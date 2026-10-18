import {
  type ChatCompletionRequest,
  type NormalizedEvent,
  OrbaError,
  type ProviderId,
  type ToolCall,
  type UsageStats,
} from "@orbaagent/shared";
import type { IModelProviderAdapter } from "./base.js";

export interface OllamaTimeoutConfig {
  connectTimeoutMs?: number;
  warmupTimeoutMs?: number;
  firstTokenTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface OllamaAdapterConfig {
  baseUrl?: string;
  apiKey?: string;
  timeouts?: OllamaTimeoutConfig;
  maxRetries?: number;
}

export class OllamaAdapter implements IModelProviderAdapter {
  public readonly providerId: ProviderId = "ollama";
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly maxRetries: number;
  private readonly timeouts: Required<OllamaTimeoutConfig>;

  constructor(config?: OllamaAdapterConfig) {
    this.baseUrl = (
      config?.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      "http://10.77.0.2:11435"
    ).replace(/\/+$/, "");
    this.apiKey = config?.apiKey || process.env.OLLAMA_API_KEY || undefined;
    this.maxRetries = config?.maxRetries ?? Number(process.env.OLLAMA_MAX_RETRIES ?? 1);
    this.timeouts = {
      connectTimeoutMs:
        config?.timeouts?.connectTimeoutMs ?? Number(process.env.OLLAMA_CONNECT_TIMEOUT_MS ?? 2500),
      warmupTimeoutMs:
        config?.timeouts?.warmupTimeoutMs ?? Number(process.env.OLLAMA_WARMUP_TIMEOUT_MS ?? 45000),
      firstTokenTimeoutMs:
        config?.timeouts?.firstTokenTimeoutMs ??
        Number(process.env.OLLAMA_FIRST_TOKEN_TIMEOUT_MS ?? 12000),
      requestTimeoutMs:
        config?.timeouts?.requestTimeoutMs ??
        Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? 120000),
    };
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  async *streamChat(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const isMock =
      process.env.USE_MOCK_PROVIDERS === "true" || process.env.ALLOW_MOCK_PROVIDERS === "true";

    if (isMock) {
      yield* this.streamMock(request);
      return;
    }

    let response: Response | null = null;
    let lastError: Error | null = null;

    const requestBody = this.buildOpenAIPayload(request, true);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      // Allow longer deadline if model might be cold-loading
      const deadline = this.timeouts.warmupTimeoutMs;
      const timer = setTimeout(() => controller.abort(), deadline);

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (this.apiKey) {
          headers.Authorization = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify(requestBody),
        });

        clearTimeout(timer);

        if (res.ok) {
          response = res;
          break;
        }

        const errText = await res.text().catch(() => "Unknown error");
        if (res.status === 404) {
          throw new OrbaError(
            `Ollama model '${request.modelId}' not found on local instance: ${errText}`,
            "MODEL_NOT_FOUND",
            404,
          );
        }
        if (res.status === 503 || res.status === 429) {
          throw new OrbaError(
            `Ollama instance busy or capacity saturated: ${errText}`,
            "CAPACITY_EXHAUSTED",
            res.status,
          );
        }

