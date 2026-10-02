import type { ModelSpec, ProviderId } from "@orbaagent/shared";

export interface QuotaTracker {
  maxRequests: number;
  maxTokens: number;
  usedRequests: number;
  usedTokens: number;
}

const DEFAULT_LANGDOCK_QUOTA: QuotaTracker = {
  maxRequests: 500,
  maxTokens: 250000,
  usedRequests: 0,
  usedTokens: 0,
};

// Quota usage map per model ID
const MODEL_QUOTA_MAP: Map<string, QuotaTracker> = new Map();

export function getQuotaState(modelId: string): QuotaTracker {
  const existing = MODEL_QUOTA_MAP.get(modelId);
  if (existing) return existing;
  const initial = { ...DEFAULT_LANGDOCK_QUOTA };
  MODEL_QUOTA_MAP.set(modelId, initial);
  return initial;
}

export function recordModelUsage(modelId: string, tokens: number): void {
  const quota = getQuotaState(modelId);
  quota.usedRequests += 1;
  quota.usedTokens += tokens;
}

export function isQuotaExhausted(modelId: string): boolean {
  const quota = getQuotaState(modelId);
  return quota.usedRequests >= quota.maxRequests || quota.usedTokens >= quota.maxTokens;
}

export function resetQuotaState(modelId?: string): void {
  if (modelId) {
    MODEL_QUOTA_MAP.set(modelId, { ...DEFAULT_LANGDOCK_QUOTA });
  } else {
    MODEL_QUOTA_MAP.clear();
  }
}

export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // Langdock API Confirmed Models (500 requests / 250k tokens quota per model)
  "gpt-6-sol": {
    id: "gpt-6-sol",
    name: "Langdock Sol Engine",
    provider: "langdock",
    contextWindow: 500000,
    maxOutputTokens: 16384,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    name: "Langdock High Intelligence Engine",
    provider: "langdock",
    contextWindow: 300000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    costPerInputToken: 0.000002,
    costPerOutputToken: 0.00001,
    isDefault: true,
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    name: "Langdock Fast Execution Engine",
    provider: "langdock",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0.0000005,
    costPerOutputToken: 0.0000015,
  },
  "gpt-5.2-pro": {
    id: "gpt-5.2-pro",
    name: "Langdock Pro Reasoning Engine",
    provider: "langdock",
    contextWindow: 250000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    costPerInputToken: 0.0000025,
    costPerOutputToken: 0.000012,
  },
  "gpt-5.2": {
    id: "gpt-5.2",
    name: "Langdock Standard Engine",
    provider: "langdock",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode"],
    costPerInputToken: 0.000002,
    costPerOutputToken: 0.000008,
  },
  "gpt-5.1": {
    id: "gpt-5.1",
    name: "Langdock Balanced Engine",
    provider: "langdock",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0.0000015,
    costPerOutputToken: 0.000006,
  },
  "gpt-5": {
    id: "gpt-5",
    name: "Langdock Base Engine",
    provider: "langdock",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0.0000015,
    costPerOutputToken: 0.000006,
  },
  "gpt-5-eu": {
    id: "gpt-5-eu",
    name: "Langdock EU Regional Engine",
    provider: "langdock",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0.0000015,
    costPerOutputToken: 0.000006,
  },
  "gpt-5-mini-eu": {
    id: "gpt-5-mini-eu",
    name: "Langdock Fast EU Regional Engine",
    provider: "langdock",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0.0000005,
    costPerOutputToken: 0.0000015,
  },

  // OpenRouter Secondary & Fallback Models
  "openrouter/auto": {
    id: "openrouter/auto",
    name: "OpenRouter Unified Engine",
    provider: "openrouter",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    costPerInputToken: 0.000002,
    costPerOutputToken: 0.00001,
  },
  "openrouter/free": {
    id: "openrouter/free",
    name: "OpenRouter Free Fallback Engine",
    provider: "openrouter",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0,
    costPerOutputToken: 0,
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
