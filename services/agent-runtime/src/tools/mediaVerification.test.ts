import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaImageGenerateTool } from "./mediaImageGenerate.js";
import { verifyDeliveredArtifact, verifyMediaMagicBytes } from "./mediaVerification.js";
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

    it("recovers from 400 validation error by auto-normalizing invalid parameters", async () => {
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
        { prompt: "ocean waves", width: 555, height: 777, duration_seconds: 50 },
        { workspaceDir: "/tmp" } as any,
      );

      expect(attempts).toBe(2);
      expect(res.success).toBe(true);
      expect(secondAttemptBody.width).toBe(480);
      expect(secondAttemptBody.height).toBe(480);
      expect(secondAttemptBody.duration_seconds).toBe(5);
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
});
