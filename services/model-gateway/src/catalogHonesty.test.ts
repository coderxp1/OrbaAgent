import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG,
  PRODUCT_ALIASES,
  UNAVAILABLE_MODELS,
  VERIFIED_AT,
  VERIFIED_LANGDOCK_MODEL_IDS,
  getUnavailableModelReason,
  isModelIdVerified,
  resolveModelDefinition,
} from "./catalog.js";
import { getModelSpec } from "./registry.js";

/**
 * These tests lock in the "no silent substitution" contract.
 *
 * A previous revision resolved user-facing names to unrelated models
 * (`gpt-5.2-pro` -> `gpt-5.4`, `gpt-5-nano` -> `gpt-5.4-mini`,
 * `gpt-5.3-codex` -> `gpt-5.6-sol`). That made every requested model appear
 * available while answering with a different one.
 *
 * `gpt-5.2-pro` has since been confirmed present in the live Langdock catalog,
 * so it is now a real entry rather than an unavailable name. The remaining
 * entries below are genuinely absent from the provider.
 */
describe("catalog does not silently substitute models", () => {
  const previouslyRedirected = [
    "gpt-5-nano",
    "gpt-5.1-codex",
    "gpt-5.1-codex-pro",
    "gpt-5.1-codex-mini",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "chatgpt-4o-latest",
  ] as const;

  for (const id of previouslyRedirected) {
    it(`marks "${id}" unavailable instead of redirecting it`, () => {
      expect(getUnavailableModelReason(id)).toBeDefined();
      // Must not resolve to a *different* model.
      expect(resolveModelDefinition(id)).toBeUndefined();
    });

    it(`throws for "${id}" rather than returning a substitute spec`, () => {
      expect(() => getModelSpec(id)).toThrow(/unavailable/i);
    });
  }

  it("resolves gpt-5.2-pro to itself now that the provider confirms it", () => {
    // It must resolve to gpt-5.2-pro, NOT to gpt-5.4 as the old alias did.
    const resolved = resolveModelDefinition("gpt-5.2-pro");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("gpt-5.2-pro");
    expect(resolved?.id).not.toBe("gpt-5.4");
    expect(getUnavailableModelReason("gpt-5.2-pro")).toBeUndefined();
  });

  it("keeps the legacy llama alias unavailable instead of silently remapping", () => {
    expect(getUnavailableModelReason("langdock-llama-3.3-70b")).toBeDefined();
    expect(resolveModelDefinition("langdock-llama-3.3-70b")).toBeUndefined();
  });

  it("does not resolve `auto` to a hardcoded substitute model", () => {
    // `auto` is handled explicitly by getModelSpec and must not be an alias here.
    expect(resolveModelDefinition("auto")).toBeUndefined();
  });
});

describe("catalog preserves verified models", () => {
  it("resolves real catalog IDs to themselves", () => {
    for (const id of Object.keys(MODEL_CATALOG)) {
      const resolved = resolveModelDefinition(id);
      expect(resolved?.id).toBe(id);
    }
  });

  it("resolves documented product aliases to real models", () => {
    for (const [alias, target] of Object.entries(PRODUCT_ALIASES)) {
      const resolved = resolveModelDefinition(alias);
      expect(resolved, `alias ${alias}`).toBeDefined();
      expect(resolved?.id).toBe(target);
    }
  });

  it("returns undefined for an entirely unknown model", () => {
    expect(resolveModelDefinition("definitely-not-a-model")).toBeUndefined();
  });

  it("throws for an unknown model rather than falling back", () => {
    expect(() => getModelSpec("definitely-not-a-model")).toThrow(/invalid or unknown/i);
  });
});

describe("verification provenance is consistent", () => {
  it("records a verification date", () => {
    expect(VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("every Langdock catalog entry is a provider-verified ID", () => {
    for (const def of Object.values(MODEL_CATALOG)) {
      if (def.provider !== "langdock") continue;
      expect(
        VERIFIED_LANGDOCK_MODEL_IDS.has(def.id),
        `Langdock entry "${def.id}" is not in the verified ID set`,
      ).toBe(true);
      expect(isModelIdVerified(def.id)).toBe(true);
    }
  });

  it("every verified Langdock ID is present in the catalog", () => {
    for (const id of VERIFIED_LANGDOCK_MODEL_IDS) {
      expect(MODEL_CATALOG[id], `verified id "${id}" missing from MODEL_CATALOG`).toBeDefined();
      expect(MODEL_CATALOG[id].provider).toBe("langdock");
    }
  });

  it("no catalog entry remains flagged unconfirmed for Langdock", () => {
    for (const def of Object.values(MODEL_CATALOG)) {
      if (def.provider !== "langdock") continue;
      expect(def.isUnconfirmed, `"${def.id}" still unconfirmed`).not.toBe(true);
    }
  });

  it("accepts an arbitrary case/whitespace spelling of a verified id", () => {
    expect(isModelIdVerified("o3")).toBe(true);
    expect(isModelIdVerified("gpt-5.6-luna")).toBe(true);
    expect(isModelIdVerified("gpt-5-nano")).toBe(false);
  });
});

describe("getModelSpec still serves verified models", () => {
  it("returns the default spec for `auto`", () => {
    const spec = getModelSpec("auto");
    expect(spec).toBeDefined();
    expect(spec.id).toBe("gpt-5.4");
  });

  it("returns an exact spec for a verified model id", () => {
    const spec = getModelSpec("gpt-5");
    expect(spec.id).toBe("gpt-5");
  });

  it("is case- and whitespace-insensitive for unavailable detection", () => {
    expect(() => getModelSpec("  GPT-5-NANO  ")).toThrow(/unavailable/i);
  });

  it("is case- and whitespace-insensitive for verified models", () => {
    expect(getModelSpec("  GPT-5.2-PRO  ").id).toBe("gpt-5.2-pro");
  });
});

describe("unavailable registry is documented", () => {
  it("gives every unavailable model a non-empty reason", () => {
    for (const [id, reason] of Object.entries(UNAVAILABLE_MODELS)) {
      expect(reason.length, `reason for ${id}`).toBeGreaterThan(10);
    }
  });

  it("does not list any unavailable model as a resolvable catalog entry", () => {
    for (const id of Object.keys(UNAVAILABLE_MODELS)) {
      expect(MODEL_CATALOG[id], `${id} must not be in MODEL_CATALOG`).toBeUndefined();
    }
  });
});
