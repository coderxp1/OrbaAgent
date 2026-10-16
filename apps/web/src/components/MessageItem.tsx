"use client";

import type { ChatMessage, ToolCall, ToolExecutionResult } from "@orbaagent/shared";
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerUpLeft,
  Download,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import React, { useState } from "react";
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
    const textContent =
      typeof message.content === "string"
        ? message.content
        : message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
    navigator.clipboard.writeText(textContent);
    setMessageCopied(true);
    setTimeout(() => setMessageCopied(false), 2000);
  };

  const handleReply = () => {
    if (message.content && onReply) {
      const textContent =
        typeof message.content === "string"
          ? message.content
          : message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
      onReply(textContent);
    }
  };

  const terminalToolCalls = (message.toolCalls || []).filter(
    (c) => c.name !== "media_image_generate" && c.name !== "media_video_generate",
  );
  const mediaToolCalls = (message.toolCalls || []).filter(
    (c) => c.name === "media_image_generate" || c.name === "media_video_generate",
  );
  const textContent =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((p) => (p.type === "text" ? p.text : "")).join("")
        : "";

  // 1. User Message: Aligned to right, self-contained message bubble (ChatGPT style)
  if (isUser) {
    return (
      <div className="group/msg flex w-full justify-end px-2 sm:px-0">
        <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%]">
          <div className="rounded-3xl bg-[#2a2a2e] text-zinc-100 px-5 py-3 text-[15px] leading-relaxed shadow-sm border border-zinc-700/40 select-text whitespace-pre-wrap">
            {textContent}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 transition-opacity">
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
            {message.timestamp && (
              <span className="text-[11px] text-zinc-500 font-mono pr-1">
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Assistant Message: Unboxed, left-aligned, flowing on canvas with Orba mascot
  return (
    <div className="group/msg flex w-full gap-4 px-2 sm:px-0 py-2">
      {/* Orba Mascot Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 p-1.5 shadow-sm mt-0.5">
        <img
          src="/orba-mascot.svg"
          alt="OrbaAgent Mascot"
          className="h-full w-full object-contain"
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 min-w-0 text-[15px] leading-relaxed text-zinc-200">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs tracking-tight text-white">OrbaAgent</span>
          {message.timestamp && (
            <time className="text-[11px] text-zinc-500 font-normal">
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
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

        {/* Media Generation Items (Images and Videos rendered directly, no terminal window) */}
        {mediaToolCalls.map((call) => {
          const result = message.toolResults?.find((r) => r.toolCallId === call.id);
          return (
            <MediaToolItem key={call.id} call={call} result={result} textContent={textContent} />
          );
        })}

        {/* Legitimate Terminal Session (Only for actual shell / git / coding operations) */}
        {terminalToolCalls.length > 0 && (
          <TerminalSession
            toolCalls={terminalToolCalls}
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

        {/* Message Content with rich Markdown formatting */}
        {message.content ? (
          <div className="leading-relaxed text-zinc-200">
            {typeof message.content === "string" ? (
              <FormattedContent
                content={message.content}
                onCopy={handleCopy}
                copiedCode={copiedCode}
              />
            ) : (
              message.content.map((p, idx) =>
                p.type === "text" ? (
                  <FormattedContent
                    key={idx}
                    content={p.text}
                    onCopy={handleCopy}
                    copiedCode={copiedCode}
                  />
                ) : isSafeImageUrl(p.image_url.url) ? (
                  <img
                    key={idx}
                    src={p.image_url.url}
                    alt="attachment"
                    className="max-w-full rounded-2xl mt-2 border border-zinc-800 shadow-md"
                  />
                ) : null,
              )
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
          <div className="flex items-center gap-1.5 pt-1 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 transition-opacity duration-150">
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
  // Split on fenced code blocks: ```lang ... ```
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, idx) => {
        const itemKey = `part_${idx}_${part.slice(0, 10)}`;
        if (part.startsWith("```") && part.endsWith("```")) {
          const lines = part.slice(3, -3).trim().split("\n");
          const language = lines[0]?.match(/^[a-zA-Z0-9_-]+$/) ? lines[0] : "code";
          const codeBody = language === lines[0] ? lines.slice(1).join("\n") : lines.join("\n");

          return (
            <div
              key={itemKey}
              className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-[#121214] my-2 shadow-md"
            >
              <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/80 px-4 py-2 text-xs text-zinc-400 font-mono">
                <span className="font-medium text-zinc-300">{language}</span>
                <button
                  onClick={() => onCopy(codeBody)}
                  type="button"
                  className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {copiedCode === codeBody ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-sans">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span className="font-sans">Copy code</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[13px] text-zinc-200 leading-relaxed">
                <code>{codeBody}</code>
              </pre>
            </div>
          );
        }

        // Render structured markdown blocks
        return <MarkdownBlock key={itemKey} text={part} />;
      })}
    </div>
  );
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;

  const flushList = () => {
    if (currentList) {
      if (currentList.type === "ul") {
        elements.push(
          <ul key={`ul_${elements.length}`} className="my-2 space-y-1 pl-1">
            {currentList.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-zinc-300 leading-relaxed">
                <span className="text-zinc-500 select-none mt-1.5 text-xs">•</span>
                <div className="flex-1">{item}</div>
              </li>
            ))}
          </ul>,
        );
      } else {
        elements.push(
          <ol
            key={`ol_${elements.length}`}
            className="my-2 space-y-1 pl-1 list-decimal list-inside text-zinc-300"
          >
            {currentList.items.map((item, i) => (
              <li key={i} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ol>,
        );
      }
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={i} className="text-base font-semibold text-white mt-4 mb-1">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>,
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h2
          key={i}
          className="text-lg font-semibold text-white mt-5 mb-1.5 border-b border-zinc-800/60 pb-1"
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>,
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(
        <h1
          key={i}
          className="text-xl font-bold text-white mt-6 mb-2 border-b border-zinc-800/80 pb-1.5"
        >
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>,
      );
      continue;
    }

    // Horizontal Rule
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={i} className="my-4 border-zinc-800/80" />);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      flushList();
      elements.push(
        <blockquote key={i} className="border-l-2 border-zinc-600 pl-3.5 my-2 text-zinc-400 italic">
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>,
      );
      continue;
    }

    // Unordered List
    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(renderInlineMarkdown(bulletMatch[1]));
      continue;
    }

    // Numbered List
    const numMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numMatch) {
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(renderInlineMarkdown(numMatch[1]));
      continue;
    }

    flushList();
    elements.push(
      <p key={i} className="my-1.5 leading-relaxed text-zinc-200">
        {renderInlineMarkdown(line)}
      </p>,
    );
  }

  flushList();
  return <div className="space-y-0.5">{elements}</div>;
}

function parseTextFormatting(text: string): React.ReactNode[] {
  // Split on inline code: `code`
  const codeParts = text.split(/(`[^`]+`)/g);
  return codeParts.map((codePart, idx) => {
    if (codePart.startsWith("`") && codePart.endsWith("`") && codePart.length >= 2) {
      return (
        <code
          key={`code_${idx}`}
          className="rounded bg-zinc-850 px-1.5 py-0.5 font-mono text-[13px] text-zinc-200 border border-zinc-750 inline-block align-baseline"
        >
          {codePart.slice(1, -1)}
        </code>
      );
    }

    // Split on bold: **bold**
    const boldParts = codePart.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={`bold_${idx}`}>
        {boldParts.map((boldPart, bIdx) => {
          if (boldPart.startsWith("**") && boldPart.endsWith("**") && boldPart.length >= 4) {
            return (
              <strong key={`b_${bIdx}`} className="font-semibold text-white">
                {boldPart.slice(2, -2)}
              </strong>
            );
          }

          // Split on italic: *italic*
          const italicParts = boldPart.split(/(\*[^*]+\*)/g);
          return (
            <React.Fragment key={`it_${bIdx}`}>
              {italicParts.map((itPart, iIdx) => {
                if (itPart.startsWith("*") && itPart.endsWith("*") && itPart.length >= 2) {
                  return (
                    <em key={`i_${iIdx}`} className="italic text-zinc-200">
                      {itPart.slice(1, -1)}
                    </em>
                  );
                }
                return itPart;
              })}
            </React.Fragment>
          );
        })}
      </React.Fragment>
    );
  });
}

function isSafeUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("/\\");
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeImageUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  const trimmed = rawUrl.trim();
  if (isSafeUrl(trimmed)) return true;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Regex to match markdown images: ![alt](url) and links: [text](url)
  const pattern = /(!?\[[^\]]*\]\([^)]+\))/g;
  const tokens = text.split(pattern);

  return tokens.map((token, i) => {
    // Check if token is image: ![alt](url)
    const imgMatch = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const alt = imgMatch[1];
      const src = imgMatch[2].trim();

      if (!isSafeImageUrl(src)) {
        return (
          <span key={i} className="font-mono text-xs text-zinc-400">
            {token}
          </span>
        );
      }

      return (
        <span key={i} className="my-3 block max-w-xl">
          <span className="block overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#141416] shadow-xl group/img relative">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="block cursor-pointer overflow-hidden bg-black/40"
            >
              <img
                src={src}
                alt={alt || "Generated Artwork"}
                className="w-full h-auto max-h-[480px] object-contain rounded-t-2xl transition-transform duration-300 group-hover/img:scale-[1.015]"
                loading="lazy"
              />
              <span className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium backdrop-blur-xs">
                Open original in full size ↗
              </span>
            </a>
            {alt && (
              <span className="px-4 py-2 bg-[#18181b]/95 border-t border-zinc-800 text-xs text-zinc-400 flex items-center justify-between">
                <span className="truncate max-w-[340px] text-zinc-300 font-medium">{alt}</span>
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="text-zinc-200 hover:text-white inline-flex items-center gap-1 font-sans text-xs bg-zinc-800/80 hover:bg-zinc-700/80 px-2.5 py-1 rounded-md border border-zinc-700/60 transition-colors"
                >
                  Download <Download className="h-3 w-3" />
                </a>
              </span>
            )}
          </span>
        </span>
      );
    }

    // Check if token is link: [text](url)
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      const href = linkMatch[2].trim();

      if (!isSafeUrl(href)) {
        return (
          <span key={i} className="font-mono text-xs text-zinc-400">
            {token}
          </span>
        );
      }

      // Inline playable video player for video artifacts
      const isVideoArtifact =
        (href.startsWith("/api/artifacts/") ||
          href.startsWith("http://") ||
          href.startsWith("https://")) &&
        (href.endsWith(".mp4") ||
          href.endsWith(".webm") ||
          linkText.toLowerCase().includes("video"));

      if (isVideoArtifact) {
        const filename = href.split("/").pop() || "video.mp4";
        return (
          <span key={i} className="my-3 block max-w-xl">
            <span className="block overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#121214] shadow-2xl">
              <span className="px-4 py-2 bg-zinc-900/95 border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400 select-none">
                <span className="flex items-center gap-2 font-medium text-zinc-200">
                  <Film className="h-3.5 w-3.5 text-violet-400" />
                  <span className="truncate max-w-[280px]">{linkText || "Cinematic Video"}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-zinc-800/90 px-2 py-0.5 text-[10px] font-mono text-zinc-300 border border-zinc-700">
                  MP4
                </span>
              </span>
              <video
                src={href}
                controls
                className="max-h-80 w-full object-contain bg-black"
                preload="metadata"
              >
                <track kind="captions" />
              </video>
              <span className="p-3 flex items-center justify-between border-t border-zinc-800/80 bg-zinc-900/90 text-[11px] text-zinc-400">
                <span className="font-mono truncate max-w-[200px] text-zinc-300">{filename}</span>
                <span className="flex items-center gap-3">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 font-sans"
                  >
                    Open artifact <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={href}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-200 hover:text-white inline-flex items-center gap-1 font-sans bg-zinc-800/80 hover:bg-zinc-700/80 px-2.5 py-1 rounded-md border border-zinc-700/60 transition-colors"
                  >
                    Download <Download className="h-3 w-3" />
                  </a>
                </span>
              </span>
            </span>
          </span>
        );
      }

      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors inline-flex items-center gap-0.5"
        >
          {linkText}
        </a>
      );
    }

    return <React.Fragment key={i}>{parseTextFormatting(token)}</React.Fragment>;
  });
}

interface MediaToolItemProps {
  call: ToolCall;
  result?: ToolExecutionResult;
  textContent: string;
}

function MediaToolItem({ call, result, textContent }: MediaToolItemProps) {
  const isVideo = call.name === "media_video_generate";
  const args = (call.arguments || {}) as Record<string, any>;
  const prompt = args.prompt || "Generating media...";

  // 1. Result not yet available -> in-progress honest status
  if (!result) {
    return (
      <div className="my-2.5 rounded-2xl border border-violet-900/50 bg-gradient-to-r from-violet-950/40 via-zinc-900/60 to-violet-950/30 p-3.5 shadow-lg backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-400">
            {isVideo ? (
              <Film className="h-5 w-5 animate-pulse" />
            ) : (
              <ImageIcon className="h-5 w-5 animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-violet-200">
                {isVideo ? "Creating your video…" : "Creating your image…"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-950/80 px-2 py-0.5 text-[10px] font-medium text-violet-300 border border-violet-700/60">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Processing
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-zinc-300 italic">&ldquo;{prompt}&rdquo;</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Failed state
  if (!result.success) {
    return (
      <div className="my-2.5 rounded-2xl border border-red-900/60 bg-red-950/30 p-3.5 text-xs text-red-300 shadow-md">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-red-200">
              {isVideo ? "Video generation failed" : "Image generation failed"}
            </span>
            <p className="mt-1 text-red-300/90 font-mono text-[11px] leading-relaxed">
              {result.error || "An error occurred executing this request."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 3. Completed state
  let data: any = null;
  try {
    data = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
  } catch {}

  const artifactUrl = data?.artifactUrl;
  const contentHasArtifact = Boolean(artifactUrl && textContent.includes(artifactUrl));

  return (
    <div className="my-2.5 flex flex-col gap-2">
      {/* If message text does not already embed the artifact via markdown, render the full preview */}
      {!contentHasArtifact && artifactUrl && (
        <div className="rounded-2xl overflow-hidden border border-zinc-800/90 bg-[#121214] shadow-2xl max-w-xl">
          {isVideo ? (
            <div className="relative">
              <div className="px-4 py-2 bg-zinc-900/95 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-2 font-medium text-zinc-200">
                  <Film className="h-3.5 w-3.5 text-violet-400" />
                  <span>Generated Video</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-zinc-800/90 px-2 py-0.5 text-[10px] font-mono text-zinc-300 border border-zinc-700">
                  {data?.duration ? `${data.duration}s` : "Video"}
                </span>
              </div>
              <video
                src={artifactUrl}
                controls
                className="max-h-80 w-full object-contain bg-black"
                preload="metadata"
              >
                <track kind="captions" />
              </video>
              <div className="p-3 flex items-center justify-between border-t border-zinc-800/80 bg-zinc-900/90 text-xs text-zinc-400">
                <span className="truncate max-w-[200px] text-zinc-300 font-mono text-[11px]">
                  {artifactUrl.split("/").pop()}
                </span>
                <div className="flex items-center gap-2.5 font-sans text-[11px]">
                  <a
                    href={artifactUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-1"
                  >
                    Open artifact <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={artifactUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-200 hover:text-white inline-flex items-center gap-1 bg-zinc-800/80 hover:bg-zinc-700/80 px-2.5 py-1 rounded-md border border-zinc-700/60 transition-colors"
                  >
                    Download <Download className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <a
                href={artifactUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block relative group/preview cursor-pointer overflow-hidden bg-black/40"
              >
                <img
                  src={artifactUrl}
                  alt={prompt}
                  className="w-full max-h-[480px] object-contain rounded-t-2xl transition-transform duration-300 group-hover/preview:scale-[1.015]"
                  loading="lazy"
                />
                <span className="absolute inset-0 bg-black/30 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium backdrop-blur-xs">
                  Click to open full size ↗
                </span>
              </a>
              <div className="px-4 py-2.5 flex items-center justify-between border-t border-zinc-800/80 bg-zinc-900/90 text-xs text-zinc-400">
                <span className="truncate max-w-[320px] text-zinc-300 font-medium text-[11px]">
                  {prompt}
                </span>
                <a
                  href={artifactUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-200 hover:text-white inline-flex items-center gap-1 text-[11px] bg-zinc-800/80 hover:bg-zinc-700/80 px-2.5 py-1 rounded-md border border-zinc-700/60 transition-colors"
                >
                  Download <Download className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
