import type {
  AuditLogEvent,
  ChatCompletionRequest,
  NormalizedEvent,
  ProviderId,
  ToolCall,
  UsageStats,
} from "@orbaagent/shared";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import type { IModelProviderAdapter } from "./adapters/base.js";
import { GoogleAdapter } from "./adapters/google.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { XAIAdapter } from "./adapters/xai.js";
import { getModelSpec } from "./registry.js";
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
      xai: customAdapters?.xai || new XAIAdapter(),
      openai: customAdapters?.openai || new OpenAIAdapter(),
      anthropic: customAdapters?.anthropic || new AnthropicAdapter(),
      google: customAdapters?.google || new GoogleAdapter(),
      local: customAdapters?.local || new OpenAIAdapter(),
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

    // Use OrbaAgent Intelligence Router to select optimal primary model & fallback chain
    const routing = this.router.selectRouting(request);
    const targetModel = routing.primaryModel;

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let toolCallsCount = 0;
    let status: "success" | "error" | "cancelled" = "success";
    let errorMessage: string | undefined;

    const actualRequest: ChatCompletionRequest = {
      ...request,
      modelId: targetModel.id,
    };

    const { adapter, providerId } = this.getAdapterForModel(targetModel.id);

    try {
      for await (const event of adapter.streamChat(actualRequest)) {
        if (event.type === "usage" && event.usage) {
          promptTokens = event.usage.promptTokens;
          completionTokens = event.usage.completionTokens;
          totalTokens = event.usage.totalTokens;
        } else if (event.type === "tool_call_start") {
          toolCallsCount++;
        } else if (event.type === "error" && event.error) {
          status = "error";
          errorMessage = event.error.message;
        }
        yield event;
      }
    } catch (err: unknown) {
      status = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        traceId: trace.traceId,
        error: {
          code: "gateway_execution_error",
          message: errorMessage,
          retryable: true,
        },
      };
    } finally {
      const endTime = new Date();
      const latencyMs = endTime.getTime() - startTime.getTime();

      const auditEvent: AuditLogEvent = {
        traceId: trace.traceId,
        tenantId: trace.tenantId,
        userId: trace.userId,
        conversationId: trace.conversationId,
        agentRunId: trace.agentRunId,
        provider: providerId,
        model: targetModel.id,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens,
        toolCallsCount,
        status,
        errorMessage,
      };

      this.auditLogs.push(auditEvent);
      console.log(`[ModelGateway Audit] ${JSON.stringify(auditEvent)}`);
    }
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
      if (event.type === "text_delta" && event.textDelta) {
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
