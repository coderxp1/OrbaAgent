import type {
  JobStatus,
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import { JobManager } from "../jobs/manager.js";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

export class BackgroundJobTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "job_manager",
    description:
      "Manage persistent asynchronous background jobs (start, status, list, pause, resume, cancel, schedule). Survives across conversational turns.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "status", "list", "pause", "resume", "cancel", "schedule"],
          description: "Job management action.",
        },
        jobId: {
          type: "string",
          description: "Target job ID for status, pause, resume, or cancel.",
        },
        name: {
          type: "string",
          description: "Name or descriptive label for the background job.",
        },
        delayMs: {
          type: "number",
          description: "Delay in milliseconds for scheduled jobs (default 1000).",
        },
        statusFilter: {
          type: "string",
          enum: [
            "QUEUED",
            "RUNNING",
            "WAITING",
            "COMPLETED",
            "FAILED",
            "CANCELLED",
            "PAUSED",
          ],
          description: "Optional filter for list action.",
        },
        payload: {
          type: "object",
          description: "Task parameters or metadata to attach to the job.",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "job_manager",
    description: "Orchestrate asynchronous persistent background jobs across turns",
    category: "jobs",
    provider: "native",
    riskTier: "TIER_2_EXEC",
    keywords: [
      "job",
      "background",
      "async",
      "schedule",
      "queue",
      "task",
      "persistent",
      "pause",
      "resume",
    ],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  public async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || `tc_job_${Date.now()}`);
    const action = String(args.action || "list");
    const jobId = args.jobId ? String(args.jobId).trim() : "";
    const name = args.name ? String(args.name).trim() : "background-task";
    const delayMs = typeof args.delayMs === "number" ? args.delayMs : 1000;
    const statusFilter = args.statusFilter as JobStatus | undefined;
    const payload = args.payload as Record<string, unknown> | undefined;

    const manager = JobManager.getInstance();
    const secretManager = SecretManager.getInstance();

    switch (action) {
      case "start": {
        const job = manager.createJob(name, payload);
        const runningJob = manager.updateJob(job.id, { status: "RUNNING", progress: 10 }) || job;
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: `Background job '${name}' started with ID '${job.id}'. Status: RUNNING.`,
          metadata: runningJob as unknown as Record<string, unknown>,
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "status": {
        if (!jobId) throw new Error("jobId is required for 'status'.");
        const job = manager.getJob(jobId);
        if (!job) {
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: `Job with ID '${jobId}' not found.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: JSON.stringify(job, null, 2),
          metadata: job as unknown as Record<string, unknown>,
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "list": {
        const jobs = manager.listJobs(statusFilter);
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: JSON.stringify(jobs, null, 2),
          metadata: { count: jobs.length },
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "pause": {
        if (!jobId) throw new Error("jobId is required for 'pause'.");
        const ok = manager.pauseJob(jobId);
        return {
          toolCallId,
          name: this.definition.name,
          success: ok,
          output: ok ? `Job '${jobId}' paused.` : `Failed to pause job '${jobId}'.`,
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "resume": {
        if (!jobId) throw new Error("jobId is required for 'resume'.");
        const ok = manager.resumeJob(jobId);
        return {
          toolCallId,
          name: this.definition.name,
          success: ok,
          output: ok ? `Job '${jobId}' resumed.` : `Failed to resume job '${jobId}'.`,
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "cancel": {
        if (!jobId) throw new Error("jobId is required for 'cancel'.");
        const ok = manager.cancelJob(jobId);
        return {
          toolCallId,
          name: this.definition.name,
          success: ok,
          output: ok ? `Job '${jobId}' cancelled.` : `Failed to cancel job '${jobId}'.`,
          executionTimeMs: Date.now() - startTime,
        };
      }
      case "schedule": {
        const job = manager.scheduleJob(name, delayMs, payload);
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: `Job '${name}' scheduled with ID '${job.id}' to run in ${delayMs}ms. Status: WAITING.`,
          metadata: job as unknown as Record<string, unknown>,
          executionTimeMs: Date.now() - startTime,
        };
      }
      default:
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Unsupported job action: '${action}'.`,
          executionTimeMs: Date.now() - startTime,
        };
    }
  }
}
