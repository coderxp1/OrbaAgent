import fs from "node:fs/promises";
import path from "node:path";
import type { AgentFileChange, AgentFileChangeStatus } from "@orbaagent/shared";

export interface FileSnapshot {
  content: string;
  mtimeMs: number;
  exists: boolean;
}

export class ChangeReviewManager {
  private static instance: ChangeReviewManager;

  // agentRunId -> (filePath -> baseline snapshot)
  private baselines: Map<string, Map<string, FileSnapshot>> = new Map();

  // agentRunId -> AgentFileChange[]
  private activeChanges: Map<string, AgentFileChange[]> = new Map();

  public static getInstance(): ChangeReviewManager {
    if (!ChangeReviewManager.instance) {
      ChangeReviewManager.instance = new ChangeReviewManager();
    }
    return ChangeReviewManager.instance;
  }

  /**
   * Helper to compute unified diff and count line additions / deletions.
   */
  public computeDiff(
    oldText: string,
    newText: string,
    filename: string,
  ): { diff: string; additions: number; deletions: number } {
    const oldLines = oldText ? oldText.split("\n") : [];
    const newLines = newText ? newText.split("\n") : [];

    let additions = 0;
    let deletions = 0;
    const diffLines: string[] = [`--- a/${filename}`, `+++ b/${filename}`];

    // Simple diff comparison
    const maxLen = Math.max(oldLines.length, newLines.length);
    let hunkStarted = false;

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        if (hunkStarted) {
          diffLines.push(` ${oldLine || ""}`);
        }
      } else {
        if (!hunkStarted) {
          diffLines.push(`@@ -${i + 1},${oldLines.length} +${i + 1},${newLines.length} @@`);
          hunkStarted = true;
        }
        if (oldLine !== undefined && (newLine === undefined || oldLine !== newLine)) {
          diffLines.push(`-${oldLine}`);
          deletions++;
        }
        if (newLine !== undefined && (oldLine === undefined || oldLine !== newLine)) {
          diffLines.push(`+${newLine}`);
          additions++;
        }
      }
    }

    return {
      diff: diffLines.join("\n"),
      additions,
      deletions,
    };
  }

  /**
   * Captures the baseline state of files that exist or might be modified before agent execution.
   */
  public async captureBaseline(
    agentRunId: string,
    workspaceDir: string,
    targetPaths?: string[],
  ): Promise<void> {
    const baselineMap = new Map<string, FileSnapshot>();

    if (targetPaths && targetPaths.length > 0) {
      for (const relPath of targetPaths) {
        const fullPath = path.resolve(workspaceDir, relPath);
        try {
          const stat = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath, "utf-8");
          baselineMap.set(relPath, { content, mtimeMs: stat.mtimeMs, exists: true });
        } catch {
          baselineMap.set(relPath, { content: "", mtimeMs: 0, exists: false });
        }
      }
    }

    this.baselines.set(agentRunId, baselineMap);
  }

  /**
   * Records a file snapshot before a tool (e.g. write_file, edit_file) modifies it.
   */
  public async recordPreModification(
    agentRunId: string,
    workspaceDir: string,
    relPath: string,
  ): Promise<void> {
    let baselineMap = this.baselines.get(agentRunId);
    if (!baselineMap) {
      baselineMap = new Map<string, FileSnapshot>();
      this.baselines.set(agentRunId, baselineMap);
    }

    // Only record if not already snapshotted at start of this run
    if (!baselineMap.has(relPath)) {
      const fullPath = path.resolve(workspaceDir, relPath);
      try {
        const stat = await fs.stat(fullPath);
        const content = await fs.readFile(fullPath, "utf-8");
        baselineMap.set(relPath, { content, mtimeMs: stat.mtimeMs, exists: true });
      } catch {
        baselineMap.set(relPath, { content: "", mtimeMs: 0, exists: false });
      }
    }
  }

  /**
   * Compares the modified workspace against recorded baselines for this run.
   */
  public async detectChanges(
    agentRunId: string,
    workspaceDir: string,
    workspaceId = "default-workspace",
    messageId?: string,
  ): Promise<AgentFileChange[]> {
    const baselineMap = this.baselines.get(agentRunId) || new Map<string, FileSnapshot>();
    const changes: AgentFileChange[] = [];

    for (const [relPath, baseline] of baselineMap.entries()) {
      const fullPath = path.resolve(workspaceDir, relPath);
      let currentContent = "";
      let currentlyExists = false;

      try {
        currentContent = await fs.readFile(fullPath, "utf-8");
        currentlyExists = true;
      } catch {
        currentlyExists = false;
      }

      let status: AgentFileChangeStatus;
      if (!baseline.exists && currentlyExists) {
        status = "created";
      } else if (baseline.exists && !currentlyExists) {
        status = "deleted";
      } else if (baseline.exists && currentlyExists && baseline.content !== currentContent) {
        status = "modified";
      } else {
        // No change made
        continue;
      }

      const { diff, additions, deletions } = this.computeDiff(
        baseline.content,
        currentContent,
        relPath,
      );

      const filename = path.basename(relPath);
      const changeId = `chg_${agentRunId}_${relPath.replace(/[^a-zA-Z0-9]/g, "_")}`;

      changes.push({
        changeId,
        agentRunId,
        messageId,
        workspaceId,
        path: relPath,
        filename,
        status,
        additions,
        deletions,
        diff,
        reviewStatus: "pending",
        timestamp: new Date().toISOString(),
      });
    }

    this.activeChanges.set(agentRunId, changes);
    return changes;
  }

  public findRunIdByChangeId(changeId: string): string | undefined {
    for (const [runId, list] of this.activeChanges.entries()) {
      if (list.some((c) => c.changeId === changeId)) {
        return runId;
      }
    }
    return undefined;
  }

  public getChanges(agentRunId?: string): AgentFileChange[] {
    if (!agentRunId) {
      const all: AgentFileChange[] = [];
      for (const list of this.activeChanges.values()) {
        all.push(...list);
      }
      return all;
    }
    return this.activeChanges.get(agentRunId) || [];
  }

  /**
   * Reverts a single file change back to its exact baseline before this agent run.
   * Protects pre-existing user changes on other files.
   */
  public async revertChange(
    agentRunId: string,
    changeId: string,
    workspaceDir?: string,
  ): Promise<boolean> {
    const changes = this.activeChanges.get(agentRunId);
    if (!changes) return false;

    const change = changes.find((c) => c.changeId === changeId);
    if (!change) return false;

    const targetDir = workspaceDir || process.env.WORKSPACE_ROOT || process.cwd();
    const baselineMap = this.baselines.get(agentRunId);
    const baseline = baselineMap?.get(change.path);
    const fullPath = path.resolve(targetDir, change.path);

    if (!baseline || !baseline.exists) {
      // Was newly created by agent -> delete it
      try {
        await fs.unlink(fullPath);
      } catch {}
    } else {
      // Existed before agent -> restore exact baseline content
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, baseline.content, "utf-8");
    }

    change.reviewStatus = "rejected";
    return true;
  }

  /**
   * Accepts a single file change.
   */
  public acceptChange(agentRunId: string, changeId: string): boolean {
    const changes = this.activeChanges.get(agentRunId);
    if (!changes) return false;

    const change = changes.find((c) => c.changeId === changeId);
    if (!change) return false;

    change.reviewStatus = "accepted";
    return true;
  }

  /**
   * Reverts ALL changes created by this agent run.
   * Does NOT touch pre-existing user modifications on other files.
   */
  public async revertAll(agentRunId: string, workspaceDir?: string): Promise<boolean> {
    const changes = this.activeChanges.get(agentRunId);
    if (!changes) return false;

    for (const change of changes) {
      if (change.reviewStatus === "pending") {
        await this.revertChange(agentRunId, change.changeId, workspaceDir);
      }
    }

    return true;
  }

  /**
   * Accepts all pending changes for this agent run.
   */
  public acceptAll(agentRunId: string): boolean {
    const changes = this.activeChanges.get(agentRunId);
    if (!changes) return false;

    for (const change of changes) {
      if (change.reviewStatus === "pending") {
        change.reviewStatus = "accepted";
      }
    }

    return true;
  }
}
