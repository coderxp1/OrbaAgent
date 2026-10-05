import { describe, expect, it } from "vitest";
import { HealthResponseSchema, OrbaError } from "./index.js";

describe("Shared Package Tests", () => {
  it("validates healthy health response schema", () => {
    const valid = {
      status: "ok",
      version: "0.1.0",
      commitSha: "abc1234",
      uptime: 42.5,
      timestamp: new Date().toISOString(),
      checks: {
        postgres: "up",
        redis: "up",
      },
    };
    const parsed = HealthResponseSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates degraded/error health response schema", () => {
    const errorState = {
      status: "error",
      version: "0.1.0",
      commitSha: "abc1234",
      uptime: 10.2,
      timestamp: new Date().toISOString(),
      checks: {
        postgres: "down",
        redis: "up",
      },
    };
    const parsed = HealthResponseSchema.safeParse(errorState);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid status in health response", () => {
    const invalid = {
      status: "degraded",
      version: "0.1.0",
      commitSha: "abc1234",
      uptime: 5,
      timestamp: new Date().toISOString(),
    };
    const parsed = HealthResponseSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("instantiates OrbaError with status code and code", () => {
    const err = new OrbaError("Unauthorized access", "UNAUTHORIZED", 401);
    expect(err.message).toBe("Unauthorized access");
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.statusCode).toBe(401);
  });

  it("validates ToolMetadataSchema and PermissionTierSchema", async () => {
    const { ToolMetadataSchema } = await import("./index.js");
    const validMeta = {
      name: "filesystem_search",
      description: "Search workspace files using regex or glob",
      category: "filesystem",
      provider: "native",
      riskTier: "TIER_0_READ",
      keywords: ["grep", "find", "search", "glob"],
      parameters: { query: { type: "string" } },
      isCore: false,
    };
    const parsed = ToolMetadataSchema.safeParse(validMeta);
    expect(parsed.success).toBe(true);
  });

  it("validates AuditEventSchema", async () => {
    const { AuditEventSchema } = await import("./index.js");
    const validAudit = {
      id: "audit-123",
      timestamp: new Date().toISOString(),
      traceId: "trace-456",
      tenantId: "tenant-1",
      userId: "user-1",
      agentRunId: "run-1",
      toolName: "filesystem_delete",
      category: "filesystem",
      riskTier: "TIER_4_DESTRUCTIVE",
      action: "delete_file",
      approved: true,
      reason: "User requested cleanup",
      redactedArgs: { path: "temp.txt" },
      success: true,
      executionTimeMs: 15,
    };
    const parsed = AuditEventSchema.safeParse(validAudit);
    expect(parsed.success).toBe(true);
  });
});

