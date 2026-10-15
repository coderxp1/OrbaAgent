import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { TaskPlanManager } from "../taskPlan.js";
import type { ITool, ToolExecutionContext } from "./base.js";

export class TaskCompleteTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "task_complete",
    description:
      "Call this tool when you have fully completed the requested task or objective. Provide a conclusive summary of the completed work, verified test results, and final findings. If an active task plan exists, all steps must be completed and verified before calling this tool.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Clear, comprehensive summary of the work executed and results achieved.",
        },
        verified: {
          type: "boolean",
          description:
            "Whether all tests, builds, or checks passed successfully. Must be true for verified completion.",
        },
        verificationEvidence: {
          type: "string",
          description:
            "Concrete output or evidence from test suites, builds, or git diffs confirming satisfaction of acceptance criteria.",
        },
      },
      required: ["summary"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "task_complete",
    description: "Mark agent objective as finished with verified summary and evidence",
    category: "system",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["complete", "finish", "done", "objective", "task", "verify"],
    parameters: this.definition.parameters,
    version: "1.1.0",
    isCore: true,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_complete_${Date.now()}`;
    const summary = String(args.summary || "Task completed successfully.");
    const verified = args.verified !== false;
    const verificationEvidence = args.verificationEvidence
      ? String(args.verificationEvidence)
      : undefined;
    const workspaceId = context.tenantId || "default-workspace";

    // Enforce truth-telling verification against active TaskPlan if one exists
    const manager = TaskPlanManager.getInstance();
    const activePlan = manager.getActivePlan(workspaceId);

    if (activePlan) {
      const evaluation = manager.evaluatePlanCompletion(activePlan.planId);
      if (!evaluation.canComplete) {
        const issues: string[] = [];
        if (evaluation.pendingSteps.length > 0) {
          issues.push(
            `Incomplete steps remaining: ${evaluation.pendingSteps
              .map((s) => `${s.id} (${s.title}: ${s.status})`)
              .join(", ")}`,
          );
        }
        if (evaluation.failedSteps.length > 0) {
          issues.push(
            `Failed steps require repair: ${evaluation.failedSteps
              .map((s) => `${s.id} (${s.title}: ${s.error || "failed"})`)
              .join(", ")}`,
          );
        }

        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Cannot complete task: active plan '${activePlan.planId}' has unfulfilled steps.\n${issues.join("\n")}\nComplete or repair all steps with verification before calling task_complete.`,
          executionTimeMs: Date.now() - startTime,
          metadata: {
            planId: activePlan.planId,
            canComplete: false,
            evaluation,
          },
        };
      }

      if (!verified) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error:
            "Cannot complete task: 'verified' was false or unconfirmed. Run tests/checks to verify correctness before completion.",
          executionTimeMs: Date.now() - startTime,
          metadata: { planId: activePlan.planId, verified: false },
        };
      }
    }

    return {
      toolCallId,
      name: this.definition.name,
      success: true,
      output: `[TASK_COMPLETE] ${verified ? "Verified Success" : "Completed"}: ${summary}${
        verificationEvidence ? `\nVerification Evidence: ${verificationEvidence}` : ""
      }`,
      executionTimeMs: Date.now() - startTime,
      metadata: { summary, verified, verificationEvidence, planId: activePlan?.planId },
    };
  }
}
