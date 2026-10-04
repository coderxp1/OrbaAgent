import type { ToolDefinition, ToolExecutionResult, ToolManifest } from "@orbaagent/shared";
import { IntegrationsManager } from "./integrations.js";
import type { ITool, ToolExecutionContext } from "./tools/base.js";
import { EditFileTool, ListFilesTool, ReadFileTool, WriteFileTool } from "./tools/filesystem.js";
import { GitTool } from "./tools/git.js";
import { GitHubTool } from "./tools/github.js";
import { ShellTool } from "./tools/shell.js";
import { WebFetchTool } from "./tools/web.js";

export class ToolRegistry {
  private readonly tools: Map<string, ITool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    const defaultTools: ITool[] = [
      new ShellTool(),
      new ListFilesTool(),
      new ReadFileTool(),
      new WriteFileTool(),
      new EditFileTool(),
      new GitTool(),
      new GitHubTool(),
      new WebFetchTool(),
    ];

    for (const tool of defaultTools) {
      this.tools.set(tool.definition.name, tool);
    }
  }

  registerTool(tool: ITool): void {
    this.tools.set(tool.definition.name, tool);
  }

  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getToolManifest(workspaceId: string, userId: string): ToolManifest {
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
    };

    return {
      availableTools,
      connectedServices,
      workspaceId,
      permissions,
    };
  }

  /**
   * Generates dynamic capability system prompt text based on connected vs disconnected services.
   * Enforces honesty: model MUST NEVER claim capabilities for disconnected integrations!
   */
  generateCapabilityPrompt(workspaceId: string, userId: string): string {
    const manifest = this.getToolManifest(workspaceId, userId);

    const connectedSummary = manifest.connectedServices
      .map((s) => `- ${s.displayName}: ${s.connected ? "CONNECTED (Active)" : "NOT CONNECTED"}`)
      .join("\n");

    const toolsSummary = manifest.availableTools.map((t) => `- ${t}`).join("\n");

    return `ACTIVE WORKSPACE & INTEGRATIONS MANIFEST:

AVAILABLE REAL EXECUTABLE TOOLS:
${toolsSummary}

CONNECTED SERVICES & INTEGRATIONS:
${connectedSummary}

STRICT CAPABILITY & HONESTY DIRECTIVES:
1. You have REAL EXECUTABLE TOOLS available for shell execution, filesystem reading/writing/editing, git operations, and web fetching.
2. When asked to inspect a repository, execute shell commands, run tests, or modify files, DO NOT ask the user to run commands manually. Use your tools to DO the work!
3. For connected services marked 'CONNECTED (Active)', you CAN perform actions directly using your tools.
4. For services marked 'NOT CONNECTED' (such as Slack, Notion, Email, Jira, or unconnected GitHub accounts), YOU DO NOT HAVE ACCESS. You MUST state clearly to the user that the service is not connected yet, and NEVER pretend or claim you can access them until connected.
5. Maintain a natural, direct conversation style. Do NOT introduce yourself with "Hi — OrbaAgent here" or repeat "OrbaAgent can..." in every response. Simply answer naturally.`;
  }

  async executeToolCall(
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
