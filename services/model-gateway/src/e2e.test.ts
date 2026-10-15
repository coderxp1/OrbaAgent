import type { ChatCompletionRequest } from "@orbaagent/shared";
import { describe, expect, it } from "vitest";
import { ModelGateway } from "./gateway.js";

describe("E2E Intelligence Fabric Routing", () => {
  it("orchestrates routing correctly without explicit configuration", async () => {
    process.env.OLLAMA_BASE_URL = "http://10.77.0.2:11435";
    process.env.OLLAMA_ENABLED = "true";
    process.env.ALLOW_MOCK_PROVIDERS = "true";

    const gateway = new ModelGateway();

    // 1. Coding task -> Qwen2.5 Coder
    const reqCode: ChatCompletionRequest = {
      messages: [{ role: "user", content: "Write a short bash script to echo Hello World." }],
      modelId: "orba-code-engine",
      stream: false,
      trace: {
        traceId: "t1",
        tenantId: "test",
        userId: "test",
        conversationId: "c1",
        agentRunId: "r1",
      },
    };

    let decision = gateway.router.selectRouting(reqCode);
    expect(decision.primaryModel.id).toBe("qwen2.5-coder:32b");
    expect(decision.primaryModel.provider).toBe("ollama");

    // 2. Vision task -> Qwen3-VL
    const reqVision: ChatCompletionRequest = {
      messages: [{ role: "user", content: "Describe the image briefly." }],
      modelId: "orba-vision-engine",
      stream: false,
      trace: {
        traceId: "t2",
        tenantId: "test",
        userId: "test",
        conversationId: "c2",
        agentRunId: "r2",
      },
    };
    decision = gateway.router.selectRouting(reqVision);
    expect(decision.primaryModel.id).toBe("qwen3-vl:8b");
    expect(decision.primaryModel.provider).toBe("ollama");

    // 3. Combined/Auto Vision task -> Auto detects vision
    const reqCombined: ChatCompletionRequest = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD" },
            },
            { type: "text", text: "What is this?" },
          ],
        },
      ],
      modelId: "auto",
      stream: false,
      trace: {
        traceId: "t3",
        tenantId: "test",
        userId: "test",
        conversationId: "c3",
        agentRunId: "r3",
      },
    };
    decision = gateway.router.selectRouting(reqCombined);
    expect(decision.primaryModel.id).toBe("qwen3-vl:8b");
    expect(decision.primaryModel.provider).toBe("ollama");

    // 4. Simulate unavailable local model -> Fallback behavior
    gateway.router.recordProviderFailure("ollama");
    gateway.router.recordProviderFailure("ollama");
    gateway.router.recordProviderFailure("ollama");

    decision = gateway.router.selectRouting(reqCode);
    // Should fallback to Langdock or OpenRouter depending on config, but definitely not ollama
    expect(decision.primaryModel.provider).not.toBe("ollama");
    expect(["langdock", "openrouter"]).toContain(decision.primaryModel.provider);
  });
});
