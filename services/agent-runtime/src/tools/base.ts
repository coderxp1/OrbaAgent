import type { ToolDefinition, ToolExecutionResult } from "@orbaagent/shared";

export interface ToolExecutionContext {
  workspaceDir: string;
  tenantId: string;
  userId: string;
  agentRunId: string;
  githubToken?: string;
  env?: Record<string, string>;
}

export interface ITool {
  readonly definition: ToolDefinition;
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}
