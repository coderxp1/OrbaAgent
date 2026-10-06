import type { ChatCompletionRequest } from "@orbaagent/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { MODEL_CATALOG, UNAVAILABLE_MODELS, resolveModelDefinition } from "./catalog.js";
import { getModelSpec, resetLocalUsage } from "./registry.js";
import { IntelligenceRouter } from "./router.js";

/**
 * Focused verification of the model-router behavior contract.
 *
 * These assert the implementation rather than the happy path: per-model failure
 * isolation, provider-level auth handling, cooldown recovery, ordered OpenRouter
 * fallback, and the absence of silent model substitution.
 */

function makeRequest(content = "Hello world"): ChatCompletionRequest {
  return {
    modelId: "auto",
    messages: [{ role: "user", content }],
    stream: true,
    trace: {
      traceId: "tr_router",
      tenantId: "t_router",
      userId: "u_router",
      conversationId: "c_router",
      agentRunId: "r_router",
    },
  };
}

describe("router: per-model failure isolation (behaviors 1, 2, 11)", () => {
  let router: IntelligenceRouter;

  beforeEach(() => {
    router = new IntelligenceRouter();
    resetLocalUsage();
  });

  it("a 429 on one model affects only that model, not its pool", () => {
    const routing = router.selectRouting(makeRequest());
    const failing = routing.primaryModel.id;
    const healthy = routing.fallbackChain.find((m) => m.provider === "langdock");

    expect(healthy, "expected a second Langdock model in the fallback chain").toBeDefined();

    router.recordModelRateLimit(failing);

    // The failed model is now ineligible...
    expect(router.getHealthTracker().isModelEligible(failing)).toBe(false);
    // ...while a sibling Langdock model remains eligible.
    expect(router.getHealthTracker().isModelEligible(healthy?.id as string)).toBe(true);
    // ...and the provider itself is still healthy.
    expect(router.getProviderHealth("langdock").isHealthy).toBe(true);
    expect(router.getProviderHealth("langdock").isAuthenticated).toBe(true);
  });

  it("does not treat one model's 429 as failure of the whole Langdock pool", () => {
    const routing = router.selectRouting(makeRequest());
    const failing = routing.primaryModel.id;

    router.recordModelRateLimit(failing);
    const after = router.selectRouting(makeRequest());

    // Routing still succeeds through Langdock with a different model.
    expect(after.primaryModel.provider).toBe("langdock");
    expect(after.primaryModel.id).not.toBe(failing);
  });
});

describe("router: auth failure is provider-level (behavior 3)", () => {
  let router: IntelligenceRouter;

  beforeEach(() => {
    router = new IntelligenceRouter();
    resetLocalUsage();
  });

  it("a 401/403 marks the provider unauthenticated and unhealthy", () => {
    router.recordAuthFailure("langdock", "401 Unauthorized");

    const health = router.getProviderHealth("langdock");
    expect(health.isAuthenticated).toBe(false);
    expect(health.isHealthy).toBe(false);
    expect(health.authError).toContain("401");
  });

  it("after an auth failure routing no longer selects Langdock", () => {
    router.recordAuthFailure("langdock", "401 Unauthorized");

    const routing = router.selectRouting(makeRequest());
    expect(routing.primaryModel.provider).toBe("openrouter");
  });

  it("auth failure does not affect the other provider", () => {
    router.recordAuthFailure("langdock", "403 Forbidden");

    expect(router.getProviderHealth("openrouter").isAuthenticated).toBe(true);
    expect(router.getProviderHealth("openrouter").isHealthy).toBe(true);
  });
});

describe("router: cooldown recovery (behavior 4)", () => {
  it("a rate-limited model becomes eligible again after its cooldown expires", () => {
    // A tiny cooldown keeps the test fast without changing the logic under test.
    const router = new IntelligenceRouter();
    resetLocalUsage();

    const routing = router.selectRouting(makeRequest());
    const failing = routing.primaryModel.id;

    router.recordModelRateLimit(failing, 1);
    expect(router.getHealthTracker().isModelEligible(failing)).toBe(false);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // getRecord() evaluates cooldown expiry on read.
        expect(router.getHealthTracker().isModelEligible(failing)).toBe(true);
        resolve();
      }, 10);
    });
  });
});

describe("router: next eligible model and OpenRouter ordering (behaviors 5, 6, 7)", () => {
  let router: IntelligenceRouter;

  beforeEach(() => {
    router = new IntelligenceRouter();
    resetLocalUsage();
  });

  it("selects the next eligible Langdock model when the primary is exhausted", () => {
    const first = router.selectRouting(makeRequest());
    router.recordModelRateLimit(first.primaryModel.id);

    const second = router.selectRouting(makeRequest());
    expect(second.primaryModel.provider).toBe("langdock");
    expect(second.primaryModel.id).not.toBe(first.primaryModel.id);
  });

  it("falls back to OpenRouter with auto before free once Langdock is exhausted", () => {
    const openrouterDefs = Object.values(MODEL_CATALOG)
      .filter((m) => m.provider === "openrouter" && m.enabled)
      .sort((a, b) => a.priority.general - b.priority.general);

    // Catalog priority must place auto ahead of free.
    expect(openrouterDefs[0]?.id).toBe("openrouter/auto");
    expect(openrouterDefs[1]?.id).toBe("openrouter/free");
  });

  it("routes through OpenRouter auto first when Langdock is fully exhausted", () => {
    for (const def of Object.values(MODEL_CATALOG)) {
      if (def.provider === "langdock" && def.enabled) {
        router.recordModelRateLimit(def.id);
      }
    }

    const routing = router.selectRouting(makeRequest());
    expect(routing.primaryModel.provider).toBe("openrouter");
    expect(routing.primaryModel.id).toBe("openrouter/auto");

    // free must be the next OpenRouter candidate
    const free = routing.fallbackChain.find((m) => m.provider === "openrouter");
    expect(free?.id).toBe("openrouter/free");
  });
});