        throw new OrbaError(`Ollama HTTP ${res.status}: ${errText}`, "OLLAMA_ERROR", res.status);
      } catch (err: unknown) {
        clearTimeout(timer);
        lastError = err as Error;

        if (err instanceof OrbaError && err.code === "MODEL_NOT_FOUND") {
          throw err;
        }

        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    if (!response || !response.body) {
      throw new OrbaError(
        `Failed to communicate with local Ollama service: ${lastError?.message || "Unknown error"}`,
        "OLLAMA_CONNECTION_FAILED",
        503,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const activeToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
    let emittedFirstToken = false;
    let firstTokenTimer: NodeJS.Timeout | null = null;

    const streamController = new AbortController();
    firstTokenTimer = setTimeout(() => {
      if (!emittedFirstToken) {
        streamController.abort();
      }
    }, this.timeouts.firstTokenTimeoutMs);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            // Emit any pending tool calls
            for (const [, tc] of activeToolCalls.entries()) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.args || "{}");
              } catch {
                parsedArgs = { raw: tc.args };
              }
              yield {
                type: "tool_call_start",
                traceId: request.trace.traceId,
                toolCall: {
                  id: tc.id || `call_${Date.now()}`,
                  name: tc.name,
                  arguments: parsedArgs,
                },
              };
            }
            yield { type: "done", traceId: request.trace.traceId, finishReason: "stop" };
            return;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (delta) {
              if (!emittedFirstToken) {
                emittedFirstToken = true;
                if (firstTokenTimer) {
                  clearTimeout(firstTokenTimer);
                  firstTokenTimer = null;
                }
              }

              // Handle thinking / reasoning delta (e.g. DeepSeek-R1 / Qwen reasoning)
              if (delta.reasoning_content || delta.thinking) {
                yield {
                  type: "thinking_delta",
                  traceId: request.trace.traceId,
                  thinkingDelta: delta.reasoning_content || delta.thinking,
                };
              }

              // Handle text content delta
              if (delta.content) {
                yield {
                  type: "text_delta",
                  traceId: request.trace.traceId,
                  textDelta: delta.content,
                };
              }

              // Handle tool call deltas
              if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const existing = activeToolCalls.get(idx) || {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    args: "",
                  };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                  activeToolCalls.set(idx, existing);
                }
              }
            }

            if (parsed.usage) {
              const usage: UsageStats = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
              };
              yield { type: "usage", traceId: request.trace.traceId, usage };
            }
          } catch {
            // Skip unparseable SSE line
          }
        }
      }
    } finally {
      if (firstTokenTimer) {
        clearTimeout(firstTokenTimer);
      }
      reader.releaseLock();
    }
  }

  async chat(request: ChatCompletionRequest): Promise<{
    text: string;
    thinking?: string;
    toolCalls?: ToolCall[];
    usage: UsageStats;
    finishReason: string;
  }> {
    const isMock =
      process.env.USE_MOCK_PROVIDERS === "true" || process.env.ALLOW_MOCK_PROVIDERS === "true";

    if (isMock) {
      return this.chatMock(request);
    }

    const payload = this.buildOpenAIPayload(request, false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeouts.requestTimeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new OrbaError(`Ollama HTTP ${res.status}: ${errText}`, "OLLAMA_ERROR", res.status);
      }

      const data = await res.json();
      const message = data.choices?.[0]?.message;

      const toolCalls: ToolCall[] = (message?.tool_calls || []).map(
        (tc: { id?: string; function?: { name?: string; arguments?: string } }) => {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function?.arguments || "{}");
          } catch {
            parsedArgs = { raw: tc.function?.arguments };
          }
          return {
            id: tc.id || `call_${Date.now()}`,
            name: tc.function?.name || "",
            arguments: parsedArgs,
          };
        },
      );

      return {
        text: message?.content || "",
        thinking: message?.reasoning_content || message?.thinking || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason: data.choices?.[0]?.finish_reason || "stop",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private buildOpenAIPayload(
    request: ChatCompletionRequest,
    stream: boolean,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.modelId || "qwen2.5-coder:32b",
      stream,
      messages: request.messages.map((m) => {
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
              },
            })),
          };
        }
        if (m.role === "tool") {
          return {
            role: "tool",
            tool_call_id: m.toolCallId || "call_default",
            content: m.content,
          };
        }
        return {
          role: m.role,
          content: m.content,
        };
      }),
    };

    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return payload;
  }

  private async *streamMock(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    yield {
      type: "thinking_delta",
      traceId: request.trace.traceId,
      thinkingDelta: `[Local Intelligence Engine] Formulating execution plan for model ${request.modelId || "local-default"}...`,
    };

    if (request.tools && request.tools.length > 0) {
      yield {
        type: "tool_call_start",
        traceId: request.trace.traceId,
        toolCall: {
          id: `call_${Date.now()}`,
          name: request.tools[0].name,
          arguments: { command: "uptime" },
        },
      };
    }

    const responseText = `[Local Intelligence Engine] Execution completed safely for model ${request.modelId || "local-default"}.`;
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
      usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
    };

    yield { type: "done", traceId: request.trace.traceId, finishReason: "stop" };
  }

  private async chatMock(request: ChatCompletionRequest): Promise<{
    text: string;
    thinking?: string;
    toolCalls?: ToolCall[];
    usage: UsageStats;
    finishReason: string;
  }> {
    const toolCalls: ToolCall[] =
      request.tools && request.tools.length > 0
        ? [
            {
              id: `call_${Date.now()}`,
              name: request.tools[0].name,
              arguments: { command: "uptime" },
            },
          ]
        : [];

    return {
      text: `[Local Intelligence Engine] Mock completion for model ${request.modelId || "local-default"}.`,
      thinking: "[Local Intelligence Engine] Formulating plan...",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
      finishReason: "stop",
    };
  }
}
