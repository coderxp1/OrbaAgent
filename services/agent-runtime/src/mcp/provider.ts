import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "../tools/base.js";
import { McpStdioClient, type McpServerConfig } from "./transport.js";

export class McpToolWrapper implements ITool {
  public readonly definition: ToolDefinition;
  public readonly metadata: ToolMetadata;

  constructor(
    private readonly client: McpStdioClient,
    private readonly originalName: string,
    toolName: string,
    description: string,
    parameters: Record<string, unknown>,
  ) {
    this.definition = {
      name: toolName,
      description: `[MCP: ${client.config.name}] ${description}`,
      parameters,
    };

    this.metadata = {
      name: toolName,
      description: this.definition.description,
      category: "mcp",
      provider: "mcp",
      riskTier: "TIER_2_EXEC",
      keywords: ["mcp", client.config.name, originalName, "tool", "integration"],
      parameters: this.definition.parameters,
      version: "1.0.0",
      isCore: false,
    };
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || `tc_mcp_${Date.now()}`);

    try {
      const cleanArgs = { ...args };
      delete cleanArgs._toolCallId;
      delete cleanArgs._managedPids;

      const response = await this.client.callTool(this.originalName, cleanArgs);
      const textOutput =
        response.content
          ?.filter((c: { type: string; text?: string }) => c.type === "text" && Boolean(c.text))
          .map((c: { type: string; text?: string }) => c.text)
          .join("\n") || "(MCP returned empty response)";

      return {
        toolCallId,
        name: this.definition.name,
        success: !response.isError,
        output: textOutput,
        executionTimeMs: Date.now() - startTime,
        metadata: { mcpServer: this.client.config.name, isError: response.isError },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: `MCP call failed: ${msg}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export class MCPProvider {
  private readonly clients: Map<string, McpStdioClient> = new Map();

  public async registerServer(config: McpServerConfig): Promise<ITool[]> {
    const client = new McpStdioClient(config);
    await client.connect();
    this.clients.set(config.name, client);

    const mcpTools = await client.listTools();
    const tools: ITool[] = [];

    for (const t of mcpTools) {
      const registeredName = `mcp_${config.name}_${t.name}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const wrapper = new McpToolWrapper(
        client,
        t.name,
        registeredName,
        t.description || `Tool ${t.name} from MCP server ${config.name}`,
        t.inputSchema || { type: "object", properties: {} },
      );
      tools.push(wrapper);
    }

    return tools;
  }

  public getClient(name: string): McpStdioClient | undefined {
    return this.clients.get(name);
  }

  public async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
  }
}
