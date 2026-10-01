import type {
  ChatCompletionRequest,
  NormalizedEvent,
  ProviderId,
  ToolCall,
  UsageStats,
} from "@orbaagent/shared";

export interface IModelProviderAdapter {
  readonly providerId: ProviderId;
  streamChat(request: ChatCompletionRequest): AsyncGenerator<NormalizedEvent, void, unknown>;
  chat(request: ChatCompletionRequest): Promise<{
    text: string;
    thinking?: string;
    toolCalls?: ToolCall[];
    usage: UsageStats;
    finishReason: string;
  }>;
}
