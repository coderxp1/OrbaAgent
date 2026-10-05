import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolManifest,
  ToolMetadata,
} from "@orbaagent/shared";
import { IntegrationsManager } from "./integrations.js";
import { PermissionEngine } from "./permissions.js";
import { SecretManager } from "./secrets.js";
import type { ITool, ToolExecutionContext } from "./tools/base.js";
import { EnvironmentInspectTool } from "./tools/environment.js";
import {
  EditFileTool,
  ListFilesTool,
  ReadFileTool,
  WriteFileTool,
} from "./tools/filesystem.js";
import {
  FilesystemCopyTool,
  FilesystemDeleteTool,
  FilesystemMoveTool,
  FilesystemSearchTool,
  FilesystemStatTool,
} from "./tools/filesystemExtended.js";
import { GitTool } from "./tools/git.js";
import { GitHubTool } from "./tools/github.js";
import { ProcessManagerTool } from "./tools/processManager.js";
import { ShellTool } from "./tools/shell.js";
import { TaskCompleteTool } from "./tools/taskComplete.js";
import { IToolSearchableRegistry, ToolsSearchTool } from "./tools/toolsSearch.js";
import { WebFetchTool } from "./tools/web.js";
import { BrowserTool } from "./tools/browser.js";
import { PackageManagerTool } from "./tools/packageManager.js";
import { TestRunnerTool } from "./tools/testRunner.js";
import { CodeQualityTool } from "./tools/lintTypecheck.js";
import { MCPProvider } from "./mcp/provider.js";
import type { McpServerConfig } from "./mcp/transport.js";

export class ToolRegistry implements IToolSearchableRegistry {
  private readonly tools: Map<string, ITool> = new Map();
  private readonly coreToolNames: Set<string> = new Set([
    "tools_search",
    "environment_inspect",
    "task_complete",
  ]);
  private readonly activeToolNames: Set<string> = new Set();
  private readonly permissionEngine: PermissionEngine;
  private readonly secretManager: SecretManager;
  private readonly mcpProvider: MCPProvider = new MCPProvider();

  constructor() {
    this.permissionEngine = PermissionEngine.getInstance();
    this.secretManager = SecretManager.getInstance();
    this.registerDefaultTools();
    this.resetActiveToolsToCore();
  }

  public getMcpProvider(): MCPProvider {
    return this.mcpProvider;
  }

  public async registerMcpServer(config: McpServerConfig): Promise<ITool[]> {
    const tools = await this.mcpProvider.registerServer(config);
    for (const tool of tools) {
      this.registerTool(tool);
    }
    return tools;
  }

  private registerDefaultTools(): void {
    const searchTool = new ToolsSearchTool(this);

    const defaultTools: ITool[] = [
      searchTool,
      new EnvironmentInspectTool(),
      new TaskCompleteTool(),
      new ShellTool(),
      new ListFilesTool(),
      new ReadFileTool(),
      new WriteFileTool(),
      new EditFileTool(),
      new FilesystemSearchTool(),
      new FilesystemStatTool(),
      new FilesystemCopyTool(),
      new FilesystemMoveTool(),
      new FilesystemDeleteTool(),
      new GitTool(),
      new GitHubTool(),
      new ProcessManagerTool(),
      new WebFetchTool(),
      new BrowserTool(),
      new PackageManagerTool(),
      new TestRunnerTool(),
      new CodeQualityTool(),
    ];

    for (const tool of defaultTools) {
      this.registerTool(tool);
    }
  }

  public registerTool(tool: ITool): void {
    this.tools.set(tool.definition.name, tool);
    if (tool.metadata?.isCore) {
      this.coreToolNames.add(tool.definition.name);
      this.activeToolNames.add(tool.definition.name);
    }
  }

  public register(tool: ITool): void {
    this.registerTool(tool);
  }

  public getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  public getToolMetadata(name: string): ToolMetadata | undefined {
    const tool = this.tools.get(name);
    return tool?.metadata;
  }

  public resetActiveToolsToCore(): void {
    this.activeToolNames.clear();
    for (const name of this.coreToolNames) {
      if (this.tools.has(name)) {
        this.activeToolNames.add(name);
      }
    }
  }

  public activateTools(names: string[]): void {
    for (const name of names) {
      if (this.tools.has(name)) {
        this.activeToolNames.add(name);
      }
    }
  }

  public pruneTools(names?: string[]): void {
    if (!names) {
      this.resetActiveToolsToCore();
      return;
    }
    for (const name of names) {
      // Never prune core tools
      if (!this.coreToolNames.has(name)) {
        this.activeToolNames.delete(name);
      }
    }
  }

  public getActiveToolNames(): string[] {
    return Array.from(this.activeToolNames);
  }

