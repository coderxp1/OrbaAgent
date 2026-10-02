import type { ChatCompletionRequest, ModelSpec } from "@orbaagent/shared";
import { MODEL_REGISTRY } from "./registry.js";

export type TaskComplexity = "high_reasoning" | "coding" | "vision" | "fast_response" | "general";

export interface RoutingDecision {
  primaryModel: ModelSpec;
  fallbackChain: ModelSpec[];
  complexity: TaskComplexity;
  reason: string;
}

export class IntelligenceRouter {
  /**
   * Classify user prompt and task requirements to determine optimal model selection
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
   * Select primary model (Langdock) and ordered fallback chain (OpenRouter) based on task intelligence.
   * Note: External model selection is rejected/ignored and normalized to "auto".
   */
  selectRouting(request: ChatCompletionRequest): RoutingDecision {
    // External model selection parameter is ignored & normalized to auto
    const normalizedModel = "auto";
    const complexity = this.classifyTask(request);

    // Primary source: Langdock. Secondary source: OpenRouter.
    const langdockPrimary = MODEL_REGISTRY["langdock-auto"] || MODEL_REGISTRY["langdock-fast"];
    const openrouterSecondary =
      MODEL_REGISTRY["openrouter/auto"] || MODEL_REGISTRY["openrouter/fallback"];

    return {
      primaryModel: langdockPrimary,
      fallbackChain: [openrouterSecondary],
      complexity,
      reason: `Task classified as ${complexity}. Primary route: Langdock API (${langdockPrimary.id}); Fallback route: OpenRouter API (${openrouterSecondary.id}). External model selection normalized to '${normalizedModel}'.`,
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
