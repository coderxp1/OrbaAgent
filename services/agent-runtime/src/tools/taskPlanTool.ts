import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";
import { TaskPlanManager } from "../taskPlan.js";

export class TaskPlanTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "task_plan",
    description:
      "Create or update a structured, multi-step execution plan for the user objective. Decomposes the goal into ordered steps with dependencies and acceptance criteria. Always create a plan before executing complex workflows.",
    parameters: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "Clear statement of the overarching goal or objective.",
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique identifier for this step (e.g. step-1, step-2)" },
              title: { type: "string", description: "Short, actionable step title" },
              description: { type: "string", description: "Detailed instructions or scope of this step" },
              dependencies: {
                type: "array",
                items: { type: "string" },
                description: "List of step IDs that must complete before this step can run",
              },
              acceptanceCriteria: {
                type: "array",
                items: { type: "string" },
                description: "Explicit verification checks required to consider this step finished",
              },
              assignedTool: {
                type: "string",
                description: "Primary tool planned to execute this step (optional)",
              },
            },
            required: ["id", "title"],
          },
          description: "Ordered list of steps to accomplish the goal.",
        },
        verificationCriteria: {
          type: "array",
          items: { type: "string" },
          description: "Global acceptance criteria and verification commands (e.g. npm test, git diff check)",
        },
      },
      required: ["goal", "steps"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "task_plan",
    description: "Structured task decomposition with dependencies and completion criteria",
    category: "system",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["plan", "steps", "tasks", "decompose", "strategy", "goal"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: true,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_plan_${Date.now()}`;
    const goal = String(args.goal || "");
    const rawSteps = (args.steps as any[]) || [];
    const verificationCriteria = (args.verificationCriteria as string[]) || [];

    if (!goal || rawSteps.length === 0) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Both 'goal' and non-empty 'steps' array are required to create a task plan.",
        executionTimeMs: Date.now() - startTime,
      };
    }

    try {
      const manager = TaskPlanManager.getInstance();
      const plan = manager.createPlan({
        goal,
        workspaceId: context.tenantId || "default-workspace",
        steps: rawSteps,
        verificationCriteria,
      });

      const nextStep = manager.getNextExecutableStep(plan.planId);

      const summary = [
        `[TASK_PLAN CREATED] Plan ID: ${plan.planId}`,
        `Goal: ${plan.goal}`,
        `Total Steps: ${plan.steps.length}`,
        `Steps:`,
        ...plan.steps.map(
          (s) =>
            `  • [${s.status.toUpperCase()}] ${s.id}: ${s.title}${
              s.dependencies.length > 0 ? ` (depends on: ${s.dependencies.join(", ")})` : ""
            }`,
        ),
        nextStep ? `\nNext Ready Step: ${nextStep.id} (${nextStep.title})` : "\nNo ready step found.",
      ].join("\n");

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: summary,
        executionTimeMs: Date.now() - startTime,
        metadata: {
          planId: plan.planId,
          plan,
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
        error: `Failed to create task plan: ${message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
