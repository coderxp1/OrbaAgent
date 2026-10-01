import type { ChatCompletionRequest } from "@orbaagent/shared";
import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";

describe("AnthropicAdapter", () => {
  const adapter = new AnthropicAdapter();

  const sampleRequest: ChatCompletionRequest = {
    modelId: "claude-3-5-sonnet-latest",
    messages: [{ role: "user", content: "Test Anthropic Claude streaming" }],
    stream: true,
    trace: {
      traceId: "test-anthropic-123",
      tenantId: "tenant-abc",
      userId: "user-456",
      conversationId: "conv-789",
      agentRunId: "run-001",
    },
  };

  it("should stream normalized events including thinking block from mock Anthropic provider", async () => {
    const events = [];
    for await (const event of adapter.streamChat(sampleRequest)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("thinking_delta");
    expect(eventTypes).toContain("text_delta");
    expect(eventTypes).toContain("usage");
    expect(eventTypes).toContain("done");
  });

  it("should return chat response from mock Anthropic provider", async () => {
    const response = await adapter.chat(sampleRequest);
    expect(response.text).toContain(
      "[Anthropic Claude Stream Output for claude-3-5-sonnet-latest]",
    );
    expect(response.thinking).toContain(
      "Claude 3.5 Sonnet formulating step-by-step reasoning plan",
    );
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.finishReason).toBe("end_turn");
  });
});
