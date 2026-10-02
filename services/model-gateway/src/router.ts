import type { ChatCompletionRequest, ModelSpec, ProviderId } from "@orbaagent/shared";
import { MODEL_REGISTRY, isLocalQuotaExhausted } from "./registry.js";

export type TaskComplexity = "high_reasoning" | "coding" | "vision" | "fast_response" | "general";

export interface ProviderHealth {
  consecutiveFailures: number;
  lastFailureTime?: number;
  isHealthy: boolean;
}

export interface RoutingDecision {
  primaryModel: ModelSpec;
  fallbackChain: ModelSpec[];
  complexity: TaskComplexity;
  reason: string;
}

export class IntelligenceRouter {
  private readonly providerHealthMap: Map<ProviderId, ProviderHealth> = new Map([
    ["langdock", { consecutiveFailures: 0, isHealthy: true }],
    ["openrouter", { consecutiveFailures: 0, isHealthy: true }],
  ]);

  private readonly modelFailureMap: Map<string, number> = new Map();
  private readonly cooldownMs = 60000; // 1 minute circuit breaker cooldown

  recordProviderFailure(providerId: ProviderId, modelId?: string): void {
    const health = this.providerHealthMap.get(providerId) || {
      consecutiveFailures: 0,
      isHealthy: true,
    };
    health.consecutiveFailures += 1;
    health.lastFailureTime = Date.now();
    if (health.consecutiveFailures >= 3) {
      health.isHealthy = false;
    }
    this.providerHealthMap.set(providerId, health);

    if (modelId) {
      const fails = (this.modelFailureMap.get(modelId) || 0) + 1;
      this.modelFailureMap.set(modelId, fails);
    }
  }

  recordProviderSuccess(providerId: ProviderId, modelId?: string): void {
    this.providerHealthMap.set(providerId, {
      consecutiveFailures: 0,
      isHealthy: true,
    });
    if (modelId) {
      this.modelFailureMap.delete(modelId);
    }
  }

  getProviderHealth(providerId: ProviderId): ProviderHealth {
    const health = this.providerHealthMap.get(providerId) || {
      consecutiveFailures: 0,
      isHealthy: true,
    };
    if (!health.isHealthy && health.lastFailureTime) {
      if (Date.now() - health.lastFailureTime > this.cooldownMs) {
        health.isHealthy = true;
        health.consecutiveFailures = 0;
      }
    }
    return health;
  }

  /**
   * Classify user prompt, task complexity, context requirements, tool dependencies, and capabilities.
   */
  classifyTask(request: ChatCompletionRequest): TaskComplexity {
    const fullText = request.messages
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
      (request.tools && request.tools.length > 0);
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
   * Evaluates task requirements, model capabilities, local quota limits, runtime model failure penalties,
   * and provider circuit-breaker health dynamically without hardcoded static lists.
   */
  selectRouting(request: ChatCompletionRequest): RoutingDecision {
    const complexity = this.classifyTask(request);
    const langdockHealth = this.getProviderHealth("langdock");

    const needsVision = complexity === "vision";
    const needsTools =
      Boolean(request.tools && request.tools.length > 0) || complexity === "coding";

    // Retrieve all registered Langdock models
    const allLangdockModels = Object.values(MODEL_REGISTRY).filter(
      (m) => m.provider === "langdock",
    );

    // Filter eligible Langdock models by task capabilities, quota limits, and failure count
    const eligibleLangdock = allLangdockModels
      .filter((m) => !needsVision || m.capabilities.includes("vision"))
      .filter((m) => !needsTools || m.capabilities.includes("tool_calling"))
      .filter((m) => !isLocalQuotaExhausted(m.id))
      .filter((m) => (this.modelFailureMap.get(m.id) || 0) < 3);

    // Score eligible models dynamically based on task complexity alignment
    const scoredLangdock = eligibleLangdock.map((m) => {
      let score = 10;
      if (complexity === "high_reasoning" && m.capabilities.includes("thinking")) score += 15;
      if (complexity === "coding" && m.capabilities.includes("tool_calling")) score += 10;
      if (complexity === "vision" && m.capabilities.includes("vision")) score += 15;
      if (complexity === "fast_response" && m.id.includes("mini")) score += 10;

      const failures = this.modelFailureMap.get(m.id) || 0;
      score -= failures * 5;
      return { model: m, score };
    });

    scoredLangdock.sort((a, b) => b.score - a.score);
    const sortedLangdockModels = scoredLangdock.map((sm) => sm.model);

    const openrouterAuto = MODEL_REGISTRY["openrouter/auto"];
    const openrouterFree = MODEL_REGISTRY["openrouter/free"];

    let primaryModel: ModelSpec;
    let fallbackChain: ModelSpec[];

    if (langdockHealth.isHealthy && sortedLangdockModels.length > 0) {
      primaryModel = sortedLangdockModels[0];
      const remainingLangdock = sortedLangdockModels.slice(1);
      fallbackChain = [...remainingLangdock, openrouterAuto, openrouterFree].filter(
        (m): m is ModelSpec => Boolean(m),
      );
    } else {
      // Langdock provider in cooldown or all Langdock models exhausted → Failover to OpenRouter
      primaryModel = openrouterAuto || openrouterFree;
      fallbackChain = [openrouterFree].filter((m): m is ModelSpec => Boolean(m));
    }

    return {
      primaryModel,
      fallbackChain,
      complexity,
      reason: `Execution route selected (complexity: ${complexity}, langdockHealth: ${
        langdockHealth.isHealthy ? "healthy" : "cooldown"
      }). Selected primary: ${primaryModel.id}, fallbacks: ${fallbackChain
        .map((m) => m.id)
        .join(", ")}.`,
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
