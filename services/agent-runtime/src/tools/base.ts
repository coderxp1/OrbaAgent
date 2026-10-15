import type { ToolDefinition, ToolExecutionResult, ToolMetadata } from "@orbaagent/shared";

export interface ToolExecutionContext {
  workspaceDir: string;
  tenantId: string;
  userId: string;
  agentRunId: string;
  githubToken?: string;
  env?: Record<string, string>;
  traceId?: string;
  isPreApproved?: boolean;
  attachments?: Array<{
    artifactId: string;
    name?: string;
    type?: string;
    size?: number;
    relPath?: string;
  }>;
}

export interface ITool {
  readonly definition: ToolDefinition;
  readonly metadata?: ToolMetadata;
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}
