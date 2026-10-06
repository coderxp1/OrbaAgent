import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

const execAsync = promisify(exec);

export class ShellTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "execute_shell",
    description:
      "Execute a shell command inside the isolated agent workspace. Returns stdout, stderr, and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (e.g., 'pwd', 'ls -la', 'pnpm test').",
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout limit in milliseconds (default 30000ms).",
        },
      },
      required: ["command"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "execute_shell",
    description: "Execute a shell command inside the workspace",
    category: "process",
    provider: "native",
    riskTier: "TIER_2_EXEC",
    keywords: ["shell", "bash", "terminal", "command", "exec", "sh", "cli", "run"],
    parameters: this.definition.parameters,
    version: "2.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_shell_${Date.now()}`;
    const command = String(args.command || "").trim();
    const timeout = Number(args.timeoutMs) || 30000;
    const secretManager = SecretManager.getInstance();

    if (!command) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Command parameter cannot be empty",
        executionTimeMs: Date.now() - startTime,
      };
    }

    const safeEnv = secretManager.sanitizeChildEnv(process.env, context.env);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workspaceDir,
        timeout,
        env: safeEnv,
        maxBuffer: 10 * 1024 * 1024, // 10MB stdout buffer limit
      });

      const rawOutput =
        [stdout, stderr].filter(Boolean).join("\n").trim() ||
        "(command returned 0 exit code with no output)";

      const output = secretManager.redact(rawOutput);

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output,
        executionTimeMs: Date.now() - startTime,
        metadata: { command, exitCode: 0 },
      };
    } catch (err: unknown) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      const rawOutput = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim();
      const rawErrMsg = execErr.message || String(err);

      const output = secretManager.redact(rawOutput || `Command execution failed: ${rawErrMsg}`);
      const errMsg = secretManager.redact(rawErrMsg);

      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output,
        error: errMsg,
        executionTimeMs: Date.now() - startTime,
        metadata: { command, exitCode: execErr.code ?? 1 },
      };
    }
  }
}
