import type { ChatCompletionRequest } from "@orbaagent/shared";
import { describe, expect, it } from "vitest";
import { IntelligenceRouter } from "./router.js";

describe("IntelligenceRouter", () => {
  const router = new IntelligenceRouter();

  it("should classify coding tasks and select top-tier coding models", () => {
    const req: ChatCompletionRequest = {
      modelId: "auto",
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
    expect(routing.primaryModel).toBeDefined();
    expect(routing.fallbackChain.length).toBeGreaterThan(0);
  });

  it("should classify vision tasks when images are mentioned", () => {
    const req: ChatCompletionRequest = {
      modelId: "auto",
      messages: [{ role: "user", content: "Analyze this image screenshot and extract text" }],
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
    expect(routing.complexity).toBe("vision");
    expect(routing.primaryModel.capabilities).toContain("vision");
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
