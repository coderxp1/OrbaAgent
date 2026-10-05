import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AuditEvent,
  PermissionTier,
  ToolCategory,
} from "@orbaagent/shared";
import { SecretManager } from "./secrets.js";
import type { ToolExecutionContext } from "./tools/base.js";

export interface PermissionEvaluationRequest {
  toolName: string;
  category?: ToolCategory;
  riskTier: PermissionTier;
  args: Record<string, unknown>;
  context: ToolExecutionContext;
  requiresApproval?: boolean;
  isPreApproved?: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  riskTier: PermissionTier;
  reason?: string;
  auditEvent: AuditEvent;
}

export class PermissionEngine {
  private static instance: PermissionEngine;
  private readonly auditLog: AuditEvent[] = [];
  private readonly secretManager: SecretManager;

  constructor(secretManager?: SecretManager) {
    this.secretManager = secretManager || SecretManager.getInstance();
  }

  public static getInstance(): PermissionEngine {
    if (!PermissionEngine.instance) {
      PermissionEngine.instance = new PermissionEngine();
    }
    return PermissionEngine.instance;
  }

  /**
   * Validates whether a file/directory path is strictly within the allowed workspaceDir.
   * Throws or returns false if traversal escapes the workspace.
   */
  public isPathWithinWorkspace(targetPath: string, workspaceDir: string): boolean {
    if (!targetPath || !workspaceDir) return false;
    const resolvedTarget = path.resolve(workspaceDir, targetPath);
    const resolvedWorkspace = path.resolve(workspaceDir);

    // Exact root check - cannot delete entire root directory
    if (resolvedTarget === resolvedWorkspace) {
      return false;
    }

    // Must start with resolved workspace path
    return resolvedTarget.startsWith(resolvedWorkspace + path.sep);
  }

  public evaluate(request: PermissionEvaluationRequest): PermissionDecision {
    const { toolName, category, riskTier, args, context, requiresApproval, isPreApproved } =
      request;
    const startTime = Date.now();
    const secretManager = this.secretManager;

    let allowed = true;
    let denialReason: string | undefined;

    // 1. Filesystem boundary checks for any filesystem-related arguments
    const pathKeys = ["path", "filePath", "targetPath", "sourcePath", "destinationPath"];
    for (const key of pathKeys) {
      const val = args[key];
      if (typeof val === "string" && val.length > 0) {
        if (!this.isPathWithinWorkspace(val, context.workspaceDir)) {
          allowed = false;
          denialReason = `Path '${val}' resolves outside the allowed workspace boundaries or attempts root manipulation.`;
          break;
        }
      }
    }

    // 2. Git force push prevention
    if (allowed && (toolName === "execute_git" || toolName === "git_push" || toolName === "git")) {
      const extraArgs = String(args.extraArgs || "");
      const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
      const op = String(args.operation || args.action || "");
      const isForce =
        extraArgs.includes("--force") ||
        extraArgs.includes("-f") ||
        extraArgs.includes("--force-with-lease") ||
        cmdArgs.some((a) => a === "--force" || a === "-f" || a === "--force-with-lease") ||
        op === "push_force";
      if (isForce && !isPreApproved) {
        allowed = false;
        denialReason = "Unverified force push ('git push --force') is prohibited.";
      }
    }

    // 3. Process kill restriction: Cannot kill host PIDs or system PIDs
    if (allowed && (toolName === "process_manager" || toolName === "process_kill" || toolName === "process")) {
      const action = String(args.action || args.operation || "");
      if (action === "kill" || toolName === "process_kill") {
        const rawId = String(args.processId || args.pid || "");
        const numPid = Number(rawId);
        const managedPids = (args._managedPids as Set<number> | undefined) || new Set<number>();
        // If it's a numeric PID and not in managedPids, or not a known managed process id
        const isManaged = (!isNaN(numPid) && managedPids.has(numPid)) || (rawId.startsWith("p_"));
        if (!isManaged) {
          allowed = false;
          denialReason = `Target PID '${rawId}' is not an OrbaAgent-managed process. Terminating external or host processes is strictly forbidden.`;
        }
      }
    }

    // 4. Browser safety checks
    if (allowed && toolName === "browser_action") {
      const url = String(args.url || "");
      if (url.startsWith("file://")) {
        let filePath = url;
        try {
          filePath = fileURLToPath(url);
        } catch {
          filePath = url.replace(/^file:\/\/\/?/, "");
        }
        if (!this.isPathWithinWorkspace(filePath, context.workspaceDir)) {
          allowed = false;
          denialReason = `Browser cannot access local path outside workspace scope: '${url}'.`;
        }
      }
      if (args.action === "upload" && args.filePath) {
        if (!this.isPathWithinWorkspace(String(args.filePath), context.workspaceDir)) {
          allowed = false;
          denialReason = `Browser upload denied: file '${args.filePath}' is outside workspace scope.`;
        }
      }
    }

    // 5. Package manager policy checks
    if (allowed && toolName === "package_manager") {
      const extraArgs = String(args.extraArgs || "");
      if (extraArgs.includes("-g") || extraArgs.includes("--global")) {
        allowed = false;
        denialReason = "Global package installation ('-g' / '--global') is strictly prohibited.";
      }
      const action = String(args.action || "");
      if ((action === "install" || action === "remove") && !isPreApproved) {
        allowed = false;
        denialReason = `Package ${action} requires explicit user approval.`;
      }
    }

    // 6. Test runner file boundary check
    if (allowed && toolName === "test_runner" && args.file) {
      if (!this.isPathWithinWorkspace(String(args.file), context.workspaceDir)) {
        allowed = false;
        denialReason = `Test file '${args.file}' resolves outside the allowed workspace boundary.`;
      }
    }

    // 7. Container sandbox & volume boundary checks
    if (allowed && toolName === "container_action") {
      const extraArgs = String(args.extraArgs || "");
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
          allowed = false;
          denialReason = `Container flag '${extraArgs}' is blocked by sandbox security policy.`;
          break;
        }
      }

