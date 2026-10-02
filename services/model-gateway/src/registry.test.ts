import { beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredQuotaLimits,
  getLocalTrackedUsage,
  isLocalQuotaExhausted,
  recordLocalUsage,
  resetLocalUsage,
} from "./registry.js";

describe("Model Gateway Registry Quota Tracking", () => {
  beforeEach(() => {
    resetLocalUsage();
    process.env.LANGDOCK_MODEL_MAX_REQUESTS = undefined;
    process.env.LANGDOCK_MODEL_MAX_TOKENS = undefined;
  });

  it("should return default configured quota limits", () => {
    const limits = getConfiguredQuotaLimits();
    expect(limits.maxRequests).toBe(500);
    expect(limits.maxTokens).toBe(250000);
  });

  it("should allow dynamic quota limits via environment variables", () => {
    process.env.LANGDOCK_MODEL_MAX_REQUESTS = "100";
    process.env.LANGDOCK_MODEL_MAX_TOKENS = "50000";

    const limits = getConfiguredQuotaLimits();
    expect(limits.maxRequests).toBe(100);
    expect(limits.maxTokens).toBe(50000);
  });

  it("should evaluate 499 requests as available and 500 as exhausted", () => {
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(false);

    // Record 499 requests
    for (let i = 0; i < 499; i++) {
      recordLocalUsage("gpt-5.4", 10);
    }
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(false);

    // 500th request
    recordLocalUsage("gpt-5.4", 10);
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(true);
  });

  it("should evaluate 249,999 tokens as available and 250,000 tokens as exhausted", () => {
    recordLocalUsage("gpt-5.4", 249999);
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(false);

    recordLocalUsage("gpt-5.4", 1);
    expect(isLocalQuotaExhausted("gpt-5.4")).toBe(true);
  });
});
