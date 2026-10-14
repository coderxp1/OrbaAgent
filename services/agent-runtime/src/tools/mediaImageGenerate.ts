import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import {
  FIRST_REQUEST_TIMEOUT_MS,
  type GpuWorkerHealth,
  getMediaWorkerConfig,
  isLazyLoadAllowed,
  unavailableMediaResult,
} from "./mediaWorkerConfig.js";

export class MediaImageGenerateTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "media_image_generate",
    description:
      "Generate an AI image using dedicated GPU 1 media worker. Returns job ID, status, accessible artifact URL, and generation metadata. When successful, present the generated image to the user in markdown using the returned artifactUrl: ![Description](artifactUrl).",
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
          enum: ["png"],
          description: "Target image format. Currently only png is supported by the worker.",
          default: "png",
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
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] GPU media worker health check failed. Response: ${healthRes ? healthRes.status : "network error"}`,
        );
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
      const health = (await healthRes.json().catch(() => null)) as GpuWorkerHealth | null;

      // The worker reports capabilities.image_generation = true only AFTER the
      // model has been loaded into GPU memory. When the worker is configured
      // with generation_backend="diffusers" but has not received its first
      // request yet, the capability is false and unavailable_reason explains
      // that the first request will trigger loading. We must allow that case.
      const capabilityReady = health?.capabilities?.image_generation === true;
      const lazyLoadPending = isLazyLoadAllowed(health);

      if (!capabilityReady && !lazyLoadPending) {
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] MEDIA_GENERATION_UNAVAILABLE: the GPU worker is reachable but reports no real image generation backend (generation_backend=${health?.generation_backend ?? "none"}).`,
        );
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

      // Use an extended timeout for the first request (model loading).
      const requestTimeout = lazyLoadPending ? FIRST_REQUEST_TIMEOUT_MS : 120_000;

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
        signal: AbortSignal.timeout(requestTimeout),
      });

      if (!jobRes.ok) {
        const errorText = await jobRes.text().catch(() => "Unknown error");
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] GPU image generation failed with status ${jobRes.status}: ${errorText}`,
        );
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

      // If delivery to production failed, report the failure truthfully
      if (
        result.delivered === false ||
        (typeof result.ingest_note === "string" && result.ingest_note.includes("ingest failed"))
      ) {
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] GPU image generated successfully but artifact delivery failed: ${result.ingest_note}`,
        );
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Image generated on GPU host, but artifact delivery to the web application failed (${result.ingest_note || "Ingest rejected"}). Artifact is not retrievable.`,
          metadata: result,
          executionTimeMs: durationMs,
        };
      }

      const artifactUrl = result.artifactUrl || result.artifact_url || "";
      const artifactPath =
        result.artifactPath ||
        result.artifact_path ||
        result.artifact_id ||
        result.artifactId ||
        "";

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify(
          {
            status: "COMPLETED",
            jobId: result.jobId || `job_${Date.now()}`,
            artifactPath,
            artifactUrl,
            markdown: artifactUrl ? `![Generated Image: ${prompt}](${artifactUrl})` : undefined,
            model: result.model || args.model || "flux1-schnell",
            dimensions: `${args.width || 1024}x${args.height || 1024}`,
            delivered: result.delivered !== false,
            executionDurationMs: durationMs,
          },
          null,
          2,
        ),
        metadata: result,
        executionTimeMs: durationMs,
      };
    } catch (err: any) {
      console.error(
        `[MEDIA GENERATION DIAGNOSTIC] GPU generation request failed: ${err.message || String(err)}`,
      );
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
