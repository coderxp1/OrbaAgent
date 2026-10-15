import type { ChatCompletionRequest } from "@orbaagent/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GpuAdmissionController } from "./admission.js";
import { resolveCapabilityAlias } from "./catalog.js";
import { resetLocalUsage } from "./registry.js";
import { IntelligenceRouter } from "./router.js";

function makeRequest(content = "Hello world", modelId = "auto"): ChatCompletionRequest {
  return {
    modelId,
    messages: [{ role: "user", content }],
    stream: true,
    trace: {
      traceId: "tr_ollama_test",
      tenantId: "t_ollama",
      userId: "u_ollama",
      conversationId: "c_ollama",
      agentRunId: "r_ollama",
    },
  };
}

describe("router: Local Ollama & Capability-Based Routing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetLocalUsage();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves capability aliases without leaking raw model IDs to users", () => {
    expect(resolveCapabilityAlias("orba-code-engine")).toBe("qwen2.5-coder:32b");
    expect(resolveCapabilityAlias("orba-fast-engine")).toBe("qwen2.5-coder:32b");
    expect(resolveCapabilityAlias("orba-reasoning-engine")).toBe("qwen2.5-coder:32b");
    expect(resolveCapabilityAlias("orba-vision-engine")).toBe("qwen3-vl:8b");
  });

  it("routes to Local Ollama when OLLAMA_ENABLED=true and capacity is available", () => {
    process.env.OLLAMA_ENABLED = "true";
    process.env.USE_MOCK_PROVIDERS = "true";

    const router = new IntelligenceRouter();
    const req = makeRequest("def solve_problem(): pass", "orba-code-engine");
    const routing = router.selectRouting(req);

    expect(routing.primaryModel.provider).toBe("ollama");
    expect(routing.primaryModel.id).toBe("qwen2.5-coder:32b");
    // Fallback chain includes cloud escalation
    expect(routing.fallbackChain.some((m) => m.provider === "langdock")).toBe(true);
    expect(routing.reason).toContain("Local Ollama primary");
  });

  it("escalates to cloud when GPU admission controller detects insufficient VRAM", () => {
    process.env.OLLAMA_ENABLED = "true";
    process.env.USE_MOCK_PROVIDERS = "true";

    // Constrain admission controller: media worker occupies 24 GB and budget is low
    const tightAdmission = new GpuAdmissionController(32768, 8192);
    tightAdmission.setMediaActive(true, "image");

    const router = new IntelligenceRouter(undefined, tightAdmission);
    const req = makeRequest("Complex reasoning request", "orba-reasoning-engine");
    const routing = router.selectRouting(req);

    // Because 70B does not fit on constrained GPU, router automatically escalated to Langdock cloud!
    expect(routing.primaryModel.provider).toBe("langdock");
    expect(routing.primaryModel.id).not.toBe("llama3.3:70b");
  });

  it("escalates to cloud when local model concurrency is saturated", () => {
    process.env.OLLAMA_ENABLED = "true";
    process.env.USE_MOCK_PROVIDERS = "true";

    const admission = new GpuAdmissionController(97887, 8192);
    // Saturate all 2 slots for 32B model
    admission.acquireSlot("qwen2.5-coder:32b");
    admission.acquireSlot("qwen2.5-coder:32b");

    const router = new IntelligenceRouter(undefined, admission);
    const req = makeRequest("Write some code", "orba-code-engine");
    const routing = router.selectRouting(req);

    // Concurrency saturated -> escalates to cloud
    expect(routing.primaryModel.provider).toBe("langdock");
  });
});
