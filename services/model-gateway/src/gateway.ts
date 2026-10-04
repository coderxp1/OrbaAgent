import type {
  AuditLogEvent,
  ChatCompletionRequest,
  NormalizedEvent,
  ProviderAttempt,
  ProviderId,
  ToolCall,
  UsageStats,
} from "@orbaagent/shared";
import type { IModelProviderAdapter } from "./adapters/base.js";
import { LangdockAdapter } from "./adapters/langdock.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { getModelSpec, recordLocalUsage } from "./registry.js";
import { IntelligenceRouter, type RoutingDecision } from "./router.js";

export const ORBAAGENT_SYSTEM_PROMPT = `You are OrbaAgent, an autonomous AI software engineering platform.
You must ALWAYS identify yourself ONLY as OrbaAgent.
NEVER mention underlying AI provider names (such as OpenAI, Anthropic, Langdock, OpenRouter, GLM, Z.ai, DeepSeek, Meta, Llama, Google, Gemini, Qwen, etc.) or internal model names in your user-facing responses.
If asked who trained you or what model you are using, state clearly and professionally that you are OrbaAgent, built by OrbaAgent.
Maintain a helpful, concise, engineering-focused tone.`;

export function sanitizeProviderLeakage(text: string): string {
  if (!text) return text;
  let sanitized = text;

  // Specific regex replacements for known self-identification leaks
  // GLM / Z.ai leaks
  sanitized = sanitized.replace(
    /I'm the GLM language model trained by Z\.ai/gi,
    "I'm OrbaAgent, an autonomous AI platform",
  );
  sanitized = sanitized.replace(/GLM language model trained by Z\.ai/gi, "OrbaAgent");
  sanitized = sanitized.replace(/trained by Z\.ai/gi, "developed by OrbaAgent");
  sanitized = sanitized.replace(/GLM-4|GLM-3|GLM-4o|Z\.ai/gi, "OrbaAgent");

  // OpenAI / ChatGPT / GPT model leaks
  sanitized = sanitized.replace(/trained by OpenAI/gi, "developed by OrbaAgent");
  sanitized = sanitized.replace(/created by OpenAI/gi, "created by OrbaAgent");
  sanitized = sanitized.replace(/I am ChatGPT/gi, "I am OrbaAgent");
  sanitized = sanitized.replace(/I'm ChatGPT/gi, "I'm OrbaAgent");

  // Anthropic / Claude leaks
  sanitized = sanitized.replace(/trained by Anthropic/gi, "developed by OrbaAgent");
  sanitized = sanitized.replace(/created by Anthropic/gi, "created by OrbaAgent");
  sanitized = sanitized.replace(/I am Claude/gi, "I am OrbaAgent");
  sanitized = sanitized.replace(/I'm Claude/gi, "I'm OrbaAgent");

  // OpenRouter / Langdock internal provider references
  sanitized = sanitized.replace(/OpenRouter Fallback Engine/gi, "OrbaAgent Engine");
  sanitized = sanitized.replace(/OpenRouter Engine/gi, "OrbaAgent Engine");
  sanitized = sanitized.replace(/Langdock Engine/gi, "OrbaAgent Engine");

  return sanitized;
}

function prepareEnrichedRequest(request: ChatCompletionRequest): ChatCompletionRequest {
  const messages = [...request.messages];
  const hasSystem = messages.length > 0 && messages[0].role === "system";

  if (!hasSystem) {
    messages.unshift({
      role: "system",
      content: ORBAAGENT_SYSTEM_PROMPT,
    });
  } else if (!messages[0].content.includes("OrbaAgent")) {
    messages[0] = {
      ...messages[0],
      content: `${ORBAAGENT_SYSTEM_PROMPT}\n\n${messages[0].content}`,
    };
  }

  return {
    ...request,
    messages,
  };
}

export class ModelGateway {
  private readonly adapters: Record<ProviderId, IModelProviderAdapter>;
  public readonly router: IntelligenceRouter;
  public readonly auditLogs: AuditLogEvent[] = [];

  constructor(
    customAdapters?: Partial<Record<ProviderId, IModelProviderAdapter>>,
    customRouter?: IntelligenceRouter,
  ) {
    this.adapters = {
      langdock: customAdapters?.langdock || new LangdockAdapter(),
      openrouter: customAdapters?.openrouter || new OpenRouterAdapter(),
    };
    this.router = customRouter || new IntelligenceRouter();
  }

  getAdapterForModel(modelId: string): { adapter: IModelProviderAdapter; providerId: ProviderId } {
    const spec = getModelSpec(modelId);
    const adapter = this.adapters[spec.provider];
    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${spec.provider}`);
    }
    return { adapter, providerId: spec.provider };
  }

  async *streamChat(
    rawRequest: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const startTime = new Date();
    const request = prepareEnrichedRequest(rawRequest);
    const trace = request.trace;

    let routing: RoutingDecision;
    try {
      routing = this.router.selectRouting(request);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        traceId: trace.traceId,
        error: {
          code: "all_providers_unavailable",
          message: errMsg,
          retryable: true,
        },
      };

      const auditEvent: AuditLogEvent = {
        traceId: trace.traceId,
        tenantId: trace.tenantId,
        userId: trace.userId,
        conversationId: trace.conversationId,
        agentRunId: trace.agentRunId,
        provider: "langdock",
        model: "gpt-5.4",
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString(),
        latencyMs: Date.now() - startTime.getTime(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        toolCallsCount: 0,
        status: "error",
        errorMessage: errMsg,
        providerAttempts: [],
      };
      this.auditLogs.push(auditEvent);
      return;
    }

    const candidateModels = [routing.primaryModel, ...routing.fallbackChain];

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let toolCallsCount = 0;
    let finalStatus: "success" | "error" | "cancelled" = "success";
    let finalErrorMessage: string | undefined;

    const providerAttempts: ProviderAttempt[] = [];
    let successfulModel = routing.primaryModel;
    let streamSucceeded = false;
    let emittedFailoverNotice = false;
    const executedToolCallIds = new Set<string>();

    for (let i = 0; i < candidateModels.length; i++) {
      const currentModel = candidateModels[i];
      const attemptStart = Date.now();
      let hasYieldedTextDelta = false;

      try {
        const { adapter } = this.getAdapterForModel(currentModel.id);
        const actualRequest: ChatCompletionRequest = {
          ...request,
          modelId: currentModel.id,
        };

        let streamBuffer = "";
        for await (const event of adapter.streamChat(actualRequest)) {
          if (event.type === "text_delta" && event.textDelta) {
            hasYieldedTextDelta = true;
            streamBuffer += event.textDelta;

            const breakIdx = Math.max(
              streamBuffer.lastIndexOf(" "),
              streamBuffer.lastIndexOf("\n"),
              streamBuffer.lastIndexOf("."),
              streamBuffer.lastIndexOf("!"),
              streamBuffer.lastIndexOf("?"),
              streamBuffer.lastIndexOf(","),
            );

            if (breakIdx >= 0) {
              const readyChunk = streamBuffer.slice(0, breakIdx + 1);
              streamBuffer = streamBuffer.slice(breakIdx + 1);
              const cleanReady = sanitizeProviderLeakage(readyChunk);
              if (cleanReady) {
                yield { ...event, textDelta: cleanReady };
              }
            }
          } else if (event.type === "thinking_delta" && event.thinkingDelta) {
            const cleanThinking = sanitizeProviderLeakage(event.thinkingDelta);
            if (cleanThinking) {
              yield { ...event, thinkingDelta: cleanThinking };
            }
          } else if (event.type === "usage" && event.usage) {
            promptTokens = event.usage.promptTokens;
            completionTokens = event.usage.completionTokens;
            totalTokens = event.usage.totalTokens;
            yield event;
          } else if (event.type === "tool_call_start" && event.toolCall) {
            const toolCallKey =
              event.toolCall.id ||
              `${event.toolCall.name}:${JSON.stringify(event.toolCall.arguments)}`;
            if (executedToolCallIds.has(toolCallKey)) {
              // Idempotency: skip duplicate tool execution on route failover
              continue;
            }
            executedToolCallIds.add(toolCallKey);
            toolCallsCount++;
            yield event;
          } else if (event.type === "error" && event.error) {
            throw new Error(event.error.message);
          } else {
            yield event;
          }
        }

        if (streamBuffer.length > 0) {
          const cleanFinal = sanitizeProviderLeakage(streamBuffer);
          if (cleanFinal) {
            yield { type: "text_delta", traceId: trace.traceId, textDelta: cleanFinal };
          }
        }

        const attemptLatency = Date.now() - attemptStart;
        providerAttempts.push({
          provider: currentModel.provider,
          model: currentModel.id,
          status: "success",
          latencyMs: attemptLatency,
        });

        this.router.recordProviderSuccess(currentModel.provider, currentModel.id);
        // Only record quota usage on SUCCESSFUL request completions
        recordLocalUsage(currentModel.id, totalTokens || 50, trace.tenantId);
        successfulModel = currentModel;
        streamSucceeded = true;
        break; // Stream succeeded, break failover loop
      } catch (err: unknown) {
        const attemptLatency = Date.now() - attemptStart;
        const errMsg = err instanceof Error ? err.message : String(err);
        const lowerMsg = errMsg.toLowerCase();
        const isTimeout = lowerMsg.includes("timeout") || lowerMsg.includes("timed out");

        providerAttempts.push({
          provider: currentModel.provider,
          model: currentModel.id,
          status: isTimeout ? "timeout" : "error",
          latencyMs: attemptLatency,
          errorMessage: errMsg,
        });

        this.router.recordProviderFailure(currentModel.provider, currentModel.id);

        // Handle partial stream failure: issue reset signal if deltas were already emitted
        if (hasYieldedTextDelta) {
          yield {
            type: "stream_reset",
            traceId: trace.traceId,
            resetReason: "Execution route reset due to stream interruption",
          };
        }

        if (i < candidateModels.length - 1) {
          const currentProvider = candidateModels[i].provider;
          const nextProvider = candidateModels[i + 1].provider;
          // Emit route optimization notice only when transitioning between provider families
          if (currentProvider !== nextProvider && !emittedFailoverNotice) {
            emittedFailoverNotice = true;
            yield {
              type: "thinking_delta",
              traceId: trace.traceId,
              thinkingDelta:
                "\n[OrbaAgent Engine] Optimizing execution route for task completion...\n",
            };
          }
        } else {
          finalStatus = "error";
          finalErrorMessage = errMsg;
          yield {
            type: "error",
            traceId: trace.traceId,
            error: {
              code: "all_providers_unavailable",
              message: `Task execution failed across available routes. Last error: ${errMsg}`,
              retryable: true,
            },
          };
        }
      }
    }

    const endTime = new Date();
    const latencyMs = endTime.getTime() - startTime.getTime();

    const auditEvent: AuditLogEvent = {
      traceId: trace.traceId,
      tenantId: trace.tenantId,
      userId: trace.userId,
      conversationId: trace.conversationId,
      agentRunId: trace.agentRunId,
      provider: successfulModel.provider,
      model: successfulModel.id,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens,
      toolCallsCount,
      status: streamSucceeded ? "success" : finalStatus,
      errorMessage: finalErrorMessage,
      providerAttempts,
    };

    this.auditLogs.push(auditEvent);
    console.log(`[ModelGateway Audit] ${JSON.stringify(auditEvent)}`);
  }

  async chat(request: ChatCompletionRequest): Promise<{
    text: string;
    thinking?: string;
    toolCalls?: ToolCall[];
    usage: UsageStats;
    finishReason: string;
    audit: AuditLogEvent;
  }> {
    let text = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];
    let usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = "stop";

    for await (const event of this.streamChat(request)) {
      if (event.type === "stream_reset") {
        text = ""; // Reset text on partial stream failover
      } else if (event.type === "text_delta" && event.textDelta) {
        text += event.textDelta;
      } else if (event.type === "thinking_delta" && event.thinkingDelta) {
        thinking += event.thinkingDelta;
      } else if (event.type === "tool_call_start" && event.toolCall) {
        toolCalls.push(event.toolCall);
      } else if (event.type === "usage" && event.usage) {
        usage = event.usage;
      } else if (event.type === "done" && event.finishReason) {
        finishReason = event.finishReason;
      }
    }

    const audit = this.auditLogs[this.auditLogs.length - 1];
    return { text, thinking: thinking || undefined, toolCalls, usage, finishReason, audit };
  }
}
