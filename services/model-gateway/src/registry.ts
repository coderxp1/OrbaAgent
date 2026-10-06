import type { ModelSpec, ProviderId } from "@orbaagent/shared";

export interface QuotaLimits {
  maxRequests: number;
  maxTokens: number;
}

export interface LocalUsage {
  requests: number;
  tokens: number;
}

// Model-specific default max tokens dictionary (e.g. Anthropic vs OpenAI based models)
const MODEL_DEFAULT_TOKENS: Record<string, number> = {
  "gpt-6-sol": 300000,
  "gpt-5.4": 250000,
  "gpt-5.4-mini": 250000,
  "gpt-5.2-pro": 200000,
  "gpt-5.2": 150000,
  "gpt-5.1": 250000,
  "gpt-5": 100000,
  "gpt-5-mini": 100000,
  "gpt-5-eu": 250000,
  "gpt-5-mini-eu": 250000,
  o3: 300000,
  "o4-mini": 200000,
  "openrouter/auto": 500000,
  "openrouter/free": 100000,
};

// Local usage tracking map per composite key (tenantId:modelId or modelId)
const LOCAL_USAGE_MAP: Map<string, LocalUsage> = new Map();

function getUsageKey(modelId: string, tenantId?: string): string {
  if (tenantId) {
    return `${tenantId}:${modelId}`;
  }
  return modelId;
}

/**
 * Retrieve configured quota limits from environment configuration or model defaults.
 * Supports per-model capacity overrides (e.g. LANGDOCK_MODEL_MAX_TOKENS_GPT_5).
 */
export function getConfiguredQuotaLimits(modelId?: string): QuotaLimits {
  const reqEnv = process.env.LANGDOCK_MODEL_MAX_REQUESTS;
  const envKey = modelId
    ? `LANGDOCK_MODEL_MAX_TOKENS_${modelId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
    : "LANGDOCK_MODEL_MAX_TOKENS";
  const tokenEnv = process.env[envKey] || process.env.LANGDOCK_MODEL_MAX_TOKENS;

  const defaultTokens = (modelId && MODEL_DEFAULT_TOKENS[modelId]) || 250000;

  const maxRequests =
    reqEnv && reqEnv !== "undefined" && !Number.isNaN(Number(reqEnv)) ? Number(reqEnv) : 500;
  const maxTokens =
    tokenEnv && tokenEnv !== "undefined" && !Number.isNaN(Number(tokenEnv))
      ? Number(tokenEnv)
      : defaultTokens;

  return { maxRequests, maxTokens };
}

/**
 * Retrieve locally tracked usage metrics for a model (with platform tenant-level isolation).
 */
export function getLocalTrackedUsage(modelId: string, tenantId?: string): LocalUsage {
  const key = getUsageKey(modelId, tenantId);
  const existing = LOCAL_USAGE_MAP.get(key);
  if (existing) return existing;
  const initial = { requests: 0, tokens: 0 };
  LOCAL_USAGE_MAP.set(key, initial);
  return initial;
}

/**
 * Record successful request usage against locally tracked counters.
 */
export function recordLocalUsage(modelId: string, tokens: number, tenantId?: string): void {
  const key = getUsageKey(modelId, tenantId);
  const usage = getLocalTrackedUsage(modelId, tenantId);
  usage.requests += 1;
  usage.tokens += tokens;
  LOCAL_USAGE_MAP.set(key, usage);
}

/**
 * Check whether a model has reached its locally configured quota limit.
 */
export function isLocalQuotaExhausted(modelId: string, tenantId?: string): boolean {
  const limits = getConfiguredQuotaLimits(modelId);
  const usage = getLocalTrackedUsage(modelId, tenantId);
  return usage.requests >= limits.maxRequests || usage.tokens >= limits.maxTokens;
}

/**
 * Reset local usage counters (primarily for testing and environment resets).
 */
export function resetLocalUsage(modelId?: string, tenantId?: string): void {
  if (modelId) {
    const key = getUsageKey(modelId, tenantId);
    LOCAL_USAGE_MAP.set(key, { requests: 0, tokens: 0 });
  } else {
    LOCAL_USAGE_MAP.clear();
  }
}

/**
 * Check whether a model has a confirmed capability for hard routing decisions.
 * Basic capabilities ("text", "streaming") are standard.
 * Specialized capabilities ("vision", "thinking", "json_mode") require isUnconfirmed to be false.
 */
export function hasConfirmedCapability(
  model: ModelSpec,
  capability: "text" | "vision" | "streaming" | "tool_calling" | "json_mode" | "thinking",
): boolean {
  if (!model.capabilities.includes(capability)) return false;
  if (capability === "text" || capability === "streaming" || capability === "tool_calling") {
    return true;
  }
  // Specialized capabilities require confirmed status
  return !model.isUnconfirmed;
}

import {
  MODEL_CATALOG,
  getUnavailableModelReason,
  resolveModelDefinition,
  toModelSpec,
} from "./catalog.js";

export const MODEL_REGISTRY: Record<string, ModelSpec> = {};
for (const def of Object.values(MODEL_CATALOG)) {
  MODEL_REGISTRY[def.id] = toModelSpec(def);
}

export function getModelSpec(modelId: string): ModelSpec {
  if (modelId === "auto" || modelId === "" || !modelId) {
    return MODEL_REGISTRY["gpt-5.4"] || Object.values(MODEL_REGISTRY)[0];
  }

  // Known-but-unavailable models must NOT silently resolve to a substitute.
  const unavailableReason = getUnavailableModelReason(modelId);
  if (unavailableReason) {
    throw new Error(`Model "${modelId}" is unavailable. ${unavailableReason}`);
  }

  const resolved = resolveModelDefinition(modelId);
  if (resolved) {
    return toModelSpec(resolved);
  }
  const model = MODEL_REGISTRY[modelId];
  if (!model) {
    throw new Error(`Invalid or unknown model ID: "${modelId}"`);
  }
  return model;
}

export function listAvailableModels(providerFilter?: ProviderId): ModelSpec[] {
  const models = Object.values(MODEL_CATALOG)
    .filter((m) => m.enabled)
    .map((m) => toModelSpec(m));
  if (providerFilter) {
    return models.filter((m) => m.provider === providerFilter);
  }
  return models;
}
