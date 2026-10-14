import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { TaskPlanManager } from "../taskPlan.js";

export class TaskStepTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "task_step",
    description:
      "Update the progress, status, and verification evidence for a specific step in the active task plan. Supports transitions: 'start' (mark running), 'complete' (provide evidence of success), 'fail' (record failure and error for diagnosis/repair), and 'skip'.",
    parameters: {
      type: "object",
      properties: {
        step_id: {
          type: "string",
          description: "ID of the step being updated (e.g. step-1, step-2).",
        },
        action: {
          type: "string",
          enum: ["start", "complete", "fail", "skip"],
          description: "Action to perform on the step.",
        },
        evidence: {
          type: "string",
          description: "Concrete verification evidence, outputs, or test results demonstrating step completion.",
        },
        error: {
          type: "string",
          description: "Diagnostic error details explaining why the step failed (required when action is 'fail').",
        },
        plan_id: {
          type: "string",
          description: "Optional plan ID. Defaults to the active plan in the current workspace context.",
        },
      },
      required: ["step_id", "action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "task_step",
    description: "Update step state and record verification evidence in active task plan",
    category: "system",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["step", "progress", "evidence", "complete", "running", "status"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: true,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_step_${Date.now()}`;
    const stepId = String(args.step_id || "");
    const action = String(args.action || "") as "start" | "complete" | "fail" | "skip";
    const evidence = args.evidence ? String(args.evidence) : undefined;
    const error = args.error ? String(args.error) : undefined;
    const workspaceId = context.tenantId || "default-workspace";

    const manager = TaskPlanManager.getInstance();
    let plan = args.plan_id
      ? manager.getPlan(String(args.plan_id))
      : manager.getActivePlan(workspaceId);

    if (!plan) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "No active task plan found for this workspace. Use 'task_plan' to create one first.",
        executionTimeMs: Date.now() - startTime,
      };
    }

    try {
      let updatedStep;
      if (action === "start") {
        updatedStep = manager.markStepRunning(plan.planId, stepId);
      } else if (action === "complete") {
        updatedStep = manager.markStepCompleted(plan.planId, stepId, evidence);
      } else if (action === "fail") {
        updatedStep = manager.markStepFailed(plan.planId, stepId, error || "Step execution failed");
      } else if (action === "skip") {
        updatedStep = manager.updateStep(plan.planId, stepId, { status: "skipped" });
      } else {
        throw new Error(`Unknown action: ${action}`);
      }

      const nextStep = manager.getNextExecutableStep(plan.planId);
      const evalResult = manager.evaluatePlanCompletion(plan.planId);

      const outputLines = [
        `[TASK_STEP UPDATED] Step: ${updatedStep.id} (${updatedStep.title}) -> ${updatedStep.status.toUpperCase()}`,
        evidence ? `Evidence: ${evidence}` : "",
        error ? `Error: ${error}` : "",
        `Plan Progress: ${evalResult.completedSteps}/${evalResult.totalSteps} steps completed`,
        nextStep
          ? `Next Step: ${nextStep.id} (${nextStep.title})`
          : evalResult.canComplete
          ? "All steps completed! Ready to verify and call 'task_complete'."
          : "No pending step currently executable (check dependencies or repair failed steps).",
      ].filter(Boolean);

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: outputLines.join("\n"),
        executionTimeMs: Date.now() - startTime,
        metadata: {
          planId: plan.planId,
          stepId: updatedStep.id,
          step: updatedStep,
          planProgress: evalResult,
          nextStepId: nextStep?.id,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: `Failed to update task step: ${message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
