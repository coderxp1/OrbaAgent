import type { ChatCompletionRequest, NormalizedEvent } from "@orbaagent/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { IModelProviderAdapter } from "./adapters/base.js";
import { MODEL_CATALOG } from "./catalog.js";
import { ModelGateway } from "./gateway.js";
import { IntelligenceRouter } from "./router.js";

/**
 * Every enabled Langdock model ID in the catalog.
 *
 * Derived from the catalog rather than hardcoded: adding a model previously
 * broke the exhaust-the-pool tests because their fail-lists silently went stale.
 */
function enabledLangdockModelIds(): string[] {
  return Object.values(MODEL_CATALOG)
    .filter((m) => m.provider === "langdock" && m.enabled)
    .map((m) => m.id);
}

class MockTestAdapter implements IModelProviderAdapter {
  constructor(
    public readonly providerId: "langdock" | "openrouter",
    public readonly modelFailures: Map<string, { type: "429" | "500" | "401" | "success" }>,
  ) {}

  async *streamChat(
    request: ChatCompletionRequest,
  ): AsyncGenerator<NormalizedEvent, void, unknown> {
    const modelId = request.modelId || "auto";
    const failureConfig = this.modelFailures.get(modelId) || { type: "success" };

    if (failureConfig.type === "429") {
      throw new Error(`429 Rate limit exceeded for model ${modelId}`);
    }
    if (failureConfig.type === "500") {
      throw new Error(`500 Internal server error for model ${modelId}`);
    }
    if (failureConfig.type === "401") {
      throw new Error("401 Unauthorized: Invalid API key");
    }

    yield {
      type: "text_delta",
      traceId: request.trace.traceId,
      textDelta: `Response from ${this.providerId}:${modelId}`,
    };
    yield {
      type: "usage",
      traceId: request.trace.traceId,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
    yield {
      type: "done",
      traceId: request.trace.traceId,
      finishReason: "stop",
    };
  }

  async chat(request: ChatCompletionRequest) {
    let text = "";
    for await (const ev of this.streamChat(request)) {
      if (ev.type === "text_delta" && ev.textDelta) text += ev.textDelta;
    }
    return {
      text,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      finishReason: "stop",
    };
  }
}

describe("Model Gateway & Intelligence Pool Failover Architecture", () => {
  let router: IntelligenceRouter;

  beforeEach(() => {
    router = new IntelligenceRouter();
  });

  it("Test 1: GPT-5 rate limit (429) enters cooldown on GPT-5 only and selects next model", async () => {
    const langdockFailures = new Map<string, { type: "429" | "500" | "401" | "success" }>([
      ["gpt-5", { type: "429" }],
      ["gpt-5.1", { type: "success" }],
    ]);

    const gateway = new ModelGateway(
      {
        langdock: new MockTestAdapter("langdock", langdockFailures),
        openrouter: new MockTestAdapter("openrouter", new Map()),
      },
      router,
    );

    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Hello world" }],
      trace: {
        traceId: "t1",
        tenantId: "tenant1",
        userId: "user1",
        conversationId: "c1",
        agentRunId: "r1",
      },
    };

    const res = await gateway.chat(req);
    expect(res.text).toContain("gpt-5.1");
    expect(res.audit.model).toBe("gpt-5.1");
    expect(res.audit.provider).toBe("langdock");

    // Verify GPT-5 entered cooldown and GPT-5.1 remained available
    const gpt5Record = router.getHealthTracker().getRecord("gpt-5");
    expect(gpt5Record.status).toBe("RATE_LIMITED");
    expect(router.getHealthTracker().isModelEligible("gpt-5")).toBe(false);
    expect(router.getHealthTracker().isModelEligible("gpt-5.1")).toBe(true);
  });

  it("Test 2: Sequential rate limit failover (GPT-5 -> 429, GPT-5.1 -> 429, GPT-5.2 -> success)", async () => {
    const langdockFailures = new Map<string, { type: "429" | "500" | "401" | "success" }>([
      ["gpt-5", { type: "429" }],
      ["gpt-5.1", { type: "429" }],
      ["gpt-5.2", { type: "success" }],
    ]);

    const gateway = new ModelGateway(
      {
        langdock: new MockTestAdapter("langdock", langdockFailures),
        openrouter: new MockTestAdapter("openrouter", new Map()),
      },
      router,
    );

    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Hello world" }],
      trace: {
        traceId: "t2",
        tenantId: "tenant1",
        userId: "user1",
        conversationId: "c1",
        agentRunId: "r2",
      },
    };

    const res = await gateway.chat(req);
    expect(res.text).toContain("gpt-5.2");
    expect(res.audit.model).toBe("gpt-5.2");
    expect(res.audit.providerAttempts.length).toBe(3);
    expect(res.audit.providerAttempts[0].model).toBe("gpt-5");
    expect(res.audit.providerAttempts[1].model).toBe("gpt-5.1");
    expect(res.audit.providerAttempts[2].model).toBe("gpt-5.2");
  });

