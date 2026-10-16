import type { ModelCapability, ModelSpec, ProviderId } from "@orbaagent/shared";

export type TaskType = "general" | "coding" | "reasoning" | "vision" | "fast";

export interface ModelDefinition {
  id: string;
  displayName: string;
  provider: ProviderId;
  enabled: boolean;
  priority: {
    general: number; // Lower number = higher priority
    coding: number;
    reasoning: number;
    fast: number;
  };
  capabilities: {
    text: boolean;
    coding: boolean;
    reasoning: boolean;
    vision: boolean;
    toolCalling: boolean;
    streaming: boolean;
    structuredOutput: boolean;
  };
  contextWindow: number;
  costClass: "free" | "low" | "standard" | "premium";
  speedClass: "fast" | "standard" | "deep_reasoning";
  fallbackGroup?: string;
  isUnconfirmed?: boolean;
}

/**
 * Verification provenance.
 *
 * Set of model IDs confirmed present in the live Langdock catalog
 * (`GET https://api.langdock.com/openai/eu/v1/models`) on {@link VERIFIED_AT}.
 * Every ID below was returned by the provider itself; none were inferred.
 *
 * Re-run that endpoint before adding an entry here. Do not add an ID that the
 * provider did not return.
 */
export const VERIFIED_LANGDOCK_MODEL_IDS: ReadonlySet<string> = new Set([
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5-mini",
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-luna",
  "gpt-6-sol",
  "langdock-llama-3.3-70b-2",
  "o3",
  "o4-mini",
]);

/** Verification timestamp for {@link VERIFIED_LANGDOCK_MODEL_IDS}. */
export const VERIFIED_AT = "2026-10-06";

/** OpenRouter IDs confirmed routable against the live OpenRouter API. */
export const VERIFIED_OPENROUTER_MODEL_IDS: ReadonlySet<string> = new Set([
  "openrouter/auto",
  "openrouter/free",
]);

/** Ollama model IDs supported on local GPU 1 instance. */
export const VERIFIED_OLLAMA_MODEL_IDS: ReadonlySet<string> = new Set([
  "qwen2.5-coder:32b",
  "qwen2.5-coder:14b",
  "qwen2.5-coder:7b",
  "llama3.3:70b",
  "qwen2.5:72b",
  "qwen3-vl:8b",
]);
/**
 * Capability-based abstract engine aliases.
 * Users and callers interact with abstract capabilities; provider and model IDs remain hidden.
 */
export const CAPABILITY_ALIASES: Record<
  string,
  { targetModel: string; task: TaskType; description: string }
> = {
  "orba-code-engine": {
    targetModel: "qwen2.5-coder:32b",
    task: "coding",
    description: "Primary engineering and autonomous coding engine (validated initial fleet)",
  },
  "orba-fast-engine": {
    targetModel: "qwen2.5-coder:32b",
    task: "fast",
    description: "Low-latency utility, categorization, and micro-task engine",
  },
  "orba-reasoning-engine": {
    targetModel: "qwen2.5-coder:32b",
    task: "reasoning",
    description:
      "Multi-step reasoning and architectural planning (escalates to cloud for deep chains)",
  },
  "orba-vision-engine": {
    targetModel: "qwen3-vl:8b",
    task: "vision",
    description:
      "Visual inspection, UI screenshots, and diagram analysis engine (validated initial fleet)",
  },
};

export function resolveCapabilityAlias(aliasOrModel: string): string {
  if (aliasOrModel in CAPABILITY_ALIASES) {
    return CAPABILITY_ALIASES[aliasOrModel].targetModel;
  }
  return aliasOrModel;
}

/** Whether a model ID has been confirmed to exist at its provider. */
export function isModelIdVerified(id: string): boolean {
  return (
    VERIFIED_LANGDOCK_MODEL_IDS.has(id) ||
    VERIFIED_OPENROUTER_MODEL_IDS.has(id) ||
    VERIFIED_OLLAMA_MODEL_IDS.has(id)
  );
}

