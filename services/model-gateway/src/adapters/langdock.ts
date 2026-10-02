import {
  type ChatCompletionRequest,
  type NormalizedEvent,
  OrbaError,
  type ProviderId,
  type ToolCall,
  type UsageStats,
} from "@orbaagent/shared";
import type { IModelProviderAdapter } from "./base.js";

export interface LangdockAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class LangdockAdapter implements IModelProviderAdapter {
  public readonly providerId: ProviderId = "langdock";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: LangdockAdapterConfig) {
    const rawKey = config?.apiKey || process.env.LANGDOCK_API_KEY;
    this.apiKey = rawKey && rawKey !== "undefined" ? rawKey : undefined;
    this.baseUrl =
      config?.baseUrl || process.env.LANGDOCK_BASE_URL || "https://api.langdock.com/v1";
    this.timeoutMs = config?.timeoutMs || Number(process.env.LANGDOCK_TIMEOUT_MS) || 15000;
  }

  async *streamChat(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const isProd = process.env.NODE_ENV === "production";
    const allowMock =
      process.env.USE_MOCK_PROVIDERS === "true" || process.env.ALLOW_MOCK_PROVIDERS === "true";

    // Enforce production security credentials
    if (!this.apiKey && isProd) {
      throw new OrbaError(
        "Langdock API key (LANGDOCK_API_KEY) is missing in production environment",
        "MISSING_PRODUCTION_CREDENTIALS",
        401,
      );
    }

    // Dev/Test Mock Streaming Fallback if credentials missing and mock explicitly enabled
    if (!this.apiKey && allowMock) {
      yield* this.streamMock(request);
      return;
    }

    if (!this.apiKey) {
      throw new OrbaError(
        "Langdock API key missing. Set LANGDOCK_API_KEY or enable development mocks.",
        "MISSING_API_KEY",
        401,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: request.modelId || "langdock-auto",
          messages: request.messages.map((m: { role: string; content: string }) => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens,
        }),
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown Langdock error");
        throw new OrbaError(
          `Langdock API error (${response.status}): ${errorText}`,
          response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
          response.status,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response reader from Langdock API");

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
          if (trimmed === "data: [DONE]") break;

          if (trimmed.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                yield {
                  type: "text_delta",
                  traceId: request.trace.traceId,
                  textDelta: delta.content,
                };
              }
              if (parsed.usage) {
                yield {
                  type: "usage",
                  traceId: request.trace.traceId,
                  usage: {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                  },
                };
              }
            } catch {
              // Parse error ignored for chunk
            }
          }
        }
      }

      yield { type: "done", traceId: request.trace.traceId, finishReason: "stop" };
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new OrbaError(
          `Langdock request timed out after ${this.timeoutMs}ms`,
          "PROVIDER_TIMEOUT",
          504,
        );
      }
      throw err;
    }
  }

  private async *streamMock(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    yield {
      type: "thinking_delta",
      traceId: request.trace.traceId,
      thinkingDelta: "[Langdock Engine] Analyzing task requirements and routing execution plan...",
    };

    const responseText = "OrbaAgent executing task via primary Langdock provider pipeline.";
    for (const char of responseText) {
      yield {
        type: "text_delta",
        traceId: request.trace.traceId,
        textDelta: char,
      };
    }

    yield {
      type: "usage",
      traceId: request.trace.traceId,
      usage: { promptTokens: 12, completionTokens: 40, totalTokens: 52 },
    };

    yield { type: "done", traceId: request.trace.traceId, finishReason: "stop" };
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

    return { text, thinking: thinking || undefined, toolCalls, usage, finishReason };
  }
}
