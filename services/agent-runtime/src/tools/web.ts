import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

export class WebFetchTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "fetch_web_page",
    description: "Fetch web content or documentation from a URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full HTTP/HTTPS URL to fetch.",
        },
      },
      required: ["url"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "fetch_web_page",
    description: "Fetch web content, documentation, or HTTP resources",
    category: "http",
    provider: "native",
    riskTier: "TIER_3_EXTERNAL",
    keywords: ["web", "http", "fetch", "url", "scrape", "documentation", "download"],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_web_${Date.now()}`;
    const url = String(args.url || "").trim();

    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: "Valid HTTP or HTTPS URL is required",
        executionTimeMs: Date.now() - startTime,
      };
    }

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "OrbaAgent-WebBot/0.1.0" },
      });
      if (!response.ok) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `HTTP request failed with status ${response.status}`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      const text = await response.text();
      const cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 5000);

      const secretManager = SecretManager.getInstance();
      const output = secretManager.redact(cleaned || "(empty page content)");

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: msg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
