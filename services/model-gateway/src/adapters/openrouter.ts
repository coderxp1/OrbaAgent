import {
  type ChatCompletionRequest,
  type NormalizedEvent,
  OrbaError,
  type ProviderId,
  type ToolCall,
  type UsageStats,
} from "@orbaagent/shared";
import type { IModelProviderAdapter } from "./base.js";

export interface OpenRouterAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class OpenRouterAdapter implements IModelProviderAdapter {
  public readonly providerId: ProviderId = "openrouter";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config?: OpenRouterAdapterConfig) {
    const rawKey = config?.apiKey || process.env.OPENROUTER_API_KEY;
    this.apiKey = rawKey && rawKey !== "undefined" ? rawKey : undefined;
    this.baseUrl =
      config?.baseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    this.timeoutMs = config?.timeoutMs || Number(process.env.OPENROUTER_TIMEOUT_MS) || 15000;
    this.maxRetries = config?.maxRetries ?? Number(process.env.OPENROUTER_MAX_RETRIES ?? 2);
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
        "OpenRouter API key (OPENROUTER_API_KEY) is missing in production environment",
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
        "OpenRouter API key missing. Set OPENROUTER_API_KEY or enable development mocks.",
        "MISSING_API_KEY",
        401,
      );
    }

    let response: Response | null = null;
    let lastError: Error | null = null;

    // Bounded retries for connection & initial HTTP request
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://orbaagent.dev",
            "X-Title": "OrbaAgent Intelligence Gateway",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: request.modelId || "openrouter/auto",
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

        if (!res.ok) {
          const errorText = await res.text().catch(() => "Unknown OpenRouter error");

          // Explicit Error Classification
          if (res.status === 401 || res.status === 403) {
            throw new OrbaError(
              `OpenRouter authentication error (${res.status}): ${errorText}`,
              "MISSING_PRODUCTION_CREDENTIALS",
              res.status,
            );
          }

          if (res.status === 400) {
            throw new OrbaError(
              `OpenRouter invalid request error (${res.status}): ${errorText}`,
              "INVALID_REQUEST",
              400,
            );
          }

          const isRetryableStatus = res.status === 429 || res.status >= 500;
          const err = new OrbaError(
            `OpenRouter API error (${res.status}): ${errorText}`,
            res.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
            res.status,
          );

          if (isRetryableStatus && attempt < this.maxRetries) {
            lastError = err;
            await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
            continue;
          }
          throw err;
        }

        response = res;
        break;
      } catch (err: unknown) {
        clearTimeout(timer);
        if (
          err instanceof OrbaError &&
          (err.code === "MISSING_PRODUCTION_CREDENTIALS" || err.code === "INVALID_REQUEST")
        ) {
          throw err; // Non-retryable errors fail immediately closed
        }

        const isAbort = err instanceof Error && err.name === "AbortError";
        const formattedErr = isAbort
          ? new OrbaError(
              `OpenRouter request timed out after ${this.timeoutMs}ms`,
              "PROVIDER_TIMEOUT",
              504,
            )
          : err instanceof Error
            ? err
            : new Error(String(err));

        lastError = formattedErr;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
          continue;
        }
        throw formattedErr;
      }
    }

    if (!response) {
      throw lastError || new Error("Failed to connect to OpenRouter API after retries");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response reader from OpenRouter API");

    // Unified cancellation controller controlling stream reader, chunk timeout, and cleanup
    const controller = new AbortController();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    let streamTimer: NodeJS.Timeout | null = null;
    const resetStreamTimer = () => {
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = setTimeout(() => {
        controller.abort(
          new OrbaError(
            `OpenRouter stream stalled: no chunk received for ${this.timeoutMs}ms`,
            "PROVIDER_TIMEOUT",
            504,
          ),
        );
      }, this.timeoutMs);
    };

    resetStreamTimer();

    try {
      while (true) {
        if (controller.signal.aborted) {
          throw (
            controller.signal.reason ||
            new OrbaError(
              `OpenRouter stream timed out after ${this.timeoutMs}ms`,
              "PROVIDER_TIMEOUT",
              504,
            )
          );
        }

        const readPromise = reader.read();
        const timeoutPromise = new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(
              controller.signal.reason ||
                new OrbaError(
                  `OpenRouter stream timed out after ${this.timeoutMs}ms`,
                  "PROVIDER_TIMEOUT",
                  504,
                ),
            );
          });
        });

        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        if (done) break;

        resetStreamTimer();

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
              // Ignore invalid SSE JSON chunk
            }
          }
        }
      }

      yield { type: "done", traceId: request.trace.traceId, finishReason: "stop" };
    } finally {
      if (streamTimer) clearTimeout(streamTimer);
      try {
        await reader.cancel();
      } catch {
        // Reader cancellation cleanup
      }
    }
  }

  private async *streamMock(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    yield {
      type: "thinking_delta",
      traceId: request.trace.traceId,
      thinkingDelta:
        "[OpenRouter Fallback Engine] Operating fallback intelligence route for OrbaAgent task...",
    };

    const responseText = "OrbaAgent executing task via OpenRouter fallback provider pipeline.";
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
      usage: { promptTokens: 15, completionTokens: 35, totalTokens: 50 },
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
