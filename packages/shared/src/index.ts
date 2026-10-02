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
export const ProviderIdSchema = z.enum(["langdock", "openrouter", "local"]);
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
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  capabilities: z.array(ModelCapabilitySchema),
  costPerInputToken: z.number(),
  costPerOutputToken: z.number(),
  isDefault: z.boolean().optional(),
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

// Tool & Message Schemas
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

export const ChatMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: ChatMessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  thinking: z.string().optional(),
  timestamp: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const TraceMetadataSchema = z.object({
  traceId: z.string(),
  tenantId: z.string().default("default-tenant"),
  userId: z.string().default("default-user"),
  conversationId: z.string().default("default-conversation"),
  agentRunId: z.string().default("default-run"),
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
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

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
  "usage",
  "error",
  "done",
]);
export type NormalizedEventType = z.infer<typeof NormalizedEventTypeSchema>;

export const NormalizedEventSchema = z.object({
  type: NormalizedEventTypeSchema,
  traceId: z.string(),
  textDelta: z.string().optional(),
  thinkingDelta: z.string().optional(),
  toolCall: ToolCallSchema.optional(),
  usage: UsageStatsSchema.optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  finishReason: z.string().optional(),
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
