"use client";

import { listAvailableModels } from "@orbaagent/model-gateway";
import type { ModelSpec } from "@orbaagent/shared";
import { Bot, Cpu, Trash2 } from "lucide-react";

interface HeaderProps {
  modelId: string;
  onSelectModel: (id: string) => void;
  activeTraceId: string | null;
  onClearChat: () => void;
}

export function Header({ modelId, onSelectModel, activeTraceId, onClearChat }: HeaderProps) {
  const models = listAvailableModels();

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950 px-6 py-4 text-zinc-100">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 shadow-md shadow-cyan-950/50">
          <Bot className="h-6 w-6 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg tracking-tight">OrbaAgent</h1>
            <span className="rounded-md border border-cyan-500/30 bg-cyan-950/50 px-2 py-0.5 font-medium text-cyan-400 text-xs">
              Phase 1 Agent
            </span>
          </div>
          <p className="text-xs text-zinc-400">Autonomous AI Platform &amp; Multi-Model Engine</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
          <Cpu className="h-4 w-4 text-cyan-400" />
          <select
            value={modelId}
            onChange={(e) => onSelectModel(e.target.value)}
            className="bg-transparent font-medium text-zinc-200 outline-none cursor-pointer"
          >
            {models.map((m: ModelSpec) => (
              <option key={m.id} value={m.id} className="bg-zinc-900 text-zinc-200">
                {m.name} ({m.provider.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        {activeTraceId && (
          <span className="hidden sm:inline-block rounded-md bg-zinc-900 px-2.5 py-1 font-mono text-xs text-zinc-400 border border-zinc-800">
            Trace: {activeTraceId.slice(0, 14)}...
          </span>
        )}

        <button
          onClick={onClearChat}
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
          title="Clear Conversation"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
    </header>
  );
}
