import {
  type TaskPlan,
  TaskPlanSchema,
  type TaskStep,
  type TaskStepStatus,
} from "@orbaagent/shared";

export interface CreatePlanParams {
  planId?: string;
  goal: string;
  workspaceId: string;
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    dependencies?: string[];
    acceptanceCriteria?: string[];
    status?: TaskStepStatus;
    assignedTool?: string;
    toolArguments?: Record<string, unknown>;
  }>;
  verificationCriteria?: string[];
  maxRetriesPerStep?: number;
}

export class TaskPlanManager {
  private static instance: TaskPlanManager;

  // planId -> TaskPlan
  private plans: Map<string, TaskPlan> = new Map();

  // workspaceId -> active planId
  private activePlans: Map<string, string> = new Map();

  public static getInstance(): TaskPlanManager {
    if (!TaskPlanManager.instance) {
      TaskPlanManager.instance = new TaskPlanManager();
    }
    return TaskPlanManager.instance;
  }

  public static resetInstance(): void {
    TaskPlanManager.instance = new TaskPlanManager();
  }

  /**
   * Creates and registers a new structured task plan.
   */
  public createPlan(params: CreatePlanParams): TaskPlan {
    const planId = params.planId || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    // Validate step uniqueness and dependency validity
    const stepIds = new Set<string>();
    for (const s of params.steps) {
      if (stepIds.has(s.id)) {
        throw new Error(`Duplicate step id: ${s.id}`);
      }
      stepIds.add(s.id);
    }

    for (const s of params.steps) {
      if (s.dependencies) {
        for (const dep of s.dependencies) {
          if (!stepIds.has(dep)) {
            throw new Error(`Step ${s.id} depends on unknown step ${dep}`);
          }
          if (dep === s.id) {
            throw new Error(`Step ${s.id} cannot depend on itself`);
          }
        }
      }
    }

    const steps: TaskStep[] = params.steps.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      dependencies: s.dependencies || [],
      acceptanceCriteria: s.acceptanceCriteria || [],
      status: s.status || "pending",
      assignedTool: s.assignedTool,
      toolArguments: s.toolArguments,
      attempts: 0,
    }));

    const plan: TaskPlan = {
      planId,
      goal: params.goal,
      workspaceId: params.workspaceId,
      status: "in_progress",
      steps,
      currentStepId: steps[0]?.id,
      verificationCriteria: params.verificationCriteria || [],
      maxRetriesPerStep: params.maxRetriesPerStep || 3,
      createdAt: now,
      updatedAt: now,
    };

    // Validate with Zod schema
    const validated = TaskPlanSchema.parse(plan);
    this.plans.set(planId, validated);
    this.activePlans.set(params.workspaceId, planId);

    return validated;
  }

  public getPlan(planId: string): TaskPlan | undefined {
    return this.plans.get(planId);
  }

  public getActivePlan(workspaceId: string): TaskPlan | undefined {
    const planId = this.activePlans.get(workspaceId);
    if (!planId) return undefined;
    return this.plans.get(planId);
  }

  public setActivePlan(workspaceId: string, planId: string): void {
    if (!this.plans.has(planId)) {
      throw new Error(`Plan ${planId} not found`);
    }
    this.activePlans.set(workspaceId, planId);
  }

  /**
   * Finds the next executable step whose dependencies have all completed.
   */
  public getNextExecutableStep(planId: string): TaskStep | undefined {
    const plan = this.plans.get(planId);
    if (!plan) return undefined;

    const completedIds = new Set(
      plan.steps.filter((s) => s.status === "completed" || s.status === "skipped").map((s) => s.id),
    );

    return plan.steps.find((s) => {
      if (s.status !== "pending") return false;
      return s.dependencies.every((dep) => completedIds.has(dep));
    });
  }

  /**
   * Updates an existing step within a plan.
   */
  public updateStep(planId: string, stepId: string, updates: Partial<TaskStep>): TaskStep {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in plan ${planId}`);
    }

    const now = new Date().toISOString();

    if (updates.status !== undefined) {
      step.status = updates.status;
      if (updates.status === "running") {
        step.attempts += 1;
        step.startedAt = now;
        plan.currentStepId = stepId;
      } else if (updates.status === "completed") {
        step.completedAt = now;
      }
    }

    if (updates.title !== undefined) step.title = updates.title;
    if (updates.description !== undefined) step.description = updates.description;
    if (updates.resultEvidence !== undefined) step.resultEvidence = updates.resultEvidence;
    if (updates.error !== undefined) step.error = updates.error;
    if (updates.assignedTool !== undefined) step.assignedTool = updates.assignedTool;
    if (updates.toolArguments !== undefined) step.toolArguments = updates.toolArguments;
    if (updates.acceptanceCriteria !== undefined)
      step.acceptanceCriteria = updates.acceptanceCriteria;

    plan.updatedAt = now;

    // Refresh overall plan status
    this.refreshPlanStatus(plan);

    return step;
  }

  public markStepRunning(planId: string, stepId: string): TaskStep {
    return this.updateStep(planId, stepId, { status: "running" });
  }

  public markStepCompleted(planId: string, stepId: string, evidence?: string): TaskStep {
    return this.updateStep(planId, stepId, {
      status: "completed",
      resultEvidence: evidence,
      error: undefined,
    });
  }

  public markStepFailed(planId: string, stepId: string, error?: string): TaskStep {
    return this.updateStep(planId, stepId, { status: "failed", error });
  }

  /**
   * Verifies whether the plan has satisfied all steps and can be marked complete.
   */
  public evaluatePlanCompletion(planId: string): {
    canComplete: boolean;
    totalSteps: number;
    completedSteps: number;
    pendingSteps: TaskStep[];
    failedSteps: TaskStep[];
  } {
    const plan = this.plans.get(planId);
    if (!plan) {
      return {
        canComplete: false,
        totalSteps: 0,
        completedSteps: 0,
        pendingSteps: [],
        failedSteps: [],
      };
    }

    const pending = plan.steps.filter((s) => s.status === "pending" || s.status === "running");
    const failed = plan.steps.filter((s) => s.status === "failed");
    const completed = plan.steps.filter((s) => s.status === "completed" || s.status === "skipped");

    const canComplete =
      pending.length === 0 && failed.length === 0 && completed.length === plan.steps.length;

    return {
      canComplete,
      totalSteps: plan.steps.length,
      completedSteps: completed.length,
      pendingSteps: pending,
      failedSteps: failed,
    };
  }

  private refreshPlanStatus(plan: TaskPlan): void {
    const allCompleted = plan.steps.every(
      (s) => s.status === "completed" || s.status === "skipped",
    );
    const anyFailed = plan.steps.some(
      (s) => s.status === "failed" && s.attempts >= plan.maxRetriesPerStep,
    );

    if (allCompleted) {
      plan.status = "completed";
      plan.completedAt = new Date().toISOString();
      plan.currentStepId = undefined;
    } else if (anyFailed) {
      plan.status = "failed";
    } else {
      plan.status = "in_progress";
    }
  }

  /**
   * Serializes a plan to JSON for resumption.
   */
  public serialize(planId: string): string {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    return JSON.stringify(plan, null, 2);
  }

  /**
   * Deserializes and registers a plan for resuming interrupted work.
   */
  public restorePlan(json: string): TaskPlan {
    const parsed = JSON.parse(json);
    const plan = TaskPlanSchema.parse(parsed);
    this.plans.set(plan.planId, plan);
    this.activePlans.set(plan.workspaceId, plan.planId);
    return plan;
  }
}
