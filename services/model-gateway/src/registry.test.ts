import { describe, expect, it } from "vitest";
import { getModelSpec, listAvailableModels } from "./registry.js";

describe("ModelRegistry", () => {
  it("should retrieve spec for default xAI Grok model", () => {
    const spec = getModelSpec("grok-2-latest");
    expect(spec).toBeDefined();
    expect(spec.provider).toBe("xai");
    expect(spec.name).toContain("Grok");
    expect(spec.capabilities).toContain("streaming");
  });

  it("should list available models filtered by provider", () => {
    const xaiModels = listAvailableModels("xai");
    expect(xaiModels.length).toBeGreaterThan(0);
    expect(xaiModels.every((m) => m.provider === "xai")).toBe(true);

    const openaiModels = listAvailableModels("openai");
    expect(openaiModels.length).toBeGreaterThan(0);
    expect(openaiModels.every((m) => m.provider === "openai")).toBe(true);
  });

  it("should throw error for unknown model ID", () => {
    expect(() => getModelSpec("non-existent-model")).toThrow(/Unknown or unsupported model ID/);
  });
});
