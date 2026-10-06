import type { ChatCompletionRequest, ModelSpec, ProviderId } from "@orbaagent/shared";
import { MODEL_CATALOG, type ModelDefinition, toModelSpec } from "./catalog.js";
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
    ["langdock", { consecutiveFailures: 0, isHealthy: true, isAuthenticated: true }],
    ["openrouter", { consecutiveFailures: 0, isHealthy: true, isAuthenticated: true }],
  ]);

  private readonly healthTracker: ModelHealthTracker;
  private readonly cooldownMs = 60000; // 1 minute circuit breaker cooldown

  constructor(customHealthTracker?: ModelHealthTracker) {
    this.healthTracker = customHealthTracker || new ModelHealthTracker(this.cooldownMs);
  }

  public getHealthTracker(): ModelHealthTracker {
    return this.healthTracker;
  }

  isProviderConfigured(providerId: ProviderId): boolean {
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
    const fullText = (userMessages.length > 0 ? userMessages : request.messages)
      .map((m: { content: string }) => m.content)
      .join(" ")
      .toLowerCase();

    // Check for vision requirement
    const hasVisionKey =
      fullText.includes("image") || fullText.includes("screenshot") || fullText.includes("picture");
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
   * Selects eligible models from the Langdock Model Pool ordered by task-specific priority.
   * If Langdock models are exhausted or unauthenticated, seamlessly falls back to OpenRouter pool.
   */
  selectRouting(request: ChatCompletionRequest): RoutingDecision {
    const complexity = this.classifyTask(request);
    const langdockHealth = this.getProviderHealth("langdock");
    const openrouterHealth = this.getProviderHealth("openrouter");

    const tenantId = request.trace?.tenantId;

    const needsVision = complexity === "vision";
    const needsTools =
      Boolean(request.tools && request.tools.length > 0) || complexity === "coding";

    const isLangdockConfigured = this.isProviderConfigured("langdock") || this.isMockAllowed();
    const isLangdockAvailable =
      langdockHealth.isHealthy && langdockHealth.isAuthenticated && isLangdockConfigured;

    const isOpenRouterConfigured = this.isProviderConfigured("openrouter") || this.isMockAllowed();
    const isOpenRouterAvailable =
      openrouterHealth.isHealthy && openrouterHealth.isAuthenticated && isOpenRouterConfigured;

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

    if (sortedLangdockModels.length > 0) {
      primaryModel = sortedLangdockModels[0];
      const remainingLangdock = sortedLangdockModels.slice(1);
      fallbackChain = [...remainingLangdock, ...eligibleOpenRouter];
    } else if (eligibleOpenRouter.length > 0) {
      primaryModel = eligibleOpenRouter[0];
      fallbackChain = eligibleOpenRouter.slice(1);
    } else {
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
        `All provider routes are unavailable or in circuit breaker cooldown (Langdock: ${langdockStatus}, OpenRouter: ${openrouterStatus}).`,
      );
    }

    // Human-readable reason ONLY. Internal provider/model identifiers must not
    // appear here: this string is part of the RoutingDecision contract and could
    // be surfaced in UI or diagnostics. Detailed IDs stay on primaryModel /
    // fallbackChain and in the server-side gateway audit log.
    const langdockFallbacks = fallbackChain.filter((m) => m.provider === "langdock").length;
    const openrouterFallbacks = fallbackChain.filter((m) => m.provider === "openrouter").length;

    const primaryProviderLabel = primaryModel.provider === "langdock" ? "Langdock" : "OpenRouter";
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
        `${langdockFallbacks + openrouterFallbacks} eligible fallback` +
        `${langdockFallbacks + openrouterFallbacks === 1 ? "" : "s"}${backupSummary}.`,
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
