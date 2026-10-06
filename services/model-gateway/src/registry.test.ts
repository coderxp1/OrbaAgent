import type { ModelSpec } from "@orbaagent/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  getConfiguredQuotaLimits,
  getLocalTrackedUsage,
  getModelSpec,
  hasConfirmedCapability,
  isLocalQuotaExhausted,
  recordLocalUsage,
  resetLocalUsage,
} from "./registry.js";

describe("Model Gateway Registry & Spec Management", () => {
  beforeEach(() => {
    resetLocalUsage();
    process.env.LANGDOCK_MODEL_MAX_REQUESTS = undefined;
    process.env.LANGDOCK_MODEL_MAX_TOKENS = undefined;
    process.env.LANGDOCK_MODEL_MAX_TOKENS_GPT_5 = undefined;
  });

  it("should throw an explicit error for an invalid model ID and NOT silently fall back to gpt-5.4", () => {
    expect(() => getModelSpec("invalid-model-123")).toThrow(
      'Invalid or unknown model ID: "invalid-model-123"',
    );
    expect(() => getModelSpec("gpt-random-fake")).toThrow(
      'Invalid or unknown model ID: "gpt-random-fake"',
    );
  });

  it("should normalize auto or empty model IDs to internal engine default", () => {
    const spec = getModelSpec("auto");
    expect(spec.id).toBe("gpt-5.4");
  });

  it("should return default configured quota limits per model", () => {
    const limitsGpt54 = getConfiguredQuotaLimits("gpt-5.4");
    expect(limitsGpt54.maxTokens).toBe(250000);

    const limitsGpt5 = getConfiguredQuotaLimits("gpt-5");
    expect(limitsGpt5.maxTokens).toBe(100000);
  });

  it("should allow model-specific quota overrides via environment variables", () => {
    process.env.LANGDOCK_MODEL_MAX_TOKENS_GPT_5 = "120000";

    const limitsGpt5 = getConfiguredQuotaLimits("gpt-5");
    expect(limitsGpt5.maxTokens).toBe(120000);
  });

  it("should isolate quota tracking per platform tenant ID", () => {
    // Record usage for Tenant A
    recordLocalUsage("gpt-5", 100000, "tenant-A");
    expect(isLocalQuotaExhausted("gpt-5", "tenant-A")).toBe(true);

    // Tenant B should remain completely unexhausted
    expect(isLocalQuotaExhausted("gpt-5", "tenant-B")).toBe(false);
  });

  it("should evaluate 499 requests as available and 500 as exhausted", () => {
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(false);

    for (let i = 0; i < 499; i++) {
      recordLocalUsage("gpt-5.4", 10);
    }
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(false);

    recordLocalUsage("gpt-5.4", 10);
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(true);
  });

  it("should not treat unconfirmed capabilities as confirmed for hard routing decisions", () => {
    // All Langdock catalog entries are now provider-verified, so gpt-5.4 is
    // confirmed and its declared vision capability is usable for routing.
    const gpt54 = MODEL_REGISTRY["gpt-5.4"];
    expect(gpt54.isUnconfirmed).not.toBe(true);

    // Standard text & tool_calling are always basic
    expect(hasConfirmedCapability(gpt54, "text")).toBe(true);
    expect(hasConfirmedCapability(gpt54, "tool_calling")).toBe(true);

    // OpenRouter models have confirmed vision capability
    const openrouterAuto = MODEL_REGISTRY["openrouter/auto"];
    expect(hasConfirmedCapability(openrouterAuto, "vision")).toBe(true);
  });

  it("gates specialized capabilities on confirmed status for an unverified model", () => {
    // The gate must still refuse specialized capabilities when a model has not
    // been verified to exist, even if the capability is declared.
    const unverifiedSpec: ModelSpec = {
      ...MODEL_REGISTRY["gpt-5.4"],
      id: "unverified-model",
      capabilities: ["text", "streaming", "tool_calling", "vision", "thinking"],
      isUnconfirmed: true,
    };

    expect(hasConfirmedCapability(unverifiedSpec, "text")).toBe(true);
    expect(hasConfirmedCapability(unverifiedSpec, "streaming")).toBe(true);
    expect(hasConfirmedCapability(unverifiedSpec, "tool_calling")).toBe(true);

    // Specialized capabilities require confirmed status
    expect(hasConfirmedCapability(unverifiedSpec, "vision")).toBe(false);
    expect(hasConfirmedCapability(unverifiedSpec, "thinking")).toBe(false);

    // And they open up once the model is confirmed
    const verifiedSpec: ModelSpec = { ...unverifiedSpec, isUnconfirmed: false };
    expect(hasConfirmedCapability(verifiedSpec, "vision")).toBe(true);
    expect(hasConfirmedCapability(verifiedSpec, "thinking")).toBe(true);
  });
});
