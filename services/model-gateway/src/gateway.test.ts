import type { ChatCompletionRequest } from "@orbaagent/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { ModelGateway } from "./gateway.js";

describe("ModelGateway", () => {
  beforeEach(() => {
    process.env.USE_MOCK_PROVIDERS = "true";
  });

  const gateway = new ModelGateway();

  const sampleRequest: ChatCompletionRequest = {
    modelId: "grok-2-latest",
    messages: [{ role: "user", content: "What is the OrbaAgent architecture?" }],
    stream: true,
    trace: {
      traceId: "test-trace-123",
      tenantId: "tenant-abc",
      userId: "user-456",
      conversationId: "conv-789",
      agentRunId: "run-001",
    },
  };

  it("should stream normalized events from xAI Grok provider", async () => {
    const events = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("thinking_delta");
    expect(eventTypes).toContain("text_delta");
    expect(eventTypes).toContain("usage");
    expect(eventTypes).toContain("done");
  });

  it("should generate audit log event upon stream completion", async () => {
    const events = [];
    for await (const event of gateway.streamChat(sampleRequest)) {
      events.push(event);
    }

    expect(gateway.auditLogs.length).toBeGreaterThan(0);
    const latestAudit = gateway.auditLogs[gateway.auditLogs.length - 1];
    expect(latestAudit.traceId).toBe("test-trace-123");
    expect(latestAudit.provider).toBe("xai");
    expect(latestAudit.model).toBe("grok-2-latest");
    expect(latestAudit.status).toBe("success");
    expect(latestAudit.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should complete non-streaming chat request with audit record", async () => {
    const nonStreamReq: ChatCompletionRequest = {
      ...sampleRequest,
      stream: false,
    };

    const response = await gateway.chat(nonStreamReq);
    expect(response.text).toBeTruthy();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.audit.traceId).toBe("test-trace-123");
  });
});
