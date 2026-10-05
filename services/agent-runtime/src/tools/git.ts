import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";

const execAsync = promisify(exec);

export class GitTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "execute_git",
    description:
      "Execute Git operations (clone, status, diff, log, branch, checkout, add, commit, push, pull, fetch, switch, merge, rebase, tag, blame, worktree) inside workspace.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "clone",
            "status",
            "diff",
            "log",
            "branch",
            "checkout",
            "add",
            "commit",
            "push",
            "pull",
            "fetch",
            "switch",
            "merge",
            "rebase",
            "tag",
            "blame",
            "worktree",
          ],
          description: "Git subcommand action to perform.",
        },
        repoUrl: {
          type: "string",
          description: "Repository HTTPS URL (required for 'clone').",
        },
        targetDir: {
          type: "string",
          description: "Target destination folder for clone.",
        },
        branchName: {
          type: "string",
          description: "Branch name (for checkout, branch, switch, push, pull, merge, rebase).",
        },
        commitMessage: {
          type: "string",
          description: "Commit log message (required for 'commit').",
        },
        filePath: {
          type: "string",
          description: "File path or pattern (for 'add', 'diff', 'blame'). Default '.'.",
        },
        extraArgs: {
          type: "string",
          description: "Additional safe git arguments (e.g. '--oneline', '-n 5', '--tags'). Force push flags are blocked.",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "execute_git",
    description: "Full local and remote Git version control operations",
    category: "git",
    provider: "native",
    riskTier: "TIER_1_WRITE",
    keywords: [
      "git",
      "clone",
      "commit",
      "push",
      "pull",
      "branch",
      "merge",
      "rebase",
      "fetch",
      "diff",
      "log",
      "switch",
      "blame",
      "worktree",
    ],
    parameters: this.definition.parameters,
    version: "2.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_git_${Date.now()}`;
    const action = String(args.action || "").toLowerCase().trim();
    const extraArgs = String(args.extraArgs || "").trim();

    // Prevent unverified force pushes
    if (
      extraArgs.includes("--force") ||
      extraArgs.includes("-f") ||
      extraArgs.includes("--force-with-lease")
    ) {
      if (!context.isPreApproved) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: "Unverified force push ('--force' or '--force-with-lease') is strictly prohibited.",
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    let gitCmd = "";
    switch (action) {
      case "clone": {
        const repoUrl = String(args.repoUrl || "").trim();
        if (!repoUrl) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "repoUrl is required for git clone",
            executionTimeMs: Date.now() - startTime,
          };
        }
        const targetDir = args.targetDir ? ` "${args.targetDir}"` : "";
        gitCmd = `git clone "${repoUrl}"${targetDir}`;
        break;
      }
      case "status":
        gitCmd = "git status";
        break;
      case "diff": {
        const filePath = args.filePath ? ` "${args.filePath}"` : "";
        gitCmd = `git diff ${extraArgs}${filePath}`.trim();
        break;
      }
      case "log":
        gitCmd = `git log ${extraArgs || "-n 10 --oneline"}`.trim();
        break;
      case "branch": {
        const branchName = args.branchName ? ` "${args.branchName}"` : "";
        gitCmd = `git branch ${extraArgs}${branchName}`.trim();
        break;
      }
      case "checkout": {
        const branchName = String(args.branchName || "").trim();
        if (!branchName) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "branchName is required for git checkout",
            executionTimeMs: Date.now() - startTime,
          };
        }
        gitCmd = `git checkout "${branchName}"`;
        break;
      }
      case "switch": {
        const branchName = String(args.branchName || "").trim();
        if (!branchName) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "branchName is required for git switch",
            executionTimeMs: Date.now() - startTime,
          };
        }
        gitCmd = `git switch "${branchName}"`;
        break;
      }
      case "add": {
        const filePath = String(args.filePath || ".").trim();
        gitCmd = filePath === "." || filePath === "-A" || !filePath ? "git add -A" : `git add "${filePath}"`;
        break;
      }
      case "commit": {
        const msg = String(args.commitMessage || "").trim();
        if (!msg) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "commitMessage is required for git commit",
            executionTimeMs: Date.now() - startTime,
          };
        }
        gitCmd = `git commit -m "${msg.replace(/"/g, '\\"')}"`;
        break;
      }
      case "push": {
        const branchName = args.branchName ? ` origin "${args.branchName}"` : "";
        gitCmd = `git push${branchName} ${extraArgs}`.trim();
        break;
      }
      case "pull": {
        const branchName = args.branchName ? ` origin "${args.branchName}"` : "";
        gitCmd = `git pull${branchName} ${extraArgs}`.trim();
        break;
      }
      case "fetch":
        gitCmd = `git fetch ${extraArgs}`.trim();
        break;
      case "merge": {
        const branchName = String(args.branchName || "").trim();
        if (!branchName) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "branchName is required for git merge",
            executionTimeMs: Date.now() - startTime,
          };
        }
        gitCmd = `git merge "${branchName}" ${extraArgs}`.trim();
        break;
      }
      case "rebase": {
        const branchName = String(args.branchName || "").trim();
        if (!branchName) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "branchName is required for git rebase",
            executionTimeMs: Date.now() - startTime,
          };
        }
        gitCmd = `git rebase "${branchName}" ${extraArgs}`.trim();
        break;
      }
      case "tag": {
        const tagName = args.branchName ? ` "${args.branchName}"` : "";
        gitCmd = `git tag ${extraArgs}${tagName}`.trim();
        break;
      }
      case "blame": {
        const filePath = String(args.filePath || "").trim();
        if (!filePath) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "filePath is required for git blame",
            executionTimeMs: Date.now() - startTime,
          };
        }
        gitCmd = `git blame "${filePath}" ${extraArgs}`.trim();
        break;
      }
      case "worktree":
        gitCmd = `git worktree ${extraArgs || "list"}`.trim();
        break;
      default:
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Unsupported git action: '${action}'`,
          executionTimeMs: Date.now() - startTime,
        };
    }

    try {
      const { stdout, stderr } = await execAsync(gitCmd, {
        cwd: context.workspaceDir,
        env: {
          ...process.env,
          ...context.env,
          GIT_AUTHOR_NAME: "OrbaAgent Workbot",
          GIT_AUTHOR_EMAIL: "bot@orbaagent.dev",
          GIT_COMMITTER_NAME: "OrbaAgent Workbot",
          GIT_COMMITTER_EMAIL: "bot@orbaagent.dev",
        },
      });

      const output =
        [stdout, stderr].filter(Boolean).join("\n").trim() ||
        `Git ${action} completed successfully.`;

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output,
        executionTimeMs: Date.now() - startTime,
        metadata: { action, command: gitCmd },
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim();
      const msg = execErr.message || String(err);

      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: output || `Git ${action} failed: ${msg}`,
        error: msg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
