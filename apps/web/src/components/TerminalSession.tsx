"use client";

import type { ToolCall, ToolExecutionResult } from "@orbaagent/shared";
import { Check, ChevronDown, ChevronRight, Copy, Terminal } from "lucide-react";
import { useState } from "react";

interface TerminalItem {
  call: ToolCall;
  result?: ToolExecutionResult;
}

interface TerminalSessionProps {
  toolCalls: ToolCall[];
  toolResults?: ToolExecutionResult[];
  isLive?: boolean;
}

export function TerminalSession({
  toolCalls,
  toolResults = [],
  isLive = false,
}: TerminalSessionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pair calls with their matching results
  const items: TerminalItem[] = toolCalls.map((call) => ({
    call,
    result: toolResults.find((r) => r.toolCallId === call.id),
  }));

  const getCommandLine = (call: ToolCall): string => {
    const args = call.arguments as Record<string, unknown>;
    if (call.name === "execute_shell") {
      return String(args.command || "");
    }
    if (call.name === "git_operations") {
      return `git ${args.action || ""} ${args.repoUrl || args.branch || args.commitMessage || ""}`.trim();
    }
    if (call.name === "github_inspect") {
      return `gh api ${args.action || "inspect"} ${args.ownerRepo || ""}`.trim();
    }
    if (call.name === "read_file") {
      return `cat ${args.path || ""}`;
    }
    if (call.name === "write_file") {
      return `write ${args.path || ""}`;
    }
    if (call.name === "edit_file") {
      return `edit ${args.path || ""}`;
    }
    if (call.name === "list_files") {
      return `ls ${args.path || "."}`;
    }
    if (call.name === "web_fetch") {
      return `curl -sL ${args.url || ""}`;
    }
    if (call.name === "task_complete") {
      return "complete --verified";
    }
    return `${call.name} ${JSON.stringify(args)}`;
  };

  const handleCopyAll = () => {
    const log = items
      .map((item) => {
        const cmd = getCommandLine(item.call);
        const out = item.result ? item.result.output || item.result.error || "" : "...running";
        return `$ ${cmd}\n${out}`;
      })
      .join("\n\n");
    navigator.clipboard.writeText(log);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const allSuccess = items.every((i) => !i.result || i.result.success);

  return (
    <div className="w-full my-2 rounded-xl border border-[#27272a] bg-[#0c0c0e] shadow-2xl overflow-hidden font-mono text-xs">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#18181b] border-b border-[#27272a] select-none">
        <div className="flex items-center gap-2">
          {/* macOS window controls */}
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#eab308]/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]/80 inline-block" />
          </div>

          <Terminal className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-zinc-300 font-semibold text-[11px] tracking-wide">
            terminal — container:runtime
          </span>

          {/* Session Status Pill */}
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
              isLive
                ? "bg-amber-950/60 text-amber-300 border border-amber-800/50 animate-pulse"
                : allSuccess
                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/50"
                  : "bg-red-950/60 text-red-400 border border-red-800/50"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isLive ? "bg-amber-400 animate-ping" : allSuccess ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            {isLive ? "LIVE" : allSuccess ? "COMPLETED" : "FAILED"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyAll}
            type="button"
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors p-1"
            title="Copy terminal session"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 text-[10px]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span className="text-[10px]">Copy</span>
              </>
            )}
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            type="button"
            className="text-zinc-400 hover:text-zinc-200 p-1"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      {!isCollapsed && (
        <div className="p-3.5 flex flex-col gap-3 max-h-[380px] overflow-y-auto leading-relaxed scrollbar-thin scrollbar-thumb-zinc-700">
          {items.map((item, idx) => {
            const cmd = getCommandLine(item.call);
            const res = item.result;
            const isLast = idx === items.length - 1;
            const isCurrentlyRunning = isLive && isLast && !res;

            return (
              <div key={item.call.id || idx} className="flex flex-col gap-1">
                {/* Prompt & Command */}
                <div className="flex items-start gap-2 text-zinc-200">
                  <span className="text-emerald-400 font-bold select-none">$</span>
                  <span className="font-semibold text-zinc-100 break-all">{cmd}</span>
                  {res?.executionTimeMs && (
                    <span className="ml-auto text-[10px] text-zinc-500 select-none">
                      {res.executionTimeMs}ms
                    </span>
                  )}
                </div>

                {/* Output */}
                {res ? (
                  <div
                    className={`whitespace-pre-wrap pl-4 py-1 text-[11px] leading-relaxed border-l-2 ${
                      res.success
                        ? "border-emerald-500/30 text-zinc-300"
                        : "border-red-500/50 text-red-300"
                    }`}
                  >
                    {res.output || res.error || "Done (no output)"}
                  </div>
                ) : isCurrentlyRunning ? (
                  <div className="pl-4 py-1 text-[11px] text-amber-300 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span>Executing command...</span>
                  </div>
                ) : null}

                {/* Inline Media Artifact Preview */}
                {(() => {
                  if (!res || !res.output) return null;
                  try {
                    const parsed = JSON.parse(res.output);
                    const url = parsed.artifactUrl || parsed.artifact_url;
                    if (typeof url === "string" && url.startsWith("/api/artifacts/")) {
                      const isVideo = url.endsWith(".mp4") || url.endsWith(".webm") || item.call.name.includes("video");
                      return (
                        <div className="pl-4 pt-1.5">
                          <div className="group/artifact relative inline-block rounded-xl overflow-hidden border border-zinc-750 bg-zinc-950/80 shadow-md max-w-sm">
                            {isVideo ? (
                              <video
                                src={url}
                                controls
                                className="max-h-60 w-full object-contain bg-black"
                              />
                            ) : (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block relative overflow-hidden group/img"
                              >
                                <img
                                  src={url}
                                  alt="Generated Artifact"
                                  className="max-h-60 w-full object-contain rounded-t-xl transition-transform duration-200 group-hover/img:scale-[1.02]"
                                  loading="lazy"
                                />
                                <span className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium">
                                  View full size ↗
                                </span>
                              </a>
                            )}
                            <div className="p-2 flex items-center justify-between border-t border-zinc-800 bg-zinc-900/90 text-[10px] text-zinc-400">
                              <span className="font-mono truncate">{url.split("/").pop()}</span>
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-400 hover:text-indigo-300 underline ml-2 shrink-0 font-sans"
                              >
                                Open artifact ↗
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
