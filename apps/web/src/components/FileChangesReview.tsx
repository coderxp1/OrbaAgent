"use client";

import type { AgentFileChange } from "@orbaagent/shared";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileDiff,
  FilePlus,
  FileX,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import React, { useState } from "react";

interface FileChangesReviewProps {
  changes: AgentFileChange[];
  onAccept?: (changeId: string) => void;
  onReject?: (changeId: string) => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
}

export function FileChangesReview({
  changes,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: FileChangesReviewProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedChange, setSelectedChange] = useState<AgentFileChange | null>(null);

  if (!changes || changes.length === 0) return null;

  const totalAdditions = changes.reduce((acc, c) => acc + c.additions, 0);
  const totalDeletions = changes.reduce((acc, c) => acc + c.deletions, 0);

  const pendingCount = changes.filter((c) => c.reviewStatus === "pending").length;

  return (
    <div className="w-full my-3 rounded-xl border border-[#2e2e34] bg-[#141416] shadow-xl overflow-hidden font-sans text-xs">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#1a1a1e] border-b border-[#2e2e34]">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
          className="flex items-center gap-2 text-zinc-200 hover:text-white transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          )}
          <FileDiff className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-sm">
            {changes.length} {changes.length === 1 ? "File" : "Files"} With Changes
          </span>
          <span className="text-[11px] font-mono text-zinc-500">
            (+{totalAdditions} -{totalDeletions})
          </span>
          {pendingCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-950/60 text-amber-300 border border-amber-800/40">
              {pendingCount} Pending Review
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          {onRejectAll && (
            <button
              onClick={onRejectAll}
              type="button"
              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-red-950/60 text-zinc-300 hover:text-red-300 border border-zinc-700 hover:border-red-800/50 transition-colors text-[11px] font-medium"
            >
              Reject all
            </button>
          )}
          {onAcceptAll && (
            <button
              onClick={onAcceptAll}
              type="button"
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors text-[11px] shadow-sm shadow-emerald-950"
            >
              Accept all
            </button>
          )}
        </div>
      </div>

      {/* Files List */}
      {isExpanded && (
        <div className="divide-y divide-[#242428]">
          {changes.map((change) => {
            const isPending = change.reviewStatus === "pending";
            const isAccepted = change.reviewStatus === "accepted";
            const isRejected = change.reviewStatus === "rejected";

            return (
              <div
                key={change.changeId}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a1f] transition-colors group cursor-pointer"
                onClick={() => setSelectedChange(change)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Status Indicator */}
                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] w-20">
                    <span className="text-emerald-400 font-bold">+{change.additions}</span>
                    <span className="text-red-400 font-bold">-{change.deletions}</span>
                  </div>

                  {/* Filename & Path */}
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100 group-hover:text-cyan-300 transition-colors truncate">
                        {change.filename}
                      </span>
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-bold tracking-wider ${
                          change.status === "created"
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800/50"
                            : change.status === "deleted"
                              ? "bg-red-950 text-red-400 border border-red-800/50"
                              : change.status === "renamed"
                                ? "bg-amber-950 text-amber-400 border border-amber-800/50"
                                : "bg-blue-950 text-blue-400 border border-blue-800/50"
                        }`}
                      >
                        {change.status}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-500 truncate font-mono">
                      {change.path}
                    </span>
                  </div>
                </div>

                {/* Per-File Actions */}
                <div
                  className="flex items-center gap-1.5 shrink-0 ml-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isAccepted && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                      ACCEPTED
                    </span>
                  )}
                  {isRejected && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-red-950 text-red-400 border border-red-800 font-mono line-through">
                      REJECTED
                    </span>
                  )}
                  {isPending && (
                    <>
                      {onReject && (
                        <button
                          onClick={() => onReject(change.changeId)}
                          type="button"
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-red-950 text-zinc-300 hover:text-red-300 text-[11px] transition-colors"
                          title="Reject this file change"
                        >
                          Reject
                        </button>
                      )}
                      {onAccept && (
                        <button
                          onClick={() => onAccept(change.changeId)}
                          type="button"
                          className="px-2 py-1 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-[11px] transition-colors border border-emerald-800/60"
                          title="Accept this file change"
                        >
                          Accept
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Diff Inspection Modal */}
      {selectedChange && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedChange(null)}
        >
          <div
            className="relative w-full max-w-4xl max-h-[85vh] rounded-2xl border border-[#2e2e34] bg-[#121214] shadow-2xl overflow-hidden flex flex-col text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Diff Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#18181c] border-b border-[#2e2e34]">
              <div className="flex items-center gap-3">
                <FileCode className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="font-bold text-sm text-white">{selectedChange.filename}</h3>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {selectedChange.path} (+{selectedChange.additions} -{selectedChange.deletions})
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedChange(null)}
                type="button"
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Diff Body */}
            <div className="flex-1 overflow-auto p-4 bg-[#0d0d0f] font-mono text-xs leading-relaxed">
              {selectedChange.diff ? (
                <div className="flex flex-col">
                  {selectedChange.diff.split("\n").map((line, idx) => {
                    const isAdd = line.startsWith("+") && !line.startsWith("+++");
                    const isDel = line.startsWith("-") && !line.startsWith("---");
                    const isHunk = line.startsWith("@@");

                    return (
                      <div
                        key={idx}
                        className={`px-2 py-0.5 whitespace-pre-wrap ${
                          isAdd
                            ? "bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500"
                            : isDel
                              ? "bg-red-950/40 text-red-300 border-l-2 border-red-500"
                              : isHunk
                                ? "bg-indigo-950/30 text-indigo-300 font-semibold my-1 py-1"
                                : "text-zinc-400"
                        }`}
                      >
                        {line}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-zinc-500 italic">No diff available</span>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="flex items-center justify-between px-5 py-3 bg-[#18181c] border-t border-[#2e2e34]">
              <span className="text-[11px] text-zinc-500">
                Status: {selectedChange.reviewStatus.toUpperCase()}
              </span>
              <div className="flex items-center gap-2">
                {onReject && (
                  <button
                    onClick={() => {
                      onReject(selectedChange.changeId);
                      setSelectedChange(null);
                    }}
                    type="button"
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-950 text-zinc-300 hover:text-red-300 text-xs font-medium transition-colors"
                  >
                    Reject this file
                  </button>
                )}
                {onAccept && (
                  <button
                    onClick={() => {
                      onAccept(selectedChange.changeId);
                      setSelectedChange(null);
                    }}
                    type="button"
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                  >
                    Accept this file
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
