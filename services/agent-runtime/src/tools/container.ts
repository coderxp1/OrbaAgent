import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

const execAsync = promisify(exec);

export interface ContainerInfo {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
}

export class ContainerTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "container_action",
    description:
      "Manage containers and Docker Compose (list, inspect, build, run, logs, exec, stop, compose_up, compose_down). Enforces strict workspace filesystem and sandbox boundaries.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "inspect",
            "build",
            "run",
            "logs",
            "exec",
            "stop",
            "compose_up",
            "compose_down",
          ],
          description: "Container management action to perform.",
        },
        containerId: {
          type: "string",
          description: "Target container ID or name (for inspect, logs, exec, stop).",
        },
        imageName: {
          type: "string",
          description: "Docker image tag or name (for build, run).",
        },
        dockerfilePath: {
          type: "string",
          description: "Relative path to Dockerfile within workspace (default 'Dockerfile').",
        },
        command: {
          type: "string",
          description: "Command to execute inside container (for exec, or container CMD for run).",
        },
        composeFile: {
          type: "string",
          description: "Relative path to docker-compose file (default 'docker-compose.yml').",
        },
        ports: {
          type: "array",
          items: { type: "string" },
          description: "Port mappings (e.g. ['3000:3000']).",
        },
        env: {
          type: "object",
          description: "Environment variables to pass into container.",
        },
        volumes: {
          type: "array",
          items: { type: "string" },
          description: "Volume mount mappings (must strictly map paths inside workspace).",
        },
        extraArgs: {
          type: "string",
          description: "Additional docker CLI flags (restricted by security policy).",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "container_action",
    description: "Manage containers and Docker workloads with strict workspace boundaries",
    category: "docker",
    provider: "native",
    riskTier: "TIER_2_EXEC",
    keywords: [
      "docker",
      "container",
      "compose",
      "build",
      "run",
      "image",
      "exec",
      "logs",
      "isolate",
      "sandbox",
    ],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  public validateVolumeMounts(volumes: string[], workspaceDir: string): void {
    const resolvedWorkspace = path.resolve(workspaceDir);

    for (const v of volumes) {
      let hostPath = "";
      const winMatch = v.match(/^([a-zA-Z]:[^:]+):(.*)$/);
      if (winMatch) {
        hostPath = winMatch[1].trim();
      } else {
        const parts = v.split(":");
        hostPath = parts[0]?.trim() || "";
      }
      if (!hostPath) continue;

      if (/^[a-zA-Z]:/.test(hostPath) && process.platform !== "win32") {
        throw new Error(
          `Security violation: Container volume '${hostPath}' resolves outside workspace boundary '${workspaceDir}'.`,
        );
      }

      const resolvedHostPath = path.resolve(workspaceDir, hostPath);
      if (resolvedHostPath !== resolvedWorkspace) {
        const rel = path.relative(resolvedWorkspace, resolvedHostPath);
        if (
          rel === "" ||
          rel === ".." ||
          rel.startsWith(`..${path.sep}`) ||
          rel.startsWith("../") ||
          rel.startsWith("..\\") ||
          path.isAbsolute(rel)
        ) {
          throw new Error(
            `Security violation: Container volume '${hostPath}' resolves outside workspace boundary '${workspaceDir}'.`,
          );
        }
      }
    }
  }

  public validateSecurityFlags(extraArgs: string): void {
    const blockedPatterns = [
      /--privileged/i,
      /--pid\s*=\s*host/i,
      /--ipc\s*=\s*host/i,
      /--net\s*=\s*host/i,
      /--network\s*=\s*host/i,
      /-v\s+\/:\//i,
      /-v\s+[A-Za-z]:\\/i,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(extraArgs)) {
        throw new Error(
          `Security violation: Dangerous container flag '${extraArgs}' is blocked by sandbox policy.`,
        );
      }
    }
  }

  public async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || `tc_docker_${Date.now()}`);
    const action = String(args.action || "list");
    const containerId = args.containerId ? String(args.containerId).trim() : "";
    const imageName = args.imageName ? String(args.imageName).trim() : "";
    const dockerfilePath = args.dockerfilePath ? String(args.dockerfilePath).trim() : "Dockerfile";
    const composeFile = args.composeFile ? String(args.composeFile).trim() : "docker-compose.yml";
    const command = args.command ? String(args.command).trim() : "";
    const extraArgs = args.extraArgs ? String(args.extraArgs).trim() : "";
    const volumes = Array.isArray(args.volumes) ? (args.volumes as string[]) : [];

    const secretManager = SecretManager.getInstance();

    // 1. Security policy validation
    try {
      if (volumes.length > 0) {
        this.validateVolumeMounts(volumes, context.workspaceDir);
      }
      if (extraArgs) {
        this.validateSecurityFlags(extraArgs);
      }
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

    // 2. Build shell command
    let cmd = "";
    switch (action) {
      case "list": {
        cmd = `docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}"`;
        break;
      }
      case "inspect": {
        if (!containerId) throw new Error("containerId is required for 'inspect'.");
        cmd = `docker inspect ${containerId}`;
        break;
      }
      case "build": {
        const fullDockerfilePath = path.resolve(context.workspaceDir, dockerfilePath);
        if (!fullDockerfilePath.startsWith(path.resolve(context.workspaceDir))) {
          throw new Error(`Dockerfile '${dockerfilePath}' resolves outside workspace boundary.`);
        }
        const tagFlag = imageName ? `-t ${imageName}` : "";
        cmd =
          `docker build -f "${fullDockerfilePath}" ${tagFlag} "${context.workspaceDir}" ${extraArgs}`.trim();
        break;
      }
      case "run": {
        if (!imageName) throw new Error("imageName is required for 'run'.");
        const portFlags = Array.isArray(args.ports)
          ? (args.ports as string[]).map((p) => `-p ${p}`).join(" ")
          : "";
        const volFlags = volumes.map((v) => `-v "${v}"`).join(" ");
        cmd = `docker run -d ${portFlags} ${volFlags} ${extraArgs} ${imageName} ${command}`.trim();
        break;
      }
      case "logs": {
        if (!containerId) throw new Error("containerId is required for 'logs'.");
        cmd = `docker logs --tail 200 ${containerId}`;
        break;
      }
      case "exec": {
        if (!containerId || !command)
          throw new Error("containerId and command are required for 'exec'.");
        cmd = `docker exec ${containerId} ${command}`;
        break;
      }
      case "stop": {
        if (!containerId) throw new Error("containerId is required for 'stop'.");
        cmd = `docker stop ${containerId}`;
        break;
      }
      case "compose_up": {
        const fullComposePath = path.resolve(context.workspaceDir, composeFile);
        if (!fullComposePath.startsWith(path.resolve(context.workspaceDir))) {
          throw new Error(`Compose file '${composeFile}' resolves outside workspace boundary.`);
        }
        cmd = `docker compose -f "${fullComposePath}" up -d ${extraArgs}`.trim();
        break;
      }
      case "compose_down": {
        const fullComposePath = path.resolve(context.workspaceDir, composeFile);
        if (!fullComposePath.startsWith(path.resolve(context.workspaceDir))) {
          throw new Error(`Compose file '${composeFile}' resolves outside workspace boundary.`);
        }
        cmd = `docker compose -f "${fullComposePath}" down ${extraArgs}`.trim();
        break;
      }
      default:
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Unsupported container action: '${action}'.`,
          executionTimeMs: Date.now() - startTime,
        };
    }

    const safeEnv = secretManager.sanitizeChildEnv(process.env, context.env);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: context.workspaceDir,
        env: safeEnv,
        timeout: 120000,
      });

      const raw = [stdout, stderr].filter(Boolean).join("\n").trim();
      const output = secretManager.redact(raw || `Action '${action}' completed successfully.`);

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output,
        metadata: { action, command: cmd },
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const rawMsg =
        [execErr.stderr, execErr.stdout].filter(Boolean).join("\n").trim() ||
        execErr.message ||
        String(err);
      const isDaemonDown =
        rawMsg.toLowerCase().includes("docker daemon is not running") ||
        rawMsg.toLowerCase().includes("cannot connect to the docker daemon") ||
        rawMsg.toLowerCase().includes("error response from daemon") ||
        rawMsg.toLowerCase().includes("is not recognized") ||
        rawMsg.toLowerCase().includes("command not found");

      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: isDaemonDown
          ? `Docker service is currently unavailable: ${rawMsg}. Ensure Docker daemon is running.`
          : `Docker command failed: ${rawMsg}`,
        metadata: { action, isDaemonDown },
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
