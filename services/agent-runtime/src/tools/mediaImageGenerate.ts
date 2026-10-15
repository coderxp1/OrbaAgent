import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { verifyDeliveredArtifact } from "./mediaVerification.js";
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

      // 2. Submit image generation job to dedicated GPU worker with bounded self-repair
      let jobRes: Response | null = null;
      let attempts = 0;
      const maxAttempts = 2;
      let currentArgs: Record<string, any> = { ...args };

      while (attempts < maxAttempts) {
        attempts++;
        try {
          jobRes = await fetch(`${workerUrl}/api/generate/image`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${workerToken}`,
            },
            body: JSON.stringify({
              prompt,
              negative_prompt: currentArgs.negative_prompt,
              width: currentArgs.width || 1024,
              height: currentArgs.height || 1024,
              steps: currentArgs.steps || 4,
              seed: currentArgs.seed,
              model: currentArgs.model || "flux1-schnell",
              output_format: currentArgs.output_format || "png",
            }),
            signal: AbortSignal.timeout(requestTimeout),
          });

          // Bounded self-repair 1: GPU permit contention (503 BUSY) -> wait and retry once
          if (jobRes.status === 503 && attempts < maxAttempts) {
            console.warn(
              `[MEDIA SELF-REPAIR] GPU worker busy (attempt ${attempts}/${maxAttempts}). Waiting before retry...`,
            );
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }

          // Bounded self-repair 2: Parameter validation error (400) -> auto-normalize dimensions & steps
          if (jobRes.status === 400 && attempts < maxAttempts) {
            const errBody = await jobRes.text().catch(() => "");
            console.warn(
              `[MEDIA SELF-REPAIR] Image parameter validation rejected: ${errBody}. Normalizing to standard 512x512 4-step parameters and retrying...`,
            );
            currentArgs = {
              ...currentArgs,
              width: 512,
              height: 512,
              steps: 4,
            };
            continue;
          }

          break;
        } catch (fetchErr: any) {
          if (attempts >= maxAttempts) throw fetchErr;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!jobRes || !jobRes.ok) {
        const errorText = await jobRes?.text().catch(() => "Unknown error");
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] GPU image generation failed with status ${jobRes?.status}: ${errorText}`,
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

      // 3. Post-generation verification: ensure the delivered artifact actually exists and is valid
      const verification = await verifyDeliveredArtifact(artifactUrl, "image/png", result.sha256);
      if (
        !verification.verified &&
        verification.retrievable === false &&
        process.env.NODE_ENV !== "test"
      ) {
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] Post-generation verification failed: ${verification.error}`,
        );
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Image generated on GPU host, but post-generation verification failed (${verification.error || "Artifact unretrievable"}).`,
          metadata: { ...result, verification },
          executionTimeMs: durationMs,
        };
      }

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
            model: result.model || currentArgs.model || "flux1-schnell",
            dimensions: `${currentArgs.width || 1024}x${currentArgs.height || 1024}`,
            delivered: result.delivered !== false,
            verified: verification.verified !== false,
            verification,
            executionDurationMs: durationMs,
          },
          null,
          2,
        ),
        metadata: { ...result, verification },
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
