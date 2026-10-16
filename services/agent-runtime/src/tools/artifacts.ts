import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { PathContainmentError, resolveWithinBase } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { parseDocument } from "./documentParser.js";

function decodeArtifactId(artifactId: string): { w: string; b: string; p: string } {
  try {
    const json = Buffer.from(artifactId, "base64url").toString("utf-8");
    const obj = JSON.parse(json);
    if (
      !obj ||
      typeof obj.w !== "string" ||
      typeof obj.b !== "string" ||
      typeof obj.p !== "string"
    ) {
      throw new Error("Invalid artifact id structure");
    }
    return obj;
  } catch {
    throw new Error("Invalid artifact id");
  }
}

/**
 * Resolve an artifact path inside the upload base directory.
 *
 * Uses the shared `resolveWithinBase` containment check (`path.relative` based)
 * instead of a `startsWith` prefix test, which sibling directories sharing a
 * string prefix could defeat.
 */
function safeJoin(base: string, relParts: string[]): string {
  return resolveWithinBase(base, relParts);
}

/**
 * Workspace identity for artifacts, matching the upload route's model
 * (`ORBA_TENANT_ID || "default-tenant"`).
 */
function currentWorkspace(context?: ToolExecutionContext): string {
  return context?.tenantId || process.env.ORBA_TENANT_ID || "default-tenant";
}

function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export class ArtifactListTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "artifact_list",
    description:
      "List artifacts available in the tenant workspace and chat attachments (images, videos, uploads).",
    parameters: {
      type: "object",
      properties: {},
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "artifact_list",
    description: "List workspace and attached artifacts (IDs, names, sizes, types, URLs)",
    category: "documents",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["artifacts", "attachments", "list", "media", "images", "videos"],
    parameters: this.definition.parameters,
    version: "1.1.0",
    isCore: false,
  };

  async execute(
    _args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const toolCallId = `tc_artifacts_list_${start}`;
    const tenantId = currentWorkspace(context);
    const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");

    const items: Array<{
      artifactId: string;
      name: string;
      type: string;
      size: number;
      relPath: string;
      url?: string;
      source: "attachment" | "workspace";
    }> = [];

    const seenKeys = new Set<string>();

    // 1. Transient turn attachments from context
    for (const a of context.attachments || []) {
      const relPath = a.relPath || "";
      items.push({
        artifactId: a.artifactId,
        name: a.name || "",
        type: a.type || "",
        size: a.size ?? 0,
        relPath,
        source: "attachment",
      });
      seenKeys.add(a.artifactId);
    }

    // 2. Discover persisted workspace artifacts (generated images, videos, bundles)
    try {
      const tenantDir = safeJoin(baseDir, [tenantId]);
      const entries = await fs.readdir(tenantDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const bundle = entry.name;
        const bundleDir = safeJoin(tenantDir, [bundle]);
        const files = await fs.readdir(bundleDir, { withFileTypes: true });

        for (const file of files) {
          if (!file.isFile()) continue;
          const filename = file.name;
          const filePath = safeJoin(bundleDir, [filename]);
          const stat = await fs.stat(filePath);

          const artifactId = Buffer.from(
            JSON.stringify({ w: tenantId, b: bundle, p: filename }),
          ).toString("base64url");

          if (!seenKeys.has(artifactId)) {
            items.push({
              artifactId,
              name: filename,
              type: getMimeType(filename),
              size: stat.size,
              relPath: `${bundle}/${filename}`,
              url: `/api/artifacts/${tenantId}/${bundle}/${filename}`,
              source: "workspace",
            });
            seenKeys.add(artifactId);
          }
        }
      }
    } catch {
      // If upload directory does not exist yet or is unreadable, proceed with attachments
    }

    return {
      toolCallId,
      name: this.definition.name,
      success: true,
      output: JSON.stringify({ count: items.length, items }, null, 2),
      metadata: { count: items.length, items },
      executionTimeMs: Date.now() - start,
    };
  }
}

export class ArtifactReadTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "artifact_read",
    description:
      "Read an artifact by its artifactId. Returns bounded text for text-like files, or metadata and URL for binary/media files.",
    parameters: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Artifact ID from artifact_list" },
        maxBytes: {
          type: "number",
          description: "Optional maximum bytes to return for text files (default 200_000)",
          minimum: 1,
        },
      },
      required: ["artifactId"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "artifact_read",
    description: "Read or inspect an artifact",
    category: "documents",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["artifact", "read", "attachment", "content", "metadata", "media"],
    parameters: this.definition.parameters,
    version: "1.1.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_artifact_read_${start}`;
    const artifactId = String(args.artifactId || "");
    const maxBytes = Math.min(Number(args.maxBytes || 200_000), 2_000_000);

    try {
      const { w, b, p } = decodeArtifactId(artifactId);
      const tenantId = currentWorkspace(context);

      // Cross-workspace guard: decoded workspace must match caller's tenant
      if (w !== tenantId) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Artifact belongs to a different workspace",
          executionTimeMs: Date.now() - start,
        };
      }

      const baseDir = process.env.ORBA_UPLOAD_DIR || path.join(process.cwd(), ".uploads");
      let filePath: string;
      try {
        filePath = safeJoin(baseDir, [w, b, p]);
      } catch (err: unknown) {
        if (err instanceof PathContainmentError) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "Path traversal denied",
            executionTimeMs: Date.now() - start,
          };
        }
        throw err;
      }

      const stat = await fs.stat(filePath);
      const filename = path.basename(p);
      const lower = filename.toLowerCase();
      const isMedia =
        lower.endsWith(".png") ||
        lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg") ||
        lower.endsWith(".gif") ||
        lower.endsWith(".webp") ||
        lower.endsWith(".mp4") ||
        lower.endsWith(".mov") ||
        lower.endsWith(".webm");

      if (isMedia) {
        // Return structured metadata and retrieval URL for media files
        const meta = {
          filename,
          size: stat.size,
          relPath: `${b}/${p}`,
          workspace: w,
          bundle: b,
          url: `/api/artifacts/${w}/${b}/${p}`,
          kind:
            lower.endsWith(".png") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".gif") ||
            lower.endsWith(".webp")
              ? "image"
              : "video",
        };
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: JSON.stringify(meta, null, 2),
          metadata: meta as any,
          executionTimeMs: Date.now() - start,
        };
      }

      // Extract document contents (supports TXT, PDF, DOCX, CSV, JSON, code, ZIP)
      const parseResult = await parseDocument(filePath, filename, maxBytes);
      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: parseResult.text,
        metadata: {
          filename,
          size: stat.size,
          relPath: `${b}/${p}`,
          kind: parseResult.kind,
          pageCount: parseResult.pageCount,
          truncated: parseResult.truncated,
        },
        executionTimeMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: msg,
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
