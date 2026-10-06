import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { PathContainmentError, resolveWithinBase } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";

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
function currentWorkspace(): string {
  return process.env.ORBA_TENANT_ID || "default-tenant";
}

export class ArtifactListTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "artifact_list",
    description:
      "List uploaded artifacts available for this chat turn (from the user's attachments).",
    parameters: {
      type: "object",
      properties: {},
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "artifact_list",
    description: "List attached artifacts (IDs, names, sizes, types, relative paths)",
    category: "documents",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["artifacts", "attachments", "list"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    _args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const toolCallId = `tc_artifacts_list_${start}`;
    const list = (context.attachments || []).map((a) => ({
      artifactId: a.artifactId,
      name: a.name || "",
      type: a.type || "",
      size: a.size ?? 0,
      relPath: a.relPath || "",
    }));
    return {
      toolCallId,
      name: this.definition.name,
      success: true,
      output: JSON.stringify({ count: list.length, items: list }, null, 2),
      metadata: { count: list.length, items: list },
      executionTimeMs: Date.now() - start,
    };
  }
}

export class ArtifactReadTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "artifact_read",
    description:
      "Read an artifact by its artifactId. Returns bounded text for text-like files, or metadata for binary files.",
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
    description: "Read or inspect an uploaded artifact",
    category: "documents",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["artifact", "read", "attachment", "content", "metadata"],
    parameters: this.definition.parameters,
    version: "1.0.0",
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
      // Whitelist: artifact must be in context.attachments
      const allowed = (context.attachments || []).some((a) => a.artifactId === artifactId);
      if (!allowed) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Artifact not attached to this turn",
        };
      }

      const { w, b, p } = decodeArtifactId(artifactId);

      // Cross-workspace guard: the decoded workspace must match this runtime's
      // configured workspace, so a crafted artifactId cannot read another tenant's file.
      if (w !== currentWorkspace()) {
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
      const isText =
        lower.endsWith(".txt") ||
        lower.endsWith(".md") ||
        lower.endsWith(".json") ||
        lower.endsWith(".csv") ||
        lower.endsWith(".ts") ||
        lower.endsWith(".tsx") ||
        lower.endsWith(".js") ||
        lower.endsWith(".jsx") ||
        lower.endsWith(".py") ||
        lower.endsWith(".go") ||
        lower.endsWith(".rs") ||
        lower.endsWith(".sql") ||
        lower.endsWith(".yaml") ||
        lower.endsWith(".yml") ||
        lower.endsWith(".html") ||
        lower.endsWith(".css");

      if (!isText) {
        // Return metadata only for non-text
        const meta = {
          filename,
          size: stat.size,
          relPath: p,
          workspace: w,
          bundle: b,
          kind:
            lower.endsWith(".png") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".gif") ||
            lower.endsWith(".webp")
              ? "image"
              : lower.endsWith(".mp4") || lower.endsWith(".mov")
                ? "video"
                : "binary",
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

      const fh = await fs.open(filePath, "r");
      const toRead = Math.min(stat.size, maxBytes);
      const buf = Buffer.alloc(Number(toRead));
      await fh.read(buf, 0, Number(toRead), 0);
      await fh.close();
      const text = buf.toString("utf-8");
      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: text,
        metadata: { filename, size: stat.size, relPath: p, truncated: stat.size > toRead },
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
