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

export type SupportedTestFramework = "vitest" | "jest" | "pytest" | "playwright" | "custom";

export interface StructuredTestReport {
  framework: SupportedTestFramework;
  command: string;
  files: string[];
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  exitCode: number;
  failureSummary: string[];
  rawOutput: string;
}

export class TestRunnerTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "test_runner",
    description:
      "Structured test discovery and execution across detected frameworks (Vitest, Jest, Pytest, Playwright). Returns structured test metrics, pass/fail counts, and failure diagnostics.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["discover", "run", "run_file", "run_failed"],
          description: "Action: 'discover' finds test files, 'run' executes full suite, 'run_file' runs single file, 'run_failed' re-runs failures.",
        },
        file: {
          type: "string",
          description: "Specific test file path relative to workspace (for 'run_file').",
        },
        testNamePattern: {
          type: "string",
          description: "Pattern or title of specific test to filter (e.g. '-t \"my test\"').",
        },
        extraArgs: {
          type: "string",
          description: "Additional arguments to pass to test runner.",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "test_runner",
    description: "Discover and run tests with structured pass/fail analysis",
    category: "testing",
    provider: "native",
    riskTier: "TIER_2_EXEC",
    keywords: ["test", "runner", "vitest", "jest", "pytest", "playwright", "assert", "unit", "spec"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  private async detectFramework(workspaceDir: string): Promise<SupportedTestFramework> {
    try {
      const files = await fs.readdir(workspaceDir);
      if (files.some((f) => f.startsWith("vitest.config"))) return "vitest";
      if (files.some((f) => f.startsWith("jest.config"))) return "jest";
      if (files.some((f) => f === "pytest.ini" || f === "conftest.py")) return "pytest";
      if (files.some((f) => f.startsWith("playwright.config"))) return "playwright";

      // Check package.json scripts
      const pkgPath = path.join(workspaceDir, "package.json");
      const pkgContent = await fs.readFile(pkgPath, "utf-8").catch(() => "");
      if (pkgContent) {
        const pkg = JSON.parse(pkgContent);
        const scripts = pkg.scripts || {};
        if (scripts.test?.includes("vitest")) return "vitest";
        if (scripts.test?.includes("jest")) return "jest";
        if (scripts.test?.includes("playwright")) return "playwright";
      }
    } catch {
      // Fallback
    }

    return "vitest";
  }

  private async discoverTestFiles(workspaceDir: string): Promise<string[]> {
    const testFiles: string[] = [];
    const ignored = new Set(["node_modules", ".git", "dist", ".next", "build"]);

    async function walk(dir: string): Promise<void> {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = path.relative(workspaceDir, full).replace(/\\/g, "/");
        if (e.isDirectory() && !ignored.has(e.name)) {
          await walk(full);
        } else if (e.isFile()) {
          if (
            e.name.endsWith(".test.ts") ||
            e.name.endsWith(".test.js") ||
            e.name.endsWith(".spec.ts") ||
            e.name.endsWith(".spec.js") ||
            e.name.startsWith("test_") && e.name.endsWith(".py") ||
            e.name.endsWith("_test.py")
          ) {
            testFiles.push(rel);
          }
        }
      }
    }

    await walk(workspaceDir);
    return testFiles;
  }

  private parseTestOutput(
    rawOutput: string,
    framework: SupportedTestFramework,
    command: string,
    files: string[],
    durationMs: number,
    exitCode: number,
  ): StructuredTestReport {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failureSummary: string[] = [];

    const lines = rawOutput.split("\n");
    for (const line of lines) {
      // Extract passed / failed counts
      const passedMatch = line.match(/(\d+)\s+passed/i);
      if (passedMatch) passed = Number(passedMatch[1]);

      const failedMatch = line.match(/(\d+)\s+failed/i);
      if (failedMatch) failed = Number(failedMatch[1]);

      const skippedMatch = line.match(/(\d+)\s+skipped/i);
      if (skippedMatch) skipped = Number(skippedMatch[1]);

      // Capture failure lines
      if (line.includes("FAIL") || line.includes("AssertionError") || line.includes("Error:") || line.includes("Expected")) {
        failureSummary.push(line.trim());
        if (failureSummary.length > 20) break;
      }
    }

    if (exitCode !== 0 && failed === 0) {
      failed = 1;
    }

    return {
      framework,
      command,
      files,
      passed,
      failed,
      skipped,
      durationMs,
      exitCode,
      failureSummary,
      rawOutput,
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_test_run");
    const action = String(args.action || "run").toLowerCase().trim();
    const testFile = args.file ? String(args.file).trim() : undefined;
    const pattern = args.testNamePattern ? String(args.testNamePattern).trim() : "";
    const extraArgs = String(args.extraArgs || "").trim();

    // Verify file boundary
    if (testFile) {
      const resolved = path.resolve(context.workspaceDir, testFile);
      if (!resolved.startsWith(path.resolve(context.workspaceDir))) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Test file '${testFile}' resolves outside workspace boundary.`,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    const framework = await this.detectFramework(context.workspaceDir);

    if (action === "discover") {
      const files = await this.discoverTestFiles(context.workspaceDir);
      const data = { framework, testFiles: files, count: files.length };
      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify(data, null, 2),
        metadata: data,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const hasPnpmLock = await fs.access(path.join(context.workspaceDir, "pnpm-lock.yaml")).then(() => true).catch(() => false);
    const runnerPrefix = hasPnpmLock ? "pnpm exec" : "npx";

    let cmd = "";
    switch (framework) {
      case "vitest": {
        const fileTarget = testFile ? ` "${testFile}"` : "";
        const pat = pattern ? ` -t "${pattern}"` : "";
        cmd = `${runnerPrefix} vitest run${fileTarget}${pat} ${extraArgs}`.trim();
        break;
      }
      case "jest": {
        const fileTarget = testFile ? ` "${testFile}"` : "";
        const pat = pattern ? ` -t "${pattern}"` : "";
        cmd = `${runnerPrefix} jest${fileTarget}${pat} ${extraArgs}`.trim();
        break;
      }
      case "pytest": {
        const fileTarget = testFile ? ` "${testFile}"` : "";
        const pat = pattern ? ` -k "${pattern}"` : "";
        cmd = `pytest${fileTarget}${pat} ${extraArgs}`.trim();
        break;
      }
      case "playwright": {
        const fileTarget = testFile ? ` "${testFile}"` : "";
        cmd = `npx playwright test${fileTarget} ${extraArgs}`.trim();
        break;
      }
      default:
        cmd = `npm test -- ${testFile || ""} ${extraArgs}`.trim();
        break;
    }

    const secretManager = SecretManager.getInstance();
    const safeEnv = secretManager.sanitizeChildEnv(process.env, context.env);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: context.workspaceDir,
        env: safeEnv,
        timeout: 90000,
      });

      const raw = [stdout, stderr].filter(Boolean).join("\n").trim();
      const files = testFile ? [testFile] : await this.discoverTestFiles(context.workspaceDir);
      const report = this.parseTestOutput(raw, framework, cmd, files, Date.now() - startTime, 0);

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
      const files = testFile ? [testFile] : await this.discoverTestFiles(context.workspaceDir);
      const report = this.parseTestOutput(raw, framework, cmd, files, Date.now() - startTime, execErr.code ?? 1);

      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: JSON.stringify(report, null, 2),
        error: `Tests failed with exit code ${execErr.code ?? 1}.`,
        metadata: report as unknown as Record<string, unknown>,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
