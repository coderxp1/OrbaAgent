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

export type SupportedPackageManager = "pnpm" | "npm" | "yarn" | "pip" | "cargo";

export class PackageManagerTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "package_manager",
    description:
      "Manage packages and dependencies (search, info, install, remove) across detected package managers (pnpm, npm, yarn, pip, cargo). Inspects environment before execution.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "info", "install", "remove"],
          description: "Package manager action to perform.",
        },
        packageName: {
          type: "string",
          description: "Name of the package or library (e.g. 'zod', 'lodash', 'requests', 'pytest').",
        },
        packageManager: {
          type: "string",
          enum: ["pnpm", "npm", "yarn", "pip", "cargo", "auto"],
          description: "Target package manager (default 'auto' detects from workspace and environment).",
        },
        isDev: {
          type: "boolean",
          description: "Install as dev dependency (default false).",
        },
        extraArgs: {
          type: "string",
          description: "Extra arguments (e.g. '--save-exact'). Global install flags are blocked.",
        },
      },
      required: ["action", "packageName"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "package_manager",
    description: "Inspect and manage workspace dependencies safely",
    category: "package",
    provider: "native",
    riskTier: "TIER_3_EXTERNAL",
    requiresApproval: true,
    keywords: [
      "package",
      "npm",
      "pnpm",
      "pip",
      "yarn",
      "cargo",
      "install",
      "uninstall",
      "dependency",
      "search",
      "module",
    ],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  private async detectPackageManager(workspaceDir: string): Promise<SupportedPackageManager> {
    // 1. Inspect workspace files
    try {
      const files = await fs.readdir(workspaceDir);
      if (files.includes("pnpm-lock.yaml")) return "pnpm";
      if (files.includes("yarn.lock")) return "yarn";
      if (files.includes("package-lock.json")) return "npm";
      if (files.includes("requirements.txt") || files.includes("pyproject.toml")) return "pip";
      if (files.includes("Cargo.toml")) return "cargo";
    } catch {
      // Continue to binary checks
    }

    // 2. Check installed binaries
    const managers: SupportedPackageManager[] = ["pnpm", "npm", "pip", "yarn", "cargo"];
    for (const pm of managers) {
      try {
        await execAsync(`${pm} --version`, { timeout: 1000 });
        return pm;
      } catch {
        // Not installed
      }
    }

    return "npm"; // Default fallback
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_pkg_mgr");
    const action = String(args.action || "info").toLowerCase().trim();
    const pkg = String(args.packageName || "").trim();
    const isDev = Boolean(args.isDev);
    const extraArgs = String(args.extraArgs || "").trim();

    if (!pkg) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "packageName argument is required.",
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Security check: Block global installs
    if (extraArgs.includes("-g") || extraArgs.includes("--global")) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Global package installation ('-g' / '--global') is strictly prohibited.",
        executionTimeMs: Date.now() - startTime,
      };
    }

    let pm = (args.packageManager as SupportedPackageManager | "auto") || "auto";
    let targetPm: SupportedPackageManager;
    if (pm === "auto" || !pm) {
      targetPm = await this.detectPackageManager(context.workspaceDir);
    } else {
      targetPm = pm;
    }

    // Verify package manager binary actually exists
    try {
      await execAsync(`${targetPm} --version`, { timeout: 8000 });
    } catch {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: `Package manager '${targetPm}' is not available in the host environment. Run environment_inspect to see installed runtimes.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    let cmd = "";
    switch (action) {
      case "search": {
        if (targetPm === "npm" || targetPm === "pnpm") cmd = `${targetPm} search "${pkg}"`;
        else if (targetPm === "pip") cmd = `pip index versions "${pkg}"`;
        else if (targetPm === "cargo") cmd = `cargo search "${pkg}"`;
        else cmd = `${targetPm} search "${pkg}"`;
        break;
      }
      case "info": {
        if (targetPm === "npm" || targetPm === "pnpm") cmd = `${targetPm} info "${pkg}" name version description`;
        else if (targetPm === "pip") cmd = `pip show "${pkg}"`;
        else if (targetPm === "cargo") cmd = `cargo info "${pkg}"`;
        else cmd = `${targetPm} view "${pkg}"`;
        break;
      }
      case "install": {
        if (targetPm === "pnpm") cmd = `pnpm add ${isDev ? "-D " : ""}"${pkg}" ${extraArgs}`;
        else if (targetPm === "npm") cmd = `npm install ${isDev ? "--save-dev " : ""}"${pkg}" ${extraArgs}`;
        else if (targetPm === "yarn") cmd = `yarn add ${isDev ? "-D " : ""}"${pkg}" ${extraArgs}`;
        else if (targetPm === "pip") cmd = `pip install "${pkg}" ${extraArgs}`;
        else if (targetPm === "cargo") cmd = `cargo add "${pkg}" ${extraArgs}`;
        break;
      }
      case "remove": {
        if (targetPm === "pnpm") cmd = `pnpm remove "${pkg}" ${extraArgs}`;
        else if (targetPm === "npm") cmd = `npm uninstall "${pkg}" ${extraArgs}`;
        else if (targetPm === "yarn") cmd = `yarn remove "${pkg}" ${extraArgs}`;
        else if (targetPm === "pip") cmd = `pip uninstall -y "${pkg}" ${extraArgs}`;
        else if (targetPm === "cargo") cmd = `cargo remove "${pkg}" ${extraArgs}`;
        break;
      }
      default:
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Unsupported package action: '${action}'`,
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

      const rawOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
      const output = secretManager.redact(rawOutput || `Package action '${action}' completed successfully.`);

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output,
        metadata: { action, packageManager: pm, packageName: pkg, command: cmd },
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const rawOutput = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim();
      const rawMsg = execErr.message || String(err);

      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: secretManager.redact(rawOutput || `Package ${action} failed: ${rawMsg}`),
        error: secretManager.redact(rawMsg),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
