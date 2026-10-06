import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

export interface ManagedProcessRecord {
  id: string;
  pid?: number;
  command: string;
  args: string[];
  status: "running" | "completed" | "failed" | "killed";
  startTime: number;
  endTime?: number;
  exitCode?: number | null;
  logs: string[];
  childProcess?: ChildProcess;
}

export class ProcessManager {
  private static instance: ProcessManager;
  private readonly processes: Map<string, ManagedProcessRecord> = new Map();
  private readonly pidToProcessId: Map<number, string> = new Map();

  public static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  public getManagedPids(): Set<number> {
    return new Set(this.pidToProcessId.keys());
  }

  public isManagedPid(pid: number): boolean {
    return this.pidToProcessId.has(pid);
  }

  public startProcess(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
      isDaemon?: boolean;
    },
  ): ManagedProcessRecord {
    const id = `p_${randomUUID().slice(0, 8)}`;
    const secretManager = SecretManager.getInstance();
    const safeEnv = secretManager.sanitizeChildEnv(process.env, options.env);

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: safeEnv,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const record: ManagedProcessRecord = {
      id,
      pid: child.pid,
      command,
      args,
      status: "running",
      startTime: Date.now(),
      logs: [],
      childProcess: child,
    };

    if (child.pid) {
      this.pidToProcessId.set(child.pid, id);
    }
    this.processes.set(id, record);

    child.stdout?.on("data", (chunk: Buffer) => {
      const redacted = secretManager.redact(chunk.toString("utf-8"));
      record.logs.push(`[stdout] ${redacted}`);
      if (record.logs.length > 500) record.logs.shift();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const redacted = secretManager.redact(chunk.toString("utf-8"));
      record.logs.push(`[stderr] ${redacted}`);
      if (record.logs.length > 500) record.logs.shift();
    });

    child.on("close", (code) => {
      record.status = code === 0 ? "completed" : "failed";
      record.exitCode = code;
      record.endTime = Date.now();
      if (child.pid) {
        this.pidToProcessId.delete(child.pid);
      }
    });

    child.on("error", (err) => {
      record.status = "failed";
      record.logs.push(`[error] ${err.message}`);
      record.endTime = Date.now();
      if (child.pid) {
        this.pidToProcessId.delete(child.pid);
      }
    });

    return record;
  }

  public listProcesses(): Array<Omit<ManagedProcessRecord, "childProcess">> {
    return Array.from(this.processes.values()).map((p) => ({
      id: p.id,
      pid: p.pid,
      command: p.command,
      args: p.args,
      status: p.status,
      startTime: p.startTime,
      endTime: p.endTime,
      exitCode: p.exitCode,
      logs: p.logs.slice(-20),
    }));
  }

  public inspectProcess(
    idOrPid: string | number,
  ): Omit<ManagedProcessRecord, "childProcess"> | null {
    let record: ManagedProcessRecord | undefined;
    if (typeof idOrPid === "number") {
      const id = this.pidToProcessId.get(idOrPid);
      if (id) record = this.processes.get(id);
    } else {
      record = this.processes.get(idOrPid);
      if (!record) {
        const numPid = Number(idOrPid);
        if (!Number.isNaN(numPid)) {
          const id = this.pidToProcessId.get(numPid);
          if (id) record = this.processes.get(id);
        }
      }
    }

    if (!record) return null;
    return {
      id: record.id,
      pid: record.pid,
      command: record.command,
      args: record.args,
      status: record.status,
      startTime: record.startTime,
      endTime: record.endTime,
      exitCode: record.exitCode,
      logs: record.logs.slice(-50),
    };
  }

  public killProcess(idOrPid: string | number): boolean {
    let record: ManagedProcessRecord | undefined;
    if (typeof idOrPid === "number") {
      const id = this.pidToProcessId.get(idOrPid);
      if (id) record = this.processes.get(id);
    } else {
      record = this.processes.get(idOrPid);
      if (!record) {
        const numPid = Number(idOrPid);
        if (!Number.isNaN(numPid)) {
          const id = this.pidToProcessId.get(numPid);
          if (id) record = this.processes.get(id);
        }
      }
    }

    if (!record || !record.childProcess) {
      return false;
    }

    try {
      record.childProcess.kill("SIGTERM");
      record.status = "killed";
      record.endTime = Date.now();
      if (record.pid) {
        this.pidToProcessId.delete(record.pid);
      }
      return true;
    } catch {
      return false;
    }
  }
}

export class ProcessManagerTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "process_manager",
    description:
      "Manage background and daemon processes (start, list, inspect, kill). Strictly restricted to OrbaAgent-managed processes. External or system host PIDs cannot be affected.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "list", "inspect", "kill"],
          description: "Action to perform on processes.",
        },
        command: {
          type: "string",
          description: "Command to execute (required for 'start').",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments for command (optional for 'start').",
        },
        processId: {
          type: "string",
          description: "Process identifier or PID (required for 'inspect' and 'kill').",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "process_manager",
    description: "Manage background and daemon processes with safe lifecycle control",
    category: "process",
    provider: "native",
    riskTier: "TIER_2_EXEC",
    keywords: ["process", "daemon", "background", "pid", "spawn", "kill", "ps"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_proc_mgr");
    const action = String(args.action || "")
      .toLowerCase()
      .trim();
    const manager = ProcessManager.getInstance();

    switch (action) {
      case "start": {
        const cmd = String(args.command || "").trim();
        if (!cmd) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "Command is required to start a process",
            executionTimeMs: Date.now() - startTime,
          };
        }
        const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
        const proc = manager.startProcess(cmd, cmdArgs, {
          cwd: context.workspaceDir,
          env: context.env,
        });

        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: `Process started successfully with ID: ${proc.id} (PID: ${proc.pid || "unknown"})`,
          metadata: { processId: proc.id, pid: proc.pid, status: proc.status },
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "list": {
        const list = manager.listProcesses();
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output:
            list.length > 0
              ? JSON.stringify(list, null, 2)
              : "No OrbaAgent-managed processes running.",
          metadata: { count: list.length },
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "inspect": {
        const procId = String(args.processId || "").trim();
        if (!procId) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "processId is required for inspect",
            executionTimeMs: Date.now() - startTime,
          };
        }
        const record = manager.inspectProcess(procId);
        if (!record) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: `Process '${procId}' not found in OrbaAgent managed registry.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: JSON.stringify(record, null, 2),
          metadata: record,
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "kill": {
        const procId = String(args.processId || "").trim();
        if (!procId) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: "processId is required for kill",
            executionTimeMs: Date.now() - startTime,
          };
        }

        // Verify it is managed by OrbaAgent
        const record = manager.inspectProcess(procId);
        if (!record) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: `Action denied: '${procId}' is not an OrbaAgent-managed process. Terminating external or host processes is strictly forbidden.`,
            executionTimeMs: Date.now() - startTime,
          };
        }

        const killed = manager.killProcess(procId);
        return {
          toolCallId,
          name: this.definition.name,
          success: killed,
          output: killed
            ? `Successfully killed managed process '${procId}' (PID: ${record.pid}).`
            : `Failed to terminate process '${procId}'.`,
          executionTimeMs: Date.now() - startTime,
        };
      }
      default:
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Unsupported action: '${action}'`,
          executionTimeMs: Date.now() - startTime,
        };
    }
  }
}
