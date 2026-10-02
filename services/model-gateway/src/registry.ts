import type { ModelSpec, ProviderId } from "@orbaagent/shared";

export interface QuotaLimits {
  maxRequests: number;
  maxTokens: number;
}

export interface LocalUsage {
  requests: number;
  tokens: number;
}

// Local usage tracking map per model ID
const LOCAL_USAGE_MAP: Map<string, LocalUsage> = new Map();

/**
 * Retrieve configured quota limits from environment configuration or sensible defaults.
 * Allows limits to be adjusted without modifying application source code.
 */
export function getConfiguredQuotaLimits(): QuotaLimits {
  const reqEnv = process.env.LANGDOCK_MODEL_MAX_REQUESTS;
  const tokenEnv = process.env.LANGDOCK_MODEL_MAX_TOKENS;
  const maxRequests =
    reqEnv && reqEnv !== "undefined" && !Number.isNaN(Number(reqEnv)) ? Number(reqEnv) : 500;
  const maxTokens =
    tokenEnv && tokenEnv !== "undefined" && !Number.isNaN(Number(tokenEnv))
      ? Number(tokenEnv)
      : 250000;
  return { maxRequests, maxTokens };
}

/**
 * Retrieve locally tracked usage metrics for a model.
 */
export function getLocalTrackedUsage(modelId: string): LocalUsage {
  const existing = LOCAL_USAGE_MAP.get(modelId);
  if (existing) return existing;
  const initial = { requests: 0, tokens: 0 };
  LOCAL_USAGE_MAP.set(modelId, initial);
  return initial;
}

/**
 * Record successful request usage against locally tracked counters.
 */
export function recordLocalUsage(modelId: string, tokens: number): void {
  const usage = getLocalTrackedUsage(modelId);
  usage.requests += 1;
  usage.tokens += tokens;
}

/**
 * Check whether a model has reached its locally configured quota limit.
 */
export function isLocalQuotaExhausted(modelId: string): boolean {
  const limits = getConfiguredQuotaLimits();
  const usage = getLocalTrackedUsage(modelId);
  return usage.requests >= limits.maxRequests || usage.tokens >= limits.maxTokens;
}

/**
 * Reset local usage counters (primarily for testing and environment resets).
 */
export function resetLocalUsage(modelId?: string): void {
  if (modelId) {
    LOCAL_USAGE_MAP.set(modelId, { requests: 0, tokens: 0 });
  } else {
    LOCAL_USAGE_MAP.clear();
  }
}

export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // Confirmed Langdock Models (unverified specs marked isUnconfirmed: true)
  "gpt-6-sol": {
    id: "gpt-6-sol",
    name: "Langdock Sol Engine",
    provider: "langdock",
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    isUnconfirmed: true,
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    name: "Langdock High Intelligence Engine",
    provider: "langdock",
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    isDefault: true,
    isUnconfirmed: true,
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    name: "Langdock Fast Execution Engine",
    provider: "langdock",
    capabilities: ["text", "streaming", "tool_calling"],
    isUnconfirmed: true,
  },
  "gpt-5.2-pro": {
    id: "gpt-5.2-pro",
    name: "Langdock Pro Reasoning Engine",
    provider: "langdock",
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    isUnconfirmed: true,
  },
  "gpt-5.2": {
    id: "gpt-5.2",
    name: "Langdock Standard Engine",
    provider: "langdock",
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode"],
    isUnconfirmed: true,
  },
  "gpt-5.1": {
    id: "gpt-5.1",
    name: "Langdock Balanced Engine",
    provider: "langdock",
    capabilities: ["text", "streaming", "tool_calling"],
    isUnconfirmed: true,
  },
  "gpt-5": {
    id: "gpt-5",
    name: "Langdock Base Engine",
    provider: "langdock",
    capabilities: ["text", "streaming", "tool_calling"],
    isUnconfirmed: true,
  },
  "gpt-5-eu": {
    id: "gpt-5-eu",
    name: "Langdock EU Regional Engine",
    provider: "langdock",
    capabilities: ["text", "streaming", "tool_calling"],
    isUnconfirmed: true,
  },
  "gpt-5-mini-eu": {
    id: "gpt-5-mini-eu",
    name: "Langdock Fast EU Regional Engine",
    provider: "langdock",
    capabilities: ["text", "streaming", "tool_calling"],
    isUnconfirmed: true,
  },

  // OpenRouter Secondary & Fallback Models
  "openrouter/auto": {
    id: "openrouter/auto",
    name: "OpenRouter Unified Engine",
    provider: "openrouter",
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
  },
  "openrouter/free": {
    id: "openrouter/free",
    name: "OpenRouter Free Fallback Engine",
    provider: "openrouter",
    capabilities: ["text", "streaming", "tool_calling"],
  },
};

export function getModelSpec(modelId: string): ModelSpec {
  const model = MODEL_REGISTRY[modelId] || MODEL_REGISTRY["gpt-5.4"];
  return model;
}

export function listAvailableModels(providerFilter?: ProviderId): ModelSpec[] {
  const models = Object.values(MODEL_REGISTRY);
  if (providerFilter) {
    return models.filter((m) => m.provider === providerFilter);
  }
  return models;
}
