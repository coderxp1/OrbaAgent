import type { ChatCompletionRequest } from "@orbaagent/shared";
import { describe, expect, it } from "vitest";
import { GoogleAdapter } from "./google.js";

describe("GoogleAdapter", () => {
  const adapter = new GoogleAdapter();

  const sampleRequest: ChatCompletionRequest = {
    modelId: "gemini-1.5-pro-latest",
    messages: [{ role: "user", content: "Test Google Gemini streaming" }],
    stream: true,
    trace: {
      traceId: "test-google-123",
      tenantId: "tenant-abc",
      userId: "user-456",
      conversationId: "conv-789",
      agentRunId: "run-001",
    },
  };

  it("should stream normalized events from mock Google Gemini provider", async () => {
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

  it("should return chat response from mock Google Gemini provider", async () => {
    const response = await adapter.chat(sampleRequest);
    expect(response.text).toContain("[Google Gemini Stream Output for gemini-1.5-pro-latest]");
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.finishReason).toBe("STOP");
  });
});
