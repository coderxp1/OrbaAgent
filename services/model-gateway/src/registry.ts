import type { ModelSpec, ProviderId } from "@orbaagent/shared";

export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // Langdock API Integration Models
  "langdock-auto": {
    id: "langdock-auto",
    name: "Langdock Intelligence Engine",
    provider: "langdock",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode", "thinking"],
    costPerInputToken: 0.000002,
    costPerOutputToken: 0.00001,
    isDefault: true,
  },
  "langdock-fast": {
    id: "langdock-fast",
    name: "Langdock Fast Execution Engine",
    provider: "langdock",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0.0000005,
    costPerOutputToken: 0.0000015,
  },

  // OpenRouter API Integration Models
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
  "openrouter/fallback": {
    id: "openrouter/fallback",
    name: "OpenRouter Failover Engine",
    provider: "openrouter",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling"],
    costPerInputToken: 0.000001,
    costPerOutputToken: 0.000003,
  },
};

export function getModelSpec(modelId: string): ModelSpec {
  // Always normalize external requests to internal registry specs
  const model = MODEL_REGISTRY[modelId] || MODEL_REGISTRY["langdock-auto"];
  return model;
}

export function listAvailableModels(providerFilter?: ProviderId): ModelSpec[] {
  const models = Object.values(MODEL_REGISTRY);
  if (providerFilter) {
    return models.filter((m) => m.provider === providerFilter);
  }
  return models;
}
