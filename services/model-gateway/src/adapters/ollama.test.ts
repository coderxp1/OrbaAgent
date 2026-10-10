import type { ChatCompletionRequest, NormalizedEvent } from "@orbaagent/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OllamaAdapter } from "./ollama.js";

describe("OllamaAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("configures defaults and WireGuard endpoint", () => {
    delete process.env.OLLAMA_BASE_URL;
    const adapter = new OllamaAdapter();
    expect(adapter.providerId).toBe("ollama");
    expect(adapter.getBaseUrl()).toBe("http://10.77.0.2:11435");
  });

  it("accepts custom base URL and timeout parameters", () => {
    const adapter = new OllamaAdapter({
      baseUrl: "http://10.77.0.2:11435/",
      timeouts: {
        connectTimeoutMs: 1500,
        warmupTimeoutMs: 30000,
        firstTokenTimeoutMs: 8000,
        requestTimeoutMs: 60000,
      },
    });
    expect(adapter.getBaseUrl()).toBe("http://10.77.0.2:11435");
  });

  it("streams mock completions correctly when mock providers are enabled", async () => {
    process.env.USE_MOCK_PROVIDERS = "true";
    const adapter = new OllamaAdapter();

    const request: ChatCompletionRequest = {
      modelId: "qwen2.5-coder:32b",
      messages: [{ role: "user", content: "Write a hello world in Rust" }],
      stream: true,
      trace: {
        traceId: "tr_test",
        tenantId: "t_test",
        userId: "u_test",
        conversationId: "c_test",
        agentRunId: "r_test",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of adapter.streamChat(request)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(3);
    const thinkingEvent = events.find((e) => e.type === "thinking_delta");
    expect(thinkingEvent).toBeDefined();

    const contentEvents = events.filter((e) => e.type === "text_delta");
    expect(contentEvents.length).toBeGreaterThan(0);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.finishReason).toBe("stop");

    const usageEvent = events.find((e) => e.type === "usage");
    expect(usageEvent).toBeDefined();
    expect(usageEvent?.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("streams mock tool calls when tools are requested", async () => {
    process.env.USE_MOCK_PROVIDERS = "true";
    const adapter = new OllamaAdapter();

    const request: ChatCompletionRequest = {
      modelId: "qwen2.5-coder:32b",
      messages: [{ role: "user", content: "Run bash command" }],
      stream: true,
      tools: [
        {
          name: "execute_command",
          description: "Run a shell command",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
      trace: {
        traceId: "tr_test",
        tenantId: "t_test",
        userId: "u_test",
        conversationId: "c_test",
        agentRunId: "r_test",
      },
    };

    const events: NormalizedEvent[] = [];
    for await (const event of adapter.streamChat(request)) {
      events.push(event);
    }

    const toolCallEvent = events.find((e) => e.type === "tool_call_start");
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent?.toolCall).toBeDefined();
    expect(toolCallEvent?.toolCall?.name).toBe("execute_command");
  });
});
