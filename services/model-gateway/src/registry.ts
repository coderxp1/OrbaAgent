import type { ModelSpec, ProviderId } from "@orbaagent/shared";

export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // xAI Grok Models
  "grok-2-latest": {
    id: "grok-2-latest",
    name: "xAI Grok 2",
    provider: "xai",
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode"],
    costPerInputToken: 0.000002,
    costPerOutputToken: 0.00001,
    isDefault: true,
  },
  "grok-beta": {
    id: "grok-beta",
    name: "xAI Grok Beta",
    provider: "xai",
    contextWindow: 131072,
    maxOutputTokens: 4096,
    capabilities: ["text", "streaming", "tool_calling", "json_mode"],
    costPerInputToken: 0.000005,
    costPerOutputToken: 0.000015,
  },
  "grok-vision-beta": {
    id: "grok-vision-beta",
    name: "xAI Grok Vision Beta",
    provider: "xai",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: ["text", "vision", "streaming", "tool_calling"],
    costPerInputToken: 0.000005,
    costPerOutputToken: 0.000015,
  },

  // OpenAI Models
  "gpt-4o": {
    id: "gpt-4o",
    name: "OpenAI GPT-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode"],
    costPerInputToken: 0.0000025,
    costPerOutputToken: 0.00001,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "OpenAI GPT-4o Mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode"],
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
  },
  o1: {
    id: "o1",
    name: "OpenAI o1 Reasoning",
    provider: "openai",
    contextWindow: 200000,
    maxOutputTokens: 100000,
    capabilities: ["text", "vision", "streaming", "thinking"],
    costPerInputToken: 0.000015,
    costPerOutputToken: 0.00006,
  },

  // Anthropic Claude Models
  "claude-3-5-sonnet-latest": {
    id: "claude-3-5-sonnet-latest",
    name: "Anthropic Claude 3.5 Sonnet",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "thinking"],
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
  },
  "claude-3-haiku-20240307": {
    id: "claude-3-haiku-20240307",
    name: "Anthropic Claude 3 Haiku",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    capabilities: ["text", "vision", "streaming", "tool_calling"],
    costPerInputToken: 0.00000025,
    costPerOutputToken: 0.00000125,
  },

  // Google Gemini Models
  "gemini-1.5-pro-latest": {
    id: "gemini-1.5-pro-latest",
    name: "Google Gemini 1.5 Pro",
    provider: "google",
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode"],
    costPerInputToken: 0.00000125,
    costPerOutputToken: 0.000005,
  },
  "gemini-1.5-flash-latest": {
    id: "gemini-1.5-flash-latest",
    name: "Google Gemini 1.5 Flash",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ["text", "vision", "streaming", "tool_calling", "json_mode"],
    costPerInputToken: 0.000000075,
    costPerOutputToken: 0.0000003,
  },
};

export function getModelSpec(modelId: string): ModelSpec {
  const model = MODEL_REGISTRY[modelId];
  if (!model) {
    throw new Error(`Unknown or unsupported model ID: '${modelId}'`);
  }
  return model;
}

export function listAvailableModels(providerFilter?: ProviderId): ModelSpec[] {
  const models = Object.values(MODEL_REGISTRY);
  if (providerFilter) {
    return models.filter((m) => m.provider === providerFilter);
  }
  return models;
}
