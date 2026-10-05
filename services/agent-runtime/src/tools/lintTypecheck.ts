import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

const execAsync = promisify(exec);

export interface CodeQualityDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
  rule?: string;
}

export interface CodeQualityReport {
  tool: string;
  command: string;
  success: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: CodeQualityDiagnostic[];
  rawOutput: string;
  durationMs: number;
}

export class CodeQualityTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "code_quality",
    description:
      "Run structured linting (ESLint, Biome, Ruff) or typechecking (TypeScript, Mypy) across the workspace. Detects installed linters/typecheckers before running.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["lint", "typecheck", "detect"],
          description: "Action to perform: 'detect' checks available linters/typecheckers; 'lint' checks code style and lint rules; 'typecheck' verifies type correctness.",
        },
        fix: {
          type: "boolean",
          description: "Automatically apply safe lint fixes (default false).",
        },
        filePath: {
          type: "string",
          description: "Optional specific file or folder path to target relative to workspace.",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "code_quality",
    description: "Execute static analysis, linting, and typechecking with structured diagnostics",
    category: "testing",
    provider: "native",
    riskTier: "TIER_2_EXEC",
    keywords: [
      "lint",
      "typecheck",
      "eslint",
      "biome",
      "typescript",
      "tsc",
      "ruff",
      "mypy",
      "code quality",
      "syntax",
    ],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  private async detectLinter(workspaceDir: string): Promise<string | null> {
    try {
      const files = await fs.readdir(workspaceDir);
      if (files.some((f) => f.startsWith("biome.json"))) return "biome";
      if (files.some((f) => f.startsWith("eslint.config") || f.startsWith(".eslintrc"))) return "eslint";
      if (files.some((f) => f === "ruff.toml" || f === ".ruff.toml")) return "ruff";

      // Check package.json scripts
      const pkgPath = path.join(workspaceDir, "package.json");
      const pkgContent = await fs.readFile(pkgPath, "utf-8").catch(() => "");
      if (pkgContent) {
        const pkg = JSON.parse(pkgContent);
        const scripts = pkg.scripts || {};
        if (scripts.lint?.includes("biome")) return "biome";
        if (scripts.lint?.includes("eslint")) return "eslint";
      }
    } catch {
      // Fallback
    }
    return null;
  }

  private async detectTypechecker(workspaceDir: string): Promise<string | null> {
    try {
      const files = await fs.readdir(workspaceDir);
      if (files.includes("tsconfig.json")) return "tsc";
      if (files.includes("mypy.ini") || files.includes(".mypy.ini")) return "mypy";

      const pkgPath = path.join(workspaceDir, "package.json");
      const pkgContent = await fs.readFile(pkgPath, "utf-8").catch(() => "");
      if (pkgContent) {
        const pkg = JSON.parse(pkgContent);
        if (pkg.scripts?.typecheck) return "tsc";
      }
    } catch {
      // Fallback
    }
    return null;
  }

  private parseDiagnostics(raw: string, tool: string): CodeQualityDiagnostic[] {
    const diagnostics: CodeQualityDiagnostic[] = [];
    const lines = raw.split("\n");

    for (const line of lines) {
      // TS error pattern: file.ts(10,5): error TS2304: Cannot find name 'foo'.
      const tsMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z0-9]+):\s+(.+)$/);
      if (tsMatch) {
        diagnostics.push({
          file: tsMatch[1].trim(),
          line: Number(tsMatch[2]),
          column: Number(tsMatch[3]),
          severity: tsMatch[4] === "error" ? "error" : "warning",
          rule: tsMatch[5],
          message: tsMatch[6].trim(),
        });
        continue;
      }

      // Generic error pattern
      if (line.includes("error") || line.includes("Error:") || line.includes("FAILED")) {
        diagnostics.push({
          severity: "error",
          message: line.trim(),
        });
      } else if (line.includes("warning") || line.includes("WARN")) {
        diagnostics.push({
          severity: "warning",
          message: line.trim(),
        });
      }

      if (diagnostics.length >= 30) break;
    }

    return diagnostics;
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_code_quality");
    const action = String(args.action || "lint").toLowerCase().trim();
    const fix = Boolean(args.fix);
    const targetPath = args.filePath ? String(args.filePath).trim() : "";

    let toolName = "";
    let cmd = "";

    if (action === "detect") {
      const linter = await this.detectLinter(context.workspaceDir);
      const typechecker = await this.detectTypechecker(context.workspaceDir);
      const info = {
        linters: linter ? [linter] : [],
        typecheckers: typechecker ? [typechecker] : [],
      };
      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify(info, null, 2),
        metadata: info,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const hasPnpmLock = await fs.access(path.join(context.workspaceDir, "pnpm-lock.yaml")).then(() => true).catch(() => false);
    const runnerPrefix = hasPnpmLock ? "pnpm exec" : "npx";

    if (action === "lint") {
      const detected = await this.detectLinter(context.workspaceDir);
      toolName = detected || "biome"; // Fallback to workspace linter

      if (toolName === "biome") {
        cmd = `${runnerPrefix} biome check ${fix ? "--write " : ""}${targetPath || "."}`;
      } else if (toolName === "eslint") {
        cmd = `${runnerPrefix} eslint ${fix ? "--fix " : ""}${targetPath || "."}`;
      } else if (toolName === "ruff") {
        cmd = `ruff check ${fix ? "--fix " : ""}${targetPath || "."}`;
      } else {
        cmd = `npm run lint`;
      }
    } else if (action === "typecheck") {
      const detected = await this.detectTypechecker(context.workspaceDir);
      toolName = detected || "tsc";

      if (toolName === "tsc") {
        cmd = `${runnerPrefix} tsc --noEmit`;
      } else if (toolName === "mypy") {
        cmd = `mypy ${targetPath || "."}`;
      } else {
        cmd = `npm run typecheck`;
      }
    } else {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: `Unsupported code quality action: '${action}'`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const secretManager = SecretManager.getInstance();
    const safeEnv = secretManager.sanitizeChildEnv(process.env, context.env);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: context.workspaceDir,
        env: safeEnv,
        timeout: 60000,
      });

      const raw = [stdout, stderr].filter(Boolean).join("\n").trim();
      const diagnostics = this.parseDiagnostics(raw, toolName);
      const report: CodeQualityReport = {
        tool: toolName,
        command: cmd,
        success: true,
        errorCount: diagnostics.filter((d) => d.severity === "error").length,
        warningCount: diagnostics.filter((d) => d.severity === "warning").length,
        diagnostics,
        rawOutput: secretManager.redact(raw || "All checks passed cleanly with no issues."),
        durationMs: Date.now() - startTime,
      };

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify(report, null, 2),
        metadata: report as unknown as Record<string, unknown>,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      const raw = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim() || execErr.message || String(err);
      const diagnostics = this.parseDiagnostics(raw, toolName);
      const report: CodeQualityReport = {
        tool: toolName,
        command: cmd,
        success: false,
        errorCount: Math.max(1, diagnostics.filter((d) => d.severity === "error").length),
        warningCount: diagnostics.filter((d) => d.severity === "warning").length,
        diagnostics,
        rawOutput: secretManager.redact(raw),
        durationMs: Date.now() - startTime,
      };

      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: JSON.stringify(report, null, 2),
        error: `Quality check '${action}' failed with issues found.`,
        metadata: report as unknown as Record<string, unknown>,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
