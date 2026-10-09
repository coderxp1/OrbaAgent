import type { ChatCompletionRequest, ModelSpec, ProviderId } from "@orbaagent/shared";
import { GpuAdmissionController } from "./admission.js";
import { MODEL_CATALOG, type ModelDefinition, resolveCapabilityAlias, toModelSpec } from "./catalog.js";
import { type ModelHealthStatus, ModelHealthTracker } from "./health.js";
import { hasConfirmedCapability, isLocalQuotaExhausted } from "./registry.js";

export type TaskComplexity = "high_reasoning" | "coding" | "vision" | "fast_response" | "general";

export interface ProviderHealth {
  consecutiveFailures: number;
  lastFailureTime?: number;
  isHealthy: boolean;
  isAuthenticated: boolean;
  authError?: string;
}

export interface RoutingDecision {
  primaryModel: ModelSpec;
  fallbackChain: ModelSpec[];
  complexity: TaskComplexity;
  reason: string;
}

export class IntelligenceRouter {
  private readonly providerHealthMap: Map<ProviderId, ProviderHealth> = new Map([
    ["ollama", { consecutiveFailures: 0, isHealthy: true, isAuthenticated: true }],
    ["langdock", { consecutiveFailures: 0, isHealthy: true, isAuthenticated: true }],
    ["openrouter", { consecutiveFailures: 0, isHealthy: true, isAuthenticated: true }],
  ]);

  private readonly healthTracker: ModelHealthTracker;
  private readonly admissionController: GpuAdmissionController;
  private readonly cooldownMs = 60000; // 1 minute circuit breaker cooldown

  constructor(customHealthTracker?: ModelHealthTracker, customAdmissionController?: GpuAdmissionController) {
    this.healthTracker = customHealthTracker || new ModelHealthTracker(this.cooldownMs);
    this.admissionController = customAdmissionController || new GpuAdmissionController();
  }

  public getHealthTracker(): ModelHealthTracker {
    return this.healthTracker;
  }

  public getAdmissionController(): GpuAdmissionController {
    return this.admissionController;
  }

  isProviderConfigured(providerId: ProviderId): boolean {
    if (providerId === "ollama") {
      // Ollama requires explicit enablement via OLLAMA_ENABLED or OLLAMA_BASE_URL
      return (
        process.env.OLLAMA_ENABLED === "true" ||
        Boolean(process.env.OLLAMA_BASE_URL && process.env.OLLAMA_BASE_URL.trim().length > 0)
      );
    }
    if (process.env.NODE_ENV === "test") {
      return true;
    }
    if (providerId === "langdock") {
      const key = process.env.LANGDOCK_API_KEY || process.env.Langdock_API_KEY;
      return Boolean(key && key !== "undefined" && key.trim().length > 0);
    }
    if (providerId === "openrouter") {
      const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API;
      return Boolean(key && key !== "undefined" && key.trim().length > 0);
    }
    return false;
  }

  recordAuthFailure(providerId: ProviderId, error: string): void {
    const health = this.providerHealthMap.get(providerId) || {
      consecutiveFailures: 0,
      isHealthy: true,
      isAuthenticated: true,
    };
    health.consecutiveFailures += 3;
    health.isHealthy = false;
    health.isAuthenticated = false;
    health.authError = error;
    health.lastFailureTime = Date.now();
    this.providerHealthMap.set(providerId, health);
  }

  recordProviderFailure(providerId: ProviderId, modelId?: string): void {
    const health = this.providerHealthMap.get(providerId) || {
      consecutiveFailures: 0,
      isHealthy: true,
      isAuthenticated: true,
    };
    health.consecutiveFailures += 1;
    health.lastFailureTime = Date.now();
    if (health.consecutiveFailures >= 3) {
      health.isHealthy = false;
    }
    this.providerHealthMap.set(providerId, health);

    if (modelId) {
      this.healthTracker.recordModelFailure(modelId, "TEMPORARILY_FAILED", undefined);
    }
  }

  recordModelRateLimit(modelId: string, retryAfterMs?: number): void {
    this.healthTracker.recordModelFailure(modelId, "RATE_LIMITED", retryAfterMs);
  }

