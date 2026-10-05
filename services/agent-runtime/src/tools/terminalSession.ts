import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SecretManager } from "../secrets.js";

export interface TerminalOutputChunk {
  stream: "stdout" | "stderr";
  text: string;
  timestamp: string;
}

export interface TerminalSession {
  sessionId: string;
  command: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "cancelled";
  exitCode?: number | null;
  startTime: number;
  endTime?: number;
  outputChunks: TerminalOutputChunk[];
  childProcess?: ChildProcess;
}

export class TerminalSessionManager {
  private static instance: TerminalSessionManager;
  private readonly sessions: Map<string, TerminalSession> = new Map();

  public static getInstance(): TerminalSessionManager {
    if (!TerminalSessionManager.instance) {
      TerminalSessionManager.instance = new TerminalSessionManager();
    }
    return TerminalSessionManager.instance;
  }

  public createSession(
    command: string,
    cwd: string,
    env?: Record<string, string>,
    onChunk?: (chunk: TerminalOutputChunk) => void,
  ): TerminalSession {
    const sessionId = `term_${randomUUID().slice(0, 8)}`;
    const secretManager = SecretManager.getInstance();
    const safeEnv = secretManager.sanitizeChildEnv(process.env, env);

    const child = spawn(command, {
      cwd,
      env: safeEnv,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const session: TerminalSession = {
      sessionId,
      command,
      cwd,
      status: "running",
      startTime: Date.now(),
      outputChunks: [],
      childProcess: child,
    };

    this.sessions.set(sessionId, session);

    child.stdout?.on("data", (data: Buffer) => {
      const text = secretManager.redact(data.toString("utf-8"));
      const chunk: TerminalOutputChunk = {
        stream: "stdout",
        text,
        timestamp: new Date().toISOString(),
      };
      session.outputChunks.push(chunk);
      if (onChunk) onChunk(chunk);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = secretManager.redact(data.toString("utf-8"));
      const chunk: TerminalOutputChunk = {
        stream: "stderr",
        text,
        timestamp: new Date().toISOString(),
      };
      session.outputChunks.push(chunk);
      if (onChunk) onChunk(chunk);
    });

    child.on("close", (code) => {
      session.status = code === 0 ? "completed" : "failed";
      session.exitCode = code;
      session.endTime = Date.now();
    });

    child.on("error", (err) => {
      session.status = "failed";
      session.exitCode = 1;
      session.endTime = Date.now();
      const chunk: TerminalOutputChunk = {
        stream: "stderr",
        text: `Process error: ${err.message}`,
        timestamp: new Date().toISOString(),
      };
      session.outputChunks.push(chunk);
      if (onChunk) onChunk(chunk);
    });

    return session;
  }

  public getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  public cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.childProcess || session.status !== "running") {
      return false;
    }
    session.childProcess.kill("SIGTERM");
    session.status = "cancelled";
    session.endTime = Date.now();
    return true;
  }
}
