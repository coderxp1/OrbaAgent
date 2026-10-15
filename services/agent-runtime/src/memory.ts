export interface WorkspaceMemoryEntry {
  id: string;
  workspaceId: string;
  userId: string;
  category: "past_work" | "architecture" | "decision" | "repository" | "user_preference";
  content: string;
  createdAt: string;
}

export class AgentMemoryManager {
  private static instance: AgentMemoryManager;
  private memories: Map<string, WorkspaceMemoryEntry[]> = new Map();

  private constructor() {
    this.seedDefaultMemories();
  }

  public static getInstance(): AgentMemoryManager {
    if (!AgentMemoryManager.instance) {
      AgentMemoryManager.instance = new AgentMemoryManager();
    }
    return AgentMemoryManager.instance;
  }

  private seedDefaultMemories(): void {
    const defaultWorkspaceId = "authenticated-tenant";
    const defaultUserId = "authenticated-user";
    this.addMemory(
      defaultWorkspaceId,
      defaultUserId,
      "architecture",
      "OrbaAgent workspace runs inside Next.js 16 (Turbopack) with isolated Docker runtime containers. Tailored for autonomous execution with unified terminal and change review.",
    );
    this.addMemory(
      defaultWorkspaceId,
      defaultUserId,
      "past_work",
      "Repository 'coderxp1/the-infected' and 'coderxp1/OrbaAgent' are verified target workspaces. Production domain is orbaagent.dev on 85.215.156.241.",
    );
  }

  public addMemory(
    workspaceId: string,
    userId: string,
    category: WorkspaceMemoryEntry["category"],
    content: string,
  ): WorkspaceMemoryEntry {
    const key = `${workspaceId}:${userId}`;
    const list = this.memories.get(key) || [];
    const entry: WorkspaceMemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      workspaceId,
      userId,
      category,
      content,
      createdAt: new Date().toISOString(),
    };
    list.push(entry);
    this.memories.set(key, list);
    return entry;
  }

  public getMemories(workspaceId: string, userId: string): WorkspaceMemoryEntry[] {
    const key = `${workspaceId}:${userId}`;
    const specific = this.memories.get(key) || [];
    const defaults = this.memories.get("authenticated-tenant:authenticated-user") || [];
    const combined = [...specific];
    for (const def of defaults) {
      if (!combined.some((m) => m.content === def.content)) {
        combined.push(def);
      }
    }
    return combined;
  }

  public generateMemoryPrompt(workspaceId: string, userId: string): string {
    const mems = this.getMemories(workspaceId, userId);
    if (mems.length === 0) return "";

    const list = mems.map((m) => `- [${m.category.toUpperCase()}] ${m.content}`).join("\n");

    return `PERSISTENT WORKSPACE MEMORY (Past Work & Context):
${list}`;
  }
}
