import type { ChatCompletionRequest, NormalizedEvent } from "@orbaagent/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { IModelProviderAdapter } from "./adapters/base.js";
import { LangdockAdapter } from "./adapters/langdock.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { ModelGateway } from "./gateway.js";
import { getLocalTrackedUsage, resetLocalUsage } from "./registry.js";

describe("ModelGateway Provider Failover & Production Safety", () => {
  beforeEach(() => {
    process.env.USE_MOCK_PROVIDERS = "true";
    process.env.NODE_ENV = undefined;
    resetLocalUsage();
  });

  const sampleRequest: ChatCompletionRequest = {
    modelId: "external-gpt-4o-custom", // User override parameter to normalize/ignore
    messages: [{ role: "user", content: "Build a web application and execute terminal commands" }],
    stream: true,
    trace: {
      traceId: "test-trace-123",
      tenantId: "tenant-abc",
      userId: "user-456",
      conversationId: "conv-789",
      agentRunId: "run-001",
    },
  };

  it("should stream successfully via primary Langdock provider and record usage", async () => {
    const gateway = new ModelGateway();
    const events: NormalizedEvent[] = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);

    const usage = getLocalTrackedUsage(
      gateway.auditLogs[0].model,
      sampleRequest.trace.tenantId,
      sampleRequest.trace.credentialId,
    );
    expect(usage.requests).toBe(1);
    expect(usage.tokens).toBeGreaterThan(0);
  });

  it("should stream successfully via OpenRouter adapter directly", async () => {
    const adapter = new OpenRouterAdapter();
    const events: NormalizedEvent[] = [];
    for await (const event of adapter.streamChat(sampleRequest)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);
  });

  it("should failover from Langdock timeout to OpenRouter fallback", async () => {
    class TimeoutLangdockAdapter extends LangdockAdapter {
      // biome-ignore lint/correctness/useYield: Interface requirement
      override async *streamChat(): AsyncGenerator<NormalizedEvent, void, unknown> {
        throw new Error("Langdock request timed out after 15000ms");
      }
    }

    const gateway = new ModelGateway({
      langdock: new TimeoutLangdockAdapter(),
      openrouter: new OpenRouterAdapter(),
    });

    const events: NormalizedEvent[] = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    const thinkingDeltas = events
      .filter((e) => e.type === "thinking_delta")
      .map((e) => e.thinkingDelta);
    expect(thinkingDeltas.some((t) => t?.includes("Optimizing execution route"))).toBe(true);

    const latestAudit = gateway.auditLogs[gateway.auditLogs.length - 1];
    expect(latestAudit.status).toBe("success");
    expect(latestAudit.provider).toBe("openrouter");
  });

  it("should NOT consume successful request quota on failed attempts", async () => {
    class FailingLangdockAdapter extends LangdockAdapter {
      // biome-ignore lint/correctness/useYield: Interface requirement
      override async *streamChat(): AsyncGenerator<NormalizedEvent, void, unknown> {
        throw new Error("Langdock connection failed");
      }
    }

    const gateway = new ModelGateway({
      langdock: new FailingLangdockAdapter(),
      openrouter: new OpenRouterAdapter(),
    });

    for await (const _ of gateway.streamChat(sampleRequest)) {
      // Stream
    }

    const langdockUsage = getLocalTrackedUsage("gpt-5.4");
    expect(langdockUsage.requests).toBe(0); // Usage was NOT incorrectly incremented for failed attempt
  });

  it("should failover from Langdock 429/5xx error to OpenRouter fallback", async () => {
    class RateLimitedLangdockAdapter extends LangdockAdapter {
      // biome-ignore lint/correctness/useYield: Interface requirement
      override async *streamChat(): AsyncGenerator<NormalizedEvent, void, unknown> {
        throw new Error("Langdock API error (429): Rate limit exceeded");
      }
    }

    const gateway = new ModelGateway({
      langdock: new RateLimitedLangdockAdapter(),
      openrouter: new OpenRouterAdapter(),
    });

    const events: NormalizedEvent[] = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    const latestAudit = gateway.auditLogs[gateway.auditLogs.length - 1];
    expect(latestAudit.status).toBe("success");
    expect(latestAudit.provider).toBe("openrouter");
  });

  it("should handle partial-stream failover by emitting stream_reset event", async () => {
    class PartialFailingLangdockAdapter extends LangdockAdapter {
      override async *streamChat(
        req: ChatCompletionRequest,
      ): AsyncGenerator<NormalizedEvent, void, unknown> {
        yield {
          type: "text_delta",
          traceId: req.trace.traceId,
          textDelta: "Partial text generated before failure...",
        };
        throw new Error("Langdock stream connection dropped mid-transfer");
      }
    }

    const gateway = new ModelGateway({
      langdock: new PartialFailingLangdockAdapter(),
      openrouter: new OpenRouterAdapter(),
    });

    const events: NormalizedEvent[] = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    const resetEvent = events.find((e) => e.type === "stream_reset");
    expect(resetEvent).toBeDefined();

    const latestAudit = gateway.auditLogs[gateway.auditLogs.length - 1];
    expect(latestAudit.status).toBe("success");
    expect(latestAudit.provider).toBe("openrouter");
  });

  it("should handle error gracefully when all routes fail without returning mock responses", async () => {
    class FailingAdapter implements IModelProviderAdapter {
      constructor(public readonly providerId: "langdock" | "openrouter") {}
      // biome-ignore lint/correctness/useYield: Interface requirement
      async *streamChat(): AsyncGenerator<NormalizedEvent, void, unknown> {
        throw new Error(`${this.providerId} connection failed`);
      }
      async chat(): Promise<{
        text: string;
        thinking?: string;
        toolCalls?: undefined;
        usage: { promptTokens: number; completionTokens: number; totalTokens: number };
        finishReason: string;
      }> {
        throw new Error(`${this.providerId} connection failed`);
      }
    }

    const gateway = new ModelGateway({
      langdock: new FailingAdapter("langdock"),
      openrouter: new FailingAdapter("openrouter"),
    });

    const events: NormalizedEvent[] = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error?.code).toBe("all_providers_unavailable");

    const latestAudit = gateway.auditLogs[gateway.auditLogs.length - 1];
    expect(latestAudit.status).toBe("error");
  });

  it("should throw hard failure when production credentials are missing", async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMock = process.env.USE_MOCK_PROVIDERS;
    try {
      process.env.NODE_ENV = "production";
      process.env.USE_MOCK_PROVIDERS = undefined;
      process.env.LANGDOCK_API_KEY = undefined;

      const langdockAdapter = new LangdockAdapter();
      await expect(async () => {
        for await (const _ of langdockAdapter.streamChat(sampleRequest)) {
          // Should throw missing production credentials error
        }
      }).rejects.toThrow(/LANGDOCK_API_KEY/i);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.USE_MOCK_PROVIDERS = originalMock;
    }
  });

  it("should never use mock responses in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const router = new ModelGateway().router;
      expect(router.isMockAllowed()).toBe(false);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("should protect tool call execution against duplicate side effects during stream failover", async () => {
    class ToolFailingLangdockAdapter extends LangdockAdapter {
      override async *streamChat(
        req: ChatCompletionRequest,
      ): AsyncGenerator<NormalizedEvent, void, unknown> {
        yield {
          type: "tool_call_start",
          traceId: req.trace.traceId,
          toolCall: { id: "tc_123", name: "execute_command", arguments: { command: "ls" } },
        };
        throw new Error("Stream connection dropped after tool call");
      }
    }

    const gateway = new ModelGateway({
      langdock: new ToolFailingLangdockAdapter(),
      openrouter: new OpenRouterAdapter(),
    });

    const events: NormalizedEvent[] = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    // Ensure tool call event was yielded exactly once despite failover
    const toolCallEvents = events.filter((e) => e.type === "tool_call_start");
    expect(toolCallEvents.length).toBe(1);
  });

  it("should ignore user model selection and perform automatic routing", () => {
    const gateway = new ModelGateway();
    const decision = gateway.router.selectRouting({
      ...sampleRequest,
      modelId: "user-selected-custom-gpt-4o",
    });

    expect(decision.primaryModel.provider).toBe("langdock");
    expect(decision.fallbackChain.some((m) => m.provider === "openrouter")).toBe(true);
  });
});
