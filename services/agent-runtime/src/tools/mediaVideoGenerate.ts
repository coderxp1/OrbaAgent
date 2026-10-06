import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { getMediaWorkerConfig, unavailableMediaResult } from "./mediaWorkerConfig.js";

export class MediaVideoGenerateTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "media_video_generate",
    description:
      "Generate an AI video using dedicated GPU 1 media worker. Returns job ID, status, artifact path, and video metadata.",
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
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error:
            "GPU media worker on GPU 1 is currently unavailable or initializing. Video generation cannot proceed until worker is online.",
          metadata: {
            status: "WORKER_UNAVAILABLE",
          },
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Defence in depth: only trust a worker that reports a real generation
      // backend. A worker can be reachable while running no model at all, and an
      // older build answered generation requests with fabricated output.
      const health = (await healthRes.json().catch(() => null)) as {
        capabilities?: { video_generation?: boolean };
        generation_backend?: string | null;
      } | null;

      if (!health?.capabilities?.video_generation) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `MEDIA_GENERATION_UNAVAILABLE: the GPU worker is reachable but reports no real video generation backend (generation_backend=${health?.generation_backend ?? "none"}). Refusing to report success.`,
          metadata: {
            status: "MEDIA_GENERATION_UNAVAILABLE",
            generationBackend: health?.generation_backend ?? null,
          },
          executionTimeMs: Date.now() - startTime,
        };
      }

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
        signal: AbortSignal.timeout(300000),
      });

      if (!jobRes.ok) {
        const errorText = await jobRes.text().catch(() => "Unknown error");
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `GPU video generation failed with status ${jobRes.status}: ${errorText}`,
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
            outputVideo: result.outputVideo || result.artifactPath,
            artifactUrl: result.artifactUrl,
            duration: args.duration_seconds || 4,
            resolution: `${args.width || 768}x${args.height || 768}`,
            model: result.model || args.model || "wan2.1-t2v-1.3b",
            executionDurationMs: durationMs,
          },
          null,
          2,
        ),
        metadata: result,
        executionTimeMs: durationMs,
      };
    } catch (err: any) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: `GPU video generation request failed: ${err.message || String(err)}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
