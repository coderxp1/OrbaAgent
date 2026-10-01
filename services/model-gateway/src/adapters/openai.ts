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

export class OpenAIAdapter implements IModelProviderAdapter {
  readonly providerId: ProviderId = "openai";

  constructor(
    private readonly apiKey: string = process.env.OPENAI_API_KEY || "",
    private readonly baseUrl: string = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  ) {}

  async *streamChat(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const traceId = request.trace.traceId;
    const isMock = !this.apiKey || process.env.USE_MOCK_PROVIDERS === "true";

    if (isMock) {
      const mockText = `[OpenAI Stream Output for ${request.modelId}] Hello! I am OrbaAgent using OpenAI. Received message: "${
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
          promptTokens: 25,
          completionTokens: 30,
          totalTokens: 55,
        },
      };

      yield {
        type: "done",
        traceId,
        finishReason: "stop",
      };
      return;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages.map((m: ChatMessage) => ({
            role: m.role,
            content: m.content,
            name: m.name,
          })),
          tools: request.tools
            ? request.tools.map((t: ToolDefinition) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              }))
            : undefined,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: "error",
          traceId,
          error: {
            code: `openai_error_${response.status}`,
            message: `OpenAI API returned HTTP ${response.status}: ${errorText}`,
            retryable: response.status >= 500 || response.status === 429,
          },
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield {
          type: "error",
          traceId,
          error: {
            code: "no_stream_body",
            message: "OpenAI response body stream unavailable",
            retryable: false,
          },
        };
        return;
      }

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
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed === "data: [DONE]") {
            yield { type: "done", traceId, finishReason: "stop" };
            return;
          }

          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta;
              const finishReason = json.choices?.[0]?.finish_reason;

              if (delta?.content) {
                yield {
                  type: "text_delta",
                  traceId,
                  textDelta: delta.content,
                };
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  yield {
                    type: "tool_call_delta",
                    traceId,
                    toolCall: {
                      id: tc.id || `call_${tc.index}`,
                      name: tc.function?.name || "",
                      arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
                    },
                  };
                }
              }

              if (json.usage) {
                yield {
                  type: "usage",
                  traceId,
                  usage: {
                    promptTokens: json.usage.prompt_tokens || 0,
                    completionTokens: json.usage.completion_tokens || 0,
                    totalTokens: json.usage.total_tokens || 0,
                  },
                };
              }

              if (finishReason) {
                yield {
                  type: "done",
                  traceId,
                  finishReason,
                };
              }
            } catch {
              // Ignore non-JSON SSE chunk
            }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        traceId,
        error: {
          code: "openai_connection_error",
          message: msg,
          retryable: true,
        },
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
    const toolCalls: ToolCall[] = [];
    let usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = "stop";

    for await (const event of this.streamChat(request)) {
      if (event.type === "text_delta" && event.textDelta) {
        text += event.textDelta;
      } else if (event.type === "tool_call_start" && event.toolCall) {
        toolCalls.push(event.toolCall);
      } else if (event.type === "usage" && event.usage) {
        usage = event.usage;
      } else if (event.type === "done" && event.finishReason) {
        finishReason = event.finishReason;
      }
    }

    return { text, toolCalls, usage, finishReason };
  }
}
