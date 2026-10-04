import type { ToolDefinition, ToolExecutionResult } from "@orbaagent/shared";
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

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
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

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: cleaned || "(empty page content)",
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
