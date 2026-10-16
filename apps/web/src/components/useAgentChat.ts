"use client";

import type { AgentActivity, ChatMessage, NormalizedEvent, UsageStats } from "@orbaagent/shared";
import { useCallback, useRef, useState } from "react";

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [latestUsage, setLatestUsage] = useState<UsageStats | null>(null);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [activeActivity, setActiveActivity] = useState<AgentActivity | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (
      userContent: string,
      attachments?: Array<{
        artifactId: string;
        name?: string;
        type?: string;
        size?: number;
        relPath?: string;
        file?: File;
      }>,
    ) => {
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
        const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
        const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

        let apiPayloadContent: any = userContent;
        if (attachments?.some((a) => a.type?.startsWith("image/"))) {
          const parts: any[] = [{ type: "text", text: userContent }];
          for (const att of attachments) {
            if (att.type?.startsWith("image/")) {
              if (!SUPPORTED_IMAGE_TYPES.includes(att.type)) {
                setError({
                  code: "unsupported_image",
                  message: `Unsupported image format: ${att.type}. Supported formats: JPEG, PNG, WEBP, GIF.`,
                });
                setIsGenerating(false);
                setMessages(messages);
                return;
              }
              if ((att.size || 0) > MAX_IMAGE_SIZE) {
                setError({
                  code: "image_too_large",
                  message: `Image exceeds 5MB limit: ${att.name || "Unknown"}`,
                });
                setIsGenerating(false);
                setMessages(messages);
                return;
              }
              if (!att.file) {
                setError({
                  code: "image_read_error",
                  message: `File data missing for image: ${att.name || "Unknown"}`,
                });
                setIsGenerating(false);
                setMessages(messages);
                return;
              }
              try {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(att.file as File);
                });
                parts.push({ type: "image_url", image_url: { url: dataUrl } });
              } catch (e) {
                setError({
                  code: "image_read_error",
                  message: `Failed to read image: ${att.name || "Unknown"}`,
                });
                setIsGenerating(false);
                setMessages(messages);
                return;
              }
            }
          }
          apiPayloadContent = parts;
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            modelId: "auto",
            messages: updatedMessages.map((m) => ({
              role: m.role,
              content: m.id === userMsgId ? apiPayloadContent : m.content,
            })),
            stream: true,
            attachments:
              attachments && attachments.length > 0
                ? attachments.map((a) => ({
                    artifactId: a.artifactId,
                    name: a.name,
                    type: a.type,
                    size: a.size,
                    relPath: a.relPath,
                  }))
                : undefined,
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
          const details = errData?.error ? `: ${errData.error}` : "";
          throw new Error(`HTTP ${response.status}${details}`);
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
                        ? {
                            ...msg,
                            content:
                              (typeof msg.content === "string" ? msg.content : "") +
                              event.textDelta,
                          }
                        : msg,
                    ),
                  );
                } else if (event.type === "thinking_delta" && event.thinkingDelta) {
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== assistantMsgId) return msg;
                      const currentThinking = msg.thinking || "";
                      const delta = event.thinkingDelta || "";
                      if (currentThinking.endsWith(delta)) {
                        return msg;
                      }
                      return { ...msg, thinking: currentThinking + delta };
                    }),
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
                } else if (event.type === "tool_call_result" && event.toolResult) {
                  const tr = event.toolResult;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== assistantMsgId) return msg;
                      const existing = msg.toolResults || [];
                      return { ...msg, toolResults: [...existing, tr] };
                    }),
                  );
                } else if (event.type === "agent_activity" && event.activity) {
                  setActiveActivity(event.activity);
                } else if (event.type === "file_changes_detected" && event.changes) {
                  const detectedChanges = event.changes;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== assistantMsgId) return msg;
                      return { ...msg, fileChanges: detectedChanges };
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
          // Normalize common fetch/network failures for clearer UX
          const lower = msg.toLowerCase();
          const isNetwork =
            lower.includes("networkerror") ||
            lower.includes("network error") ||
            lower.includes("failed to fetch") ||
            lower.includes("fetch failed") ||
            lower.includes("load failed") ||
            lower.includes("typeerror");
          setError({
            code: isNetwork ? "CLIENT_ERROR" : "client_error",
            message: isNetwork
              ? "network error — verify the API is reachable and streaming is allowed through the proxy"
              : msg,
          });
        }
      } finally {
        setIsGenerating(false);
        setActiveActivity(null);
        abortControllerRef.current = null;
      }
    },
    [isGenerating, messages],
  );

  const reviewFileChange = useCallback(
    async (
      action: "accept" | "reject" | "accept_all" | "reject_all",
      changeId?: string,
      agentRunId?: string,
    ) => {
      try {
        await fetch("/api/changes/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, changeId, agentRunId }),
        });

        // Optimistically update local message state
        setMessages((prev) =>
          prev.map((msg) => {
            if (!msg.fileChanges || msg.fileChanges.length === 0) return msg;
            const updated = msg.fileChanges.map((change) => {
              if (action === "accept_all") {
                return { ...change, reviewStatus: "accepted" as const };
              }
              if (action === "reject_all") {
                return { ...change, reviewStatus: "rejected" as const };
              }
              if (change.changeId === changeId) {
                return {
                  ...change,
                  reviewStatus: (action === "accept" ? "accepted" : "rejected") as
                    | "accepted"
                    | "rejected",
                };
              }
              return change;
            });
            return { ...msg, fileChanges: updated };
          }),
        );
      } catch (err) {
        console.error("Failed to review file change:", err);
      }
    },
    [],
  );

  const retryLastMessage = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      setMessages((prev) => prev.slice(0, -1)); // Remove failed assistant msg
      sendMessage(
        typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : lastUserMsg.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
      );
    }
  }, [messages, sendMessage]);

  const clearChat = useCallback(() => {
    cancelGeneration();
    setMessages([]);
    setError(null);
    setLatestUsage(null);
    setActiveTraceId(null);
    setActiveActivity(null);
  }, [cancelGeneration]);

  const loadMessages = useCallback(
    (newMessages: ChatMessage[]) => {
      cancelGeneration();
      setMessages(newMessages);
      setError(null);
      setLatestUsage(null);
      setActiveTraceId(null);
      setActiveActivity(null);
    },
    [cancelGeneration],
  );

  return {
    messages,
    isGenerating,
    error,
    latestUsage,
    activeTraceId,
    activeActivity,
    sendMessage,
    cancelGeneration,
    retryLastMessage,
    clearChat,
    loadMessages,
    reviewFileChange,
  };
}
