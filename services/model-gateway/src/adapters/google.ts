import type {
  ChatCompletionRequest,
  ChatMessage,
  NormalizedEvent,
  ProviderId,
  ToolCall,
  UsageStats,
} from "@orbaagent/shared";
import type { IModelProviderAdapter } from "./base.js";

export class GoogleAdapter implements IModelProviderAdapter {
  readonly providerId: ProviderId = "google";

  constructor(
    private readonly apiKey: string = process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      "",
    private readonly baseUrl: string = process.env.GOOGLE_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async *streamChat(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const traceId = request.trace.traceId;
    const isMock = !this.apiKey || process.env.USE_MOCK_PROVIDERS === "true";

    if (isMock) {
      const mockText = `[Google Gemini Stream Output for ${request.modelId}] Hello! I am OrbaAgent powered by Google Gemini. Received message: "${
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
          promptTokens: 30,
          completionTokens: 30,
          totalTokens: 60,
        },
      };

      yield {
        type: "done",
        traceId,
        finishReason: "STOP",
      };
      return;
    }

    try {
      const endpoint = `${this.baseUrl}/models/${request.modelId}:streamGenerateContent?key=${this.apiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: request.messages.map((m: ChatMessage) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature: request.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: "error",
          traceId,
          error: {
            code: `google_error_${response.status}`,
            message: `Google API returned HTTP ${response.status}: ${errorText}`,
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
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          try {
            const cleanJsonStr = trimmed.replace(/^,\s*/, "").replace(/^\[/, "").replace(/\]$/, "");
            if (!cleanJsonStr) continue;
            const json = JSON.parse(cleanJsonStr);

            const textChunk = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk) {
              yield { type: "text_delta", traceId, textDelta: textChunk };
            }

            if (json.usageMetadata) {
              yield {
                type: "usage",
                traceId,
                usage: {
                  promptTokens: json.usageMetadata.promptTokenCount || 0,
                  completionTokens: json.usageMetadata.candidatesTokenCount || 0,
                  totalTokens: json.usageMetadata.totalTokenCount || 0,
                },
              };
            }
          } catch {
            // Non-JSON buffer chunk
          }
        }
      }

      yield { type: "done", traceId, finishReason: "STOP" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        traceId,
        error: { code: "google_connection_error", message: msg, retryable: true },
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
    let finishReason = "STOP";

    for await (const event of this.streamChat(request)) {
      if (event.type === "text_delta" && event.textDelta) text += event.textDelta;
      else if (event.type === "usage" && event.usage) usage = event.usage;
      else if (event.type === "done" && event.finishReason) finishReason = event.finishReason;
    }

    return { text, toolCalls, usage, finishReason };
  }
}
