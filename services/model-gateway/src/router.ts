import type { ChatCompletionRequest, ModelSpec, ProviderId } from "@orbaagent/shared";
import { MODEL_REGISTRY, isQuotaExhausted } from "./registry.js";

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
    ["local", { consecutiveFailures: 0, isHealthy: true }],
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
      "architecture",
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
    const reasoningKeywords = ["explain", "analyze", "compare", "plan", "design", "solve", "why"];
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
   * Multi-dimensional intelligence routing:
   * Evaluates task type, provider health state, quota/allowance exhaustion, context limits, and model capabilities.
   * User model parameters are strictly ignored and normalized to "auto".
   */
  selectRouting(request: ChatCompletionRequest): RoutingDecision {
    const complexity = this.classifyTask(request);
    const langdockHealth = this.getProviderHealth("langdock");

    // Candidate model priority ordering per task type
    let candidateLangdockIds: string[];
    switch (complexity) {
      case "high_reasoning":
        candidateLangdockIds = [
          "gpt-6-sol",
          "gpt-5.4",
          "gpt-5.2-pro",
          "gpt-5.2",
          "gpt-5.1",
          "gpt-5",
          "gpt-5-eu",
        ];
        break;
      case "coding":
        candidateLangdockIds = ["gpt-5.4", "gpt-5.2-pro", "gpt-5.2", "gpt-5.1", "gpt-5.4-mini"];
        break;
      case "vision":
        candidateLangdockIds = ["gpt-5.4", "gpt-5.2-pro", "gpt-5.2", "gpt-6-sol"];
        break;
      case "fast_response":
        candidateLangdockIds = ["gpt-5.4-mini", "gpt-5-mini-eu", "gpt-5.1", "gpt-5.2"];
        break;
      default:
        candidateLangdockIds = ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-eu", "gpt-5.4-mini"];
        break;
    }

    // Filter eligible Langdock models based on health, quota availability, and model failure count
    const eligibleLangdock = candidateLangdockIds
      .map((id) => MODEL_REGISTRY[id])
      .filter((m): m is ModelSpec => Boolean(m))
      .filter((m) => !isQuotaExhausted(m.id))
      .filter((m) => (this.modelFailureMap.get(m.id) || 0) < 3);

    const openrouterAuto = MODEL_REGISTRY["openrouter/auto"];
    const openrouterFree = MODEL_REGISTRY["openrouter/free"];

    let primaryModel: ModelSpec;
    let fallbackChain: ModelSpec[];

    if (langdockHealth.isHealthy && eligibleLangdock.length > 0) {
      primaryModel = eligibleLangdock[0];
      const remainingLangdock = eligibleLangdock.slice(1);
      fallbackChain = [...remainingLangdock, openrouterAuto, openrouterFree].filter(
        (m): m is ModelSpec => Boolean(m),
      );
    } else {
      // Langdock provider unhealthy or all Langdock models exhausted → Failover to OpenRouter
      primaryModel = openrouterAuto || openrouterFree;
      fallbackChain = [openrouterFree].filter((m): m is ModelSpec => Boolean(m));
    }

    return {
      primaryModel,
      fallbackChain,
      complexity,
      reason: `Execution route selected (complexity: ${complexity}, langdockHealth: ${
        langdockHealth.isHealthy ? "healthy" : "cooldown"
      }). Selected internal primary: ${primaryModel.id}, fallbacks: ${fallbackChain
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
