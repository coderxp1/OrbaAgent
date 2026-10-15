import { exec } from "node:child_process";
import os from "node:os";
import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";

async function getCliVersionAsync(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      exec(cmd, { timeout: 500 }, (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
        } else {
          resolve(stdout.trim().split("\n")[0].trim() || null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

export class EnvironmentInspectTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "environment_inspect",
    description:
      "Inspect the host execution environment, including operating system, CPU, memory, Node.js, package managers (npm, pnpm, yarn), Python, compilers, and CLI tools. Returns truthful, real host facts.",
    parameters: {
      type: "object",
      properties: {
        verbose: {
          type: "boolean",
          description: "Include extended toolchain and compiler checks (default false)",
        },
      },
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "environment_inspect",
    description: "Inspect the host execution environment and installed runtimes",
    category: "system",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["environment", "inspect", "system", "os", "ram", "cpu", "node", "python", "git"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: true,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const toolCallId = String(args._toolCallId || "call_env_inspect");
    const verbose = Boolean(args.verbose);

    const totalRamGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeRamGb = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : "Unknown CPU";

    // Run version queries concurrently in parallel
    const checks: Record<string, Promise<string | null>> = {
      npm: getCliVersionAsync("npm --version"),
      pnpm: getCliVersionAsync("pnpm --version"),
      yarn: getCliVersionAsync("yarn --version"),
      git: getCliVersionAsync("git --version"),
      python: getCliVersionAsync("python --version").then(
        (v) => v || getCliVersionAsync("python3 --version"),
      ),
      pip: getCliVersionAsync("pip --version").then(
        (v) => v || getCliVersionAsync("pip3 --version"),
      ),
    };

    if (verbose) {
      checks.docker = getCliVersionAsync("docker --version");
      checks.gcc = getCliVersionAsync("gcc --version");
      checks.clang = getCliVersionAsync("clang --version");
      checks.rustc = getCliVersionAsync("rustc --version");
      checks.go = getCliVersionAsync("go version");
    }

    const checkKeys = Object.keys(checks);
    const checkResults = await Promise.all(Object.values(checks));

    const runtimes: Record<string, string | null> = {
      node: process.version,
    };
    for (let i = 0; i < checkKeys.length; i++) {
      runtimes[checkKeys[i]] = checkResults[i];
    }

    const envInfo = {
      os: {
        platform: os.platform(),
        type: os.type(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptimeSeconds: Math.floor(os.uptime()),
      },
      hardware: {
        cpuCount: cpus.length,
        cpuModel,
        totalRamGb: `${totalRamGb} GB`,
        freeRamGb: `${freeRamGb} GB`,
      },
      workspace: {
        workspaceDir: context.workspaceDir,
      },
      runtimes,
    };

    return {
      toolCallId,
      name: this.definition.name,
      success: true,
      output: JSON.stringify(envInfo, null, 2),
      metadata: envInfo,
    };
  }
}
