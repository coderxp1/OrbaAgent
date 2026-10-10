import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  version: z.string(),
  commitSha: z.string(),
  uptime: z.number(),
  timestamp: z.string().datetime(),
  checks: z
    .object({
      postgres: z.enum(["up", "down"]),
      redis: z.enum(["up", "down"]),
    })
    .optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const UserRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export class OrbaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "OrbaError";
  }
}

// Model Registry & Provider Schemas
export const ProviderIdSchema = z.enum(["langdock", "openrouter", "ollama"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ModelCapabilitySchema = z.enum([
  "text",
  "vision",
  "streaming",
  "tool_calling",
  "json_mode",
  "thinking",
]);
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

export const ModelSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: ProviderIdSchema,
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  capabilities: z.array(ModelCapabilitySchema),
  costPerInputToken: z.number().optional(),
  costPerOutputToken: z.number().optional(),
  isUnconfirmed: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

// Tool & Message Schemas
export const ToolCategorySchema = z.enum([
  "system",
  "filesystem",
  "process",
  "git",
  "github",
  "browser",
  "http",
  "runtime",
  "package",
  "testing",
  "docker",
  "database",
  "cloud",
  "communication",
  "calendar",
  "knowledge",
  "documents",
  "media",
  "mcp",
  "ci",
  "jobs",
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const ToolProviderTypeSchema = z.enum(["native", "mcp", "connector"]);
export type ToolProviderType = z.infer<typeof ToolProviderTypeSchema>;

export const PermissionTierSchema = z.enum([
  "TIER_0_READ",
  "TIER_1_WRITE",
  "TIER_2_EXEC",
  "TIER_3_EXTERNAL",
  "TIER_4_DESTRUCTIVE",
]);
export type PermissionTier = z.infer<typeof PermissionTierSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: ToolCategorySchema,
  provider: ToolProviderTypeSchema,
  riskTier: PermissionTierSchema,
  keywords: z.array(z.string()).default([]),
  requiredConnection: z.string().optional(),
  requiredRuntime: z.string().optional(),
  requiresApproval: z.boolean().default(false).optional(),
  parameters: z.record(z.unknown()),
  version: z.string().default("1.0.0").optional(),
  isCore: z.boolean().default(false).optional(),
});
export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  traceId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  agentRunId: z.string(),
  toolName: z.string(),
  category: ToolCategorySchema.optional(),
  riskTier: PermissionTierSchema,
  action: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
  redactedArgs: z.record(z.unknown()).optional(),
  success: z.boolean().optional(),
  executionTimeMs: z.number().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const ToolExecutionResultSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  success: z.boolean(),
  output: z.string(),
  error: z.string().optional(),
  executionTimeMs: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;

export const AgentFileChangeStatusSchema = z.enum(["created", "modified", "deleted", "renamed"]);
export type AgentFileChangeStatus = z.infer<typeof AgentFileChangeStatusSchema>;

export const AgentFileChangeSchema = z.object({
  changeId: z.string(),
  agentRunId: z.string(),
  messageId: z.string().optional(),
  workspaceId: z.string(),
  path: z.string(),
  filename: z.string(),
  status: AgentFileChangeStatusSchema,
  previousPath: z.string().optional(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  diff: z.string().optional(),
  reviewStatus: z.enum(["pending", "accepted", "rejected"]).default("pending"),
  timestamp: z.string().optional(),
});
export type AgentFileChange = z.infer<typeof AgentFileChangeSchema>;

export const ChatMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: ChatMessageRoleSchema,
  content: z.union([
    z.string(),
    z.array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
        image_url: z.object({ url: z.string() }).optional(),
      })
    ),
  ]),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolResults: z.array(ToolExecutionResultSchema).optional(),
  thinking: z.string().optional(),
  timestamp: z.string().optional(),
  fileChanges: z.array(AgentFileChangeSchema).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const TraceMetadataSchema = z.object({
  traceId: z.string(),
  tenantId: z.string().default("default-tenant"),
  userId: z.string().default("default-user"),
  conversationId: z.string().default("default-conversation"),
  agentRunId: z.string().default("default-run"),
  githubToken: z.string().optional(),
  executionSessionId: z.string().optional(),
});
export type TraceMetadata = z.infer<typeof TraceMetadataSchema>;

export const RoutingStrategySchema = z.enum([
  "auto",
  "cost_optimized",
  "high_reasoning",
  "fast_response",
  "fallback",
]);
export type RoutingStrategy = z.infer<typeof RoutingStrategySchema>;

