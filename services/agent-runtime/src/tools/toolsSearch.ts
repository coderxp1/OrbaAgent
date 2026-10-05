import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";

export interface IToolSearchableRegistry {
  searchTools(query: string, category?: string, limit?: number): ToolMetadata[];
  activateTools(names: string[]): void;
}

export class ToolsSearchTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "tools_search",
    description:
      "Search and dynamically discover tools from the OrbaAgent capability registry. Use this to find capabilities for filesystem manipulation, git operations, process management, packages, testing, browser, or external services.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keywords or capability description (e.g. 'search files', 'git rebase', 'process manager', 'stat', 'delete file')",
        },
        category: {
          type: "string",
          description:
            "Optional category filter: system, filesystem, process, git, github, browser, http, runtime, package, testing, docker, database, cloud, communication, calendar, knowledge, documents, media, mcp",
        },
        limit: {
          type: "number",
          description: "Maximum tools to return (default: 8)",
        },
      },
      required: ["query"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "tools_search",
    description: "Search and discover available tools and capabilities in the registry",
    category: "system",
    provider: "native",
    riskTier: "TIER_0_READ",
    keywords: ["tools", "search", "discover", "capabilities", "registry", "find"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: true,
  };

  private registry?: IToolSearchableRegistry;

  constructor(registry?: IToolSearchableRegistry) {
    this.registry = registry;
  }

  public setRegistry(registry: IToolSearchableRegistry): void {
    this.registry = registry;
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const toolCallId = String(args._toolCallId || "call_tools_search");
    const query = String(args.query || "").trim();
    const category = args.category ? String(args.category).trim() : undefined;
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(25, args.limit)) : 8;

    if (!query) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Missing required argument 'query'",
      };
    }

    if (!this.registry) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Registry search interface is not configured.",
      };
    }

    const matches = this.registry.searchTools(query, category, limit);

    // Auto-activate discovered tools into the active registry
    const toolNames = matches.map((m) => m.name);
    if (toolNames.length > 0) {
      this.registry.activateTools(toolNames);
    }

    const summary = matches.map((m) => ({
      name: m.name,
      category: m.category,
      riskTier: m.riskTier,
      description: m.description,
      provider: m.provider,
      requiresApproval: m.requiresApproval,
    }));

    const output =
      matches.length === 0
        ? `No tools matched query '${query}'. Try broader keywords (e.g. 'filesystem', 'git', 'process', 'search').`
        : `Discovered and activated ${matches.length} tool(s):\n${JSON.stringify(summary, null, 2)}`;

    return {
      toolCallId,
      name: this.definition.name,
      success: true,
      output,
      metadata: {
        query,
        count: matches.length,
        discoveredTools: toolNames,
      },
    };
  }
}
