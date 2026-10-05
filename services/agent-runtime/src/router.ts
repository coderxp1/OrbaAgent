import type {
  AuditEvent,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import { PermissionEngine, type PermissionDecision } from "./permissions.js";
import { ProcessManager } from "./tools/processManager.js";
import type { ToolRegistry } from "./registry.js";
import { SecretManager } from "./secrets.js";
import type { ToolExecutionContext } from "./tools/base.js";

export interface ToolRouterOptions {
  registry: ToolRegistry;
  permissionEngine?: PermissionEngine;
  secretManager?: SecretManager;
}

export class ToolRouter {
  private readonly registry: ToolRegistry;
  private readonly permissionEngine: PermissionEngine;
  private readonly secretManager: SecretManager;

  constructor(options: ToolRouterOptions) {
    this.registry = options.registry;
    this.permissionEngine = options.permissionEngine || PermissionEngine.getInstance();
    this.secretManager = options.secretManager || SecretManager.getInstance();
  }

  public getPermissionEngine(): PermissionEngine {
    return this.permissionEngine;
  }

  public getSecretManager(): SecretManager {
    return this.secretManager;
  }

  public async routeAndExecute(
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<{ result: ToolExecutionResult; auditEvent?: AuditEvent }> {
    const startTime = Date.now();
    const tool = this.registry.getTool(name);

    if (!tool) {
      return {
        result: {
          toolCallId,
          name,
          success: false,
          output: "",
          error: `Tool '${name}' is not registered in the Agent Capability Registry.`,
          executionTimeMs: Date.now() - startTime,
        },
      };
    }

    const metadata: ToolMetadata = tool.metadata || {
      name,
      description: tool.definition.description,
      category: "system",
      provider: "native",
      riskTier: "TIER_0_READ",
      keywords: [],
      parameters: tool.definition.parameters,
      version: "1.0.0",
      isCore: false,
      requiresApproval: false,
    };

    // If GITHUB_TOKEN or secret passed in context, register in SecretManager
    if (context.githubToken) {
      this.secretManager.registerSecret(context.githubToken, "GITHUB_TOKEN");
    }

    // Pass managed PIDs into process check
    const managedPids = ProcessManager.getInstance().getManagedPids();
    const argsWithInternal = { ...args, _managedPids: managedPids };

    // Evaluate permissions
    const decision: PermissionDecision = this.permissionEngine.evaluate({
      toolName: name,
      category: metadata.category,
      riskTier: metadata.riskTier,
      args: argsWithInternal,
      context,
      requiresApproval: metadata.requiresApproval,
      isPreApproved: context.isPreApproved,
    });

    if (!decision.allowed) {
      return {
        result: {
          toolCallId,
          name,
          success: false,
          output: "",
          error: `Permission Denied (${decision.riskTier}): ${decision.reason || "Unauthorized action"}`,
          executionTimeMs: Date.now() - startTime,
          metadata: {
            permissionDenied: true,
            riskTier: decision.riskTier,
            reason: decision.reason,
          },
        },
        auditEvent: decision.auditEvent,
      };
    }

    // Auto-activate tool in registry if not yet active
    this.registry.activateTools([name]);

    try {
      const fullArgs = { ...args, _toolCallId: toolCallId };
      const rawResult = await tool.execute(fullArgs, context);

      // Redact sensitive secrets from output and error
      const output = this.secretManager.redact(rawResult.output || "");
      const error = rawResult.error ? this.secretManager.redact(rawResult.error) : undefined;

      const finalResult: ToolExecutionResult = {
        ...rawResult,
        output,
        error,
        executionTimeMs: rawResult.executionTimeMs ?? Date.now() - startTime,
      };

      return {
        result: finalResult,
        auditEvent: decision.auditEvent,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const redactedError = this.secretManager.redact(errMsg);

      return {
        result: {
          toolCallId,
          name,
          success: false,
          output: "",
          error: `Execution error in '${name}': ${redactedError}`,
          executionTimeMs: Date.now() - startTime,
        },
        auditEvent: decision.auditEvent,
      };
    }
  }
}
