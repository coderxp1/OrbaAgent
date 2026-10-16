import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { resolveWithinBase, type ToolDefinition, type ToolExecutionResult, type ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { verifyDeliveredArtifact } from "./mediaVerification.js";
import {
  FIRST_REQUEST_TIMEOUT_MS,
  type GpuWorkerHealth,
  getMediaWorkerConfig,
  isLazyLoadAllowed,
  unavailableMediaResult,
} from "./mediaWorkerConfig.js";

const execFileAsync = promisify(execFile);

interface ClipGenerationResult {
  success: boolean;
  artifactUrl?: string;
  outputVideo?: string;
  bundle?: string;
  sha256?: string;
  error?: string;
  delivered?: boolean;
  ingest_note?: string;
  rawResult?: any;
}

export class MediaVideoGenerateTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "media_video_generate",
    description:
      "Generate an AI video from a descriptive prompt. Returns accessible artifact URL and video metadata. When successful, present the generated video to the user using the returned artifactUrl: [View Video](artifactUrl).",
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
          description: "Target video duration in seconds (e.g. 2, 4, 8, 15). Default is 4.",
        },
        fps: {
          type: "number",
          description: "Frames per second (e.g. 16, 24). Default is 16.",
        },
        width: {
          type: "number",
          description: "Video width in pixels. Default is 480.",
        },
        height: {
          type: "number",
          description: "Video height in pixels. Default is 480.",
        },
        model: {
          type: "string",
          description: "Optional model preset name.",
        },
      },
      required: ["prompt"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "media_video_generate",
    description: "Generate generative AI video clips from text descriptions",
    category: "media",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: ["video", "generate", "animation", "motion", "clip", "mp4", "ai video"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  /**
   * Submits a single video generation job to the media backend with self-repair for 503 and 400.
   */
  private async submitClip(
    workerUrl: string,
    workerToken: string,
    requestTimeout: number,
    clipParams: {
      prompt: string;
      negative_prompt?: string;
      duration_seconds: number;
      fps: number;
      width: number;
      height: number;
      model?: string;
    },
  ): Promise<ClipGenerationResult> {
    let jobRes: Response | null = null;
    let attempts = 0;
    const maxAttempts = 2;
    let current = { ...clipParams };

    while (attempts < maxAttempts) {
      attempts++;
      try {
        jobRes = await fetch(`${workerUrl}/api/generate/video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${workerToken}`,
          },
          body: JSON.stringify({
            prompt: current.prompt,
            negative_prompt: current.negative_prompt,
            duration_seconds: current.duration_seconds,
            fps: current.fps,
            width: current.width,
            height: current.height,
            model: current.model || "wan2.1-t2v-1.3b",
          }),
          signal: AbortSignal.timeout(requestTimeout),
        });

        // Bounded self-repair 1: Permit contention (503 BUSY) -> wait and retry
        if (jobRes.status === 503 && attempts < maxAttempts) {
          console.warn(
            `[MEDIA SELF-REPAIR] Worker busy (attempt ${attempts}/${maxAttempts}). Waiting before retry...`,
          );
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        // Bounded self-repair 2: Parameter validation error (400) -> normalize dimensions & duration
        if (jobRes.status === 400 && attempts < maxAttempts) {
          const errBody = await jobRes.text().catch(() => "");
          console.warn(
            `[MEDIA SELF-REPAIR] Validation rejected: ${errBody}. Normalizing to standard 480x480 16fps and retrying...`,
          );
          current = {
            ...current,
            width: 480,
            height: 480,
            fps: 16,
            duration_seconds: Math.min(5, Math.max(1, Number(current.duration_seconds) || 2)),
          };
          continue;
        }

        break;
      } catch (fetchErr: any) {
        if (attempts >= maxAttempts) {
          return { success: false, error: fetchErr.message || String(fetchErr) };
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!jobRes || !jobRes.ok) {
      const errorText = await jobRes?.text().catch(() => "Unknown error");
      return {
        success: false,
        error: `Video generation failed (temporarily unavailable): GPU worker returned HTTP ${jobRes?.status}: ${errorText}`,
      };
    }

    const result = await jobRes.json();
    if (
      result.delivered === false ||
      (typeof result.ingest_note === "string" && result.ingest_note.includes("ingest failed"))
    ) {
      return {
        success: false,
        delivered: false,
        ingest_note: result.ingest_note,
        error: `Video generated on GPU host, but artifact delivery to the web application failed (${result.ingest_note || "Ingest rejected"}). Artifact is not retrievable.`,
        rawResult: result,
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
      success: true,
      artifactUrl,
      outputVideo,
      bundle: result.bundle,
      sha256: result.sha256,
      delivered: result.delivered !== false,
      ingest_note: result.ingest_note,
      rawResult: result,
    };
  }

  /**
   * Resolves a delivered artifact URL to a local filesystem path, or downloads it to a temp path.
   */
  private async resolveOrDownloadArtifact(artifactUrl: string, tmpDest: string): Promise<string> {
    const prefix = "/api/artifacts/";
    if (artifactUrl.startsWith(prefix)) {
      const rawPath = artifactUrl.slice(prefix.length);
      const segments = rawPath.split("/").map((s) => decodeURIComponent(s));
      const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
      try {
        const local = resolveWithinBase(baseDir, segments);
        const st = await fs.stat(local);
        if (st.isFile() && st.size > 0) {
          return local;
        }
      } catch {}
    }

    const appUrl = (
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.ORBA_WEB_URL ||
      "http://127.0.0.1:3000"
    ).replace(/\/+$/, "");

    const res = await fetch(`${appUrl}${artifactUrl}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch artifact from ${artifactUrl}: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(tmpDest, buf);
    return tmpDest;
  }

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
      // 1. Check health of media backend
      const healthRes = await fetch(`${workerUrl}/health`, {
        headers: { Authorization: `Bearer ${workerToken}` },
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      if (!healthRes || !healthRes.ok) {
        const statusDetail = healthRes ? `HTTP ${healthRes.status}` : "network error / timeout";
        const errorMsg = `Video generation service unavailable (${statusDetail}).`;
        console.error(`[MEDIA GENERATION DIAGNOSTIC] ${errorMsg}`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: errorMsg,
          metadata: { status: "UNAVAILABLE" },
          executionTimeMs: Date.now() - startTime,
        };
      }

      const health = (await healthRes.json().catch(() => null)) as GpuWorkerHealth | null;
      const capabilityReady = health?.capabilities?.video_generation === true;
      const lazyLoadPending = isLazyLoadAllowed(health);

      if (!capabilityReady && !lazyLoadPending) {
        const errorMsg = "Video generation is currently initializing or unavailable.";
        console.error(`[MEDIA GENERATION DIAGNOSTIC] ${errorMsg}`);
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: errorMsg,
          metadata: { status: "UNAVAILABLE" },
          executionTimeMs: Date.now() - startTime,
        };
      }

      const requestTimeout = lazyLoadPending ? FIRST_REQUEST_TIMEOUT_MS : 300_000;
      const requestedDuration = Math.min(30, Math.max(1, Number(args.duration_seconds) || 4));
      const width = Number(args.width) || 480;
      const height = Number(args.height) || 480;
      const fps = Number(args.fps) || 16;
      const negative_prompt = args.negative_prompt ? String(args.negative_prompt) : undefined;
      const model = args.model ? String(args.model) : "wan2.1-t2v-1.3b";

      let finalArtifactUrl = "";
      let finalSha256: string | undefined;
      let rawResultMetadata: any = {};
      let jobId = `job_${Date.now()}`;

      if (requestedDuration > 8 && requestedDuration <= 20) {
        // Multi-segment generation pipeline for extended duration (e.g. 15s)
        console.log(
          `[MEDIA MULTI-SEGMENT] Generating multi-segment video (${requestedDuration}s target) via sequential clips...`,
        );

        // Segment 1: continuous sequence
        const clip1 = await this.submitClip(workerUrl, workerToken, requestTimeout, {
          prompt: `${prompt} (Part 1, dynamic action sequence)`,
          negative_prompt,
          duration_seconds: 8,
          fps,
          width,
          height,
          model,
        });

        if (!clip1.success || !clip1.artifactUrl) {
          throw new Error(clip1.error || "Failed to generate first video segment");
        }

        jobId = clip1.rawResult?.jobId || jobId;

        // Segment 2: continuation of the scene
        const clip2 = await this.submitClip(workerUrl, workerToken, requestTimeout, {
          prompt: `${prompt} (Part 2, continuous continuation)`,
          negative_prompt,
          duration_seconds: 8,
          fps,
          width,
          height,
          model,
        });

        if (!clip2.success || !clip2.artifactUrl) {
          throw new Error(clip2.error || "Failed to generate continuation video segment");
        }

        // Concatenate both clips into exact target duration using ffmpeg
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-vid-stitch-"));
        const tmp1 = path.join(tmpDir, "seg1.mp4");
        const tmp2 = path.join(tmpDir, "seg2.mp4");
        const tmpConcat = path.join(tmpDir, "final.mp4");
        const listPath = path.join(tmpDir, "list.txt");

        try {
          const seg1Path = await this.resolveOrDownloadArtifact(clip1.artifactUrl, tmp1);
          const seg2Path = await this.resolveOrDownloadArtifact(clip2.artifactUrl, tmp2);

          const esc1 = seg1Path.replace(/'/g, "'\\''");
          const esc2 = seg2Path.replace(/'/g, "'\\''");
          await fs.writeFile(listPath, `file '${esc1}'\nfile '${esc2}'\n`);

          await execFileAsync("ffmpeg", [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            listPath,
            "-t",
            String(requestedDuration),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            String(fps),
            tmpConcat,
          ]);

          const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
          const workspace = process.env.ORBA_TENANT_ID || "default-tenant";
          const bundle = clip1.bundle || `vid_${Date.now().toString(36)}`;
          const filename = `${crypto.randomUUID()}.mp4`;
          const targetDir = path.join(baseDir, workspace, bundle);
          await fs.mkdir(targetDir, { recursive: true });
          const targetPath = path.join(targetDir, filename);

          await fs.copyFile(tmpConcat, targetPath);

          const finalBytes = await fs.readFile(targetPath);
          finalSha256 = crypto.createHash("sha256").update(finalBytes).digest("hex");
          finalArtifactUrl = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
            bundle,
          )}/${encodeURIComponent(filename)}`;

          rawResultMetadata = {
            multiSegment: true,
            segments: [clip1.artifactUrl, clip2.artifactUrl],
            targetDuration: requestedDuration,
          };
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      } else {
        // Single-segment generation (<= 8 seconds or extreme duration fallback)
        const clip = await this.submitClip(workerUrl, workerToken, requestTimeout, {
          prompt,
          negative_prompt,
          duration_seconds: requestedDuration,
          fps,
          width,
          height,
          model,
        });

        if (!clip.success) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: clip.error || "Video generation failed",
            metadata: clip.rawResult || {},
            executionTimeMs: Date.now() - startTime,
          };
        }

        jobId = clip.rawResult?.jobId || jobId;
        finalArtifactUrl = clip.artifactUrl || "";
        finalSha256 = clip.sha256;
        rawResultMetadata = clip.rawResult || {};
      }

      const durationMs = Date.now() - startTime;

      // Post-generation verification: ensure the delivered artifact actually exists and is valid
      const verification = await verifyDeliveredArtifact(finalArtifactUrl, "video/mp4", finalSha256);
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
          error: `Video generated, but verification failed (${verification.error || "Artifact unretrievable"}).`,
          metadata: { ...rawResultMetadata, verification },
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
            jobId,
            artifactUrl: finalArtifactUrl,
            markdown: finalArtifactUrl ? `[View Generated Video](${finalArtifactUrl})` : undefined,
            duration: requestedDuration,
            resolution: `${width}x${height}`,
            delivered: true,
          },
          null,
          2,
        ),
        metadata: {
          status: "COMPLETED",
          artifactUrl: finalArtifactUrl,
          duration: requestedDuration,
          verification,
        },
        executionTimeMs: durationMs,
      };
    } catch (err: any) {
      const errorMsg = `Video generation request failed: ${err.message || String(err)}`;
      console.error(`[MEDIA GENERATION DIAGNOSTIC] ${errorMsg}`);
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
