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
import { IntelligenceRouter } from "./router.js";

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
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const startTime = new Date();
    const trace = request.trace;

    // Intelligence Router selects internal primary model and fallback chain dynamically
    const routing = this.router.selectRouting(request);
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

        for await (const event of adapter.streamChat(actualRequest)) {
          if (event.type === "text_delta" && event.textDelta) {
            hasYieldedTextDelta = true;
          } else if (event.type === "usage" && event.usage) {
            promptTokens = event.usage.promptTokens;
            completionTokens = event.usage.completionTokens;
            totalTokens = event.usage.totalTokens;
          } else if (event.type === "tool_call_start") {
            toolCallsCount++;
          } else if (event.type === "error" && event.error) {
            throw new Error(event.error.message);
          }
          yield event;
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
        recordLocalUsage(currentModel.id, totalTokens || 50);
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
          yield {
            type: "thinking_delta",
            traceId: trace.traceId,
            thinkingDelta:
              "\n[OrbaAgent Engine] Optimizing execution route for task completion...\n",
          };
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
