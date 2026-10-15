import { type ChildProcess, spawn } from "node:child_process";
import { SecretManager } from "../secrets.js";

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpCallResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  shell?: boolean;
}

export class McpStdioClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests: Map<
    number,
    { resolve: (res: any) => void; reject: (err: Error) => void }
  > = new Map();
  private buffer = "";

  constructor(public readonly config: McpServerConfig) {}

  public async connect(): Promise<void> {
    const secretManager = SecretManager.getInstance();
    const safeEnv = secretManager.sanitizeChildEnv(process.env, this.config.env);

    this.child = spawn(this.config.command, this.config.args || [], {
      cwd: this.config.cwd || process.cwd(),
      env: safeEnv,
      shell: this.config.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
      this.processBuffer();
    });

    this.child.stderr?.on("data", (chunk: Buffer) => {
      // Log or capture stderr
    });

    this.child.on("error", (err) => {
      for (const req of this.pendingRequests.values()) {
        req.reject(err);
      }
      this.pendingRequests.clear();
    });

    // Initialize MCP handshake
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "orbaagent-runtime", version: "0.1.0" },
    });

    this.sendNotification("notifications/initialized", {});
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (req) {
            if (msg.error) {
              req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              req.resolve(msg.result);
            }
          }
        }
      } catch {
        // Ignore unparseable line
      }
    }
  }

  public async sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
    if (!this.child || !this.child.stdin || this.child.killed) {
      throw new Error(`MCP Client '${this.config.name}' is not connected.`);
    }

    const id = this.nextId++;
    const message = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request '${method}' timed out after 15s.`));
        }
      }, 15000);

      this.pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.child?.stdin?.write(message);
    });
  }

  public sendNotification(method: string, params: Record<string, unknown>): void {
    if (this.child?.stdin && !this.child.killed) {
      const message = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
      this.child.stdin.write(message);
    }
  }

  public async listTools(): Promise<McpToolSchema[]> {
    const res = await this.sendRequest("tools/list", {});
    return (res?.tools as McpToolSchema[]) || [];
  }

  public async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const res = await this.sendRequest("tools/call", { name, arguments: args });
    return res as McpCallResult;
  }

  public async disconnect(): Promise<void> {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.pendingRequests.clear();
  }
}
