import { randomUUID } from "node:crypto";
import path from "node:path";
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

    // 4. Tier 4 Destructive action policy check
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
