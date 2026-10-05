import type { ToolDefinition, ToolExecutionResult } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";

export class TaskCompleteTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "task_complete",
    description:
      "Call this tool when you have fully completed the requested task or objective. Provide a conclusive summary of the completed work, verified test results, and final findings.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Clear, comprehensive summary of the work executed and results achieved.",
        },
        verified: {
          type: "boolean",
          description: "Whether all tests, builds, or checks passed successfully.",
        },
      },
      required: ["summary"],
    },
  };

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_complete_${Date.now()}`;
    const summary = String(args.summary || "Task completed successfully.");
    const verified = args.verified !== false;

    return {
      toolCallId,
      name: this.definition.name,
      success: true,
      output: `[TASK_COMPLETE] ${verified ? "Verified Success" : "Completed"}: ${summary}`,
      executionTimeMs: Date.now() - startTime,
      metadata: { summary, verified },
    };
  }
}