  recordProviderSuccess(providerId: ProviderId, modelId?: string): void {
    this.providerHealthMap.set(providerId, {
      consecutiveFailures: 0,
      isHealthy: true,
      isAuthenticated: true,
    });

    if (modelId) {
      this.healthTracker.recordModelSuccess(modelId);
    } else {
      this.healthTracker.clearProviderFailures(providerId);
    }
  }

  getModelFailures(modelId: string): number {
    const rec = this.healthTracker.getRecord(modelId);
    return rec.failureCount;
  }

  getProviderHealth(providerId: ProviderId): ProviderHealth {
    const health = this.providerHealthMap.get(providerId) || {
      consecutiveFailures: 0,
      isHealthy: true,
      isAuthenticated: true,
    };
    if (!health.isHealthy && health.lastFailureTime) {
      if (Date.now() - health.lastFailureTime > this.cooldownMs) {
        health.isHealthy = true;
        health.consecutiveFailures = 0;
        health.isAuthenticated = true;
        health.authError = undefined;

        this.healthTracker.clearProviderFailures(providerId);
      }
    }
    return health;
  }

  /**
   * Classify user prompt, task complexity, context requirements, tool dependencies, and capabilities.
   */
  classifyTask(request: ChatCompletionRequest): TaskComplexity {
    const userMessages = request.messages.filter((m) => m.role === "user");
    
    let hasExplicitImagePart = false;

    const fullText = (userMessages.length > 0 ? userMessages : request.messages)
      .map((m: any) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content.map((part: any) => {
            if (part.type === "image_url") {
              hasExplicitImagePart = true;
              return "";
            }
            if (part.type === "text") return part.text || "";
            return "";
          }).join(" ");
        }
        return "";
      })
      .join(" ")
      .toLowerCase();

    // Check for vision requirement
    const hasVisionKey =
      hasExplicitImagePart || fullText.includes("image") || fullText.includes("screenshot") || fullText.includes("picture");
    if (hasVisionKey) {
      return "vision";
    }

    // Check for coding/engineering/architecture requirement
    const codingKeywords = [
      "code",
      "build",
      "function",
      "fix",
      "bug",
      "terminal",
      "git",
      "github",
      "repo",
      "test",
      "docker",
      "deploy",
      "script",
      "app",
      "react",
      "next.js",
      "typescript",
      "python",
      "api",
      "refactor",
      "ci/cd",
    ];
    const isCodingTask =
      codingKeywords.some((kw) => fullText.includes(kw)) ||
      Boolean(request.tools && request.tools.length > 0);
    if (isCodingTask) {
      return "coding";
    }

    // Check for complex reasoning
    const reasoningKeywords = ["explain", "analyze", "compare", "plan", "solve", "prove", "math"];
    if (reasoningKeywords.some((kw) => fullText.includes(kw)) || fullText.length > 300) {
      return "high_reasoning";
    }

    // Quick/simple query
    if (fullText.length < 50) {
      return "fast_response";
    }

    return "general";
  }

  /**
   * Dynamic Capability-Based Intelligence Routing:
   * Selects eligible local models from the Ollama Model Pool on GPU 1 when capable and admitted.
   * If local models are unavailable, saturated, or in cooldown, seamlessly escalates to Langdock cloud intelligence,
   * then falls back to OpenRouter.
   */
  selectRouting(request: ChatCompletionRequest): RoutingDecision {
    const rawModelId = request.modelId;
    const isAuto = rawModelId === "auto" || !rawModelId;
    const resolvedModelId = !isAuto ? resolveCapabilityAlias(rawModelId) : undefined;
    const effectiveRequest = resolvedModelId ? { ...request, modelId: resolvedModelId } : request;

    const complexity = this.classifyTask(effectiveRequest);
    const ollamaHealth = this.getProviderHealth("ollama");
    const langdockHealth = this.getProviderHealth("langdock");
    const openrouterHealth = this.getProviderHealth("openrouter");

    const tenantId = effectiveRequest.trace?.tenantId;

    const needsVision = complexity === "vision";
    const needsTools =
      Boolean(effectiveRequest.tools && effectiveRequest.tools.length > 0) || complexity === "coding";

    const isOllamaConfigured = this.isProviderConfigured("ollama") || this.isMockAllowed();
    const isOllamaAvailable =
      ollamaHealth.isHealthy && isOllamaConfigured;

    const isLangdockConfigured = this.isProviderConfigured("langdock") || this.isMockAllowed();
    const isLangdockAvailable =
      langdockHealth.isHealthy && langdockHealth.isAuthenticated && isLangdockConfigured;

    const isOpenRouterConfigured = this.isProviderConfigured("openrouter") || this.isMockAllowed();
    const isOpenRouterAvailable =
      openrouterHealth.isHealthy && openrouterHealth.isAuthenticated && isOpenRouterConfigured;

    // Filter and sort eligible Local Ollama models
    const allOllamaDefs = Object.values(MODEL_CATALOG).filter(
      (m) => m.provider === "ollama" && m.enabled,
    );

    const eligibleOllamaDefs = isOllamaAvailable
      ? allOllamaDefs
          .filter((def) => !resolvedModelId || def.id === resolvedModelId)
          .filter((def) => !needsVision || def.capabilities.vision)
          .filter((def) => !needsTools || def.capabilities.toolCalling)
          .filter((def) => !isLocalQuotaExhausted(def.id, tenantId))
          .filter((def) => this.healthTracker.isModelEligible(def.id))
          .filter((def) => this.admissionController.evaluateAdmission(def.id).admitted)
      : [];

    eligibleOllamaDefs.sort((a, b) => {
      let prioA = a.priority.general;
      let prioB = b.priority.general;
      if (complexity === "coding") {
        prioA = a.priority.coding;
        prioB = b.priority.coding;
      } else if (complexity === "high_reasoning") {
        prioA = a.priority.reasoning;
        prioB = b.priority.reasoning;
      } else if (complexity === "fast_response") {
        prioA = a.priority.fast;
        prioB = b.priority.fast;
      }
      return prioA - prioB;
    });

    const sortedOllamaModels: ModelSpec[] = eligibleOllamaDefs.map((def) => toModelSpec(def));

    // Filter eligible Langdock models from the Model Catalog
    const allLangdockDefs = Object.values(MODEL_CATALOG).filter(
      (m) => m.provider === "langdock" && m.enabled,
    );

    const eligibleLangdockDefs = isLangdockAvailable
      ? allLangdockDefs
          .filter((def) => !needsVision || def.capabilities.vision)
          .filter((def) => !needsTools || def.capabilities.toolCalling)
          .filter((def) => !isLocalQuotaExhausted(def.id, tenantId))
          .filter((def) => this.healthTracker.isModelEligible(def.id))
      : [];

    // Sort Langdock models by task-specific priority (lower number = higher priority)
    eligibleLangdockDefs.sort((a, b) => {
      let prioA = a.priority.general;
      let prioB = b.priority.general;
      if (complexity === "coding") {
        prioA = a.priority.coding;
        prioB = b.priority.coding;
      } else if (complexity === "high_reasoning") {
        prioA = a.priority.reasoning;
        prioB = b.priority.reasoning;
      } else if (complexity === "fast_response") {
        prioA = a.priority.fast;
        prioB = b.priority.fast;
      }
      return prioA - prioB;
    });

    const sortedLangdockModels: ModelSpec[] = eligibleLangdockDefs.map((def) => toModelSpec(def));

    // Filter eligible OpenRouter models from catalog
    const allOpenRouterDefs = Object.values(MODEL_CATALOG).filter(
      (m) => m.provider === "openrouter" && m.enabled,
    );

    const eligibleOpenRouterDefs = isOpenRouterAvailable
      ? allOpenRouterDefs
          .filter((def) => !needsVision || def.capabilities.vision)
          .filter((def) => !needsTools || def.capabilities.toolCalling)
          .filter((def) => !isLocalQuotaExhausted(def.id, tenantId))
          .filter((def) => this.healthTracker.isModelEligible(def.id))
      : [];

    eligibleOpenRouterDefs.sort((a, b) => a.priority.general - b.priority.general);
    const eligibleOpenRouter: ModelSpec[] = eligibleOpenRouterDefs.map((def) => toModelSpec(def));

    let primaryModel: ModelSpec;
    let fallbackChain: ModelSpec[];

    // Determine whether to prioritize Local Ollama or Langdock based on the task complexity
    // Local models are preferred for coding and vision.
    // Cloud models (Langdock) are preferred for general intelligence and high reasoning.
    const preferLocal = 
      (sortedOllamaModels.length > 0) &&
      (!isAuto || complexity === "coding" || complexity === "vision");

    if (preferLocal) {
      primaryModel = sortedOllamaModels[0];
      const remainingOllama = sortedOllamaModels.slice(1);
      fallbackChain = [...remainingOllama, ...sortedLangdockModels, ...eligibleOpenRouter];
    } else if (sortedLangdockModels.length > 0) {
      primaryModel = sortedLangdockModels[0];
      const remainingLangdock = sortedLangdockModels.slice(1);
      fallbackChain = [...remainingLangdock, ...sortedOllamaModels, ...eligibleOpenRouter];
    } else if (sortedOllamaModels.length > 0) {
      // If Langdock is offline, but local models are available, fallback to local models
      primaryModel = sortedOllamaModels[0];
      const remainingOllama = sortedOllamaModels.slice(1);
      fallbackChain = [...remainingOllama, ...eligibleOpenRouter];
    } else if (eligibleOpenRouter.length > 0) {
      primaryModel = eligibleOpenRouter[0];
      fallbackChain = eligibleOpenRouter.slice(1);
    } else {
      const ollamaStatus = !isOllamaConfigured
        ? "unconfigured"
        : !ollamaHealth.isHealthy
          ? "cooldown"
          : "no eligible or admitted models";

      const langdockStatus = !isLangdockConfigured
        ? "unconfigured"
        : !langdockHealth.isAuthenticated
          ? "unauthenticated"
          : !langdockHealth.isHealthy
            ? "cooldown"
            : "no eligible models";

      const openrouterStatus = !isOpenRouterConfigured
        ? "unconfigured"
        : !openrouterHealth.isAuthenticated
          ? "unauthenticated"
          : !openrouterHealth.isHealthy
            ? "cooldown"
            : "no eligible models";

      throw new Error(
        `All provider routes are unavailable or in circuit breaker cooldown (Local Ollama: ${ollamaStatus}, Langdock: ${langdockStatus}, OpenRouter: ${openrouterStatus}).`,
      );
    }

    // Human-readable reason ONLY. Internal provider/model identifiers must not
    // appear here: this string is part of the RoutingDecision contract and could
    // be surfaced in UI or diagnostics. Detailed IDs stay on primaryModel /
    // fallbackChain and in the server-side gateway audit log.
    const ollamaFallbacks = fallbackChain.filter((m) => m.provider === "ollama").length;
    const langdockFallbacks = fallbackChain.filter((m) => m.provider === "langdock").length;
    const openrouterFallbacks = fallbackChain.filter((m) => m.provider === "openrouter").length;

    const primaryProviderLabel =
      primaryModel.provider === "langdock"
        ? "Langdock"
        : primaryModel.provider === "ollama"
          ? "Local Ollama"
          : "OpenRouter";

    const backupSummary =
      openrouterFallbacks > 0
        ? ` and OpenRouter backup (${openrouterFallbacks} route${
            openrouterFallbacks === 1 ? "" : "s"
          })`
        : "";

    return {
      primaryModel,
      fallbackChain,
      complexity,
      reason:
        `Execution route selected: ${primaryProviderLabel} primary with ` +
        `${ollamaFallbacks + langdockFallbacks + openrouterFallbacks} eligible fallback` +
        `${ollamaFallbacks + langdockFallbacks + openrouterFallbacks === 1 ? "" : "s"}${backupSummary}.`,
    };
  }

  /**
   * Verify whether mock providers are allowed in current environment.
   * Mock providers are STRICTLY FORBIDDEN in production.
   */
  isMockAllowed(): boolean {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      return false; // NEVER allow mocks in production
    }
    return process.env.USE_MOCK_PROVIDERS === "true" || process.env.ALLOW_MOCK_PROVIDERS === "true";
  }
}