  public getActiveToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const name of this.activeToolNames) {
      const tool = this.tools.get(name);
      if (tool) {
        definitions.push(tool.definition);
      }
    }
    return definitions;
  }

  public getAllToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * For orchestrator: returns active tool definitions by default,
   * or all tool definitions if all is explicitly true.
   */
  public getToolDefinitions(all = false): ToolDefinition[] {
    return all ? this.getAllToolDefinitions() : this.getActiveToolDefinitions();
  }

  public searchTools(query: string, category?: string, limit = 10): ToolMetadata[] {
    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const scoredTools: Array<{ metadata: ToolMetadata; score: number }> = [];

    for (const tool of this.tools.values()) {
      const meta = tool.metadata || {
        name: tool.definition.name,
        description: tool.definition.description,
        category: "system",
        provider: "native",
        riskTier: "TIER_0_READ",
        keywords: [],
        parameters: tool.definition.parameters,
        version: "1.0.0",
        isCore: false,
      };

      if (category && meta.category.toLowerCase() !== category.toLowerCase()) {
        continue;
      }

      let score = 0;
      const lowerName = meta.name.toLowerCase();
      const lowerDesc = meta.description.toLowerCase();
      const lowerKeywords = meta.keywords.map((k) => k.toLowerCase());

      for (const token of queryTokens) {
        if (lowerName === token) score += 10;
        else if (lowerName.includes(token)) score += 5;

        if (lowerKeywords.includes(token)) score += 6;
        else if (lowerKeywords.some((k) => k.includes(token))) score += 3;

        if (lowerDesc.includes(token)) score += 2;
        if (meta.category.toLowerCase().includes(token)) score += 4;
      }

      if (queryTokens.length === 0 || score > 0) {
        scoredTools.push({ metadata: meta, score });
      }
    }

    scoredTools.sort((a, b) => b.score - a.score);
    return scoredTools.slice(0, limit).map((s) => s.metadata);
  }

  public getToolManifest(workspaceId: string, userId: string): ToolManifest {
    const integrationsManager = IntegrationsManager.getInstance();
    const connectedServices = integrationsManager.getIntegrations(userId);

    const availableTools = Array.from(this.tools.keys());

    const permissions: Record<string, boolean> = {
      "shell.execute": true,
      "filesystem.read": true,
      "filesystem.write": true,
      "git.operations": true,
      "github.read": connectedServices.some((s) => s.name === "github" && s.connected),
      "web.fetch": true,
      "process.manage": true,
    };

    return {
      availableTools,
      connectedServices,
      workspaceId,
      permissions,
    };
  }

  /**
   * Generates dynamic capability system prompt text.
   */
  public generateCapabilityPrompt(workspaceId: string, userId: string): string {
    const manifest = this.getToolManifest(workspaceId, userId);

    const connectedSummary = manifest.connectedServices
      .map((s) => `- ${s.displayName}: ${s.connected ? "CONNECTED (Active)" : "NOT CONNECTED"}`)
      .join("\n");

    const coreToolsList = Array.from(this.coreToolNames).map((t) => `- ${t}`).join("\n");

    return `ACTIVE WORKSPACE & CAPABILITY RUNTIME MANIFEST:

CORE INITIAL DISCOVERY & CONTROL TOOLS:
${coreToolsList}

TOTAL REGISTERED CAPABILITIES IN REGISTRY:
${manifest.availableTools.length} tools available across categories: system, filesystem, process, git, github, http.
To discover and activate any specialized tool (e.g. filesystem search, stat, copy, move, delete, git operations, process manager, shell execution), CALL 'tools_search' with your intent!

CONNECTED SERVICES & INTEGRATIONS:
${connectedSummary}

STRICT CAPABILITY & HONESTY DIRECTIVES:
1. Dynamic Tool Discovery: You begin turns with core discovery tools (tools_search, environment_inspect, task_complete). Call 'tools_search' immediately when you require filesystem, git, process, or execution tools. They will be dynamically activated for you.
2. Real Executable Tools: Use your tools to DO the work directly. Never ask the user to run commands manually.
3. Connected Services: For connected services marked 'CONNECTED (Active)', you CAN perform actions directly using your tools.
4. Disconnected Services: For services marked 'NOT CONNECTED', YOU DO NOT HAVE ACCESS. You MUST state clearly that the service is not connected yet, and NEVER claim access.
5. Continuous Autonomous Execution: When executing multi-step workflows, DO NOT stop to say "Now let me run...". Continue executing tools until completed. Call task_complete when finished.`;
  }

  public async executeToolCall(
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        toolCallId,
        name,
        success: false,
        output: "",
        error: `Tool '${name}' is not registered in Agent Runtime`,
      };
    }

    const fullArgs = { ...args, _toolCallId: toolCallId };
    return tool.execute(fullArgs, context);
  }
}
