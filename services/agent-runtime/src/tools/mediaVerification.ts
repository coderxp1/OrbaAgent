import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { PathContainmentError, resolveWithinBase } from "@orbaagent/shared";

const execFileAsync = promisify(execFile);

export interface ArtifactVerificationResult {
  verified: boolean;
  retrievable: boolean;
  sizeBytes?: number;
  sha256?: string;
  sha256Match?: boolean;
  contentType?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface VideoArtifactVerificationResult extends ArtifactVerificationResult {
  fps?: number;
  duration?: number;
  hasAudioStream?: boolean;
  isVertical?: boolean;
  aspectRatio?: string;
  frameInspectionPassed?: boolean;
}

export interface VideoVerificationOptions {
  expectedVertical?: boolean;
  expectedAudio?: boolean;
  expectedSha256?: string;
  minDurationSeconds?: number;
}

/**
 * Checks magic bytes of a file header buffer.
 */
export function verifyMediaMagicBytes(
  header: Buffer,
  expectedType: "image/png" | "video/mp4" | "image/jpeg",
): boolean {
  if (expectedType === "image/png") {
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    if (header.length < 8) return false;
    return (
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a
    );
  }

  if (expectedType === "video/mp4") {
    // MP4 ISO Base Media File Format: 'ftyp' box signature at offset 4
    if (header.length < 8) return false;
    return (
      header[4] === 0x66 && // 'f'
      header[5] === 0x74 && // 't'
      header[6] === 0x79 && // 'y'
      header[7] === 0x70 // 'p'
    );
  }

  if (expectedType === "image/jpeg") {
    if (header.length < 3) return false;
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }

  return true;
}

/**
 * Post-generation verification for an artifact URL (e.g. /api/artifacts/default-tenant/bundle/filename.ext)
 */
export async function verifyDeliveredArtifact(
  artifactUrl: string,
  expectedType: "image/png" | "video/mp4" | "image/jpeg",
  expectedSha256?: string,
): Promise<ArtifactVerificationResult> {
  if (!artifactUrl || typeof artifactUrl !== "string") {
    return {
      verified: false,
      retrievable: false,
      error: "Missing or invalid artifact URL",
    };
  }

  const prefix = "/api/artifacts/";
  if (!artifactUrl.startsWith(prefix)) {
    return {
      verified: false,
      retrievable: false,
      error: `Artifact URL must start with ${prefix}`,
    };
  }

  const rawPath = artifactUrl.slice(prefix.length);
  const segments = rawPath.split("/").map((s) => decodeURIComponent(s));
  if (segments.length < 3) {
    return {
      verified: false,
      retrievable: false,
      error: "Malformed artifact URL segments",
    };
  }

  const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");

  let localPath: string | null = null;
  try {
    localPath = resolveWithinBase(baseDir, segments);
  } catch (err) {
    if (err instanceof PathContainmentError) {
      return {
        verified: false,
        retrievable: false,
        error: "Artifact path traversal rejected",
      };
    }
  }

  // Attempt local filesystem verification if running on the host that holds artifacts
  if (localPath) {
    try {
      const st = await fs.stat(localPath);
      if (st.isFile() && st.size > 0) {
        let probedWidth: number | undefined;
        let probedHeight: number | undefined;

        const fileHandle = await fs.open(localPath, "r");
        try {
          const header = Buffer.alloc(32);
          await fileHandle.read(header, 0, 32, 0);
          const magicValid = verifyMediaMagicBytes(header, expectedType);
          if (!magicValid) {
            return {
              verified: false,
              retrievable: false,
              sizeBytes: st.size,
              error: `Invalid magic bytes for expected type ${expectedType}`,
            };
          }
          if (expectedType === "image/png" && header.length >= 24) {
            probedWidth = header.readUInt32BE(16);
            probedHeight = header.readUInt32BE(20);
          }
        } finally {
          await fileHandle.close();
        }

        let sha256Match = true;
        let actualSha256: string | undefined;

        if (expectedSha256) {
          const content = await fs.readFile(localPath);
          actualSha256 = crypto.createHash("sha256").update(content).digest("hex");
          sha256Match = actualSha256.toLowerCase() === expectedSha256.toLowerCase();
          if (!sha256Match) {
            return {
              verified: false,
              retrievable: true,
              sizeBytes: st.size,
              sha256: actualSha256,
              sha256Match: false,
              width: probedWidth,
              height: probedHeight,
              error: `SHA-256 integrity mismatch: expected ${expectedSha256}, got ${actualSha256}`,
            };
          }
        }

        return {
          verified: true,
          retrievable: true,
          sizeBytes: st.size,
          sha256: actualSha256 || expectedSha256,
          sha256Match,
          contentType: expectedType,
          width: probedWidth,
          height: probedHeight,
        };
      }
    } catch {
      // Local path does not exist; continue to HTTP check below
    }
  }

  // Fallback to internal HTTP check (e.g. when agent runtime is on a separate container)
  const appUrl = (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.ORBA_WEB_URL ||
    "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");

  try {
    const res = await fetch(`${appUrl}${artifactUrl}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return {
        verified: false,
        retrievable: false,
        error: `Artifact endpoint returned HTTP ${res.status}`,
      };
    }

    const contentType = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      return {
        verified: false,
        retrievable: false,
        error: "Artifact endpoint returned empty content",
      };
    }

    const magicValid = verifyMediaMagicBytes(buf, expectedType);
    if (!magicValid) {
      return {
        verified: false,
        retrievable: true,
        sizeBytes: buf.length,
        error: `Invalid content headers for ${expectedType}`,
      };
    }

    let probedWidth: number | undefined;
    let probedHeight: number | undefined;
    if (expectedType === "image/png" && buf.length >= 24) {
      probedWidth = buf.readUInt32BE(16);
      probedHeight = buf.readUInt32BE(20);
    }

    let sha256Match = true;
    let actualSha256: string | undefined;
    if (expectedSha256) {
      actualSha256 = crypto.createHash("sha256").update(buf).digest("hex");
      sha256Match = actualSha256.toLowerCase() === expectedSha256.toLowerCase();
      if (!sha256Match) {
        return {
          verified: false,
          retrievable: true,
          sizeBytes: buf.length,
          sha256: actualSha256,
          sha256Match: false,
          width: probedWidth,
          height: probedHeight,
          error: `SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
        };
      }
    }