export const ChatCompletionRequestSchema = z.object({
  modelId: z.string().optional().default("auto"),
  messages: z.array(ChatMessageSchema),
  systemPrompt: z.string().optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().default(true),
  trace: TraceMetadataSchema,
  attachments: z
    .array(
      z.object({
        artifactId: z.string(),
        name: z.string().optional(),
        type: z.string().optional(),
        size: z.number().int().nonnegative().optional(),
        relPath: z.string().optional(),
      }),
    )
    .optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export const IntegrationNameSchema = z.enum([
  "github",
  "slack",
  "notion",
  "email",
  "gmail",
  "jira",
  "atlassian",
  "linear",
  "google_calendar",
  "teams",
  "outlook",
  "salesforce",
  "asana",
  "box",
  "google_drive",
  "sharepoint",
  "google_workspace",
  "microsoft_365",
  "vercel",
  "cloudflare",
  "supabase",
]);
export type IntegrationName = z.infer<typeof IntegrationNameSchema>;

export const JobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "PAUSED",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: JobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  progress: z.number().min(0).max(100).optional(),
  payload: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const IntegrationStatusSchema = z.object({
  name: IntegrationNameSchema,
  displayName: z.string(),
  connected: z.boolean(),
  accountName: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  lastSyncedAt: z.string().optional(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const ToolManifestSchema = z.object({
  availableTools: z.array(z.string()),
  connectedServices: z.array(IntegrationStatusSchema),
  workspaceId: z.string(),
  permissions: z.record(z.boolean()),
});
export type ToolManifest = z.infer<typeof ToolManifestSchema>;

export const UsageStatsSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type UsageStats = z.infer<typeof UsageStatsSchema>;

export const NormalizedEventTypeSchema = z.enum([
  "text_delta",
  "thinking_delta",
  "tool_call_start",
  "tool_call_delta",
  "tool_call_end",
  "tool_call_result",
  "agent_activity",
  "usage",
  "error",
  "done",
  "stream_reset",
  "terminal_command_start",
  "terminal_stdout",
  "terminal_stderr",
  "terminal_exit",
  "file_changes_detected",
  "tools_discovered",
  "permission_requested",
  "permission_granted",
  "permission_denied",
  "audit_logged",
]);
export type NormalizedEventType = z.infer<typeof NormalizedEventTypeSchema>;

export const AgentActivitySchema = z.object({
  step: z.string(),
  status: z.enum(["in_progress", "completed", "failed"]),
  details: z.string().optional(),
});
export type AgentActivity = z.infer<typeof AgentActivitySchema>;

export const NormalizedEventSchema = z.object({
  type: NormalizedEventTypeSchema,
  traceId: z.string(),
  textDelta: z.string().optional(),
  thinkingDelta: z.string().optional(),
  toolCall: ToolCallSchema.optional(),
  toolResult: ToolExecutionResultSchema.optional(),
  activity: AgentActivitySchema.optional(),
  usage: UsageStatsSchema.optional(),
  executionSessionId: z.string().optional(),
  command: z.string().optional(),
  exitCode: z.number().optional(),
  changes: z.array(AgentFileChangeSchema).optional(),
  discoveredTools: z.array(z.string()).optional(),
  auditEvent: AuditEventSchema.optional(),
  permissionDetails: z
    .object({
      toolName: z.string(),
      riskTier: PermissionTierSchema,
      action: z.string(),
      reason: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  finishReason: z.string().optional(),
  resetReason: z.string().optional(),
});
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

export const ProviderAttemptSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string(),
  status: z.enum(["success", "error", "timeout"]),
  latencyMs: z.number(),
  errorMessage: z.string().optional(),
});
export type ProviderAttempt = z.infer<typeof ProviderAttemptSchema>;

export const AuditLogEventSchema = z.object({
  traceId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  conversationId: z.string(),
  agentRunId: z.string(),
  provider: ProviderIdSchema,
  model: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  latencyMs: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  toolCallsCount: z.number(),
  status: z.enum(["success", "error", "cancelled"]),
  errorMessage: z.string().optional(),
  providerAttempts: z.array(ProviderAttemptSchema).optional(),
});
export type AuditLogEvent = z.infer<typeof AuditLogEventSchema>;

export {
  PathContainmentError,
  resolveWithinBase,
  tryResolveWithinBase,
} from "./lib/safePath.js";
