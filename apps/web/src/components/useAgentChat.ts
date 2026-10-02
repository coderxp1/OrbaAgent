"use client";

import type { ChatMessage, NormalizedEvent, UsageStats } from "@orbaagent/shared";
import { useCallback, useRef, useState } from "react";

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [latestUsage, setLatestUsage] = useState<UsageStats | null>(null);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (userContent: string) => {
      if (!userContent.trim() || isGenerating) return;

      setError(null);
      const userMsgId = `msg_user_${Date.now()}`;
      const assistantMsgId = `msg_ast_${Date.now()}`;
      const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      setActiveTraceId(traceId);

      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: userContent,
        timestamp: new Date().toISOString(),
      };

      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        thinking: "",
        toolCalls: [],
        timestamp: new Date().toISOString(),
      };

      const updatedMessages = [...messages, userMsg];
      setMessages([...updatedMessages, assistantMsg]);
      setIsGenerating(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            modelId: "auto",
            messages: updatedMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
            trace: {
              traceId,
              tenantId: "default-tenant",
              userId: "default-user",
              conversationId: "default-conv",
              agentRunId: `run_${Date.now()}`,
            },
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP error ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream reader available");

        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed === "data: [DONE]") break;

            if (trimmed.startsWith("data: ")) {
              try {
                const event = JSON.parse(trimmed.slice(6)) as NormalizedEvent;

                if (event.type === "stream_reset") {
                  setMessages((prev) =>
                    prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, content: "" } : msg)),
                  );
                } else if (event.type === "text_delta" && event.textDelta) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, content: msg.content + event.textDelta }
                        : msg,
                    ),
                  );
                } else if (event.type === "thinking_delta" && event.thinkingDelta) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, thinking: (msg.thinking || "") + event.thinkingDelta }
                        : msg,
                    ),
                  );
                } else if (event.type === "tool_call_start" && event.toolCall) {
                  const tc = event.toolCall;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== assistantMsgId) return msg;
                      const existing = msg.toolCalls || [];
                      return { ...msg, toolCalls: [...existing, tc] };
                    }),
                  );
                } else if (event.type === "usage" && event.usage) {
                  setLatestUsage(event.usage);
                } else if (event.type === "error" && event.error) {
                  setError({ code: event.error.code, message: event.error.message });
                }
              } catch {
                // Non-JSON SSE chunk fallback
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User explicitly cancelled generation
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError({ code: "client_error", message: msg });
        }
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [isGenerating, messages],
  );

  const retryLastMessage = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      setMessages((prev) => prev.slice(0, -1)); // Remove failed assistant msg
      sendMessage(lastUserMsg.content);
    }
  }, [messages, sendMessage]);

  const clearChat = useCallback(() => {
    cancelGeneration();
    setMessages([]);
    setError(null);
    setLatestUsage(null);
    setActiveTraceId(null);
  }, [cancelGeneration]);

  return {
    messages,
    isGenerating,
    error,
    latestUsage,
    activeTraceId,
    sendMessage,
    cancelGeneration,
    retryLastMessage,
    clearChat,
  };
}
