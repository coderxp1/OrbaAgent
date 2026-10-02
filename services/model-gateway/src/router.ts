import type { ChatCompletionRequest, ModelSpec } from "@orbaagent/shared";
import { MODEL_REGISTRY, getModelSpec } from "./registry.js";

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
      .map((m) => m.content)
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
   * Select primary model and ordered fallback chain based on task intelligence
   */
  selectRouting(request: ChatCompletionRequest): RoutingDecision {
    const reqModel = request.modelId || "auto";

    // If explicit model requested (and not auto), honor explicit request first
    if (reqModel !== "auto" && MODEL_REGISTRY[reqModel]) {
      const primary = getModelSpec(reqModel);
      const fallbacks = Object.values(MODEL_REGISTRY).filter((m) => m.id !== primary.id);
      return {
        primaryModel: primary,
        fallbackChain: fallbacks,
        complexity: "general",
        reason: `User explicitly specified model: ${primary.name}`,
      };
    }

    const complexity = this.classifyTask(request);

    switch (complexity) {
      case "coding":
      case "high_reasoning":
        return {
          primaryModel:
            MODEL_REGISTRY["grok-2-latest"] || MODEL_REGISTRY["claude-3-5-sonnet-latest"],
          fallbackChain: [
            MODEL_REGISTRY["claude-3-5-sonnet-latest"],
            MODEL_REGISTRY["gpt-4o"],
            MODEL_REGISTRY["gemini-1.5-pro-latest"],
            MODEL_REGISTRY["gpt-4o-mini"],
          ].filter(Boolean),
          complexity,
          reason:
            "Task requires advanced reasoning and coding capabilities; routed to top-tier agentic models.",
        };
      case "vision":
        return {
          primaryModel: MODEL_REGISTRY["grok-vision-beta"] || MODEL_REGISTRY["gpt-4o"],
          fallbackChain: [
            MODEL_REGISTRY["gpt-4o"],
            MODEL_REGISTRY["claude-3-5-sonnet-latest"],
            MODEL_REGISTRY["gemini-1.5-pro-latest"],
          ].filter(Boolean),
          complexity,
          reason: "Multimodal vision task detected; routed to vision-capable model provider.",
        };
      case "fast_response":
        return {
          primaryModel: MODEL_REGISTRY["gpt-4o-mini"] || MODEL_REGISTRY["claude-3-haiku-20240307"],
          fallbackChain: [
            MODEL_REGISTRY["claude-3-haiku-20240307"],
            MODEL_REGISTRY["gemini-1.5-flash-latest"],
            MODEL_REGISTRY["grok-2-latest"],
          ].filter(Boolean),
          complexity,
          reason: "Fast response task; routed to low-latency model with fallback to high-tier.",
        };
      default:
        return {
          primaryModel: MODEL_REGISTRY["grok-2-latest"] || MODEL_REGISTRY["gpt-4o"],
          fallbackChain: [
            MODEL_REGISTRY["gpt-4o"],
            MODEL_REGISTRY["claude-3-5-sonnet-latest"],
            MODEL_REGISTRY["gemini-1.5-pro-latest"],
          ].filter(Boolean),
          complexity,
          reason: "General autonomous task; routed to OrbaAgent primary model.",
        };
    }
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