      if (allowed && Array.isArray(args.volumes)) {
        for (const v of args.volumes as string[]) {
          let hostPath = "";
          const winMatch = String(v).match(/^([a-zA-Z]:[^:]+):(.*)$/);
          if (winMatch) {
            hostPath = winMatch[1].trim();
          } else {
            hostPath = String(v).split(":")[0]?.trim() || "";
          }
          if (hostPath && !this.isPathWithinWorkspace(hostPath, context.workspaceDir)) {
            allowed = false;
            denialReason = `Container volume mount '${hostPath}' resolves outside workspace boundary.`;
            break;
          }
        }
      }
    }

    // 8. Database query safety & path checks
    if (allowed && toolName === "database_action") {
      const dbPath = String(args.databasePath || "");
      if (dbPath && dbPath !== ":memory:" && !this.isPathWithinWorkspace(dbPath, context.workspaceDir)) {
        allowed = false;
        denialReason = `SQLite database path '${dbPath}' resolves outside workspace boundary.`;
      }
      if (allowed && args.migrationPath) {
        if (!this.isPathWithinWorkspace(String(args.migrationPath), context.workspaceDir)) {
          allowed = false;
          denialReason = `Database migration path '${args.migrationPath}' resolves outside workspace boundary.`;
        }
      }
      if (allowed && args.backupPath) {
        if (!this.isPathWithinWorkspace(String(args.backupPath), context.workspaceDir)) {
          allowed = false;
          denialReason = `Database backup path '${args.backupPath}' resolves outside workspace boundary.`;
        }
      }
      if (allowed && args.action === "query" && args.query) {
        const q = String(args.query).trim().toUpperCase();
        const isDestructive =
          q.startsWith("DROP TABLE") ||
          q.startsWith("DROP DATABASE") ||
          q.startsWith("TRUNCATE") ||
          (q.startsWith("DELETE FROM") && !q.includes("WHERE"));
        if (isDestructive && !isPreApproved) {
          allowed = false;
          denialReason = `Destructive database query requires explicit pre-approval: '${String(args.query).slice(0, 40)}...'`;
        }
      }
    }

    // 9. Tier 4 Destructive action policy check
    if (allowed && riskTier === "TIER_4_DESTRUCTIVE") {
      if (requiresApproval && !isPreApproved) {
        allowed = false;
        denialReason = `Action '${toolName}' is classified as TIER_4_DESTRUCTIVE and requires explicit pre-approval.`;
      }
    }

    // Prepare redacted arguments for audit log
    const redactedArgs = secretManager.redactObject({ ...args });
    // Remove internal routing flags from audit log
    delete (redactedArgs as Record<string, unknown>)._managedPids;
    delete (redactedArgs as Record<string, unknown>)._toolCallId;

    const auditEvent: AuditEvent = {
      id: `audit_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      traceId: (context as any)?.traceId || `trace_${randomUUID().slice(0, 8)}`,
      tenantId: context.tenantId || "default-tenant",
      userId: context.userId || "default-user",
      agentRunId: context.agentRunId || "default-run",
      toolName,
      category,
      riskTier,
      action: toolName,
      approved: allowed,
      reason: denialReason,
      redactedArgs: redactedArgs as Record<string, unknown>,
      success: allowed,
      executionTimeMs: Date.now() - startTime,
    };

    this.auditLog.push(auditEvent);

    return {
      allowed,
      riskTier,
      reason: denialReason,
      auditEvent,
    };
  }

  public getAuditLog(): AuditEvent[] {
    return [...this.auditLog];
  }

  public clearAuditLog(): void {
    this.auditLog.length = 0;
  }
}
