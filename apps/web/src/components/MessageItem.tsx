"use client";

import type { ChatMessage } from "@orbaagent/shared";
import { Brain, Check, Copy, User } from "lucide-react";
import { useState } from "react";
import { FileChangesReview } from "./FileChangesReview";
import { TerminalSession } from "./TerminalSession";

interface MessageItemProps {
  message: ChatMessage;
  onAcceptChange?: (changeId: string, runId?: string) => void;
  onRejectChange?: (changeId: string, runId?: string) => void;
  onAcceptAllChanges?: (runId?: string) => void;
  onRejectAllChanges?: (runId?: string) => void;
}

export function MessageItem({
  message,
  onAcceptChange,
  onRejectChange,
  onAcceptAllChanges,
  onRejectAllChanges,
}: MessageItemProps) {
  const isUser = message.role === "user";
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState<boolean>(true);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div
      className={`flex w-full gap-4 p-4 rounded-xl transition-colors ${
        isUser
          ? "bg-zinc-950/40 border border-zinc-900"
          : "bg-[#161616] border border-[#242424]"
      }`}
    >
      {/* Avatar: User icon vs Official Orba Mascot Logo */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden ${
          isUser
            ? "bg-zinc-800 text-zinc-300"
            : "bg-white p-1 ring-1 ring-white/20 shadow-md shadow-black/40"
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <img
            src="/orba-mascot.svg"
            alt="OrbaAgent Mascot"
            className="h-full w-full object-contain"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden text-sm">
        <div className="flex items-center justify-between font-semibold text-xs text-zinc-400">
          <span>{isUser ? "You" : "OrbaAgent"}</span>
          {message.timestamp && (
            <time className="font-mono text-zinc-500">
              {new Date(message.timestamp).toLocaleTimeString()}
            </time>
          )}
        </div>

        {/* Thinking / Planning Block */}
        {message.thinking && (
          <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-3 text-xs text-indigo-200">
            <button
              onClick={() => setShowThinking(!showThinking)}
              type="button"
              className="flex items-center gap-2 font-medium text-indigo-400 hover:text-indigo-300 transition-colors w-full text-left"
            >
              <Brain className="h-4 w-4 text-indigo-400 animate-pulse" />
              <span>Agent Thought &amp; Planning Process</span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-indigo-500 font-mono">
                {showThinking ? "Hide" : "Show"}
              </span>
            </button>
            {showThinking && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-indigo-300/90 border-t border-indigo-900/40 pt-2">
                {message.thinking}
              </pre>
            )}
          </div>
        )}

        {/* Unified Live Terminal Session */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <TerminalSession
            toolCalls={message.toolCalls}
            toolResults={message.toolResults}
            isLive={false}
          />
        )}

        {/* Agent File Changes Review Panel */}
        {message.fileChanges && message.fileChanges.length > 0 && (
          <FileChangesReview
            changes={message.fileChanges}
            onAccept={onAcceptChange ? (id) => onAcceptChange(id) : undefined}
            onReject={onRejectChange ? (id) => onRejectChange(id) : undefined}
            onAcceptAll={onAcceptAllChanges ? () => onAcceptAllChanges() : undefined}
            onRejectAll={onRejectAllChanges ? () => onRejectAllChanges() : undefined}
          />
        )}

        {/* Message Content */}
        {message.content ? (
          <div className="whitespace-pre-wrap leading-relaxed text-zinc-200">
            {message.content.includes("```") ? (
              <FormattedContent
                content={message.content}
                onCopy={handleCopy}
                copiedCode={copiedCode}
              />
            ) : (
              message.content
            )}
          </div>
        ) : (
          !message.thinking &&
          (!message.toolCalls || message.toolCalls.length === 0) && (
            <span className="inline-block animate-pulse text-zinc-500 text-xs italic">
              Thinking...
            </span>
          )
        )}
      </div>
    </div>
  );
}

function FormattedContent({
  content,
  onCopy,
  copiedCode,
}: {
  content: string;
  onCopy: (code: string) => void;
  copiedCode: string | null;
}) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="flex flex-col gap-3">
      {parts.map((part, idx) => {
        const itemKey = `part_${idx}_${part.slice(0, 10)}`;
        if (part.startsWith("```") && part.endsWith("```")) {
          const lines = part.slice(3, -3).trim().split("\n");
          const language = lines[0]?.match(/^[a-zA-Z0-9_-]+$/) ? lines[0] : "code";
          const codeBody = language === lines[0] ? lines.slice(1).join("\n") : lines.join("\n");

          return (
            <div
              key={itemKey}
              className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs text-zinc-400 font-mono">
                <span>{language}</span>
                <button
                  onClick={() => onCopy(codeBody)}
                  type="button"
                  className="flex items-center gap-1 hover:text-zinc-200 transition-colors"
                >
                  {copiedCode === codeBody ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-green-400" />
                      <span className="text-green-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-xs text-zinc-200 leading-relaxed">
                <code>{codeBody}</code>
              </pre>
            </div>
          );
        }
        return (
          <p key={itemKey} className="whitespace-pre-wrap">
            {part}
          </p>
        );
      })}
    </div>
  );
}

