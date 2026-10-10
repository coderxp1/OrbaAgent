"use client";

import type { ChatMessage } from "@orbaagent/shared";
import { Brain, Check, Copy, CornerUpLeft, ThumbsDown, ThumbsUp, User } from "lucide-react";
import { useState } from "react";
import { FileChangesReview } from "./FileChangesReview";
import { TerminalSession } from "./TerminalSession";

interface MessageItemProps {
  message: ChatMessage;
  onAcceptChange?: (changeId: string, runId?: string) => void;
  onRejectChange?: (changeId: string, runId?: string) => void;
  onAcceptAllChanges?: (runId?: string) => void;
  onRejectAllChanges?: (runId?: string) => void;
  onReply?: (content: string) => void;
}

export function MessageItem({
  message,
  onAcceptChange,
  onRejectChange,
  onAcceptAllChanges,
  onRejectAllChanges,
  onReply,
}: MessageItemProps) {
  const isUser = message.role === "user";
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState<boolean>(true);
  const [messageCopied, setMessageCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleCopyMessage = () => {
    if (!message.content) return;
    const textContent = typeof message.content === "string" 
      ? message.content 
      : message.content.map(p => p.type === "text" ? p.text : "").join("");
    navigator.clipboard.writeText(textContent);
    setMessageCopied(true);
    setTimeout(() => setMessageCopied(false), 2000);
  };

  const handleReply = () => {
    if (message.content && onReply) {
      const textContent = typeof message.content === "string" 
        ? message.content 
        : message.content.map(p => p.type === "text" ? p.text : "").join("");
      onReply(textContent);
    }
  };

  return (
    <div
      className={`group/msg flex w-full gap-4 p-4 rounded-xl transition-colors ${
        isUser ? "bg-zinc-950/40 border border-zinc-900" : "bg-[#161616] border border-[#242424]"
      }`}
    >
      {/* Avatar */}
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
        <div className="flex items-center gap-2 font-semibold text-xs text-zinc-400">
          <span>{isUser ? "You" : "OrbaAgent"}</span>
          {message.timestamp && (
            <time className="font-mono text-zinc-500 font-normal">
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
            {typeof message.content === "string" && message.content.includes("```") ? (
              <FormattedContent
                content={message.content}
                onCopy={handleCopy}
                copiedCode={copiedCode}
              />
            ) : typeof message.content === "string" ? (
              message.content
            ) : (
              message.content.map((p, idx) => p.type === "text" ? <span key={idx}>{p.text}</span> : <img key={idx} src={p.image_url.url} alt="attachment" className="max-w-full rounded mt-2" />)
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

        {/* Message Action Bar — appears on hover / focus */}
        {(message.content || message.thinking) && (
          <div className="flex items-center gap-1.5 pt-0.5 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 transition-opacity duration-150">
            <ActionIconButton
              onClick={handleCopyMessage}
              title={messageCopied ? "Copied!" : "Copy message"}
              active={messageCopied}
              activeClass="border-emerald-500/40 bg-emerald-950/30 text-emerald-400"
            >
              {messageCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </ActionIconButton>

            {onReply && (
              <ActionIconButton onClick={handleReply} title="Quote & reply">
                <CornerUpLeft className="h-3.5 w-3.5" />
              </ActionIconButton>
            )}

            {!isUser && (
              <>
                <ActionIconButton
                  onClick={() => setFeedback(feedback === "up" ? null : "up")}
                  title="Good response"
                  active={feedback === "up"}
                  activeClass="border-emerald-500/40 bg-emerald-950/30 text-emerald-400"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </ActionIconButton>
                <ActionIconButton
                  onClick={() => setFeedback(feedback === "down" ? null : "down")}
                  title="Bad response"
                  active={feedback === "down"}
                  activeClass="border-red-500/40 bg-red-950/30 text-red-400"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </ActionIconButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionIconButton({
  children,
  onClick,
  title,
  active = false,
  activeClass = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  activeClass?: string;
}) {
  return (
    <div className="relative group/btn flex items-center justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-zinc-500 ${
          active
            ? activeClass
            : "border-[#2c2c30] bg-[#1e1e22] text-zinc-400 hover:border-zinc-600 hover:bg-[#28282e] hover:text-white shadow-sm"
        }`}
      >
        {children}
      </button>
      <div className="pointer-events-none absolute bottom-full mb-1.5 hidden group-hover/btn:flex flex-col items-center z-30">
        <div className="rounded-md bg-[#18181b] border border-zinc-700/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200 shadow-xl whitespace-nowrap">
          {title}
        </div>
        <div className="w-1.5 h-1.5 bg-[#18181b] border-r border-b border-zinc-700/60 transform rotate-45 -mt-1" />
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
