import { describe, expect, it } from "vitest";
import { getModelSpec, listAvailableModels } from "./registry.js";

describe("ModelRegistry", () => {
  it("should retrieve spec for primary Langdock engine model", () => {
    const spec = getModelSpec("langdock-auto");
    expect(spec).toBeDefined();
    expect(spec.provider).toBe("langdock");
    expect(spec.name).toContain("Langdock");
    expect(spec.capabilities).toContain("streaming");
  });

  it("should list available models filtered by provider", () => {
    const langdockModels = listAvailableModels("langdock");
    expect(langdockModels.length).toBeGreaterThan(0);
    expect(langdockModels.every((m) => m.provider === "langdock")).toBe(true);

    const openrouterModels = listAvailableModels("openrouter");
    expect(openrouterModels.length).toBeGreaterThan(0);
    expect(openrouterModels.every((m) => m.provider === "openrouter")).toBe(true);
  });

  it("should normalize unknown model ID to default spec", () => {
    const spec = getModelSpec("non-existent-model");
    expect(spec).toBeDefined();
    expect(spec.provider).toBe("langdock");
  });
});

