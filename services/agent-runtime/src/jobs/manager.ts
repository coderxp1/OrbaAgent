import { randomUUID } from "node:crypto";
import type { JobRecord, JobStatus } from "@orbaagent/shared";

export class JobManager {
  private static instance: JobManager;
  private readonly jobs: Map<string, JobRecord> = new Map();
  private readonly runningTimers: Map<string, NodeJS.Timeout> = new Map();

  public static getInstance(): JobManager {
    if (!JobManager.instance) {
      JobManager.instance = new JobManager();
    }
    return JobManager.instance;
  }

  public createJob(name: string, payload?: Record<string, unknown>): JobRecord {
    const id = `job_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const job: JobRecord = {
      id,
      name,
      status: "QUEUED",
      createdAt: now,
      updatedAt: now,
      progress: 0,
      payload,
    };
    this.jobs.set(id, job);
    return job;
  }

  public updateJob(
    id: string,
    updates: Partial<Omit<JobRecord, "id" | "createdAt">>,
  ): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    const updated: JobRecord = {
      ...job,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, updated);
    return updated;
  }

  public getJob(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  public listJobs(statusFilter?: JobStatus): JobRecord[] {
    const all = Array.from(this.jobs.values());
    if (statusFilter) {
      return all.filter((j) => j.status === statusFilter);
    }
    return all;
  }

  public pauseJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== "RUNNING") return false;
    this.updateJob(id, { status: "PAUSED" });
    return true;
  }

  public resumeJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== "PAUSED") return false;
    this.updateJob(id, { status: "RUNNING" });
    return true;
  }

  public cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    const timer = this.runningTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.runningTimers.delete(id);
    }
    this.updateJob(id, { status: "CANCELLED" });
    return true;
  }

  public scheduleJob(
    name: string,
    delayMs: number,
    payload?: Record<string, unknown>,
  ): JobRecord {
    const job = this.createJob(name, payload);
    const waitingJob = this.updateJob(job.id, { status: "WAITING" }) || job;

    const timer = setTimeout(() => {
      this.updateJob(job.id, { status: "RUNNING", progress: 50 });
      setTimeout(() => {
        this.updateJob(job.id, {
          status: "COMPLETED",
          progress: 100,
          result: { message: `Scheduled job '${name}' completed successfully.` },
        });
        this.runningTimers.delete(job.id);
      }, 500);
    }, delayMs);

    this.runningTimers.set(job.id, timer);
    return waitingJob;
  }

  public clearAll(): void {
    for (const timer of this.runningTimers.values()) {
      clearTimeout(timer);
    }
    this.runningTimers.clear();
    this.jobs.clear();
  }
}
