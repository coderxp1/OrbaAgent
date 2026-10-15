import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import {
  FIRST_REQUEST_TIMEOUT_MS,
  type GpuWorkerHealth,
  getMediaWorkerConfig,
  isLazyLoadAllowed,
  unavailableMediaResult,
} from "./mediaWorkerConfig.js";

export class MediaVideoGenerateTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "media_video_generate",
    description:
      "Generate an AI video using dedicated GPU 1 media worker. Returns job ID, status, accessible artifact URL, and video metadata. When successful, present the generated video to the user using the returned artifactUrl: [View Video](artifactUrl).",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of the video motion and scene to generate.",
        },
        negative_prompt: {
          type: "string",
          description: "Elements to exclude or suppress in the generation.",
        },
        duration_seconds: {
          type: "number",
          description: "Target video duration in seconds (e.g. 2, 4, 5). Default is 4.",
        },
        fps: {
          type: "number",
          description: "Frames per second (e.g. 16, 24). Default is 16.",
        },
        width: {
          type: "number",
          description: "Video width in pixels. Default is 768.",
        },
        height: {
          type: "number",
          description: "Video height in pixels. Default is 768.",
        },
        model: {
          type: "string",
          description:
            "Video model to use on GPU worker (e.g. wan2.1-t2v-1.3b). Default is wan2.1-t2v-1.3b.",
        },
      },
      required: ["prompt"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "media_video_generate",
    description: "Generate generative AI video clips via dedicated GPU 1 worker",
    category: "media",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: ["video", "generate", "animation", "motion", "clip", "mp4", "gpu", "ai video"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_vid_${Date.now()}`;
    const prompt = String(args.prompt || "").trim();

    if (!prompt) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Prompt is required for video generation",
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
          error: "Video generation is temporarily unavailable. Please try again later.",
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

      // The worker reports capabilities.video_generation = true only AFTER the
      // model has been loaded into GPU memory. When the worker is configured
      // with generation_backend="diffusers" but has not received its first
      // request yet, the capability is false and unavailable_reason explains
      // that the first request will trigger loading. We must allow that case.
      const capabilityReady = health?.capabilities?.video_generation === true;
      const lazyLoadPending = isLazyLoadAllowed(health);

      if (!capabilityReady && !lazyLoadPending) {
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] MEDIA_GENERATION_UNAVAILABLE: the GPU worker is reachable but reports no real video generation backend (generation_backend=${health?.generation_backend ?? "none"}).`,
        );
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Video generation is temporarily unavailable. Please try again later.",
          metadata: {
            status: "UNAVAILABLE",
          },
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Use an extended timeout for the first request (model loading).
      // Video already uses 300s, but bump for consistency when lazy-loading.
      const requestTimeout = lazyLoadPending ? FIRST_REQUEST_TIMEOUT_MS : 300_000;

      // 2. Submit video generation job to dedicated GPU worker
      const jobRes = await fetch(`${workerUrl}/api/generate/video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          prompt,
          negative_prompt: args.negative_prompt,
          duration_seconds: args.duration_seconds || 4,
          fps: args.fps || 16,
          width: args.width || 768,
          height: args.height || 768,
          model: args.model || "wan2.1-t2v-1.3b",
        }),
        signal: AbortSignal.timeout(requestTimeout),
      });

      if (!jobRes.ok) {
        const errorText = await jobRes.text().catch(() => "Unknown error");
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] GPU video generation failed with status ${jobRes.status}: ${errorText}`,
        );
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Video generation is temporarily unavailable. Please try again later.",
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
          `[MEDIA GENERATION DIAGNOSTIC] GPU video generated successfully but artifact delivery failed: ${result.ingest_note}`,
        );
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Video generated on GPU host, but artifact delivery to the web application failed (${result.ingest_note || "Ingest rejected"}). Artifact is not retrievable.`,
          metadata: result,
          executionTimeMs: durationMs,
        };
      }

      const artifactUrl = result.artifactUrl || result.artifact_url || "";
      const outputVideo =
        result.outputVideo ||
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
            outputVideo,
            artifactUrl,
            markdown: artifactUrl ? `[View Generated Video](${artifactUrl})` : undefined,
            duration: args.duration_seconds || 4,
            resolution: `${args.width || 768}x${args.height || 768}`,
            model: result.model || args.model || "wan2.1-t2v-1.3b",
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
        `[MEDIA GENERATION DIAGNOSTIC] GPU video generation request failed: ${err.message || String(err)}`,
      );
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Video generation is temporarily unavailable. Please try again later.",
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