    return {
      verified: true,
      retrievable: true,
      sizeBytes: buf.length,
      sha256: actualSha256 || expectedSha256,
      sha256Match,
      contentType: contentType || expectedType,
      width: probedWidth,
      height: probedHeight,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If neither local filesystem nor internal HTTP succeeded, report truthful error
    return {
      verified: false,
      retrievable: false,
      error: `Failed to retrieve and verify artifact: ${msg}`,
    };
  }
}

/**
 * Probes video streams, dimensions, frame rate, duration, and audio using ffprobe.
 */
export async function probeVideoFile(filePath: string): Promise<{
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  hasAudioStream: boolean;
  isVertical?: boolean;
  aspectRatio?: string;
}> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      filePath,
    ]);
    const info = JSON.parse(stdout);
    const videoStream = (info.streams || []).find((s: any) => s.codec_type === "video");
    const audioStream = (info.streams || []).find((s: any) => s.codec_type === "audio");

    let width = videoStream?.width ? Number(videoStream.width) : undefined;
    let height = videoStream?.height ? Number(videoStream.height) : undefined;
    let duration = info.format?.duration ? Number.parseFloat(info.format.duration) : undefined;
    let fps: number | undefined;
    if (videoStream?.r_frame_rate) {
      const parts = String(videoStream.r_frame_rate).split("/");
      if (parts.length === 2 && Number(parts[1]) > 0) {
        fps = Math.round(Number(parts[0]) / Number(parts[1]));
      } else {
        fps = Number(videoStream.r_frame_rate) || undefined;
      }
    }
    const hasAudioStream = Boolean(audioStream);
    const isVertical = width !== undefined && height !== undefined ? height > width : undefined;
    const aspectRatio = width && height ? `${width}:${height}` : undefined;

    return {
      width,
      height,
      fps,
      duration,
      hasAudioStream,
      isVertical,
      aspectRatio,
    };
  } catch {
    return {
      hasAudioStream: false,
    };
  }
}