  it("Test 3: Exhausting all eligible Langdock models triggers OpenRouter auto fallback", async () => {
    // Fail every enabled Langdock model, derived from the catalog so the test
    // cannot silently go stale when a model is added or removed.
    const langdockFailures = new Map<string, { type: "429" | "500" | "401" | "success" }>();
    for (const m of enabledLangdockModelIds()) {
      langdockFailures.set(m, { type: "429" });
    }

    const gateway = new ModelGateway(
      {
        langdock: new MockTestAdapter("langdock", langdockFailures),
        openrouter: new MockTestAdapter("openrouter", new Map()),
      },
      router,
    );

    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Hello world" }],
      trace: {
        traceId: "t3",
        tenantId: "tenant1",
        userId: "user1",
        conversationId: "c1",
        agentRunId: "r3",
      },
    };

    const res = await gateway.chat(req);
    expect(res.text).toContain("openrouter:openrouter/auto");
    expect(res.audit.provider).toBe("openrouter");
    expect(res.audit.model).toBe("openrouter/auto");
  });

  it("Test 4: OpenRouter auto fails, falls over to OpenRouter free", async () => {
    // Fail every enabled Langdock model, derived from the catalog.
    const langdockFailures = new Map<string, { type: "429" | "500" | "401" | "success" }>();
    for (const m of enabledLangdockModelIds()) {
      langdockFailures.set(m, { type: "429" });
    }

    const openrouterFailures = new Map<string, { type: "429" | "500" | "401" | "success" }>([
      ["openrouter/auto", { type: "500" }],
      ["openrouter/free", { type: "success" }],
    ]);

    const gateway = new ModelGateway(
      {
        langdock: new MockTestAdapter("langdock", langdockFailures),
        openrouter: new MockTestAdapter("openrouter", openrouterFailures),
      },
      router,
    );

    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Hello world" }],
      trace: {
        traceId: "t4",
        tenantId: "tenant1",
        userId: "user1",
        conversationId: "c1",
        agentRunId: "r4",
      },
    };

    const res = await gateway.chat(req);
    expect(res.text).toContain("openrouter:openrouter/free");
    expect(res.audit.provider).toBe("openrouter");
    expect(res.audit.model).toBe("openrouter/free");
  });

  it("Test 5: Langdock authentication failure (401) marks provider unauthenticated and skips remaining models", async () => {
    const langdockFailures = new Map<string, { type: "429" | "500" | "401" | "success" }>([
      ["gpt-5", { type: "401" }],
    ]);

    const gateway = new ModelGateway(
      {
        langdock: new MockTestAdapter("langdock", langdockFailures),
        openrouter: new MockTestAdapter("openrouter", new Map()),
      },
      router,
    );

    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Hello world" }],
      trace: {
        traceId: "t5",
        tenantId: "tenant1",
        userId: "user1",
        conversationId: "c1",
        agentRunId: "r5",
      },
    };

    const res = await gateway.chat(req);
    expect(res.audit.provider).toBe("openrouter");
    expect(res.audit.model).toBe("openrouter/auto");
    // Only 1 Langdock attempt before fast-skipping the entire provider
    const langdockAttempts = res.audit.providerAttempts.filter((a) => a.provider === "langdock");
    expect(langdockAttempts.length).toBe(1);

    // Subsequent request directly routes to OpenRouter without trying Langdock
    const res2 = await gateway.chat({
      ...req,
      trace: { ...req.trace, traceId: "t5-b" },
    });
    expect(res2.audit.provider).toBe("openrouter");
    const langdockAttempts2 = res2.audit.providerAttempts.filter((a) => a.provider === "langdock");
    expect(langdockAttempts2.length).toBe(0);
  });

  it("Test 6: Model cooldown expiration restores model eligibility", () => {
    const tracker = router.getHealthTracker();
    // Simulate rate limit on GPT-5 with 50ms cooldown
    tracker.recordModelFailure("gpt-5", "RATE_LIMITED", 50);
    expect(tracker.isModelEligible("gpt-5")).toBe(false);

    // Wait for cooldown to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(tracker.isModelEligible("gpt-5")).toBe(true);
        expect(tracker.getRecord("gpt-5").status).toBe("AVAILABLE");
        resolve();
      }, 70);
    });
  });

  it("Test 7: Provider recovery clears model failure states appropriately", () => {
    const tracker = router.getHealthTracker();
    tracker.recordModelFailure("gpt-5", "RATE_LIMITED", 60000);
    tracker.recordModelFailure("gpt-5.1", "TEMPORARILY_FAILED", 60000);

    expect(tracker.isModelEligible("gpt-5")).toBe(false);
    expect(tracker.isModelEligible("gpt-5.1")).toBe(false);

    // Record success on Langdock provider
    router.recordProviderSuccess("langdock");

    expect(tracker.isModelEligible("gpt-5")).toBe(true);
    expect(tracker.isModelEligible("gpt-5.1")).toBe(true);
  });
});
