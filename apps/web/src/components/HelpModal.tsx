"use client";

import { Command, HelpCircle, Key, ShieldCheck, Terminal, X, Zap } from "lucide-react";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-2xl border border-[#27272a] bg-[#161616] p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <HelpCircle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">OrbaAgent Help &amp; Guides</h2>
              <p className="text-[11px] text-zinc-400">Keyboard shortcuts and autonomous workflow guide</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="rounded-lg p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-4 flex flex-col gap-4 text-xs text-zinc-300">
          <div>
            <h3 className="font-semibold text-zinc-100 flex items-center gap-2 mb-2">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              Keyboard Shortcuts
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-[#202020] border border-[#2d2d2d] flex justify-between items-center">
                <span className="text-zinc-400">New Chat</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[10px]">Ctrl+O</kbd>
              </div>
              <div className="p-2 rounded-lg bg-[#202020] border border-[#2d2d2d] flex justify-between items-center">
                <span className="text-zinc-400">Send Message</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[10px]">Enter</kbd>
              </div>
              <div className="p-2 rounded-lg bg-[#202020] border border-[#2d2d2d] flex justify-between items-center">
                <span className="text-zinc-400">New Line</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[10px]">Shift+Enter</kbd>
              </div>
              <div className="p-2 rounded-lg bg-[#202020] border border-[#2d2d2d] flex justify-between items-center">
                <span className="text-zinc-400">Cancel Loop</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[10px]">Stop Button</kbd>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-zinc-100 flex items-center gap-2 mb-2">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              Autonomous Agent Runtime
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              OrbaAgent runs inside an isolated container with an autonomous execution loop. When given a repository, task, or bug, it clones code, runs type checks, installs dependencies, and executes linters automatically without manual intervention.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-zinc-100 flex items-center gap-2 mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              Connected Tools &amp; Permissions
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Only authorized and connected third-party integrations (like GitHub) can be interacted with. If an integration is not connected, OrbaAgent will inform you and provide a 1-click connect button.
            </p>
          </div>
        </div>

        <div className="pt-3 border-t border-[#27272a] flex justify-end">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
