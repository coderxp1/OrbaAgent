"use client";

import type { UsageStats } from "@orbaagent/shared";
import { Activity } from "lucide-react";

interface UsageBarProps {
  usage: UsageStats | null;
}

export function UsageBar({ usage }: UsageBarProps) {
  if (!usage) return null;

  return (
    <div className="flex items-center justify-between border-t border-zinc-900 bg-zinc-950/80 px-6 py-1.5 font-mono text-[11px] text-zinc-400">
      <div className="flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-cyan-400" />
        <span>Token Accounting:</span>
      </div>
      <div className="flex items-center gap-4">
        <span>
          Prompt: <strong className="text-zinc-200">{usage.promptTokens}</strong>
        </span>
        <span>
          Completion: <strong className="text-zinc-200">{usage.completionTokens}</strong>
        </span>
        <span>
          Total Tokens: <strong className="text-cyan-400">{usage.totalTokens}</strong>
        </span>
      </div>
    </div>
  );
}
