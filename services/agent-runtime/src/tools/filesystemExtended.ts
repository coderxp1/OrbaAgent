import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";

function resolveSafePath(workspaceDir: string, relativePath: string, allowRoot = false): string {
  if (!relativePath && !allowRoot) {
    throw new Error("Empty path is not permitted.");
  }
  const cleanRelative = (relativePath || ".").trim();
  const resolvedTarget = path.resolve(workspaceDir, cleanRelative);
  const resolvedWorkspace = path.resolve(workspaceDir);

  if (!allowRoot && resolvedTarget === resolvedWorkspace) {
    throw new Error("Targeting workspace root directly is not permitted for this operation.");
  }

  if (
    resolvedTarget !== resolvedWorkspace &&
    !resolvedTarget.startsWith(resolvedWorkspace + path.sep)
  ) {
    throw new Error(
      `Path traversal denied: '${relativePath}' is outside workspace scope (${resolvedWorkspace}).`,
    );
  }

  return resolvedTarget;
}

export class FilesystemSearchTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "filesystem_search",
    description:
      "Search for files or grep text patterns across the workspace. Skips node_modules, .git, and dist.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search string or regex to match against file contents or file names",
        },
        path: {
          type: "string",
          description: "Subdirectory to search within (default '.')",
        },
        contentMatch: {
          type: "boolean",
          description: "Search inside file contents (true) or file names only (false, default: true)",
        },
        maxResults: {
          type: "number",
          description: "Maximum results to return (default: 20)",
        },
      },
      required: ["query"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "filesystem_search",
    description: "Search file contents or names across workspace using grep/glob",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["search", "grep", "find", "glob", "filesystem", "code"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_fs_search");
    const query = String(args.query || "");
    const subPath = String(args.path || ".");
    const contentMatch = args.contentMatch !== false;
    const maxResults = typeof args.maxResults === "number" ? Math.min(50, Math.max(1, args.maxResults)) : 20;

    if (!query) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Missing required query argument",
      };
    }

    try {
      const searchRoot = resolveSafePath(context.workspaceDir, subPath, true);
      const results: string[] = [];
      const ignoredDirs = new Set(["node_modules", ".git", "dist", ".next", ".turbo", "build"]);

      async function scan(currentDir: string): Promise<void> {
        if (results.length >= maxResults) return;
        let entries: import("node:fs").Dirent[] = [];
        try {
          entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          const fullPath = path.join(currentDir, entry.name);
          const relPath = path.relative(context.workspaceDir, fullPath).replace(/\\/g, "/");

          if (entry.isDirectory()) {
            if (!ignoredDirs.has(entry.name)) {
              if (!contentMatch && entry.name.toLowerCase().includes(query.toLowerCase())) {
                results.push(`[DIR] ${relPath}`);
              }
              await scan(fullPath);
            }
          } else if (entry.isFile()) {
            if (!contentMatch) {
              if (entry.name.toLowerCase().includes(query.toLowerCase())) {
                results.push(`[FILE] ${relPath}`);
              }
            } else {
              try {
                const stat = await fs.stat(fullPath);
                // Skip binary or huge files (>1MB)
                if (stat.size < 1024 * 1024) {
                  const content = await fs.readFile(fullPath, "utf-8");
                  const lines = content.split("\n");
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                      results.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
                      if (results.length >= maxResults) break;
                    }
                  }
                }
              } catch {
                // Skip unreadable files
              }
            }
          }
        }
      }

      await scan(searchRoot);

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output:
          results.length > 0
            ? results.join("\n")
            : `No matches found for query '${query}' in ${subPath}.`,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class FilesystemStatTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "filesystem_stat",
    description: "Get metadata for a file or directory (size, modified time, isDirectory, isFile).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file or directory relative to workspace",
        },
      },
      required: ["path"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "filesystem_stat",
    description: "Inspect file/directory metadata, size, timestamps, and type",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["stat", "metadata", "size", "mtime", "file info"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_fs_stat");
    const target = String(args.path || "");

    try {
      const targetPath = resolveSafePath(context.workspaceDir, target, true);
      const stat = await fs.stat(targetPath);

      const info = {
        path: target,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        sizeBytes: stat.size,
        modifiedTime: stat.mtime.toISOString(),
        createdTime: stat.birthtime.toISOString(),
        mode: stat.mode.toString(8),
      };

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify(info, null, 2),
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class FilesystemCopyTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "filesystem_copy",
    description: "Copy a file or directory from source to destination within the workspace.",
    parameters: {
      type: "object",
      properties: {
        sourcePath: {
          type: "string",
          description: "Source relative path",
        },
        destinationPath: {
          type: "string",
          description: "Destination relative path",
        },
      },
      required: ["sourcePath", "destinationPath"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "filesystem_copy",
    description: "Copy file or directory within workspace",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: ["copy", "cp", "clone file", "filesystem"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_fs_copy");
    const src = String(args.sourcePath || "");
    const dest = String(args.destinationPath || "");

    try {
      const srcPath = resolveSafePath(context.workspaceDir, src, false);
      const destPath = resolveSafePath(context.workspaceDir, dest, false);

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.cp(srcPath, destPath, { recursive: true });

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: `Copied successfully from '${src}' to '${dest}'.`,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class FilesystemMoveTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "filesystem_move",
    description: "Move or rename a file or directory within the workspace.",
    parameters: {
      type: "object",
      properties: {
        sourcePath: {
          type: "string",
          description: "Source relative path",
        },
        destinationPath: {
          type: "string",
          description: "Destination relative path",
        },
      },
      required: ["sourcePath", "destinationPath"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "filesystem_move",
    description: "Move or rename file or directory within workspace",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: ["move", "mv", "rename", "filesystem"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_fs_move");
    const src = String(args.sourcePath || "");
    const dest = String(args.destinationPath || "");

    try {
      const srcPath = resolveSafePath(context.workspaceDir, src, false);
      const destPath = resolveSafePath(context.workspaceDir, dest, false);

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.rename(srcPath, destPath);

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: `Moved successfully from '${src}' to '${dest}'.`,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class FilesystemDeleteTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "filesystem_delete",
    description:
      "Delete a file or directory within the workspace. Target path cannot be the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file or directory to delete",
        },
        recursive: {
          type: "boolean",
          description: "Whether to recursively delete directories (default false)",
        },
      },
      required: ["path"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "filesystem_delete",
    description: "Delete file or directory within workspace (Destructive, protected)",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_4_DESTRUCTIVE",
    keywords: ["delete", "remove", "rm", "unlink", "filesystem"],
    requiresApproval: true,
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_fs_delete");
    const target = String(args.path || "").trim();
    const recursive = Boolean(args.recursive);

    try {
      const targetPath = resolveSafePath(context.workspaceDir, target, false);
      const stat = await fs.stat(targetPath);

      if (stat.isDirectory()) {
        await fs.rm(targetPath, { recursive, force: true });
      } else {
        await fs.unlink(targetPath);
      }

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: `Deleted '${target}' successfully.`,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
