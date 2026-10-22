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
  resolveAttachmentArtifactUrl,
  resolveWithinBase,
} from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import {
  isHardVerificationFailure,
  probeVideoFile,
  verifyDeliveredArtifact,
  verifyDeliveredVideoArtifact,
} from "./mediaVerification.js";
import {
  FIRST_REQUEST_TIMEOUT_MS,
  type GpuWorkerHealth,
  getMediaWorkerConfig,
  isLazyLoadAllowed,
  unavailableMediaResult,
} from "./mediaWorkerConfig.js";
import {
  finalizeVideoWithAudio,
  isExplicitlySilent,
} from "./mediaAudioPipeline.js";

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
          description: "Target video duration in seconds (e.g. 2, 4, 8, 10, 15). Default is 5.",
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
        orientation: {
          type: "string",
          description:
            "Video orientation: 'vertical' (9:16 portrait, 720x1280) or 'horizontal' (16:9 landscape, 1280x720).",
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
      image_data?: string;
      workspace?: string;
    },
  ): Promise<ClipGenerationResult> {
    const maxAttempts = 60;
    let attempts = 0;
    let identicalRepairRetries = 0;
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
            // The tenant the server resolved for this caller. The worker
            // ingests the artifact into that workspace.
            workspace: current.workspace,
            prompt: current.prompt,
            negative_prompt: current.negative_prompt,
            duration_seconds: current.duration_seconds,
            fps: current.fps,
            width: current.width,
            height: current.height,
            ...(current.model ? { model: current.model } : {}),
            ...(current.image_data ? { image_data: current.image_data } : {}),
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

        // Bounded self-repair 2: Parameter validation error (400) -> normalize
        // ONLY the divisibility of the dimensions, preserving the requested
        // aspect ratio / orientation and the requested duration. The previous
        // repair forced 480x480 (destroying vertical framing) and silently
        // truncated duration to <=5s; both violated the user's request.
        if (jobRes.status === 400 && attempts < maxAttempts) {
          const errBody = await jobRes.text().catch(() => "");
          const snap32 = (v: number) =>
            Math.max(256, Math.min(1920, Math.round(v / 32) * 32));
          const repaired = {
            ...current,
            width: snap32(current.width),
            height: snap32(current.height),
          };
          if (repaired.width === current.width && repaired.height === current.height) {
            // The repair cannot change the payload, so this 400 is not a
            // dimension problem. Allow exactly one bounded retry of the
            // identical request (a 400 can race a worker-side state
            // change); beyond that, surface the worker's validation
            // error as-is instead of spinning identical requests until
            // the attempt budget is gone and misreporting a permanent
            // failure as transient unavailability.
            identicalRepairRetries++;
            if (identicalRepairRetries > 1) {
              return {
                success: false,
                error: `Video generation rejected by the media worker (HTTP 400): ${errBody}`,
              };
            }
            continue;
          }
          console.warn(
            `[MEDIA SELF-REPAIR] Validation rejected: ${errBody}. Snapping dimensions to 32-divisible values while preserving aspect ratio and duration, and retrying...`,
          );
          current = repaired;
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
                error: `A media generation job (${activeJob.job_id}) is currently processing in the queue (${progressMsg}, elapsed ${activeJob.elapsed_seconds}s). Please retry shortly.`,
              };
            }
          }
        } catch {}
      }
      return {
        success: false,
        error: `Video generation failed (temporarily unavailable): Media processing service returned HTTP ${jobRes?.status}: ${errorText}`,
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
        error: `Video generated successfully, but artifact delivery to the web application failed (${result.ingest_note || "Ingest rejected"}). Artifact is not retrievable.`,
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

    // NOTE: there is deliberately NO fallback that searches the uploads
    // tree for a file with the same basename. Uploads keep their original
    // filenames, so same-named files from other bundles/tenants are
    // common; guessing by basename silently substituted a different
    // photograph as the video conditioning image (wrong person in the
    // delivered video, reported 2026-10-21). Resolution either finds the
    // exact artifact or fails loudly below.


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

      // MOVA generations are measured in hours, not seconds (Test A on
      // the production GPU host, 2026-10-22: ~189 s/step at 720p,
      // 2h38m wall for a full 193-frame clip). The legacy 600 s cap
      // would abort every MOVA request client-side while the worker
      // kept generating. When the worker reports the MOVA video
      // backend, use the long timeout aligned with the worker/service
      // MOVA timeouts (14,400 s), overridable via env.
      const isMovaBackend = health?.generation_video_backend === "mova";
      const movaTimeoutMs = Number(
        process.env.MEDIA_VIDEO_REQUEST_TIMEOUT_MS ?? 14_400_000,
      );
      const requestTimeout = isMovaBackend
        ? movaTimeoutMs
        : lazyLoadPending
          ? FIRST_REQUEST_TIMEOUT_MS
          : 600_000;
      const orientation = String(args.orientation || "").toLowerCase();
      const isVertical =
        orientation === "vertical" ||
        /\b(?:vertical|portrait|vertikal|hochformat|9:16|9\/16|tiktok|reels?|shorts?)\b/i.test(prompt);
      // Explicit durations are preserved exactly or rejected with a clear
      // explanation — never silently clamped. Only an unspecified duration
      // falls back to the documented 5s default.
      const MAX_DURATION_SECONDS = 30;
      const explicitDuration = Number(args.duration_seconds);
      if (Number.isFinite(explicitDuration) && explicitDuration > MAX_DURATION_SECONDS) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Requested duration of ${explicitDuration}s exceeds the maximum supported duration of ${MAX_DURATION_SECONDS}s. Please request ${MAX_DURATION_SECONDS}s or less; the duration was not silently shortened.`,
          metadata: { status: "FAILED" },
          executionTimeMs: Date.now() - startTime,
        };
      }
      // An explicitly supplied duration that is not a positive whole
      // number of seconds (0, negative, fractional, NaN) is rejected
      // with an explanation rather than silently replaced by the
      // default — the worker itself only accepts whole seconds.
      if (
        args.duration_seconds !== undefined &&
        args.duration_seconds !== null &&
        !(Number.isInteger(explicitDuration) && explicitDuration >= 1)
      ) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Requested duration ${args.duration_seconds}s is invalid: duration must be a whole number of seconds between 1 and ${MAX_DURATION_SECONDS}. The duration was not silently changed.`,
          metadata: { status: "FAILED" },
          executionTimeMs: Date.now() - startTime,
        };
      }
      const requestedDuration =
        Number.isInteger(explicitDuration) && explicitDuration >= 1 ? explicitDuration : 5;

      // Calculate target dimensions and worker model dimensions.
      // For vertical 9:16 requests, target output is 720x1280.
      // LTX-Video spatial constraint requires both dimensions to be divisible by 32:
      // 704 = 22 * 32, 1280 = 40 * 32.
      let targetWidth: number;
      let targetHeight: number;
      let width: number;
      let height: number;

      if (isVertical) {
        targetWidth = 720;
        targetHeight = 1280;
        width = 704;
        height = 1280;
      } else {
        const rawWidth = Number(args.width) || 1280;
        const rawHeight = Number(args.height) || 720;
        targetWidth = Math.max(256, Math.min(1920, Math.round(rawWidth / 16) * 16));
        targetHeight = Math.max(256, Math.min(1920, Math.round(rawHeight / 16) * 16));
        width = Math.max(256, Math.min(1920, Math.round(rawWidth / 32) * 32));
        height = Math.max(256, Math.min(1920, Math.round(rawHeight / 32) * 32));
      }

      const fps = Number(args.fps) || 16;
      const isCartoonPrompt = /\b(?:cartoon|dibujo|dibujos\s+animados|animaci[oó]n|anime|manga|pixar|doodle|sketch)\b/i.test(
        prompt,
      );
      const negative_prompt = args.negative_prompt
        ? String(args.negative_prompt)
        : isCartoonPrompt
          ? "photorealistic, hyperrealistic, deformed, blurry"
          : "cartoon, anime, 3d render, cgi, blurry, distorted, doodle, sketch, low quality, deformed, artificial";
      // No model is invented here. Only an explicitly requested model is
      // forwarded; otherwise the worker's configured video model decides
      // (and is what the worker records in the ingest metadata). A
      // hard-coded default previously stamped "Lightricks/LTX-Video"
      // onto requests regardless of the backend that actually ran.
      const model = args.model ? String(args.model) : undefined;

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
          // Canonical artifact reference only (shared helper):
          // previewUrl (low-resolution derivative) and bare filenames
          // are not usable references for conditioning — if the
          // attachment carries neither a direct artifact URL nor a
          // decodable artifactId, no image is attached rather than a
          // guessed one (incident 2026-10-21, gap G2).
          const resolvedAttUrl = resolveAttachmentArtifactUrl(imageAtt);
          if (resolvedAttUrl) {
            const isLogo = /logo/i.test(imageAtt.name || "") || /\b(logo|brand|brandmark)\b/i.test(prompt);
            if (isLogo) {
              logoArtifactUrl = resolvedAttUrl;
            } else {
              inputImageUrl = resolvedAttUrl;
            }
          } else {
            // An image was attached but its reference cannot be
            // resolved to the original uploaded artifact. Proceeding
            // without it would silently degrade the request to
            // text-to-video — refuse honestly instead (2026-10-21).
            return {
              toolCallId,
              name: this.definition.name,
              success: false,
              output: "",
              error:
                "The attached image could not be resolved to its original uploaded artifact (only a preview or filename reference was provided). Refusing to generate the video without the exact uploaded image.",
              metadata: { status: "FAILED", reason: "UNRESOLVABLE_IMAGE_REFERENCE" },
              executionTimeMs: Date.now() - startTime,
            };
          }
        }
      }

      const isSilent = isExplicitlySilent(prompt, args);

      let inputImageData: string | undefined;
      let sourceImageSha256: string | undefined;
      const tmpImgDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-photo-i2v-"));
      try {
        if (inputImageUrl) {
          const tmpImg = path.join(tmpImgDir, "source_photo.png");
          const resolvedImg = await this.resolveOrDownloadArtifact(inputImageUrl, tmpImg);
          const imgBuf = await fs.readFile(resolvedImg);
          inputImageData = imgBuf.toString("base64");
          // Record the exact bytes that will condition the model, so the
          // uploaded photograph can be traced to the worker payload by
          // hash at every hop (upload -> tool -> worker -> ingest).
          sourceImageSha256 = crypto.createHash("sha256").update(imgBuf).digest("hex");
          console.log(
            `[MEDIA VIDEO GENERATE] Image conditioning active. Loaded source photograph (${imgBuf.length} bytes, sha256 ${sourceImageSha256}) for genuine neural Image-to-Video generation: ${inputImageUrl}`,
          );
        }
      } catch (imgErr: any) {
        await fs.rm(tmpImgDir, { recursive: true, force: true }).catch(() => {});
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Failed to resolve uploaded source image for video conditioning: ${imgErr.message || imgErr}`,
          metadata: { status: "FAILED" },
          executionTimeMs: Date.now() - startTime,
        };
      } finally {
        await fs.rm(tmpImgDir, { recursive: true, force: true }).catch(() => {});
      }

      const isImageToVideo = Boolean(inputImageData);
      const chosenModel = model && model !== "kandinsky-6.0" ? model : undefined;

      // Send the requested duration to the worker. The previous cap of 5s
      // silently truncated longer requests at the generation stage and left
      // the audio finalizer to loop a short clip up to the reported length.
      const baseDuration = requestedDuration;
      console.log(
        `[MEDIA VIDEO GENERATE] Dispatching genuine ${isImageToVideo ? "Image-to-Video" : "Text-to-Video"} inference (model: ${chosenModel ?? "worker-configured"}, duration: ${baseDuration}s, ${width}x${height}, silent: ${isSilent})...`,
      );

      const clip = await this.submitClip(workerUrl, workerToken, requestTimeout, {
        prompt,
        negative_prompt,
        duration_seconds: baseDuration,
        fps,
        width,
        height,
        model: chosenModel,
        image_url: inputImageUrl,
        image_data: inputImageData,
        // The tenant the server resolved for this caller. The worker ingests
        // the artifact into that workspace.
        workspace: context.tenantId,
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
      rawResultMetadata = {
        ...(clip.rawResult || {}),
        mode: isImageToVideo ? "image-to-video" : "text-to-video",
        // Only an explicitly requested model overrides the worker-reported
        // one; otherwise the worker's model (from its result metadata)
        // stands as the honest record of what generated the video.
        ...(chosenModel ? { model: chosenModel } : {}),
        identityPreserved: isImageToVideo,
        ...(sourceImageSha256
          ? { sourceImageSha256, sourceImageUrl: inputImageUrl }
          : {}),
      };

      // Duration bookkeeping: the worker clip and the delivered file are
      // measured, never assumed. The worker enforces its own per-clip
      // limit; the delivered file is what the user asked for.
      let workerClipDurationSeconds: number | undefined;
      let deliveredDurationSeconds: number | undefined;
      let audiovisualFinalized = false;

      // Complete audiovisual assembly (environmental ambience, cinematic music, branding, duration synchronization)
      if (clip.artifactUrl) {
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-vid-final-"));
          try {
            const tmpVid = path.join(tmpDir, "raw_clip.mp4");
            const resolvedVid = await this.resolveOrDownloadArtifact(clip.artifactUrl, tmpVid);
            workerClipDurationSeconds = (await probeVideoFile(resolvedVid)).duration;
            const tmpResolvedLogo = logoArtifactUrl
              ? await this.resolveOrDownloadArtifact(logoArtifactUrl, path.join(tmpDir, "logo.png"))
              : null;
            const tmpFinalized = path.join(tmpDir, "finalized_video.mp4");

            const finalizeRes = await finalizeVideoWithAudio({
              videoPath: resolvedVid,
              outputPath: tmpFinalized,
              prompt,
              duration: requestedDuration,
              fps,
              logoPath: tmpResolvedLogo,
              isSilent,
              targetWidth,
              targetHeight,
              isVertical,
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
            deliveredDurationSeconds = (await probeVideoFile(targetPath)).duration;
            audiovisualFinalized = true;
            finalArtifactUrl = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
              bundle,
            )}/${encodeURIComponent(filename)}`;

            rawResultMetadata = {
              ...rawResultMetadata,
              audiovisualFinalized: true,
              workerClipDurationSeconds,
              deliveredDurationSeconds,
              hasAudio: finalizeRes.hasAudio,
              hasVoice: finalizeRes.hasVoice,
              voiceText: finalizeRes.voiceText,
              targetDuration: requestedDuration,
              logoApplied: Boolean(tmpResolvedLogo),
              targetWidth,
              targetHeight,
              isVertical,
              aspectRatio: isVertical ? "9:16" : `${targetWidth}:${targetHeight}`,
            };
            console.log(
              `[MEDIA VIDEO GENERATE] Finalized complete audiovisual delivery (hasAudio=${finalizeRes.hasAudio}, hasVoice=${finalizeRes.hasVoice}, dimensions=${targetWidth}x${targetHeight}): ${finalArtifactUrl}`,
            );
          } catch (finalizeErr) {
            // The raw worker clip is delivered as-is. Its measured duration
            // (not the requested duration) is what gets reported.
            deliveredDurationSeconds = workerClipDurationSeconds;
            console.warn(
              "[MEDIA VIDEO GENERATE] Audiovisual finalization warning, delivering raw clip:",
              finalizeErr,
            );
          } finally {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          }
        }

        const durationMs = Date.now() - startTime;

      const hasDialogueRequest =
        /\b(?:saying|says|speaks?|said|talking|telling)\b/i.test(prompt) ||
        /["'“][^"'”]{2,150}["'”]/.test(prompt);

      // Post-generation verification: ensure the delivered artifact actually exists, is 9:16 if vertical, and has audio if requested
      const verification = await verifyDeliveredVideoArtifact(
        finalArtifactUrl,
        {
          expectedSha256: finalSha256,
          expectedVertical: isVertical,
          expectedAudio: hasDialogueRequest || !isSilent,
          expectedDurationSeconds: requestedDuration,
        },
      );
      // Use the verification probe's measurement of the delivered file
      // when the local probes above did not produce one.
      if (
        deliveredDurationSeconds === undefined &&
        verification.duration !== undefined &&
        Number.isFinite(verification.duration)
      ) {
        deliveredDurationSeconds = verification.duration;
      }
      const reportedDuration = deliveredDurationSeconds ?? requestedDuration;
      // Hard verification failures fail the result: the delivered
      // artifact does not satisfy an explicit request parameter
      // (duration, requested orientation) or cannot be trusted
      // (unretrievable, integrity mismatch). Softer failures (e.g. a
      // missing audio track) keep the generation successful but are
      // carried explicitly as verified=false below — never silently
      // presented as verified.
      if (!verification.verified && isHardVerificationFailure(verification) && process.env.NODE_ENV !== "test") {
        console.error(
          `[MEDIA GENERATION DIAGNOSTIC] Post-generation verification failed: ${verification.error}`,
        );
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Video generated, but verification failed (${verification.error || "Artifact unretrievable"}).`,
          metadata: {
            ...rawResultMetadata,
            status: "VERIFICATION_FAILED",
            verified: false,
            verificationError: verification.error,
            verification,
            requestedDuration,
            workerClipDurationSeconds,
            deliveredDurationSeconds,
            audiovisualFinalized,
          },
          executionTimeMs: durationMs,
        };
      }

      let speechSummary: string | undefined;
      if (hasDialogueRequest) {
        if (rawResultMetadata?.hasVoice) {
          speechSummary = `Audible dialogue synthesized into audio track: "${rawResultMetadata.voiceText}". (Note: LTX-Video generates visual motion; phoneme-level lip synchronization is not natively supported by the video diffusion model.)`;
        } else {
          speechSummary = `Dialogue requested ("${prompt}"), but could not be synthesized into the audio stream.`;
        }
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
            duration: reportedDuration,
            requestedDuration,
            workerClipDurationSeconds,
            deliveredDurationSeconds,
            audiovisualFinalized,
            resolution: `${targetWidth}x${targetHeight}`,
            aspectRatio: isVertical ? "9:16" : `${targetWidth}:${targetHeight}`,
            orientation: isVertical ? "vertical" : "horizontal",
            delivered: true,
            ...(sourceImageSha256 ? { sourceImageSha256 } : {}),
            verified: verification.verified,
            ...(verification.verified
              ? {}
              : { verificationError: verification.error }),
            hasAudio: Boolean(rawResultMetadata?.hasAudio),
            speechSummary,
          },
          null,
          2,
        ),
        metadata: {
          status: "COMPLETED",
          ...(sourceImageSha256 ? { sourceImageSha256, sourceImageUrl: inputImageUrl } : {}),
          verified: verification.verified,
          ...(verification.verified
            ? {}
            : { verificationError: verification.error }),
          artifactUrl: finalArtifactUrl,
          duration: reportedDuration,
          requestedDuration,
          workerClipDurationSeconds,
          deliveredDurationSeconds,
          audiovisualFinalized,
          resolution: `${targetWidth}x${targetHeight}`,
          aspectRatio: isVertical ? "9:16" : `${targetWidth}:${targetHeight}`,
          isVertical,
          verification,
          hasAudio: Boolean(rawResultMetadata?.hasAudio),
          speechSummary,
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
