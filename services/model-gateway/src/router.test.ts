import type { ChatCompletionRequest } from "@orbaagent/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { recordModelUsage, resetQuotaState } from "./registry.js";
import { IntelligenceRouter } from "./router.js";

describe("IntelligenceRouter", () => {
  let router: IntelligenceRouter;

  beforeEach(() => {
    router = new IntelligenceRouter();
    resetQuotaState();
  });

  it("should route coding tasks to primary Langdock gpt-5.4 model and OpenRouter fallback", () => {
    const req: ChatCompletionRequest = {
      modelId: "user-requested-custom-model", // External choice to ignore
      messages: [
        { role: "user", content: "Build a React component with TypeScript and fix CI bugs" },
      ],
      stream: true,
      trace: {
        traceId: "tr_1",
        tenantId: "t_1",
        userId: "u_1",
        conversationId: "c_1",
        agentRunId: "r_1",
      },
    };

    const routing = router.selectRouting(req);
    expect(routing.complexity).toBe("coding");
    expect(routing.primaryModel.provider).toBe("langdock");
    expect(routing.primaryModel.id).toBe("gpt-5.4");
    expect(routing.fallbackChain.some((m) => m.provider === "openrouter")).toBe(true);
  });

  it("should select gpt-6-sol for complex reasoning tasks", () => {
    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [
        {
          role: "user",
          content:
            "Explain and analyze why this mathematical theorem holds true and evaluate its formal proof",
        },
      ],
      stream: true,
      trace: {
        traceId: "tr_2",
        tenantId: "t_1",
        userId: "u_1",
        conversationId: "c_1",
        agentRunId: "r_1",
      },
    };

    const routing = router.selectRouting(req);
    expect(routing.complexity).toBe("high_reasoning");
    expect(routing.primaryModel.id).toBe("gpt-6-sol");
  });

  it("should automatically select next eligible Langdock model when primary model quota is exhausted", () => {
    // Exhaust quota for gpt-5.4 (500 requests / 250k tokens)
    recordModelUsage("gpt-5.4", 260000);

    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Fix code bug in typescript function" }],
      stream: true,
      trace: {
        traceId: "tr_3",
        tenantId: "t_1",
        userId: "u_1",
        conversationId: "c_1",
        agentRunId: "r_1",
      },
    };

    const routing = router.selectRouting(req);
    expect(routing.primaryModel.id).not.toBe("gpt-5.4");
    expect(routing.primaryModel.provider).toBe("langdock");
  });

  it("should failover to OpenRouter when Langdock circuit breaker is triggered", () => {
    // Record repeated failures to trigger circuit breaker
    router.recordProviderFailure("langdock");
    router.recordProviderFailure("langdock");
    router.recordProviderFailure("langdock");

    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Write a python script" }],
      stream: true,
      trace: {
        traceId: "tr_4",
        tenantId: "t_1",
        userId: "u_1",
        conversationId: "c_1",
        agentRunId: "r_1",
      },
    };

    const routing = router.selectRouting(req);
    expect(routing.primaryModel.provider).toBe("openrouter");
  });

  it("should enforce non-mock policy in production", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      process.env.USE_MOCK_PROVIDERS = "true";
      expect(router.isMockAllowed()).toBe(false);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