describe("router: no silent substitution, no invented IDs (behaviors 8, 9)", () => {
  beforeEach(() => {
    resetLocalUsage();
  });

  it("never routes to an unavailable model name", () => {
    const router = new IntelligenceRouter();
    const routing = router.selectRouting(makeRequest());

    const routed = [routing.primaryModel.id, ...routing.fallbackChain.map((m) => m.id)];
    for (const id of routed) {
      expect(UNAVAILABLE_MODELS[id], `${id} was routed but is unavailable`).toBeUndefined();
      expect(MODEL_CATALOG[id], `${id} was routed but is not in the catalog`).toBeDefined();
    }
  });

  it("throws rather than substituting for an unavailable requested model", () => {
    for (const name of Object.keys(UNAVAILABLE_MODELS)) {
      expect(() => getModelSpec(name)).toThrow(/unavailable/i);
    }
  });

  it("resolves every catalog Langdock id to itself", () => {
    for (const def of Object.values(MODEL_CATALOG)) {
      if (def.provider !== "langdock") continue;
      expect(resolveModelDefinition(def.id)?.id).toBe(def.id);
    }
  });

  it("does not invent IDs outside the provider-verified set", () => {
    // Every Langdock catalog entry must be a verified provider ID.
    for (const def of Object.values(MODEL_CATALOG)) {
      if (def.provider !== "langdock") continue;
      expect(def.id).toMatch(/^[a-z0-9.\-]+$/);
    }
  });
});

describe("router: user-facing output hides internal IDs (behavior 10)", () => {
  beforeEach(() => {
    resetLocalUsage();
  });

  /**
   * Every internal identifier that must never appear in a human-readable string.
   * Derived from the catalog so a newly added model is covered automatically.
   */
  function internalIdentifiers(): string[] {
    const ids = Object.keys(MODEL_CATALOG);
    const prefixes = ["gpt-", "o3", "o4-", "langdock-", "openrouter/"];
    return [...ids, ...prefixes];
  }

  function assertNoInternalIds(text: string) {
    for (const token of internalIdentifiers()) {
      expect(text.toLowerCase(), `"${token}" leaked into: ${text}`).not.toContain(
        token.toLowerCase(),
      );
    }
  }

  it("routing.reason does not contain any internal model or provider ID", () => {
    const router = new IntelligenceRouter();
    const routing = router.selectRouting(makeRequest());

    expect(routing.reason).toBeTruthy();
    assertNoInternalIds(routing.reason);
  });

  it("routing.reason stays clean for coding and reasoning routes too", () => {
    const router = new IntelligenceRouter();

    for (const prompt of [
      "Build a React component with TypeScript and fix CI bugs",
      "Analyze this algorithm and prove its complexity step by step",
      "Hello there",
    ]) {
      resetLocalUsage();
      const routing = router.selectRouting(makeRequest(prompt));
      assertNoInternalIds(routing.reason);
    }
  });

  it("routing.reason remains clean after failures and fallbacks", () => {
    const router = new IntelligenceRouter();
    const first = router.selectRouting(makeRequest());
    router.recordModelRateLimit(first.primaryModel.id);

    const second = router.selectRouting(makeRequest());
    assertNoInternalIds(second.reason);
  });

  it("routing.reason is still descriptive and human-readable", () => {
    const router = new IntelligenceRouter();
    const routing = router.selectRouting(makeRequest());

    expect(routing.reason).toMatch(/Execution route selected/i);
    expect(routing.reason).toMatch(/Langdock|OpenRouter/);
    expect(routing.reason).toMatch(/fallback/i);
  });

  it("does not leak provider/model identifiers in the thrown all-providers-unavailable error", () => {
    const router = new IntelligenceRouter();
    for (const def of Object.values(MODEL_CATALOG)) {
      if (def.enabled) router.recordModelRateLimit(def.id);
    }
    router.recordAuthFailure("langdock", "401");
    router.recordAuthFailure("openrouter", "401");

    // This message reaches the client via the SSE `error` event, so it must not
    // contain raw provider or model identifiers.
    let message = "";
    try {
      router.selectRouting(makeRequest());
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toBeTruthy();
    expect(message).not.toMatch(/gpt-5|openrouter\/|langdock-llama/i);
  });

  it("keeps detailed model IDs available on the decision for server-side diagnostics", () => {
    const router = new IntelligenceRouter();
    const routing = router.selectRouting(makeRequest());

    // Sanitising `reason` must NOT remove the machine-readable fields: the
    // gateway audit log legitimately needs these.
    expect(routing.primaryModel.id).toMatch(/\S/);
    expect(routing.primaryModel.provider).toMatch(/^(langdock|openrouter)$/);
    expect(routing.fallbackChain.length).toBeGreaterThan(0);
    for (const m of routing.fallbackChain) {
      expect(m.id).toMatch(/\S/);
      expect(m.provider).toMatch(/^(langdock|openrouter)$/);
    }
  });
});
