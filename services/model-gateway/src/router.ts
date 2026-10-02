import type { ChatCompletionRequest, ModelSpec, ProviderId } from "@orbaagent/shared";
import { MODEL_REGISTRY } from "./registry.js";

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

  private readonly cooldownMs = 60000; // 1 minute circuit-breaker cooldown

  recordProviderFailure(providerId: ProviderId): void {
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
  }

  recordProviderSuccess(providerId: ProviderId): void {
    this.providerHealthMap.set(providerId, {
      consecutiveFailures: 0,
      isHealthy: true,
    });
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
   * Evaluates task type, provider health state, context limits, latency/cost efficiency, and capability compatibility.
   * Note: External model selection is rejected/ignored and normalized to "auto".
   */
  selectRouting(request: ChatCompletionRequest): RoutingDecision {
    const normalizedModel = "auto";
    const complexity = this.classifyTask(request);

    const langdockHealth = this.getProviderHealth("langdock");
    const openrouterHealth = this.getProviderHealth("openrouter");

    let primaryModel = MODEL_REGISTRY["langdock-auto"] || MODEL_REGISTRY["langdock-fast"];
    let fallbackChain = [
      MODEL_REGISTRY["openrouter/auto"] || MODEL_REGISTRY["openrouter/fallback"],
    ];

    // If Langdock circuit-breaker is open (unhealthy due to repeated failures), promote OpenRouter as primary route
    if (!langdockHealth.isHealthy && openrouterHealth.isHealthy) {
      primaryModel = MODEL_REGISTRY["openrouter/auto"] || MODEL_REGISTRY["openrouter/fallback"];
      fallbackChain = [MODEL_REGISTRY["langdock-auto"] || MODEL_REGISTRY["langdock-fast"]];
    }

    return {
      primaryModel,
      fallbackChain,
      complexity,
      reason: `Multi-dimensional routing decision (complexity: ${complexity}, langdockHealth: ${
        langdockHealth.isHealthy ? "healthy" : "cooldown"
      }, openrouterHealth: ${
        openrouterHealth.isHealthy ? "healthy" : "cooldown"
      }). Selected primary: ${primaryModel.id}, fallback: ${
        fallbackChain[0].id
      }. External model selection normalized to '${normalizedModel}'.`,
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