export const MODEL_CATALOG: Record<string, ModelDefinition> = {
  // --- OLLAMA LOCAL MODEL POOL (GPU 1 EXCLUSIVE) ---
  // Staged Acquisition Policy: First deployment includes strictly 1 primary coding model and 1 vision model.
  // 70B/72B and mid-tier models are staged disabled until empirical GPU 1 benchmarks are established.
  "qwen2.5-coder:32b": {
    id: "qwen2.5-coder:32b",
    displayName: "Local Code Engine Pro (Qwen 2.5 Coder 32B)",
    provider: "ollama",
    enabled: true,
    priority: { general: 2, coding: 1, reasoning: 3, fast: 3 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 65536,
    costClass: "free",
    speedClass: "standard",
    fallbackGroup: "local-code",
  },
  "qwen2.5-coder:14b": {
    id: "qwen2.5-coder:14b",
    displayName: "Local Code Engine Mid (Qwen 2.5 Coder 14B)",
    provider: "ollama",
    enabled: false, // Staged: not downloaded in initial deployment
    priority: { general: 3, coding: 2, reasoning: 4, fast: 2 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 32768,
    costClass: "free",
    speedClass: "fast",
    fallbackGroup: "local-code",
  },
  "qwen2.5-coder:7b": {
    id: "qwen2.5-coder:7b",
    displayName: "Local Fast Engine (Qwen 2.5 Coder 7B)",
    provider: "ollama",
    enabled: false, // Staged: not downloaded in initial deployment
    priority: { general: 4, coding: 3, reasoning: 5, fast: 1 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: false,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 32768,
    costClass: "free",
    speedClass: "fast",
    fallbackGroup: "local-fast",
  },
  "llama3.3:70b": {
    id: "llama3.3:70b",
    displayName: "Local General Intelligence (Llama 3.3 70B)",
    provider: "ollama",
    enabled: false, // Staged: disabled until empirical GPU 1 benchmarking
    priority: { general: 1, coding: 4, reasoning: 2, fast: 4 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 131072,
    costClass: "free",
    speedClass: "standard",
    fallbackGroup: "local-reasoning",
  },
  "qwen2.5:72b": {
    id: "qwen2.5:72b",
    displayName: "Local Deep Reasoning (Qwen 2.5 72B)",
    provider: "ollama",
    enabled: false, // Staged: disabled until empirical GPU 1 benchmarking
    priority: { general: 2, coding: 4, reasoning: 1, fast: 5 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 65536,
    costClass: "free",
    speedClass: "deep_reasoning",
    fallbackGroup: "local-reasoning",
  },
  "qwen3-vl:8b": {
    id: "qwen3-vl:8b",
    displayName: "Local Vision Engine (Qwen3-VL 8B)",
    provider: "ollama",
    enabled: true,
    priority: { general: 5, coding: 5, reasoning: 5, fast: 4 },
    capabilities: {
      text: true,
      coding: false,
      reasoning: false,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 32768,
    costClass: "free",
    speedClass: "standard",
    fallbackGroup: "local-vision",
  },

  // --- LANGDOCK MODEL POOL ---
  "gpt-5": {
    id: "gpt-5",
    displayName: "Langdock Base Engine (GPT-5)",
    provider: "langdock",
    enabled: true,
    priority: { general: 1, coding: 6, reasoning: 7, fast: 1 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: false,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 100000,
    costClass: "standard",
    speedClass: "standard",
    fallbackGroup: "langdock-base",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.1": {
    id: "gpt-5.1",
    displayName: "Langdock Balanced Engine (GPT-5.1)",
    provider: "langdock",
    enabled: true,
    priority: { general: 2, coding: 4, reasoning: 6, fast: 2 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: false,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "standard",
    speedClass: "fast",
    fallbackGroup: "langdock-balanced",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.2": {
    id: "gpt-5.2",
    displayName: "Langdock Standard Engine (GPT-5.2)",
    provider: "langdock",
    enabled: true,
    priority: { general: 3, coding: 3, reasoning: 4, fast: 3 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 150000,
    costClass: "standard",
    speedClass: "standard",
    fallbackGroup: "langdock-primary",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  // Previously marked UNAVAILABLE because no verified ID was configured. The live
  // Langdock catalog does return `gpt-5.2-pro`, so it is now a real entry rather
  // than an alias redirecting to another model.
  "gpt-5.2-pro": {
    id: "gpt-5.2-pro",
    displayName: "Langdock Pro Reasoning Engine (GPT-5.2 Pro)",
    provider: "langdock",
    enabled: false, // Not supported on /v1/chat/completions endpoint (completions only)
    priority: { general: 6, coding: 5, reasoning: 2, fast: 6 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    displayName: "Langdock High Intelligence (GPT-5.4)",
    provider: "langdock",
    enabled: true,
    priority: { general: 4, coding: 1, reasoning: 2, fast: 4 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "premium",
    speedClass: "standard",
    fallbackGroup: "langdock-primary",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.5": {
    id: "gpt-5.5",
    displayName: "Langdock Next-Gen Engine (GPT-5.5)",
    provider: "langdock",
    enabled: true,
    priority: { general: 5, coding: 2, reasoning: 3, fast: 5 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "premium",
    speedClass: "standard",
    fallbackGroup: "langdock-primary",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-6-luna": {
    id: "gpt-6-luna",
    displayName: "Langdock Luna Engine (GPT-6 Luna)",
    provider: "langdock",
    enabled: true,
    priority: { general: 6, coding: 10, reasoning: 1, fast: 6 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 300000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  o3: {
    id: "o3",
    displayName: "Langdock Reasoning Engine (o3)",
    provider: "langdock",
    enabled: false, // Not available in current Langdock chat pool
    priority: { general: 7, coding: 8, reasoning: 1, fast: 7 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 300000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "o4-mini": {
    id: "o4-mini",
    displayName: "Langdock Fast Reasoning Engine (o4-mini)",
    provider: "langdock",
    enabled: false, // Not available in current Langdock chat pool
    priority: { general: 8, coding: 7, reasoning: 8, fast: 8 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 200000,
    costClass: "low",
    speedClass: "fast",
    fallbackGroup: "langdock-fast",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5-mini": {
    id: "gpt-5-mini",
    displayName: "Langdock Fast Engine (GPT-5 Mini)",
    provider: "langdock",
    enabled: true,
    priority: { general: 9, coding: 9, reasoning: 9, fast: 9 },
    capabilities: {
      text: true,
      coding: false,
      reasoning: false,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 100000,
    costClass: "low",
    speedClass: "fast",
    fallbackGroup: "langdock-fast",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    displayName: "Langdock Fast Execution (GPT-5.4 Mini)",
    provider: "langdock",
    enabled: true,
    priority: { general: 10, coding: 5, reasoning: 10, fast: 10 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: false,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "low",
    speedClass: "fast",
    fallbackGroup: "langdock-fast",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-6-sol": {
    id: "gpt-6-sol",
    displayName: "Langdock Sol Engine (GPT-6 Sol)",
    provider: "langdock",
    enabled: true,
    priority: { general: 11, coding: 11, reasoning: 2, fast: 11 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 300000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-6.1-sol": {
    id: "gpt-6.1-sol",
    displayName: "Langdock Sol Pro (GPT-6.1 Sol)",
    provider: "langdock",
    enabled: true,
    priority: { general: 12, coding: 12, reasoning: 1, fast: 12 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 350000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-6-astra": {
    id: "gpt-6-astra",
    displayName: "Langdock Astra Engine (GPT-6 Astra)",
    provider: "langdock",
    enabled: true,
    priority: { general: 13, coding: 13, reasoning: 3, fast: 13 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 300000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    displayName: "Langdock Sol Reasoning (GPT-5.6 Sol)",
    provider: "langdock",
    enabled: true,
    priority: { general: 14, coding: 14, reasoning: 4, fast: 14 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    displayName: "Langdock Luna Reasoning (GPT-5.6 Luna)",
    provider: "langdock",
    enabled: true,
    priority: { general: 15, coding: 15, reasoning: 5, fast: 15 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    displayName: "Langdock Terra Reasoning (GPT-5.6 Terra)",
    provider: "langdock",
    enabled: true,
    priority: { general: 16, coding: 16, reasoning: 6, fast: 16 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 250000,
    costClass: "premium",
    speedClass: "deep_reasoning",
    fallbackGroup: "langdock-reasoning",
    // Verified present in the live Langdock catalog on 2026-10-06
  },
  "langdock-llama-3.3-70b-2": {
    id: "langdock-llama-3.3-70b-2",
    displayName: "Langdock Llama 3.3 70B",
    provider: "langdock",
    enabled: true,
    priority: { general: 17, coding: 17, reasoning: 17, fast: 17 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: false,
      vision: false,
      toolCalling: false,
      streaming: true,
      structuredOutput: false,
    },
    contextWindow: 128000,
    costClass: "low",
    speedClass: "fast",
    fallbackGroup: "langdock-llama",
    // Verified present in the live Langdock catalog on 2026-10-06
  },

  // --- OPENROUTER FALLBACK POOL ---
  "openrouter/auto": {
    id: "openrouter/auto",
    displayName: "OpenRouter Auto Fallback Engine",
    provider: "openrouter",
    enabled: true,
    priority: { general: 1, coding: 1, reasoning: 1, fast: 1 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: true,
      vision: true,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 500000,
    costClass: "standard",
    speedClass: "fast",
    fallbackGroup: "openrouter-primary",
  },
  "openrouter/free": {
    id: "openrouter/free",
    displayName: "OpenRouter Free Secondary Fallback",
    provider: "openrouter",
    enabled: true,
    priority: { general: 2, coding: 2, reasoning: 2, fast: 2 },
    capabilities: {
      text: true,
      coding: true,
      reasoning: false,
      vision: false,
      toolCalling: true,
      streaming: true,
      structuredOutput: true,
    },
    contextWindow: 100000,
    costClass: "free",
    speedClass: "fast",
    fallbackGroup: "openrouter-secondary",
  },
};

/**
 * Aliases that resolve to a model with the SAME identity.
 *
 * This map may only contain entries where the key and the resolved model are the
 * same underlying model. It must never redirect one model name to a different
 * model: a caller asking for `gpt-5.2-pro` and receiving `gpt-5.4` output is a
 * silent substitution, which is indistinguishable from a wrong answer.
 */
export const IDENTITY_ALIASES: Record<string, string> = {
  "gpt-5": "gpt-5",
  "gpt-5.1": "gpt-5.1",
  "gpt-5.2": "gpt-5.2",
  "gpt-6-luna": "gpt-6-luna",
  "openrouter/auto": "openrouter/auto",
  "openrouter/free": "openrouter/free",
};

/**
 * Product aliases that intentionally select a specific real backend model.
 *
 * These are not silent substitutions: each is an explicit product-level choice
 * with a stable name, resolved to a model that is genuinely served. They are
 * documented here so the mapping is auditable rather than incidental.
 */
export const PRODUCT_ALIASES: Record<string, string> = {
  // The CoderXP tier defaults intentionally select OpenRouter's routing tiers.
  "coderxp-free-default": "openrouter/free",
  "coderxp-pro-default": "openrouter/auto",
};

/**
 * Models that are requested by users but are NOT available.
 *
 * A previous revision pointed these at unrelated models (for example
 * `gpt-5.2-pro` -> `gpt-5.4`, `gpt-5-nano` -> `gpt-5.4-mini`,
 * `gpt-5.3-codex` -> `gpt-5.6-sol`), which made every requested model appear
 * available while silently answering with a different one.
 *
 * Every entry here must either be mapped to a provider-verified real model ID or
 * remain listed as unavailable. Do not invent provider IDs, and do not restore a
 * redirect to make the list look complete.
 */
export const UNAVAILABLE_MODELS: Record<string, string> = {
  "gpt-5-nano":
    "Not available: the live Langdock catalog (verified 2026-10-06) does not return this model ID.",
  "gpt-5.1-codex":
    "Not available: the live Langdock catalog (verified 2026-10-06) does not return this model ID.",
  "gpt-5.1-codex-pro":
    "Not available: the live Langdock catalog (verified 2026-10-06) does not return this model ID.",
  "gpt-5.1-codex-mini":
    "Not available: the live Langdock catalog (verified 2026-10-06) does not return this model ID.",
  "gpt-5.2-codex":
    "Not available: the live Langdock catalog (verified 2026-10-06) does not return this model ID.",
  "gpt-5.3-codex":
    "Not available: the live Langdock catalog (verified 2026-10-06) does not return this model ID.",
  "chatgpt-4o-latest":
    "Not available: the live Langdock catalog (verified 2026-10-06) does not return this model ID; it is an OpenAI marketing name, not a Langdock ID.",
  "langdock-llama-3.3-70b":
    "Not available under this name: the live Langdock catalog returns `langdock-llama-3.3-70b-2`. Request that ID directly.",
};

/**
 * Backwards-compatible aggregate view of the alias maps.
 *
 * Retained so existing imports keep working. It contains only identity aliases
 * and documented product aliases; unavailable names are deliberately absent so
 * they cannot resolve to a substitute model.
 */
export const FRIENDLY_NAME_MAP: Record<string, string> = {
  ...IDENTITY_ALIASES,
  ...PRODUCT_ALIASES,
};

/** Normalise a requested model name. */
function normaliseModelId(idOrAlias: string): string {
  return idOrAlias.toLowerCase().trim();
}

/** Whether the given name is a known-but-unavailable model. */
export function getUnavailableModelReason(idOrAlias: string): string | undefined {
  return UNAVAILABLE_MODELS[normaliseModelId(idOrAlias)];
}

/**
 * Resolve a requested model name to a catalog definition.
 *
 * Returns `undefined` for unknown names and for known-unavailable names, so the
 * caller reports the model as unavailable rather than substituting another one.
 */
export function resolveModelDefinition(idOrAlias: string): ModelDefinition | undefined {
  const key = normaliseModelId(idOrAlias);

  // Exact catalog hit (provider-verified IDs live here).
  if (MODEL_CATALOG[key]) {
    return MODEL_CATALOG[key];
  }

  // Known-but-unavailable must never fall through to a substitute.
  if (UNAVAILABLE_MODELS[key]) {
    return undefined;
  }

  const mapped = IDENTITY_ALIASES[key] ?? PRODUCT_ALIASES[key];
  if (mapped && MODEL_CATALOG[mapped]) {
    return MODEL_CATALOG[mapped];
  }

  return undefined;
}

export function toModelSpec(def: ModelDefinition): ModelSpec {
  const caps: ModelCapability[] = ["text", "streaming"];
  if (def.capabilities.vision) caps.push("vision");
  if (def.capabilities.toolCalling) caps.push("tool_calling");
  if (def.capabilities.structuredOutput) caps.push("json_mode");
  if (def.capabilities.reasoning) caps.push("thinking");

  return {
    id: def.id,
    name: def.displayName,
    provider: def.provider,
    contextWindow: def.contextWindow,
    capabilities: caps,
    isUnconfirmed: def.isUnconfirmed,
    isDefault: def.id === "gpt-5" || def.id === "gpt-5.4",
  };
}
