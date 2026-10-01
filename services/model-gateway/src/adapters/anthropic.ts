import type {
  ChatCompletionRequest,
  ChatMessage,
  NormalizedEvent,
  ProviderId,
  ToolCall,
  ToolDefinition,
  UsageStats,
} from "@orbaagent/shared";
import type { IModelProviderAdapter } from "./base.js";

export class AnthropicAdapter implements IModelProviderAdapter {
  readonly providerId: ProviderId = "anthropic";

  constructor(
    private readonly apiKey: string = process.env.ANTHROPIC_API_KEY || "",
    private readonly baseUrl: string = process.env.ANTHROPIC_BASE_URL ||
      "https://api.anthropic.com/v1",
  ) {}

  async *streamChat(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const traceId = request.trace.traceId;
    const isMock = !this.apiKey || process.env.USE_MOCK_PROVIDERS === "true";

    if (isMock) {
      yield {
        type: "thinking_delta",
        traceId,
        thinkingDelta: "Claude 3.5 Sonnet formulating step-by-step reasoning plan...",
      };

      const mockText = `[Anthropic Claude Stream Output for ${request.modelId}] Hello! I am OrbaAgent powered by Anthropic. Received message: "${
        request.messages[request.messages.length - 1]?.content || ""
      }".`;

      for (const word of mockText.split(" ")) {
        yield {
          type: "text_delta",
          traceId,
          textDelta: `${word} `,
        };
      }

      yield {
        type: "usage",
        traceId,
        usage: {
          promptTokens: 40,
          completionTokens: 35,
          totalTokens: 75,
        },
      };

      yield {
        type: "done",
        traceId,
        finishReason: "end_turn",
      };
      return;
    }

    try {
      const systemMessage =
        request.systemPrompt ||
        request.messages.find((m: ChatMessage) => m.role === "system")?.content;
      const userAssistantMessages = request.messages.filter(
        (m: ChatMessage) => m.role !== "system",
      );

      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: request.modelId,
          system: systemMessage,
          messages: userAssistantMessages.map((m: ChatMessage) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
          tools: request.tools
            ? request.tools.map((t: ToolDefinition) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              }))
            : undefined,
          max_tokens: request.maxTokens || 4096,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: "error",
          traceId,
          error: {
            code: `anthropic_error_${response.status}`,
            message: `Anthropic API returned HTTP ${response.status}: ${errorText}`,
            retryable: response.status >= 500 || response.status === 429,
          },
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            if (json.type === "content_block_delta") {
              if (json.delta?.type === "text_delta") {
                yield { type: "text_delta", traceId, textDelta: json.delta.text };
              } else if (json.delta?.type === "thinking_delta") {
                yield { type: "thinking_delta", traceId, thinkingDelta: json.delta.thinking };
              }
            } else if (json.type === "message_delta" && json.usage) {
              yield {
                type: "usage",
                traceId,
                usage: {
                  promptTokens: json.usage.input_tokens || 0,
                  completionTokens: json.usage.output_tokens || 0,
                  totalTokens: (json.usage.input_tokens || 0) + (json.usage.output_tokens || 0),
                },
              };
            } else if (json.type === "message_stop") {
              yield { type: "done", traceId, finishReason: "end_turn" };
            }
          } catch {
            // Ignore non-JSON payload
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        traceId,
        error: { code: "anthropic_connection_error", message: msg, retryable: true },
      };
    }
  }

  async chat(request: ChatCompletionRequest): Promise<{
    text: string;
    thinking?: string;
    toolCalls?: ToolCall[];
    usage: UsageStats;
    finishReason: string;
  }> {
    let text = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];
    let usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = "end_turn";

    for await (const event of this.streamChat(request)) {
      if (event.type === "text_delta" && event.textDelta) text += event.textDelta;
      else if (event.type === "thinking_delta" && event.thinkingDelta)
        thinking += event.thinkingDelta;
      else if (event.type === "usage" && event.usage) usage = event.usage;
      else if (event.type === "done" && event.finishReason) finishReason = event.finishReason;
    }

    return { text, thinking: thinking || undefined, toolCalls, usage, finishReason };
  }
}
