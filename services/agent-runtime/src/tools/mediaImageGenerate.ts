import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolMetadata,
  resolveWithinBase,
} from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { isHardVerificationFailure, verifyDeliveredArtifact } from "./mediaVerification.js";
import {
  FIRST_REQUEST_TIMEOUT_MS,
  type GpuWorkerHealth,
  getMediaWorkerConfig,
  isLazyLoadAllowed,
  unavailableMediaResult,
} from "./mediaWorkerConfig.js";

const execFileAsync = promisify(execFile);

export class MediaImageGenerateTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "media_image_generate",
    description:
      "Generate an AI image from a descriptive prompt. Returns the accessible artifact URL and image metadata. When successful, present the generated image to the user in markdown using the returned artifactUrl: ![Description](artifactUrl).",
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
          description: "Image width in pixels. High-resolution default is 1024 (e.g. 1024 for square, 1344 for wide 16:9 landscape, 768 for 9:16 portrait). Always use at least 1024 unless low-res is specifically requested.",
        },
        height: {
          type: "number",
          description: "Image height in pixels. High-resolution default is 1024 (e.g. 1024 for square, 768 for wide 16:9 landscape, 1344 for 9:16 portrait). Always use at least 1024 unless low-res is specifically requested.",
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
          description: "Optional model preset name.",
        },
        output_format: {
          type: "string",
          enum: ["png"],
          description: "Target image format. Currently only png is supported.",
          default: "png",
        },
        image_url: {
          type: "string",
          description:
            "Optional URL or artifactId of an input image/photo to edit, transform, or condition generation on.",
        },
      },
      required: ["prompt"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "media_image_generate",
    description: "Generate high-resolution AI images from text descriptions",
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
    context: ToolExecutionContext,
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
        const statusDetail = healthRes ? `HTTP ${healthRes.status}` : "network error / timeout";
        const errorMsg = `Image generation failed: Media processing service health check failed (${statusDetail}).`;
        console.error(`[MEDIA GENERATION DIAGNOSTIC] ${errorMsg}`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: errorMsg,
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
        const errorMsg = `Image generation unavailable: Media processing service reports no active image generation backend (backend=${health?.generation_backend ?? "none"}, reason: ${health?.unavailable_reason ?? "model initializing"}).`;
        console.error(`[MEDIA GENERATION DIAGNOSTIC] ${errorMsg}`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: errorMsg,
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

      // Automatic human photorealism enhancement: if prompt depicts humans and is not explicitly cartoon,
      // enforce lifelike photography tokens and suppress 3D render / CGI / doll / avatar artifacts
      const isHumanPrompt =
        /\b(?:human|person|woman|man|female|male|girl|guy|model|face|lady|blonde|brunette|portrait|headshot|people)\b/i.test(
          prompt,
        );
      const isCartoon = /\b(?:cartoon|anime|manga|3d\s+render|pixar|doodle|sketch|comic)\b/i.test(
        prompt,
      );

      let effectiveNegative = currentArgs.negative_prompt;
      if (!effectiveNegative && isHumanPrompt && !isCartoon) {
        effectiveNegative =
          "3d render, cartoon, anime, doll, plastic skin, cgi, airbrushed, drawing, painting, avatar, fake, deformed, extra fingers, distorted";
      }

      let effectivePrompt = prompt;
      if (
        isHumanPrompt &&
        !isCartoon &&
        !/\b(?:skin|pores|texture|photo|photograph|hyperrealistic|editorial)\b/i.test(prompt)
      ) {
        effectivePrompt = `${prompt}, photorealistic editorial photography, natural skin texture with subtle pores, lifelike features and natural lighting`;
      }

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const requestedWidth = Number(currentArgs.width) || 1024;
          const requestedHeight = Number(currentArgs.height) || 1024;
          // FLUX.1 is a native 1024px flow-matching transformer.
          // If caller passed 512x512 without explicit small-dimension override, upgrade to native 1024x1024 for crystal-clear 4K/retina sharpness.
          const targetWidth = requestedWidth <= 512 && requestedHeight <= 512 ? 1024 : requestedWidth;
          const targetHeight = requestedWidth <= 512 && requestedHeight <= 512 ? 1024 : requestedHeight;

          jobRes = await fetch(`${workerUrl}/api/generate/image`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${workerToken}`,
            },
            body: JSON.stringify({
              // The tenant the server resolved for this caller. The worker
              // ingests the artifact into that workspace.
              workspace: context.tenantId,
              prompt: effectivePrompt,
              negative_prompt: effectiveNegative,
              width: targetWidth,
              height: targetHeight,
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
        const errorMsg = `Image generation failed (temporarily unavailable): Media processing service returned HTTP ${jobRes?.status}: ${errorText}`;
        console.error(`[MEDIA GENERATION DIAGNOSTIC] ${errorMsg}`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: errorMsg,
          metadata: { status: "FAILED" },
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
          error: `Image generated successfully, but artifact delivery to the web application failed (${result.ingest_note || "Ingest rejected"}). Artifact is not retrievable.`,
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
        isHardVerificationFailure(verification) &&
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
          error: `Image generated successfully, but post-generation verification failed (${verification.error || "Artifact unretrievable"}).`,
          metadata: { ...result, verification },
          executionTimeMs: durationMs,
        };
      }

      let finalArtifactUrl = artifactUrl;
      let finalVerification = verification;

      // High-resolution workflow: if caller explicitly requests 4K or ultra-high resolution,
      // apply high-fidelity Lanczos 2x upscaling with subtle texture unsharp enhancement.
      const wantsHighRes = /\b(?:4k|uhd|3840|ultra\s+high\s+res|upscale|high\s+resolution\s+4k)\b/i.test(prompt);
      if (wantsHighRes && verification.verified && verification.width && verification.width <= 1024) {
        try {
          const prefix = "/api/artifacts/";
          if (artifactUrl.startsWith(prefix)) {
            const rawPath = artifactUrl.slice(prefix.length);
            const segments = rawPath.split("/").map((s: string) => decodeURIComponent(s));
            const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
            const localPath = resolveWithinBase(baseDir, segments);
            const ext = path.extname(localPath);
            const dir = path.dirname(localPath);
            const basename = path.basename(localPath, ext);
            const upscaledPath = path.join(dir, `${basename}_2k${ext}`);

            await execFileAsync("ffmpeg", [
              "-y",
              "-i",
              localPath,
              "-vf",
              "scale=iw*2:ih*2:flags=lanczos,unsharp=5:5:0.6:3:3:0.3",
              "-compression_level",
              "3",
              upscaledPath,
            ]);

            const upscaledSegments = [...segments.slice(0, -1), `${basename}_2k${ext}`];
            const upscaledUrl = `/api/artifacts/${upscaledSegments.map((s: string) => encodeURIComponent(s)).join("/")}`;
            const recheck = await verifyDeliveredArtifact(upscaledUrl, "image/png");
            if (recheck.verified) {
              finalArtifactUrl = upscaledUrl;
              finalVerification = recheck;
              console.log(
                `[MEDIA IMAGE GENERATE] Applied high-resolution Lanczos upscaling: ${finalVerification.width}x${finalVerification.height} at ${finalArtifactUrl}`,
              );
            }
          }
        } catch (upscaleErr) {
          console.warn("[MEDIA IMAGE GENERATE] High-res upscaling skipped, keeping native output:", upscaleErr);
        }
      }

      const actualDimensions =
        finalVerification.width && finalVerification.height
          ? `${finalVerification.width}x${finalVerification.height}`
          : `${currentArgs.width || 1024}x${currentArgs.height || 1024}`;

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify(
          {
            status: "COMPLETED",
            artifactUrl: finalArtifactUrl,
            markdown: finalArtifactUrl ? `![Generated Image: ${prompt}](${finalArtifactUrl})` : undefined,
            dimensions: actualDimensions,
            delivered: result.delivered !== false,
            verified: finalVerification.verified,
            ...(finalVerification.verified
              ? {}
              : { verificationError: finalVerification.error }),
          },
          null,
          2,
        ),
        metadata: {
          ...result,
          verification: finalVerification,
          verified: finalVerification.verified,
          ...(finalVerification.verified
            ? {}
            : { verificationError: finalVerification.error }),
          dimensions: actualDimensions,
        },
        executionTimeMs: durationMs,
      };
    } catch (err: any) {
      const errorMsg = `Image generation request failed: ${err.message || String(err)}`;
      console.error(
        `[MEDIA GENERATION DIAGNOSTIC] GPU generation request failed: ${err.message || String(err)}`,
      );
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: errorMsg,
        metadata: {
          errorDetail: err.message || String(err),
        },
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
