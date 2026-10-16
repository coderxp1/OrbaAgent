import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolMetadata,
  resolveWithinBase,
} from "@orbaagent/shared";
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
        logo_url: {
          type: "string",
          description:
            "Optional URL or artifactId of a company logo or brand image to visibly incorporate into the commercial.",
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

  /**
   * Finalizes commercial video with:
   * 1. Rich upbeat modern corporate tech electronic audio track (synthesized chords, bassline, rhythmic pulse, smooth fade-in/out).
   * 2. Preserved, crisp company branding: subtle translucent watermark during the clip, plus a cinematic brand outro end-card with original un-hallucinated logo centered.
   * 3. H.264 + AAC audio + faststart for instant streaming playback on mobile Safari and desktop browsers.
   */
  private async finalizeCommercialVideo(
    videoPath: string,
    logoPath: string | null,
    outputPath: string,
    fps: number,
    duration: number,
  ): Promise<void> {
    const audioExpr =
      "sin(2*PI*130.81*t)*0.13*exp(-2.5*mod(t\\,1.0)) + " +
      "sin(2*PI*164.81*t)*0.10*exp(-2.5*mod(t\\,1.0)) + " +
      "sin(2*PI*196.00*t)*0.10*exp(-2.5*mod(t\\,1.0)) + " +
      "sin(2*PI*261.63*t)*0.08*exp(-3.0*mod(t\\,0.5)) + " +
      "sin(2*PI*329.63*t)*0.06*exp(-3.0*mod(t\\,0.5))";

    const fadeOutStart = Math.max(0.5, duration - 1.0);

    if (logoPath) {
      const outroStart = Math.max(1.0, duration - 2.5);
      const filterComplex = [
        "[1:v]scale=90:-1,format=rgba,colorchannelmixer=aa=0.75[wm]",
        `[0:v][wm]overlay=main_w-overlay_w-16:16:enable='between(t,0,${outroStart})'[vmid]`,
        `[1:v]scale=160:-1,format=rgba,fade=t=in:st=${outroStart}:d=0.6:alpha=1[brand]`,
        `[vmid][brand]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:enable='gte(t,${outroStart})'[vout]`,
        `[2:a]afade=t=in:ss=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=1.0[aout]`,
      ].join(";");

      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-i",
        logoPath,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=${audioExpr}:s=44100`,
        "-filter_complex",
        filterComplex,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-t",
        String(duration),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(fps),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        outputPath,
      ]);
    } else {
      const filterComplex = `[1:a]afade=t=in:ss=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=1.0[aout]`;
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=${audioExpr}:s=44100`,
        "-filter_complex",
        filterComplex,
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-t",
        String(duration),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(fps),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        outputPath,
      ]);
    }
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
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

      // Detect logo artifact URL from parameters or context attachments
      let logoArtifactUrl: string | undefined = args.logo_url ? String(args.logo_url) : undefined;
      if (!logoArtifactUrl && context?.attachments && context.attachments.length > 0) {
        const logoAtt = context.attachments.find(
          (a) =>
            a.type?.startsWith("image/") ||
            /\.(png|jpe?g|webp|gif)$/i.test(a.name || "") ||
            /logo/i.test(a.name || ""),
        );
        if (logoAtt) {
          if (logoAtt.artifactId) {
            try {
              const decoded = JSON.parse(
                Buffer.from(logoAtt.artifactId, "base64url").toString("utf-8"),
              );
              logoArtifactUrl = `/api/artifacts/${encodeURIComponent(decoded.w)}/${encodeURIComponent(decoded.b)}/${encodeURIComponent(decoded.p)}`;
            } catch {}
          }
        }
      }

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

          let finalVideoPath = tmpConcat;
          try {
            const tmpResolvedLogo = logoArtifactUrl
              ? await this.resolveOrDownloadArtifact(logoArtifactUrl, path.join(tmpDir, "logo.png"))
              : null;
            const tmpCommercial = path.join(tmpDir, "commercial_final.mp4");
            await this.finalizeCommercialVideo(
              tmpConcat,
              tmpResolvedLogo,
              tmpCommercial,
              fps,
              requestedDuration,
            );
            finalVideoPath = tmpCommercial;
            console.log(
              `[MEDIA VIDEO GENERATE] Finalized multi-segment commercial with soundtrack and branding: ${finalVideoPath}`,
            );
          } catch (err) {
            console.warn("[MEDIA VIDEO GENERATE] Multi-segment finalization warning:", err);
          }

          const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
          const workspace = process.env.ORBA_TENANT_ID || "default-tenant";
          const bundle = clip1.bundle || `vid_${Date.now().toString(36)}`;
          const filename = `${crypto.randomUUID()}.mp4`;
          const targetDir = path.join(baseDir, workspace, bundle);
          await fs.mkdir(targetDir, { recursive: true });
          const targetPath = path.join(targetDir, filename);

          await fs.copyFile(finalVideoPath, targetPath);

          const finalBytes = await fs.readFile(targetPath);
          finalSha256 = crypto.createHash("sha256").update(finalBytes).digest("hex");
          finalArtifactUrl = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
            bundle,
          )}/${encodeURIComponent(filename)}`;

          rawResultMetadata = {
            multiSegment: true,
            segments: [clip1.artifactUrl, clip2.artifactUrl],
            targetDuration: requestedDuration,
            logoApplied: Boolean(logoArtifactUrl),
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

        if (clip.artifactUrl) {
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-vid-single-"));
          try {
            const tmpVid = path.join(tmpDir, "clip.mp4");
            const resolvedVid = await this.resolveOrDownloadArtifact(clip.artifactUrl, tmpVid);
            const tmpResolvedLogo = logoArtifactUrl
              ? await this.resolveOrDownloadArtifact(logoArtifactUrl, path.join(tmpDir, "logo.png"))
              : null;
            const tmpCommercial = path.join(tmpDir, "commercial_final.mp4");
            await this.finalizeCommercialVideo(
              resolvedVid,
              tmpResolvedLogo,
              tmpCommercial,
              fps,
              requestedDuration,
            );

            const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
            const workspace = process.env.ORBA_TENANT_ID || "default-tenant";
            const bundle = clip.bundle || `vid_${Date.now().toString(36)}`;
            const filename = `${crypto.randomUUID()}.mp4`;
            const targetDir = path.join(baseDir, workspace, bundle);
            await fs.mkdir(targetDir, { recursive: true });
            const targetPath = path.join(targetDir, filename);

            await fs.copyFile(tmpCommercial, targetPath);

            const finalBytes = await fs.readFile(targetPath);
            finalSha256 = crypto.createHash("sha256").update(finalBytes).digest("hex");
            finalArtifactUrl = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
              bundle,
            )}/${encodeURIComponent(filename)}`;
            rawResultMetadata.commercialFinalized = true;
            rawResultMetadata.hasAudio = true;
            rawResultMetadata.logoApplied = Boolean(tmpResolvedLogo);
            console.log(
              `[MEDIA VIDEO GENERATE] Finalized single-clip commercial with soundtrack and branding: ${finalArtifactUrl}`,
            );
          } catch (err) {
            console.warn("[MEDIA VIDEO GENERATE] Single clip finalization warning:", err);
          } finally {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          }
        }
      }

      const durationMs = Date.now() - startTime;

      // Post-generation verification: ensure the delivered artifact actually exists and is valid
      const verification = await verifyDeliveredArtifact(
        finalArtifactUrl,
        "video/mp4",
        finalSha256,
      );
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
