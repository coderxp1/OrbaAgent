import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { getMediaWorkerConfig, unavailableMediaResult } from "./mediaWorkerConfig.js";

export class MediaImageGenerateTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "media_image_generate",
    description:
      "Generate an AI image using dedicated GPU 1 media worker. Returns job ID, status, artifact path, and generation metadata.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of the image to generate.",
        },
        negative_prompt: {
          type: "string",
          description: "Elements to exclude or suppress in the generation.",
        },
        width: {
          type: "number",
          description: "Image width in pixels (e.g. 512, 768, 1024). Default is 1024.",
        },
        height: {
          type: "number",
          description: "Image height in pixels (e.g. 512, 768, 1024). Default is 1024.",
        },
        steps: {
          type: "number",
          description: "Number of sampling steps. Default is 20.",
        },
        seed: {
          type: "number",
          description: "Seed for deterministic generation.",
        },
        model: {
          type: "string",
          description:
            "Model to use on GPU worker (e.g. flux1-schnell, sd-xl). Default is flux1-schnell.",
        },
        output_format: {
          type: "string",
          enum: ["png", "jpeg", "webp"],
          description: "Target image format. Default is png.",
        },
      },
      required: ["prompt"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "media_image_generate",
    description: "Generate high-resolution AI images via dedicated GPU 1 worker",
    category: "media",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: ["image", "generate", "media", "diffusion", "gpu", "render", "picture", "photo"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_img_${Date.now()}`;
    const prompt = String(args.prompt || "").trim();

    if (!prompt) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Prompt is required for image generation",
        executionTimeMs: Date.now() - startTime,
      };
    }

    const workerState = getMediaWorkerConfig();
    if (!workerState.config) {
      return unavailableMediaResult(toolCallId, this.definition.name, startTime);
    }
    const { url: workerUrl, token: workerToken } = workerState.config;

    try {
      // 1. Check health of GPU worker
      const healthRes = await fetch(`${workerUrl}/health`, {
        headers: { Authorization: `Bearer ${workerToken}` },
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      if (!healthRes || !healthRes.ok) {
        console.error(`[MEDIA GENERATION DIAGNOSTIC] GPU media worker health check failed. Response: ${healthRes ? healthRes.status : 'network error'}`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Image generation is temporarily unavailable. Please try again later.",
          metadata: {
            status: "UNAVAILABLE",
          },
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Defence in depth: only trust a worker that reports a real generation
      // backend. A worker can be reachable while running no model at all, and an
      // older build answered generation requests with fabricated output.
      const health = (await healthRes.json().catch(() => null)) as {
        capabilities?: { image_generation?: boolean };
        generation_backend?: string | null;
      } | null;

      if (!health?.capabilities?.image_generation) {
        console.error(`[MEDIA GENERATION DIAGNOSTIC] MEDIA_GENERATION_UNAVAILABLE: the GPU worker is reachable but reports no real image generation backend (generation_backend=${health?.generation_backend ?? "none"}).`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Image generation is temporarily unavailable. Please try again later.",
          metadata: {
            status: "UNAVAILABLE",
          },
          executionTimeMs: Date.now() - startTime,
        };
      }

      // 2. Submit image generation job to dedicated GPU worker
      const jobRes = await fetch(`${workerUrl}/api/generate/image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          prompt,
          negative_prompt: args.negative_prompt,
          width: args.width || 1024,
          height: args.height || 1024,
          steps: args.steps || 20,
          seed: args.seed,
          model: args.model || "flux1-schnell",
          output_format: args.output_format || "png",
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!jobRes.ok) {
        const errorText = await jobRes.text().catch(() => "Unknown error");
        console.error(`[MEDIA GENERATION DIAGNOSTIC] GPU image generation failed with status ${jobRes.status}: ${errorText}`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Image generation is temporarily unavailable. Please try again later.",
          executionTimeMs: Date.now() - startTime,
        };
      }

      const result = await jobRes.json();
      const durationMs = Date.now() - startTime;

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify(
          {
            status: "COMPLETED",
            jobId: result.jobId || `job_${Date.now()}`,
            artifactPath: result.artifactPath,
            artifactUrl: result.artifactUrl,
            model: result.model || args.model || "flux1-schnell",
            dimensions: `${args.width || 1024}x${args.height || 1024}`,
            executionDurationMs: durationMs,
          },
          null,
          2,
        ),
        metadata: result,
        executionTimeMs: durationMs,
      };
    } catch (err: any) {
      console.error(`[MEDIA GENERATION DIAGNOSTIC] GPU generation request failed: ${err.message || String(err)}`);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Image generation is temporarily unavailable. Please try again later.",
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
