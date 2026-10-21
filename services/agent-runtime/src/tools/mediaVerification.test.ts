import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaImageGenerateTool } from "./mediaImageGenerate.js";
import {
  isHardVerificationFailure,
  verifyDeliveredArtifact,
  verifyDeliveredVideoArtifact,
  verifyMediaMagicBytes,
} from "./mediaVerification.js";
import { MediaVideoGenerateTool } from "./mediaVideoGenerate.js";

describe("Media Post-Generation Verification & Bounded Self-Repair", () => {
  let tmpDir: string;
  const originalUploadDir = process.env.ORBA_UPLOAD_DIR;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-verify-test-"));
    process.env.ORBA_UPLOAD_DIR = tmpDir;
  });

  afterEach(async () => {
    process.env.ORBA_UPLOAD_DIR = originalUploadDir;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Magic Bytes Validation", () => {
    it("recognizes valid PNG magic bytes", () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      expect(verifyMediaMagicBytes(pngHeader, "image/png")).toBe(true);
    });

    it("rejects invalid PNG magic bytes (e.g. text/html header)", () => {
      const textHeader = Buffer.from("<!DOCTYPE html><html>");
      expect(verifyMediaMagicBytes(textHeader, "image/png")).toBe(false);
    });

    it("recognizes valid MP4 ftyp box signature", () => {
      // Offset 4 must be 'ftyp'
      const mp4Header = Buffer.from([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]);
      expect(verifyMediaMagicBytes(mp4Header, "video/mp4")).toBe(true);
    });

    it("rejects invalid MP4 signature", () => {
      const invalidHeader = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x6d, 0x6f, 0x6f, 0x76]);
      expect(verifyMediaMagicBytes(invalidHeader, "video/mp4")).toBe(false);
    });
  });

  describe("verifyDeliveredArtifact", () => {
    it("successfully verifies existing valid PNG file and matching SHA-256", async () => {
      const workspace = "default-tenant";
      const bundle = "bundle_img_1";
      const filename = "test.png";
      const bundleDir = path.join(tmpDir, workspace, bundle);
      await fs.mkdir(bundleDir, { recursive: true });

      // Valid PNG header + mock payload
      const payload = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("valid_png_content_bytes_for_testing"),
      ]);
      const targetFile = path.join(bundleDir, filename);
      await fs.writeFile(targetFile, payload);

      const expectedSha256 = crypto.createHash("sha256").update(payload).digest("hex");
      const artifactUrl = `/api/artifacts/${workspace}/${bundle}/${filename}`;

      const result = await verifyDeliveredArtifact(artifactUrl, "image/png", expectedSha256);

      expect(result.verified).toBe(true);
      expect(result.retrievable).toBe(true);
      expect(result.sha256Match).toBe(true);
      expect(result.sizeBytes).toBe(payload.length);
    });

    it("successfully verifies existing valid MP4 file and matching SHA-256", async () => {
      const workspace = "default-tenant";
      const bundle = "bundle_vid_1";
      const filename = "wave.mp4";
      const bundleDir = path.join(tmpDir, workspace, bundle);
      await fs.mkdir(bundleDir, { recursive: true });

      const payload = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
        Buffer.from("valid_h264_frames_for_testing_video_pipeline"),
      ]);
      const targetFile = path.join(bundleDir, filename);
      await fs.writeFile(targetFile, payload);

      const expectedSha256 = crypto.createHash("sha256").update(payload).digest("hex");
      const artifactUrl = `/api/artifacts/${workspace}/${bundle}/${filename}`;

      const result = await verifyDeliveredArtifact(artifactUrl, "video/mp4", expectedSha256);

      expect(result.verified).toBe(true);
      expect(result.retrievable).toBe(true);
      expect(result.sha256Match).toBe(true);
      expect(result.sizeBytes).toBe(payload.length);
    });

    it("rejects corrupted file with invalid magic bytes", async () => {
      const workspace = "default-tenant";
      const bundle = "bundle_bad";
      const filename = "corrupt.png";
      const bundleDir = path.join(tmpDir, workspace, bundle);
      await fs.mkdir(bundleDir, { recursive: true });

      await fs.writeFile(path.join(bundleDir, filename), Buffer.from("plain text not a png image"));
      const artifactUrl = `/api/artifacts/${workspace}/${bundle}/${filename}`;

      const result = await verifyDeliveredArtifact(artifactUrl, "image/png");

      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/invalid magic bytes/i);
    });

    it("rejects artifact when SHA-256 hash does not match expected value", async () => {
      const workspace = "default-tenant";
      const bundle = "bundle_mismatch";
      const filename = "video.mp4";
      const bundleDir = path.join(tmpDir, workspace, bundle);
      await fs.mkdir(bundleDir, { recursive: true });

      const payload = Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]);
      await fs.writeFile(path.join(bundleDir, filename), payload);

      const artifactUrl = `/api/artifacts/${workspace}/${bundle}/${filename}`;
      const wrongSha256 = "0000000000000000000000000000000000000000000000000000000000000000";

      const result = await verifyDeliveredArtifact(artifactUrl, "video/mp4", wrongSha256);

      expect(result.verified).toBe(false);
      expect(result.sha256Match).toBe(false);
      expect(result.error).toMatch(/sha-256 integrity mismatch/i);
    });

    it("rejects path traversal attempts in artifact URL", async () => {
      const result = await verifyDeliveredArtifact(
        "/api/artifacts/default-tenant/../../etc/passwd",
        "image/png",
      );

      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/traversal/i);
    });
  });

  describe("Bounded Self-Repair in Media Tools", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("recovers from temporary 503 BUSY permit contention with bounded retry", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";

      let attempts = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.endsWith("/api/generate/video")) {
          attempts++;
          if (attempts === 1) {
            // First attempt: GPU is busy with permit
            return new Response(
              JSON.stringify({ detail: { status: "BUSY", message: "GPU is busy" } }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          // Second attempt: succeeds
          return new Response(
            JSON.stringify({
              jobId: "job_recovered",
              status: "COMPLETED",
              artifact_url: "/api/artifacts/default-tenant/job_recovered/video.mp4",
              delivered: true,
              model: "wan2.1-t2v-1.3b",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response("{}", { status: 200 });
      });

      const tool = new MediaVideoGenerateTool();
      const res = await tool.execute({ prompt: "ocean waves" }, { workspaceDir: "/tmp" } as any);

      expect(attempts).toBe(2);
      expect(res.success).toBe(true);
      const parsed = JSON.parse(res.output);
      expect(parsed.status).toBe("COMPLETED");
      expect(parsed.jobId).toBe("job_recovered");
    });

    it("recovers from 400 validation error by snapping dimensions to 32-divisible values while preserving aspect ratio and duration", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";

      let attempts = 0;
      let secondAttemptBody: any = null;

      globalThis.fetch = vi
        .fn()
        .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/health")) {
            return new Response(
              JSON.stringify({
                worker: "healthy",
                status: "ok",
                capabilities: { video_generation: true },
                generation_backend: "diffusers",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          if (url.endsWith("/api/generate/video")) {
            attempts++;
            if (attempts === 1) {
              // Invalid parameters rejected by backend
              return new Response("Width and height must be divisible by 16", { status: 400 });
            }
            if (init?.body) {
              secondAttemptBody = JSON.parse(String(init.body));
            }
            return new Response(
              JSON.stringify({
                jobId: "job_normalized",
                status: "COMPLETED",
                artifact_url: "/api/artifacts/default-tenant/job_normalized/video.mp4",
                delivered: true,
                model: "wan2.1-t2v-1.3b",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          return new Response("{}", { status: 200 });
        });

      const tool = new MediaVideoGenerateTool();
      const res = await tool.execute(
        { prompt: "ocean waves", width: 555, height: 777, duration_seconds: 25 },
        { workspaceDir: "/tmp" } as any,
      );

      expect(attempts).toBe(2);
      expect(res.success).toBe(true);
      // 555x777 (portrait) snaps to 544x768: aspect/orientation preserved,
      // NOT forced to 480x480; the explicit 25s duration is preserved
      // exactly, NOT truncated to 5s on repair.
      expect(secondAttemptBody.width).toBe(544);
      expect(secondAttemptBody.height).toBe(768);
      expect(secondAttemptBody.duration_seconds).toBe(25);
    });

    it("rejects an explicit duration over the 30s ceiling instead of silently clamping it", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";

      let generateCalls = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/generate/video")) generateCalls++;
        return new Response("{}", { status: 200 });
      });

      const tool = new MediaVideoGenerateTool();
      const res = await tool.execute({ prompt: "ocean waves", duration_seconds: 50 }, {
        workspaceDir: "/tmp",
      } as any);

      expect(res.success).toBe(false);
      expect(res.error).toContain("50s exceeds the maximum supported duration of 30s");
      expect(res.error).toContain("not silently shortened");
      expect(generateCalls).toBe(0);
    });

    it("bounds identical-payload retries when a 400 cannot be repaired", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";

      let generateCalls = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/generate/video")) {
          generateCalls++;
          return new Response("model not available", { status: 400 });
        }
        return new Response("{}", { status: 200 });
      });

      const tool = new MediaVideoGenerateTool();
      // Vertical request: worker dims 704x1280 are already 32-divisible,
      // so the dimension repair cannot change the payload.
      const res = await tool.execute({ prompt: "vertical video of ocean waves" }, {
        workspaceDir: "/tmp",
      } as any);

      expect(res.success).toBe(false);
      expect(res.error).toContain("rejected by the media worker (HTTP 400)");
      // One bounded identical retry is allowed; the previous behaviour
      // retried the identical payload until the 60-attempt budget ran out.
      expect(generateCalls).toBe(2);
    });

    it("rejects explicit zero, negative, and fractional durations instead of silently replacing them", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";

      let generateCalls = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/generate/video")) generateCalls++;
        return new Response("{}", { status: 200 });
      });

      const tool = new MediaVideoGenerateTool();
      for (const bad of [0, -10, 5.5]) {
        const res = await tool.execute({ prompt: "ocean waves", duration_seconds: bad }, {
          workspaceDir: "/tmp",
        } as any);
        expect(res.success).toBe(false);
        expect(res.error).toContain("is invalid");
        expect(res.error).toContain("not silently changed");
      }
      expect(generateCalls).toBe(0);
    });

    it("stops after 2 attempts when error is non-recoverable without infinite loop", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";

      let attempts = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.endsWith("/api/generate/video")) {
          attempts++;
          return new Response("Persistent GPU worker internal error", { status: 500 });
        }

        return new Response("{}", { status: 200 });
      });

      const tool = new MediaVideoGenerateTool();
      const res = await tool.execute({ prompt: "ocean waves" }, { workspaceDir: "/tmp" } as any);

      // Max attempts strictly capped at 2
      expect(attempts).toBeLessThanOrEqual(2);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/temporarily unavailable/i);
    });
  });

  describe("Delivered duration verification", () => {
    async function writeVideo(workspace: string, bundle: string, seconds: number) {
      const bundleDir = path.join(tmpDir, workspace, bundle);
      await fs.mkdir(bundleDir, { recursive: true });
      const filePath = path.join(bundleDir, "clip.mp4");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=320x240:r=16:d=${seconds}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        filePath,
      ]);
      return `/api/artifacts/${workspace}/${bundle}/clip.mp4`;
    }

    it("fails verification when the delivered duration is far from the requested duration", async () => {
      const url = await writeVideo("default-tenant", "bundle_short", 2);
      const res = await verifyDeliveredVideoArtifact(url, { expectedDurationSeconds: 5 });
      expect(res.verified).toBe(false);
      expect(res.duration).toBeCloseTo(2, 0);
      expect(res.error).toMatch(/does not match the requested 5s/);
    });

    it("passes verification when the delivered duration matches the request", async () => {
      const url = await writeVideo("default-tenant", "bundle_ok", 5);
      const res = await verifyDeliveredVideoArtifact(url, { expectedDurationSeconds: 5 });
      expect(res.verified).toBe(true);
      expect(res.duration).toBeCloseTo(5, 0);
    });

    it("enforces minDurationSeconds when provided", async () => {
      const url = await writeVideo("default-tenant", "bundle_min", 2);
      const res = await verifyDeliveredVideoArtifact(url, { minDurationSeconds: 4 });
      expect(res.verified).toBe(false);
      expect(res.error).toMatch(/below the minimum 4s/);
    });

    it("tags duration, orientation, and audio failures with their kind", async () => {
      const url = await writeVideo("default-tenant", "bundle_kinds", 2);
      const dur = await verifyDeliveredVideoArtifact(url, { expectedDurationSeconds: 5 });
      expect(dur.failureKind).toBe("duration");
      const ori = await verifyDeliveredVideoArtifact(url, { expectedVertical: true });
      expect(ori.failureKind).toBe("orientation");
      const aud = await verifyDeliveredVideoArtifact(url, { expectedAudio: true });
      expect(aud.failureKind).toBe("audio");
    });
  });

  describe("Source image resolution — no substitution", () => {
    it("resolves the exact artifact, never a same-named file from another bundle", async () => {
      const tool = new MediaVideoGenerateTool() as any;
      const dirA = path.join(tmpDir, "tenant-a", "bundleA");
      const dirB = path.join(tmpDir, "tenant-b", "bundleB");
      await fs.mkdir(dirA, { recursive: true });
      await fs.mkdir(dirB, { recursive: true });
      await fs.writeFile(path.join(dirA, "photo.jpg"), Buffer.from("PHOTO-A-BYTES"));
      await fs.writeFile(path.join(dirB, "photo.jpg"), Buffer.from("PHOTO-B-BYTES"));

      const resolved = await tool.resolveOrDownloadArtifact(
        "/api/artifacts/tenant-b/bundleB/photo.jpg",
        path.join(tmpDir, "dest.jpg"),
      );
      const bytes = await fs.readFile(resolved);
      expect(bytes.toString()).toBe("PHOTO-B-BYTES");
    });

    it("fails loudly instead of substituting a same-named file when the exact artifact is missing", async () => {
      const tool = new MediaVideoGenerateTool() as any;
      const dirA = path.join(tmpDir, "tenant-a", "bundleA");
      await fs.mkdir(dirA, { recursive: true });
      await fs.writeFile(path.join(dirA, "photo.jpg"), Buffer.from("PHOTO-A-BYTES"));
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

      await expect(
        tool.resolveOrDownloadArtifact(
          "/api/artifacts/tenant-b/bundleMissing/photo.jpg",
          path.join(tmpDir, "dest.jpg"),
        ),
      ).rejects.toThrow(/Failed to fetch artifact/);
    });

    it("records the source image hash and sends the exact uploaded bytes to the worker", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";

      const photoBytes = Buffer.from("THE-EXACT-UPLOADED-PHOTO-BYTES");
      const photoDir = path.join(tmpDir, "test-tenant", "uploads1");
      await fs.mkdir(photoDir, { recursive: true });
      await fs.writeFile(path.join(photoDir, "photo.jpg"), photoBytes);
      const expectedSha = crypto.createHash("sha256").update(photoBytes).digest("hex");

      let workerPayload: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: any) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/generate/video")) {
          workerPayload = JSON.parse(init?.body || "{}");
          return new Response(
            JSON.stringify({
              jobId: "job_trace",
              status: "COMPLETED",
              artifactUrl: "/api/artifacts/test-tenant/vid_trace/raw.mp4",
              bundle: "vid_trace",
              sha256: "fake-sha256",
              delivered: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      });

      const tool = new MediaVideoGenerateTool();
      const res = await tool.execute(
        {
          prompt: "Generate a vertical video using this photo",
          image_url: "/api/artifacts/test-tenant/uploads1/photo.jpg",
        },
        { workspaceDir: "/tmp" } as any,
      );

      expect(res.success).toBe(true);
      // The worker received the exact uploaded bytes — no substitution.
      expect(workerPayload?.image_data).toBe(photoBytes.toString("base64"));
      // And the hash of those bytes is recorded for end-to-end tracing.
      expect((res.metadata as any)?.sourceImageSha256).toBe(expectedSha);
      expect(JSON.parse(res.output)?.sourceImageSha256).toBe(expectedSha);
    });
  });

  describe("Unresolvable image reference — no silent text-to-video", () => {
    it("refuses when the attachment carries only a preview/filename reference", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";
      const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      });
      globalThis.fetch = fetchMock;

      const tool = new MediaVideoGenerateTool();
      const res = await tool.execute(
        { prompt: "Generate a vertical video using this photo" },
        {
          workspaceDir: "/tmp",
          attachments: [
            { name: "photo.jpg", type: "image/jpeg", previewUrl: "blob:https://orbaagent.dev/abc" },
          ],
        } as any,
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/could not be resolved/i);
      expect((res.metadata as any)?.reason).toBe("UNRESOLVABLE_IMAGE_REFERENCE");
      // The worker was never asked to GENERATE anything (health check only).
      const generateCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/generate/"),
      );
      expect(generateCalls).toHaveLength(0);
    });
  });

  describe("Verification failure semantics", () => {
    it("classifies hard failures: unretrievable, integrity, duration, orientation", () => {
      expect(isHardVerificationFailure({ verified: true, retrievable: true })).toBe(false);
      expect(isHardVerificationFailure({ verified: false, retrievable: false })).toBe(true);
      expect(
        isHardVerificationFailure({ verified: false, retrievable: true, failureKind: "integrity" }),
      ).toBe(true);
      expect(
        isHardVerificationFailure({ verified: false, retrievable: true, failureKind: "duration" }),
      ).toBe(true);
      expect(
        isHardVerificationFailure({
          verified: false,
          retrievable: true,
          failureKind: "orientation",
        }),
      ).toBe(true);
      expect(
        isHardVerificationFailure({ verified: false, retrievable: true, failureKind: "audio" }),
      ).toBe(false);
      expect(
        isHardVerificationFailure({ verified: false, retrievable: true, failureKind: "format" }),
      ).toBe(false);
    });

    async function writeRawClip(seconds: number, withAudio: boolean) {
      const bundleDir = path.join(tmpDir, "test-tenant", "vid_test");
      await fs.mkdir(bundleDir, { recursive: true });
      const filePath = path.join(bundleDir, "raw.mp4");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const args = ["-y", "-f", "lavfi", "-i", `color=c=black:s=320x240:r=16:d=${seconds}`];
      if (withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=440:d=${seconds}`);
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
      if (withAudio) args.push("-c:a", "aac", "-shortest");
      args.push(filePath);
      await promisify(execFile)("ffmpeg", args);
      const bytes = await fs.readFile(filePath);
      return crypto.createHash("sha256").update(bytes).digest("hex");
    }

    function mockWorker(sha256: string) {
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              worker: "healthy",
              status: "ok",
              capabilities: { video_generation: true },
              generation_backend: "diffusers",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/generate/video")) {
          return new Response(
            JSON.stringify({
              jobId: "job_semantics",
              status: "COMPLETED",
              artifactUrl: "/api/artifacts/test-tenant/vid_test/raw.mp4",
              artifact_url: "/api/artifacts/test-tenant/vid_test/raw.mp4",
              bundle: "vid_test",
              sha256,
              delivered: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("{}", { status: 200 });
      });
    }

    it("fails the tool result when the delivered duration is wrong (hard failure)", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";
      const sha = await writeRawClip(2, true);
      mockWorker(sha);
      const tool = new MediaVideoGenerateTool();
      // Force the raw-clip path: finalization cannot run, so the 2s
      // worker clip is what gets delivered for a 5s request.
      (tool as any).resolveOrDownloadArtifact = vi
        .fn()
        .mockRejectedValue(new Error("finalize unavailable in test"));
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const res = await tool.execute({ prompt: "ocean waves", duration_seconds: 5 }, {
          workspaceDir: "/tmp",
        } as any);
        expect(res.success).toBe(false);
        expect(res.error).toContain("does not match the requested 5s");
        expect((res.metadata as any)?.status).toBe("VERIFICATION_FAILED");
        expect((res.metadata as any)?.verified).toBe(false);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it("keeps generation successful but explicitly unverified when only audio is missing (soft failure)", async () => {
      process.env.MEDIA_WORKER_ENABLED = "true";
      process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
      process.env.MEDIA_WORKER_TOKEN = "test-token";
      const sha = await writeRawClip(5, false);
      mockWorker(sha);
      const tool = new MediaVideoGenerateTool();
      (tool as any).resolveOrDownloadArtifact = vi
        .fn()
        .mockRejectedValue(new Error("finalize unavailable in test"));
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const res = await tool.execute({ prompt: "ocean waves", duration_seconds: 5 }, {
          workspaceDir: "/tmp",
        } as any);
        expect(res.success).toBe(true);
        const parsed = JSON.parse(res.output);
        expect(parsed.verified).toBe(false);
        expect(parsed.verificationError).toContain("no audio stream");
        expect((res.metadata as any)?.verified).toBe(false);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });
});
