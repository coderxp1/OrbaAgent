import type {
  IntegrationStatus,
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import { IntegrationsManager } from "./integrations.js";
import { AgentMemoryManager } from "./memory.js";
import type { ToolRegistry } from "./registry.js";
import type { ITool, ToolExecutionContext } from "./tools/base.js";

export type CapabilityStatus =
  | "AVAILABLE"
  | "AVAILABLE_BUT_NOT_CONNECTED"
  | "AVAILABLE_BUT_REQUIRES_APPROVAL"
  | "AVAILABLE_BUT_REQUIRES_RUNTIME"
  | "UNAVAILABLE"
  | "NOT_IMPLEMENTED";

export interface CapabilityItem {
  id: string;
  name: string;
  category:
    | "coding_development"
    | "web_browsing"
    | "connected_services"
    | "workspace_memory"
    | "ai_media";
  status: CapabilityStatus;
  provider: "native" | "mcp" | "connector" | "gpu_worker";
  description: string;
  tools: string[];
  connected?: boolean;
  requiresApproval?: boolean;
  notes?: string;
}

export interface CapabilityReport {
  timestamp: string;
  totalCapabilities: number;
  availableCount: number;
  notConnectedCount: number;
  unavailableCount: number;
  categories: {
    coding_development: CapabilityItem[];
    web_browsing: CapabilityItem[];
    connected_services: CapabilityItem[];
    workspace_memory: CapabilityItem[];
    ai_media: CapabilityItem[];
  };
}

export class CapabilityManager {
  private static instance: CapabilityManager;
  private mediaWorkerAvailable = false; // GPU 1 media worker is not deployed yet
  /**
   * Whether image/video generation may be advertised. Deliberately separate from
   * {@link mediaWorkerAvailable}: the worker can be reachable while no real
   * generation backend is loaded, in which case generation is NOT available.
   */
  private mediaGenerationAdvertised = false;
  private playwrightAvailable = true; // Playwright chromium installed and verified

  public static getInstance(): CapabilityManager {
    if (!CapabilityManager.instance) {
      CapabilityManager.instance = new CapabilityManager();
    }
    return CapabilityManager.instance;
  }

  public setMediaWorkerAvailable(available: boolean): void {
    this.mediaWorkerAvailable = available;
  }

  public async checkMediaWorkerHealth(): Promise<boolean> {
    // Allow hard disable via env to avoid blocking normal chat in environments where GPU worker is not yet deployed
    if (process.env.MEDIA_WORKER_DISABLED === "true") {
      this.mediaWorkerAvailable = false;
      return false;
    }

    const workerUrl = (process.env.MEDIA_WORKER_URL || "").trim();
    const workerToken = (process.env.MEDIA_WORKER_TOKEN || "").trim();

    // No fallback URL or token: a missing token must not silently become a
    // hardcoded shared secret, and a missing URL must not reach a hardcoded host.
    if (!workerUrl || !workerToken) {
      this.mediaWorkerAvailable = false;
      return false;
    }

    try {
      const res = await fetch(`${workerUrl}/health`, {
        headers: { Authorization: `Bearer ${workerToken}` },
        // Keep this very short to avoid blocking any agent turn when the GPU worker is down
        signal: AbortSignal.timeout(Number(process.env.MEDIA_WORKER_HEALTH_TIMEOUT_MS) || 800),
      });
      if (res.ok) {
        const data = await res.json();
        this.mediaWorkerAvailable = data.worker === "healthy" || data.status === "ok";
        // Trust the worker's own capability flags. A reachable GPU does not imply
        // a loaded generation model, so absent flags default to false.
        const caps = data.capabilities ?? {};
        this.setMediaGenerationAdvertised(
          Boolean(caps.image_generation) || Boolean(caps.video_generation),
        );
        return this.mediaWorkerAvailable;
      }
    } catch {
      // Worker offline or unreachable
    }
    this.mediaWorkerAvailable = false;
    this.setMediaGenerationAdvertised(false);
    return false;
  }

  /**
   * Whether image/video generation may be advertised as AVAILABLE.
   *
   * Defaults to `false`. The real GPU generation backend has not been deployed,
   * so generation must not be reported as available merely because a worker
   * responds to /health.
   */
  public setMediaGenerationAdvertised(advertised: boolean): void {
    this.mediaGenerationAdvertised = advertised;
  }

  public setPlaywrightAvailable(available: boolean): void {
    this.playwrightAvailable = available;
  }

  public inspectCapabilities(
    registry: ToolRegistry,
    userId = "authenticated-user",
    workspaceId = "authenticated-tenant",
  ): CapabilityReport {
    const integrationsManager = IntegrationsManager.getInstance();
    const integrations = integrationsManager.getIntegrations(userId);
    const gitHubConnected = integrations.some((i) => i.name === "github" && i.connected);
    const slackConnected = integrations.some((i) => i.name === "slack" && i.connected);
    const notionConnected = integrations.some((i) => i.name === "notion" && i.connected);
    const googleConnected = integrations.some(
      (i) => (i.name === "google_workspace" || i.name === "google_drive") && i.connected,
    );
    const m365Connected = integrations.some(
      (i) =>
        (i.name === "microsoft_365" || i.name === "teams" || i.name === "outlook") && i.connected,
    );

    const coding_development: CapabilityItem[] = [
      {
        id: "terminal_shell",
        name: "Terminal & Shell Execution",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description: "Execute commands in isolated workspace (Node.js, pnpm, git, CLI)",
        tools: ["execute_shell"],
      },
      {
        id: "filesystem",
        name: "Filesystem Operations",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description: "Read, write, edit, search, stat, copy, move, delete files in workspace",
        tools: [
          "read_file",
          "write_file",
          "edit_file",
          "list_files",
          "filesystem_search",
          "filesystem_stat",
          "filesystem_copy",
          "filesystem_move",
          "filesystem_delete",
        ],
      },
      {
        id: "git_operations",
        name: "Git Version Control",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description: "Branch, checkout, status, diff, commit, push, pull with force-push guard",
        tools: ["execute_git"],
      },
      {
        id: "package_manager",
        name: "Package Management",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description:
          "Manage dependencies across pnpm, npm, yarn (install, remove, outdated, audit)",
        tools: ["package_manager"],
        requiresApproval: true,
      },
      {
        id: "test_runner",
        name: "Structured Test Runner",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description:
          "Auto-detect framework (vitest, jest, pytest, playwright), discover & run tests",
        tools: ["test_runner"],
      },
      {
        id: "code_quality",
        name: "Lint & Typecheck",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description:
          "Run TypeScript typechecking, Biome, ESLint, Prettier with structured diagnostics",
        tools: ["code_quality"],
      },
      {
        id: "docker_containers",
        name: "Docker & Container Workloads",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description:
          "Build, run, inspect, stop containers & Docker Compose with workspace volume sandboxing",
        tools: ["container_action"],
      },
      {
        id: "databases",
        name: "Database Tooling",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "native",
        description:
          "Native Node 24 SQLite (zero C++ dependencies), PostgreSQL & Redis adapters, migrations, explain, backups",
        tools: ["database_action"],
        requiresApproval: true,
      },
      {
        id: "ci_cd",
        name: "CI/CD Pipelines",
        category: "coding_development",
        status: gitHubConnected ? "AVAILABLE" : "AVAILABLE_BUT_NOT_CONNECTED",
        provider: "native",
        description: "Inspect GitHub Actions workflow status, logs, rerun, cancel, and artifacts",
        tools: ["ci_action"],
        connected: gitHubConnected,
      },
      {
        id: "cloud_deployments",
        name: "Cloud Deployments",
        category: "coding_development",
        status: "AVAILABLE",
        provider: "connector",
        description:
          "Manage Vercel, Cloudflare, and Supabase deployments, domains, logs, rollbacks",
        tools: ["deployment_action"],
      },
    ];

    const web_browsing: CapabilityItem[] = [
      {
        id: "browser_automation",
        name: "Interactive Browser Automation",
        category: "web_browsing",
        status: this.playwrightAvailable ? "AVAILABLE" : "UNAVAILABLE",
        provider: "native",
        description:
          "Playwright Chromium headless browser (navigate, click, type, screenshot, evaluate, forms)",
        tools: ["browser_action"],
        notes: this.playwrightAvailable
          ? "Chromium available"
          : "Playwright runtime not currently installed",
      },
      {
        id: "web_fetch",
        name: "Web Content Fetching",
        category: "web_browsing",
        status: "AVAILABLE",
        provider: "native",
        description: "Fetch and extract text/documentation from public URLs via HTTP",
        tools: ["web_fetch"],
      },
    ];

    const connected_services: CapabilityItem[] = [
      {
        id: "github_service",
        name: "GitHub",
        category: "connected_services",
        status: gitHubConnected ? "AVAILABLE" : "AVAILABLE_BUT_NOT_CONNECTED",
        provider: "connector",
        description: "Create pull requests, manage issues, commit files, create branches",
        tools: ["github_service"],
        connected: gitHubConnected,
        notes: gitHubConnected
          ? "Authenticated via OAuth / PAT"
          : "Available, but GitHub account is not connected for authenticated operations",
      },
      {
        id: "slack_service",
        name: "Slack",
        category: "connected_services",
        status: slackConnected ? "AVAILABLE" : "AVAILABLE_BUT_NOT_CONNECTED",
        provider: "connector",
        description: "Post messages, create threads, list channels in Slack workspaces",
        tools: ["slack_service"],
        connected: slackConnected,
        notes: slackConnected ? "Connected" : "Available, but Slack account is not connected",
      },
      {
        id: "notion_service",
        name: "Notion",
        category: "connected_services",
        status: notionConnected ? "AVAILABLE" : "AVAILABLE_BUT_NOT_CONNECTED",
        provider: "connector",
        description: "Search documents, read pages, create pages and database items",
        tools: ["notion_service"],
        connected: notionConnected,
        notes: notionConnected ? "Connected" : "Available, but Notion workspace is not connected",
      },
      {
        id: "google_workspace_service",
        name: "Google Workspace",
        category: "connected_services",
        status: googleConnected ? "AVAILABLE" : "AVAILABLE_BUT_NOT_CONNECTED",
        provider: "connector",
        description: "Search Google Drive, read Docs, view Calendar events",
        tools: ["google_workspace_service"],
        connected: googleConnected,
        notes: googleConnected ? "Connected" : "Available, but Google account is not connected",
      },
      {
        id: "microsoft_365_service",
        name: "Microsoft 365",
        category: "connected_services",
        status: m365Connected ? "AVAILABLE" : "AVAILABLE_BUT_NOT_CONNECTED",
        provider: "connector",
        description: "Send Teams messages, access SharePoint files and OneDrive",
        tools: ["microsoft_365_service"],
        connected: m365Connected,
        notes: m365Connected
          ? "Connected"
          : "Available, but Microsoft 365 account is not connected",
      },
    ];

    const workspace_memory: CapabilityItem[] = [
      {
        id: "persistent_memory",
        name: "Persistent Workspace Memory",
        category: "workspace_memory",
        status: "AVAILABLE",
        provider: "native",
        description:
          "Project architecture context, decisions, past work, and user preferences persisted across turns",
        tools: ["memory_manager"],
        notes: "Active and persistent across sessions",
      },
      {
        id: "background_jobs",
        name: "Persistent Background Jobs",
        category: "workspace_memory",
        status: "AVAILABLE",
        provider: "native",
        description:
          "Asynchronous multi-turn jobs (start, pause, resume, cancel, schedule) surviving conversational turns",
        tools: ["job_manager"],
      },
    ];

    const ai_media: CapabilityItem[] = [
      {
        id: "image_generation",
        name: "AI Image Generation",
        category: "ai_media",
        status: this.mediaGenerationAdvertised ? "AVAILABLE" : "UNAVAILABLE",
        provider: "gpu_worker",
        description: "Diffusion-based text-to-image and image-to-image generation on dedicated GPU",
        tools: ["media_image_generate"],
        notes: this.mediaGenerationAdvertised
          ? "Real generation backend reported ready by the GPU media worker"
          : "UNAVAILABLE: the real GPU generation backend has not been deployed. The media_image_generate tool returns MEDIA_GENERATION_UNAVAILABLE and does not produce output.",
      },
      {
        id: "video_generation",
        name: "AI Video Generation",
        category: "ai_media",
        status: this.mediaGenerationAdvertised ? "AVAILABLE" : "UNAVAILABLE",
        provider: "gpu_worker",
        description: "Generative text-to-video diffusion on dedicated GPU",
        tools: ["media_video_generate"],
        notes: this.mediaGenerationAdvertised
          ? "Real generation backend reported ready by the GPU media worker"
          : "UNAVAILABLE: the real GPU generation backend has not been deployed. The media_video_generate tool returns MEDIA_GENERATION_UNAVAILABLE and does not produce output.",
      },
      {
        id: "media_processing",
        name: "Media Processing",
        category: "ai_media",
        status: this.mediaWorkerAvailable ? "AVAILABLE" : "UNAVAILABLE",
        provider: "gpu_worker",
        description: "Image resize, conversion, compositing, video encoding, and frame extraction",
        tools: ["media_process"],
        notes: this.mediaWorkerAvailable
          ? "Media processing active on GPU 1"
          : "GPU media worker on GPU 1 is currently unavailable or initializing",
      },
    ];

    const allItems = [
      ...coding_development,
      ...web_browsing,
      ...connected_services,
      ...workspace_memory,
      ...ai_media,
    ];

    const availableCount = allItems.filter((i) => i.status === "AVAILABLE").length;
    const notConnectedCount = allItems.filter(
      (i) => i.status === "AVAILABLE_BUT_NOT_CONNECTED",
    ).length;
    const unavailableCount = allItems.filter(
      (i) => i.status === "UNAVAILABLE" || i.status === "NOT_IMPLEMENTED",
    ).length;

    return {
      timestamp: new Date().toISOString(),
      totalCapabilities: allItems.length,
      availableCount,
      notConnectedCount,
      unavailableCount,
      categories: {
        coding_development,
        web_browsing,
        connected_services,
        workspace_memory,
        ai_media,
      },
    };
  }

  public formatMarkdownSummary(report: CapabilityReport): string {
    const lines: string[] = [];
    lines.push("## Coding & Development");
    for (const item of report.categories.coding_development) {
      const mark = item.status === "AVAILABLE" ? "✓" : "○";
      const connNote = item.connected === false ? " — available, not connected" : "";
      lines.push(`${mark} **${item.name}**${connNote}: ${item.description}`);
    }

    lines.push("\n## Web & Browsing");
    for (const item of report.categories.web_browsing) {
      const mark = item.status === "AVAILABLE" ? "✓" : "○";
      const note = item.notes ? ` (${item.notes})` : "";
      lines.push(`${mark} **${item.name}**${note}: ${item.description}`);
    }

    lines.push("\n## Connected Services");
    for (const item of report.categories.connected_services) {
      const mark = item.status === "AVAILABLE" ? "✓" : "○";
      const statusLabel =
        item.status === "AVAILABLE" ? "CONNECTED (Active)" : "Available, but account not connected";
      lines.push(`${mark} **${item.name}** — ${statusLabel}`);
    }

    lines.push("\n## Workspace & Memory");
    for (const item of report.categories.workspace_memory) {
      const mark = item.status === "AVAILABLE" ? "✓" : "○";
      lines.push(`${mark} **${item.name}**: ${item.description}`);
    }

    lines.push("\n## AI Media");
    for (const item of report.categories.ai_media) {
      const mark = item.status === "AVAILABLE" ? "✓" : "○";
      const note = item.notes ? ` — ${item.notes}` : "";
      lines.push(`${mark} **${item.name}**${note}`);
    }

    return lines.join("\n");
  }

  public generateCapabilityPrompt(
    registry: ToolRegistry,
    workspaceId: string,
    userId: string,
  ): string {
    const report = this.inspectCapabilities(registry, userId, workspaceId);
    const summary = this.formatMarkdownSummary(report);

    return `LIVE RUNTIME CAPABILITY MANIFEST (SOURCE OF TRUTH):
Below is your actual, live, verified runtime capability state. You MUST ALWAYS derive answers to capability questions ("what can you do?", "can you do X?", "do you have tool Y?") from this live state, NOT from any hardcoded assumptions.

${summary}

STRICT CAPABILITY & HONESTY DIRECTIVES:
1. Interactive Browser: Playwright Chromium browser automation is ${this.playwrightAvailable ? "AVAILABLE and executable via browser_action" : "CURRENTLY UNAVAILABLE in this workspace"}. NEVER say you cannot browse the live web interactively when Playwright is available!
2. Persistent Memory: Persistent workspace memory is ACTIVE via AgentMemoryManager. Do NOT say you have no memory between sessions!
3. Disconnected Services: For services marked "Available, but account not connected" (e.g. Slack, Notion, Google Workspace, Microsoft 365, or unauthenticated GitHub), you MUST state clearly: "<Service> integration is available, but your account is not connected yet." NEVER claim the tool does not exist!
4. AI Media Generation: Image/Video generation is planned for the dedicated GPU worker on GPU 1, but the GPU media worker is NOT currently deployed. Accurately explain that image generation is not executable until the GPU worker is deployed.
5. Dynamic Tool Discovery: You begin turns with core tools (tools_search, environment_inspect, capabilities_inspect, task_complete). Call 'tools_search' to dynamically activate specialized tools.
6. Real Autonomous Execution: When asked what you can do, summarize your live capabilities accurately using the categories above.`;
  }
}

export class CapabilitiesInspectTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "capabilities_inspect",
    description:
      "Inspect the live, verified runtime capability state of OrbaAgent. Returns real-time status across coding, browser, connected services, memory, and media worker availability.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "all",
            "coding_development",
            "web_browsing",
            "connected_services",
            "workspace_memory",
            "ai_media",
          ],
          description: "Optional category filter (default: 'all').",
        },
      },
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "capabilities_inspect",
    description: "Inspect live runtime capabilities, connected services, and system status",
    category: "system",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["capabilities", "tools", "status", "available", "can", "inspect", "runtime"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: true,
  };

  constructor(private readonly registry?: ToolRegistry) {}

  public async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || `tc_cap_${Date.now()}`);
    const category = String(args.category || "all");

    const manager = CapabilityManager.getInstance();
    await manager.checkMediaWorkerHealth();
    const registry = this.registry || new (await import("./registry.js")).ToolRegistry();
    const report = manager.inspectCapabilities(registry, context.userId, context.workspaceDir);

    if (category !== "all" && category in report.categories) {
      const items = (report.categories as any)[category];
      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: JSON.stringify({ category, items }, null, 2),
        metadata: { category, count: items.length },
        executionTimeMs: Date.now() - startTime,
      };
    }

    const summary = manager.formatMarkdownSummary(report);
    return {
      toolCallId,
      name: this.definition.name,
      success: true,
      output: summary,
      metadata: report as unknown as Record<string, unknown>,
      executionTimeMs: Date.now() - startTime,
    };
  }
}
