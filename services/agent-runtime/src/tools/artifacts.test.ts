import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactListTool, ArtifactReadTool } from "./artifacts.js";
import type { ToolExecutionContext } from "./base.js";

function createMockContext(
  workspaceDir: string,
  tenantId = "tenant-a",
  attachments?: ToolExecutionContext["attachments"],
): ToolExecutionContext {
  return {
    workspaceDir,
    tenantId,
    userId: "user-test",
    agentRunId: "run-test",
    attachments,
  };
}

describe("ArtifactListTool & ArtifactReadTool", () => {
  let tmpDir: string;
  const originalUploadDir = process.env.ORBA_UPLOAD_DIR;
  const originalTenantId = process.env.ORBA_TENANT_ID;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-artifacts-test-"));
    process.env.ORBA_UPLOAD_DIR = tmpDir;
    process.env.ORBA_TENANT_ID = "tenant-a";
  });

  afterEach(async () => {
    process.env.ORBA_UPLOAD_DIR = originalUploadDir;
    process.env.ORBA_TENANT_ID = originalTenantId;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("ArtifactListTool", () => {
    it("returns turn attachments when present", async () => {
      const tool = new ArtifactListTool();
      const context = createMockContext(tmpDir, "tenant-a", [
        {
          artifactId: "att-123",
          name: "design_spec.md",
          type: "text/markdown",
          size: 1024,
          relPath: "uploads/design_spec.md",
        },
      ]);

      const result = await tool.execute({}, context);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(1);
      expect(parsed.items[0].artifactId).toBe("att-123");
      expect(parsed.items[0].name).toBe("design_spec.md");
      expect(parsed.items[0].source).toBe("attachment");
    });

    it("discovers generated media artifacts in tenant workspace", async () => {
      // Create mock generated media bundle
      const bundleDir = path.join(tmpDir, "tenant-a", "img_sphere123");
      await fs.mkdir(bundleDir, { recursive: true });
      await fs.writeFile(path.join(bundleDir, "obsidian.png"), Buffer.from("fake-png-bytes"));

      const tool = new ArtifactListTool();
      const context = createMockContext(tmpDir, "tenant-a");

      const result = await tool.execute({}, context);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(1);
      expect(parsed.items[0].name).toBe("obsidian.png");
      expect(parsed.items[0].type).toBe("image/png");
      expect(parsed.items[0].url).toBe("/api/artifacts/tenant-a/img_sphere123/obsidian.png");
      expect(parsed.items[0].source).toBe("workspace");
    });

    it("isolates tenant artifacts from other tenants", async () => {
      // Create files for tenant-b
      const otherTenantDir = path.join(tmpDir, "tenant-b", "vid_secret456");
      await fs.mkdir(otherTenantDir, { recursive: true });
      await fs.writeFile(
        path.join(otherTenantDir, "confidential.mp4"),
        Buffer.from("fake-video-bytes"),
      );

      const tool = new ArtifactListTool();
      const context = createMockContext(tmpDir, "tenant-a");

      const result = await tool.execute({}, context);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      // tenant-a has no artifacts, should not see tenant-b
      expect(parsed.count).toBe(0);
      expect(parsed.items).toHaveLength(0);
    });
  });

  describe("ArtifactReadTool", () => {
    it("reads a text artifact within byte limit", async () => {
      const bundleDir = path.join(tmpDir, "tenant-a", "docs_bundle");
      await fs.mkdir(bundleDir, { recursive: true });
      await fs.writeFile(path.join(bundleDir, "notes.txt"), "Hello, OrbaAgent workspace!", "utf-8");

      const artifactId = Buffer.from(
        JSON.stringify({ w: "tenant-a", b: "docs_bundle", p: "notes.txt" }),
      ).toString("base64url");

      const tool = new ArtifactReadTool();
      const context = createMockContext(tmpDir, "tenant-a");

      const result = await tool.execute({ artifactId }, context);
      expect(result.success).toBe(true);
      expect(result.output).toBe("Hello, OrbaAgent workspace!");
    });

    it("returns structured metadata and URL for binary media files", async () => {
      const bundleDir = path.join(tmpDir, "tenant-a", "vid_sunset999");
      await fs.mkdir(bundleDir, { recursive: true });
      await fs.writeFile(path.join(bundleDir, "sunset.mp4"), Buffer.from("fake-mp4-data"));

      const artifactId = Buffer.from(
        JSON.stringify({ w: "tenant-a", b: "vid_sunset999", p: "sunset.mp4" }),
      ).toString("base64url");

      const tool = new ArtifactReadTool();
      const context = createMockContext(tmpDir, "tenant-a");

      const result = await tool.execute({ artifactId }, context);
      expect(result.success).toBe(true);
      const meta = JSON.parse(result.output);
      expect(meta.filename).toBe("sunset.mp4");
      expect(meta.kind).toBe("video");
      expect(meta.url).toBe("/api/artifacts/tenant-a/vid_sunset999/sunset.mp4");
      expect(meta.workspace).toBe("tenant-a");
    });

    it("rejects artifact read when workspace does not match caller tenant", async () => {
      const artifactId = Buffer.from(
        JSON.stringify({ w: "tenant-evil", b: "stolen", p: "passwords.txt" }),
      ).toString("base64url");

      const tool = new ArtifactReadTool();
      const context = createMockContext(tmpDir, "tenant-a");

      const result = await tool.execute({ artifactId }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Artifact belongs to a different workspace");
    });

    it("denies path traversal attempts", async () => {
      const artifactId = Buffer.from(
        JSON.stringify({ w: "tenant-a", b: "../", p: "../../etc/passwd" }),
      ).toString("base64url");

      const tool = new ArtifactReadTool();
      const context = createMockContext(tmpDir, "tenant-a");

      const result = await tool.execute({ artifactId }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Path traversal denied");
    });
  });
});
