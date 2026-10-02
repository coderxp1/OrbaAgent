import type { ChatCompletionRequest, NormalizedEvent } from "@orbaagent/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { IModelProviderAdapter } from "./adapters/base.js";
import { LangdockAdapter } from "./adapters/langdock.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { ModelGateway } from "./gateway.js";

describe("ModelGateway Provider Failover & Production Safety", () => {
  beforeEach(() => {
    process.env.USE_MOCK_PROVIDERS = "true";
    process.env.NODE_ENV = undefined;
  });

  const sampleRequest: ChatCompletionRequest = {
    modelId: "gpt-4o-external-choice-attempt", // Should be normalized to auto
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

  it("should stream successfully via primary Langdock provider", async () => {
    const gateway = new ModelGateway();
    const events: NormalizedEvent[] = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);

    const latestAudit = gateway.auditLogs[gateway.auditLogs.length - 1];
    expect(latestAudit.provider).toBe("langdock");
    expect(latestAudit.status).toBe("success");
    expect(latestAudit.providerAttempts).toBeDefined();
    expect(latestAudit.providerAttempts?.[0].provider).toBe("langdock");
    expect(latestAudit.providerAttempts?.[0].status).toBe("success");
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
    expect(thinkingDeltas.some((t) => t?.includes("Initiating failover to openrouter"))).toBe(true);

    const latestAudit = gateway.auditLogs[gateway.auditLogs.length - 1];
    expect(latestAudit.status).toBe("success");
    expect(latestAudit.provider).toBe("openrouter");
    expect(latestAudit.providerAttempts?.length).toBe(2);
    expect(latestAudit.providerAttempts?.[0].provider).toBe("langdock");
    expect(latestAudit.providerAttempts?.[0].status).toBe("timeout");
    expect(latestAudit.providerAttempts?.[1].provider).toBe("openrouter");
    expect(latestAudit.providerAttempts?.[1].status).toBe("success");
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
    expect(latestAudit.providerAttempts?.[0].status).toBe("error");
    expect(latestAudit.providerAttempts?.[1].status).toBe("success");
  });

  it("should handle error gracefully when both Langdock and OpenRouter fail", async () => {
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
    expect(latestAudit.providerAttempts?.length).toBe(2);
    expect(latestAudit.providerAttempts?.[0].status).toBe("error");
    expect(latestAudit.providerAttempts?.[1].status).toBe("error");
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

  it("should normalize external model selection to auto", () => {
    const gateway = new ModelGateway();
    const decision = gateway.router.selectRouting({
      ...sampleRequest,
      modelId: "external-gpt-4o-custom",
    });

    expect(decision.primaryModel.provider).toBe("langdock");
    expect(decision.fallbackChain[0].provider).toBe("openrouter");
  });
});

