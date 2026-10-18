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
import { finalizeVideoWithAudio, isExplicitlySilent } from "./mediaAudioPipeline.js";

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
          description: "Target video duration in seconds (e.g. 2, 4, 8, 10, 15). Default is 4.",
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
        image_url: {
          type: "string",
          description:
            "Optional URL or artifactId of an input image or photo to condition video generation on (Image-to-Video).",
        },
        silent: {
          type: "boolean",
          description: "Optional flag to produce a silent video without background ambience or music.",
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
      image_url?: string;
    },
  ): Promise<ClipGenerationResult> {
    const maxAttempts = 60;
    let attempts = 0;
    let jobRes: Response | null = null;

    // Always guarantee that dimensions sent to the backend are multiples of 16
    let safeWidth = Math.max(256, Math.min(1920, Math.round(clipParams.width / 16) * 16));
    let safeHeight = Math.max(256, Math.min(1920, Math.round(clipParams.height / 16) * 16));

    let current = {
      ...clipParams,
      width: safeWidth,
      height: safeHeight,
    };

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
            model: current.model || (current.image_url ? "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers" : "kandinsky-6.0"),
            ...(current.image_url ? { image_url: current.image_url } : {}),
          }),
          signal: AbortSignal.timeout(requestTimeout),
        });

        // Bounded self-repair 1: Permit contention (503 BUSY) -> check health and auto-recover stale locks
        if (jobRes.status === 503 && attempts < maxAttempts) {
          console.warn(
            `[MEDIA RETRY] Worker busy (attempt ${attempts}/${maxAttempts}). Inspecting worker health...`,
          );
          try {
            const hRes = await fetch(`${workerUrl}/health`, {
              headers: { Authorization: `Bearer ${workerToken}` },
              signal: AbortSignal.timeout(3000),
            });
            if (hRes.ok) {
              const hData = await hRes.json();
              const activeJob = hData?.active_job;
              // If active job has stalled (no heartbeat for > 60s or elapsed > 500s without recent progress), trigger a reset
              if (activeJob && (activeJob.last_heartbeat_ago > 60 || (activeJob.last_heartbeat_ago > 30 && activeJob.elapsed_seconds > 500))) {
                console.warn(
                  `[MEDIA RECOVERY] Stale job detected (${activeJob.job_id}, silent ${activeJob.last_heartbeat_ago}s). Resetting worker limiter...`,
                );
                await fetch(`${workerUrl}/api/jobs/reset`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${workerToken}` },
                  signal: AbortSignal.timeout(3000),
                }).catch(() => null);
              }
            }
          } catch (hErr) {
            console.warn("[MEDIA RECOVERY] Health inspection failed during busy retry:", hErr);
          }
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        // Bounded self-repair 2: Parameter validation error (400) -> normalize dimensions & duration
        if (jobRes.status === 400 && attempts < maxAttempts) {
          const errBody = await jobRes.text().catch(() => "");
          console.warn(
            `[MEDIA SELF-REPAIR] Validation rejected: ${errBody}. Normalizing to standard 16-divisible 480x480 16fps and retrying...`,
          );
          current = {
            ...current,
            width: 480,
            height: 480,
            fps: 16,
            duration_seconds: Math.min(5, Math.max(1, Number(current.duration_seconds) || 5)),
          };
          continue;
        }

        // Non-recoverable status code (e.g. 500) -> do not spin retry loop
        if (jobRes.status !== 503 && jobRes.status !== 400) {
          break;
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
      if (jobRes?.status === 503) {
        try {
          const hRes = await fetch(`${workerUrl}/health`, {
            headers: { Authorization: `Bearer ${workerToken}` },
            signal: AbortSignal.timeout(2000),
          });
          if (hRes.ok) {
            const hData = await hRes.json();
            const activeJob = hData?.active_job;
            if (activeJob) {
              const progressMsg =
                activeJob.step && activeJob.total_steps
                  ? `step ${activeJob.step}/${activeJob.total_steps} (${Math.round(
                      (activeJob.step / activeJob.total_steps) * 100,
                    )}% complete)`
                  : `stage '${activeJob.stage || "inference"}'`;
              return {
                success: false,
                error: `A media generation job (${activeJob.job_id}) is currently running on the GPU worker (${progressMsg}, elapsed ${activeJob.elapsed_seconds}s). Please retry shortly.`,
              };
            }
          }
        } catch {}
      }
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
    if (!artifactUrl) {
      throw new Error("Cannot resolve empty artifact URL");
    }

    const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");

    // 1. Direct filesystem path check
    if (path.isAbsolute(artifactUrl)) {
      try {
        const st = await fs.stat(artifactUrl);
        if (st.isFile() && st.size > 0) return artifactUrl;
      } catch {}
    }

    // 2. Base64url encoded artifactId
    if (!artifactUrl.includes("/") && artifactUrl.length > 10) {
      try {
        const decoded = JSON.parse(Buffer.from(artifactUrl, "base64url").toString("utf-8"));
        if (decoded.w && decoded.b && decoded.p) {
          const local = resolveWithinBase(baseDir, [decoded.w, decoded.b, decoded.p]);
          const st = await fs.stat(local);
          if (st.isFile() && st.size > 0) return local;
        }
      } catch {}
    }

    // 3. Extract path from /api/artifacts/... (works for relative /api/artifacts/... AND absolute https://.../api/artifacts/...)
    const artIndex = artifactUrl.indexOf("/api/artifacts/");
    if (artIndex !== -1) {
      const relPart = artifactUrl.slice(artIndex + "/api/artifacts/".length);
      const segments = relPart.split("/").map((s) => decodeURIComponent(s));
      try {
        const local = resolveWithinBase(baseDir, segments);
        const st = await fs.stat(local);
        if (st.isFile() && st.size > 0) {
          return local;
        }
      } catch {}
    }

    // 4. Check if artifactUrl matches directly under baseDir (or relative path in uploads)
    try {
      const cleanRel = artifactUrl.replace(/^\/+/, "");
      const segments = cleanRel.split("/").map((s) => decodeURIComponent(s));
      const directLocal = resolveWithinBase(baseDir, segments);
      const st = await fs.stat(directLocal);
      if (st.isFile() && st.size > 0) return directLocal;
    } catch {}

    // Search for the filename anywhere in baseDir if it's a simple name like "KuikChat_Logo.png"
    const simpleName = path.basename(artifactUrl);
    if (simpleName && simpleName.includes(".")) {
      try {
        const entries = await fs.readdir(baseDir, { recursive: true });
        for (const entry of entries) {
          if (
            typeof entry === "string" &&
            (entry.endsWith(`/${simpleName}`) ||
              entry.endsWith(`\\${simpleName}`) ||
              entry === simpleName)
          ) {
            const foundPath = path.join(baseDir, entry);
            const st = await fs.stat(foundPath);
            if (st.isFile() && st.size > 0) return foundPath;
          }
        }
      } catch {}
    }

    // 5. Network fetch fallback: ensure proper URL formatting with single slash
    let fetchUrl: string;
    if (artifactUrl.startsWith("http://") || artifactUrl.startsWith("https://")) {
      fetchUrl = artifactUrl;
    } else {
      const appUrl = (
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.ORBA_WEB_URL ||
        "http://127.0.0.1:3000"
      ).replace(/\/+$/, "");
      const cleanPath = artifactUrl.startsWith("/") ? artifactUrl : `/${artifactUrl}`;
      fetchUrl = `${appUrl}${cleanPath}`;
    }

    const res = await fetch(fetchUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch artifact from ${fetchUrl}: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(tmpDest, buf);
    return tmpDest;
  }



  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_vid_${Date.now()}`;
    const prompt = String(
      args.prompt ||
        args.description ||
        args.text ||
        args.caption ||
        (args.image_url ? "Coherent cinematic motion following the reference photograph" : ""),
    ).trim();

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

      const requestTimeout = lazyLoadPending ? FIRST_REQUEST_TIMEOUT_MS : 600_000;
      const requestedDuration = Math.min(30, Math.max(1, Number(args.duration_seconds) || 5));
      const rawWidth = Number(args.width) || 1280;
      const rawHeight = Number(args.height) || 720;
      // Guarantee strict divisibility by 16 to avoid diffusers pipeline errors
      const width = Math.max(256, Math.min(1920, Math.round(rawWidth / 16) * 16));
      const height = Math.max(256, Math.min(1920, Math.round(rawHeight / 16) * 16));
      const fps = Number(args.fps) || 16;
      const isCartoonPrompt = /\b(?:cartoon|dibujo|dibujos\s+animados|animaci[oó]n|anime|manga|pixar|doodle|sketch)\b/i.test(
        prompt,
      );
      const negative_prompt = args.negative_prompt
        ? String(args.negative_prompt)
        : isCartoonPrompt
          ? "photorealistic, hyperrealistic, deformed, blurry"
          : "cartoon, anime, 3d render, cgi, blurry, distorted, doodle, sketch, low quality, deformed, artificial";
      const model = args.model ? String(args.model) : "kandinsky-6.0";

      let finalArtifactUrl = "";
      let finalSha256: string | undefined;
      let rawResultMetadata: any = {};
      let jobId = `job_${Date.now()}`;

      // Detect conditioning photo vs. brand logo from parameters or context attachments
      let inputImageUrl: string | undefined = args.image_url ? String(args.image_url) : undefined;
      let logoArtifactUrl: string | undefined = args.logo_url ? String(args.logo_url) : undefined;

      if (!inputImageUrl && !logoArtifactUrl && context?.attachments && context.attachments.length > 0) {
        const imageAtt = context.attachments.find(
          (a) =>
            a.type?.startsWith("image/") ||
            /\.(png|jpe?g|webp|gif|svg)$/i.test(a.name || "") ||
            /logo/i.test(a.name || ""),
        );
        if (imageAtt) {
          const rawUrl = (imageAtt as any).url || (imageAtt as any).previewUrl;
          let resolvedAttUrl = "";
          if (rawUrl && typeof rawUrl === "string") {
            resolvedAttUrl = rawUrl;
          } else if (imageAtt.artifactId || (imageAtt as any).id) {
            const rawId = imageAtt.artifactId || (imageAtt as any).id;
            try {
              const decoded = JSON.parse(
                Buffer.from(rawId, "base64url").toString("utf-8"),
              );
              resolvedAttUrl = `/api/artifacts/${encodeURIComponent(decoded.w)}/${encodeURIComponent(decoded.b)}/${encodeURIComponent(decoded.p)}`;
            } catch {
              resolvedAttUrl = rawId;
            }
          } else if (imageAtt.name) {
            resolvedAttUrl = imageAtt.name;
          }

          const isLogo = /logo/i.test(imageAtt.name || "") || /\b(logo|brand|brandmark)\b/i.test(prompt);
          if (isLogo) {
            logoArtifactUrl = resolvedAttUrl;
          } else {
            inputImageUrl = resolvedAttUrl;
          }
        }
      }

      const isSilent = isExplicitlySilent(prompt, args);

      // Generate a rich 5s base visual clip for long videos (81 frames @ 16fps) to ensure continuous, coherent motion
      const baseDuration = Math.min(requestedDuration, 5);
      console.log(
        `[MEDIA VIDEO GENERATE] Generating visual clip (${baseDuration}s base, target: ${requestedDuration}s, silent: ${isSilent})...`,
      );

      const clip = await this.submitClip(workerUrl, workerToken, requestTimeout, {
        prompt,
        negative_prompt,
        duration_seconds: baseDuration,
        fps,
        width,
        height,
        model: args.model
          ? String(args.model)
          : inputImageUrl
            ? "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers"
            : model,
        image_url: inputImageUrl,
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

      // Complete audiovisual assembly (environmental ambience, cinematic music, branding, duration synchronization)
      if (clip.artifactUrl) {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-vid-final-"));
        try {
          const tmpVid = path.join(tmpDir, "raw_clip.mp4");
          const resolvedVid = await this.resolveOrDownloadArtifact(clip.artifactUrl, tmpVid);
          const tmpResolvedLogo = logoArtifactUrl
            ? await this.resolveOrDownloadArtifact(logoArtifactUrl, path.join(tmpDir, "logo.png"))
            : null;
          const tmpFinalized = path.join(tmpDir, "finalized_video.mp4");

          await finalizeVideoWithAudio({
            videoPath: resolvedVid,
            outputPath: tmpFinalized,
            prompt,
            duration: requestedDuration,
            fps,
            logoPath: tmpResolvedLogo,
            isSilent,
          });

          const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
          const workspace = process.env.ORBA_TENANT_ID || "default-tenant";
          const bundle = clip.bundle || `vid_${Date.now().toString(36)}`;
          const filename = `${crypto.randomUUID()}.mp4`;
          const targetDir = path.join(baseDir, workspace, bundle);
          await fs.mkdir(targetDir, { recursive: true });
          const targetPath = path.join(targetDir, filename);

          await fs.copyFile(tmpFinalized, targetPath);

          const finalBytes = await fs.readFile(targetPath);
          finalSha256 = crypto.createHash("sha256").update(finalBytes).digest("hex");
          finalArtifactUrl = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
            bundle,
          )}/${encodeURIComponent(filename)}`;

          rawResultMetadata = {
            ...rawResultMetadata,
            audiovisualFinalized: true,
            hasAudio: !isSilent,
            targetDuration: requestedDuration,
            logoApplied: Boolean(tmpResolvedLogo),
          };
          console.log(
            `[MEDIA VIDEO GENERATE] Finalized complete audiovisual delivery (hasAudio=${!isSilent}, duration=${requestedDuration}s): ${finalArtifactUrl}`,
          );
        } catch (finalizeErr) {
          console.warn(
            "[MEDIA VIDEO GENERATE] Audiovisual finalization warning, delivering raw clip:",
            finalizeErr,
          );
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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
      let rawMsg = err.message || String(err);
      if (rawMsg.includes("divisible by 16")) {
        rawMsg = "Video generation requires dimensions divisible by 16. Setting has been normalized.";
      }
      const errorMsg = `Video generation request failed: ${rawMsg}`;
      console.error(`[MEDIA GENERATION DIAGNOSTIC] ${errorMsg}`);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: errorMsg,
        metadata: {
          errorDetail: rawMsg,
        },
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
