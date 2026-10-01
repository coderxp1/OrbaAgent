import type { ChatCompletionRequest } from "@orbaagent/shared";
import { describe, expect, it } from "vitest";
import { OpenAIAdapter } from "./openai.js";

describe("OpenAIAdapter", () => {
  const adapter = new OpenAIAdapter();

  const sampleRequest: ChatCompletionRequest = {
    modelId: "gpt-4o",
    messages: [{ role: "user", content: "Test OpenAI streaming" }],
    stream: true,
    trace: {
      traceId: "test-openai-123",
      tenantId: "tenant-abc",
      userId: "user-456",
      conversationId: "conv-789",
      agentRunId: "run-001",
    },
  };

  it("should stream normalized events from mock OpenAI provider", async () => {
    const events = [];
    for await (const event of adapter.streamChat(sampleRequest)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("text_delta");
    expect(eventTypes).toContain("usage");
    expect(eventTypes).toContain("done");
  });

  it("should return chat response from mock OpenAI provider", async () => {
    const response = await adapter.chat(sampleRequest);
    expect(response.text).toContain("[OpenAI Stream Output for gpt-4o]");
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.finishReason).toBe("stop");
  });
});
