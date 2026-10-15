import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { ChangeReviewManager } from "../changes.js";
import type { ITool, ToolExecutionContext } from "./base.js";

function resolveSafePath(workspaceDir: string, relativePath: string): string {
  const normalized = path.normalize(relativePath || ".").replace(/^(\.\.(\/|\\))+/, "");
  const absolute = path.resolve(workspaceDir, normalized);
  if (!absolute.startsWith(path.resolve(workspaceDir))) {
    throw new Error(`Path traversal denied: '${relativePath}' is outside workspace scope.`);
  }
  return absolute;
}

export class ListFilesTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "list_files",
    description: "List contents of a directory in the workspace.",
    parameters: {
      type: "object",
      properties: {
        dirPath: {
          type: "string",
          description: "Relative path to directory (default '.').",
        },
      },
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "list_files",
    description: "List directory contents in the workspace",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["list", "files", "directory", "ls", "dir", "browse"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_ls_${Date.now()}`;
    const dirPath = String(args.dirPath || ".");

    try {
      const targetDir = resolveSafePath(context.workspaceDir, dirPath);
      const entries = await fs.readdir(targetDir, { withFileTypes: true });

      const fileList = entries
        .map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`)
        .join("\n");

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: fileList || "(directory is empty)",
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: msg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class ReadFileTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "read_file",
    description: "Read the full contents of a file in the workspace.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Relative path to file in workspace.",
        },
      },
      required: ["filePath"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "read_file",
    description: "Read full contents of a file in the workspace",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["read", "file", "view", "cat", "open", "inspect"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_read_${Date.now()}`;
    const filePath = String(args.filePath || args.path || "");

    try {
      const targetPath = resolveSafePath(context.workspaceDir, filePath);
      const content = await fs.readFile(targetPath, "utf-8");

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: content,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: msg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class WriteFileTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "write_file",
    description:
      "Write content to a file in the workspace (creates file and parent directories if needed).",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Relative path to file.",
        },
        content: {
          type: "string",
          description: "File text content to write.",
        },
      },
      required: ["filePath", "content"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "write_file",
    description: "Create or overwrite file in the workspace",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: ["write", "file", "create", "save", "overwrite"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_write_${Date.now()}`;
    const filePath = String(args.filePath || args.path || "");
    const content = String(args.content ?? "");

    try {
      const targetPath = resolveSafePath(context.workspaceDir, filePath);
      await ChangeReviewManager.getInstance().recordPreModification(
        context.agentRunId,
        context.workspaceDir,
        filePath,
      );
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf-8");

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: `Successfully wrote ${content.length} characters to '${filePath}'.`,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: msg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class EditFileTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "edit_file",
    description: "Replace exact content snippet in a file with new content.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Relative path to file.",
        },
        targetContent: {
          type: "string",
          description: "Exact text string to be replaced.",
        },
        replacementContent: {
          type: "string",
          description: "New content to replace target text.",
        },
      },
      required: ["filePath", "targetContent", "replacementContent"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "edit_file",
    description: "Replace exact content snippet in a file with new content",
    category: "filesystem",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: ["edit", "replace", "patch", "modify", "update"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_edit_${Date.now()}`;
    const filePath = String(args.filePath || args.path || "");
    const targetContent = String(args.targetContent || "");
    const replacementContent = String(args.replacementContent || "");

    try {
      const targetPath = resolveSafePath(context.workspaceDir, filePath);
      const original = await fs.readFile(targetPath, "utf-8");

      if (!original.includes(targetContent)) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Target content snippet not found in '${filePath}'.`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      await ChangeReviewManager.getInstance().recordPreModification(
        context.agentRunId,
        context.workspaceDir,
        filePath,
      );
      const updated = original.replace(targetContent, replacementContent);
      await fs.writeFile(targetPath, updated, "utf-8");

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: `Successfully replaced content in '${filePath}'.`,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: msg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