/**
 * Validates a delivered video artifact for:
 * 1. File existence, magic bytes, sha256 integrity
 * 2. Aspect ratio / vertical format compliance (e.g. 720x1280 9:16)
 * 3. Audio stream presence if speech or sound was requested
 * 4. Video decodability via representative frame inspection
 */
export async function verifyDeliveredVideoArtifact(
  artifactUrl: string,
  options?: VideoVerificationOptions,
): Promise<VideoArtifactVerificationResult> {
  const baseResult = await verifyDeliveredArtifact(
    artifactUrl,
    "video/mp4",
    options?.expectedSha256,
  );

  if (!baseResult.verified) {
    return baseResult;
  }

  // Resolve local file path for probing
  const prefix = "/api/artifacts/";
  const rawPath = artifactUrl.slice(prefix.length);
  const segments = rawPath.split("/").map((s) => decodeURIComponent(s));
  const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
  let localPath: string | null = null;
  try {
    localPath = resolveWithinBase(baseDir, segments);
  } catch {}

  let tmpPath: string | null = null;
  let targetFile = localPath;

  if (!targetFile) {
    try {
      const appUrl = (
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.ORBA_WEB_URL ||
        "http://127.0.0.1:3000"
      ).replace(/\/+$/, "");
      const res = await fetch(`${appUrl}${artifactUrl}`);
      if (res.ok) {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-verify-vid-"));
        tmpPath = path.join(tmpDir, "check.mp4");
        await fs.writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
        targetFile = tmpPath;
      }
    } catch {}
  }

  if (!targetFile) {
    return baseResult;
  }

  try {
    const probe = await probeVideoFile(targetFile);

    // Validate vertical aspect ratio if expected
    if (options?.expectedVertical) {
      if (probe.width !== undefined && probe.height !== undefined) {
        if (probe.height <= probe.width) {
          return {
            ...baseResult,
            verified: false,
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            duration: probe.duration,
            hasAudioStream: probe.hasAudioStream,
            isVertical: false,
            aspectRatio: probe.aspectRatio,
            error: `Vertical orientation required (9:16 portrait), but delivered video has dimensions ${probe.width}x${probe.height} (horizontal/square).`,
          };
        }
      }
    }

    // Validate audio stream presence if expected
    if (options?.expectedAudio && !probe.hasAudioStream) {
      return {
        ...baseResult,
        verified: false,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        duration: probe.duration,
        hasAudioStream: false,
        isVertical: probe.isVertical,
        aspectRatio: probe.aspectRatio,
        error: "Audible dialogue/speech was requested, but delivered video contains no audio stream.",
      };
    }

    // Inspect representative frame decodability
    let frameInspectionPassed = false;
    try {
      const testFramePath = path.join(os.tmpdir(), `frame_${Date.now()}.jpg`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        "0.5",
        "-i",
        targetFile,
        "-vframes",
        "1",
        testFramePath,
      ]);
      const st = await fs.stat(testFramePath);
      if (st.size > 100) {
        frameInspectionPassed = true;
      }
      await fs.rm(testFramePath, { force: true }).catch(() => {});
    } catch {
      // ffmpeg frame extraction warning only
    }

    return {
      ...baseResult,
      width: probe.width ?? baseResult.width,
      height: probe.height ?? baseResult.height,
      fps: probe.fps,
      duration: probe.duration,
      hasAudioStream: probe.hasAudioStream,
      isVertical: probe.isVertical,
      aspectRatio: probe.aspectRatio,
      frameInspectionPassed,
    };
  } finally {
    if (tmpPath) {
      const parentDir = path.dirname(tmpPath);
      await fs.rm(parentDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
