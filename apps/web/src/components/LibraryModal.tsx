"use client";

import {
  Bookmark,
  Code2,
  FileText,
  FolderGit2,
  Library,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";

interface LibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt: (prompt: string) => void;
}

const TEMPLATES = [
  {
    category: "Full Repository Audit",
    title: "Inspect GitHub Repository & Run Verification",
    prompt:
      "Inspect the connected repository, analyze the project structure, install dependencies, run type checking and tests, and report any failing issues.",
    icon: FolderGit2,
  },
  {
    category: "Full-Stack Development",
    title: "Refactor Component & Enforce Type Safety",
    prompt:
      "Scan all TypeScript files in the codebase, locate any any-casts or missing types, and refactor them with strict interfaces.",
    icon: Code2,
  },
  {
    category: "Meeting & Product Synthesis",
    title: "Executive AI Meeting Notes & Action Plan",
    prompt:
      "Generate an executive meeting summary outline with Action Items, Owners, Key Strategic Decisions, and Target Deliverables.",
    icon: FileText,
  },
  {
    category: "DevOps & CI/CD",
    title: "Docker Production Health & Security Audit",
    prompt:
      "Inspect our Dockerfile and docker-compose files to ensure multi-stage builds, non-root users, minimal image size, and secure secret handling.",
    icon: Terminal,
  },
];

export function LibraryModal({ isOpen, onClose, onSelectPrompt }: LibraryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-2xl border border-[#27272a] bg-[#161616] p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Library className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Workforce Workflow Library</h2>
              <p className="text-[11px] text-zinc-400">
                Proven autonomous workflow templates and prompts
              </p>
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

        <div className="py-4 flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto">
          {TEMPLATES.map((tmpl) => {
            const Icon = tmpl.icon;
            return (
              <button
                key={tmpl.title}
                onClick={() => {
                  onSelectPrompt(tmpl.prompt);
                  onClose();
                }}
                type="button"
                className="p-3 text-left rounded-xl bg-[#1f1f22] border border-[#2e2e32] hover:border-emerald-500/60 hover:bg-[#252529] transition-all flex flex-col gap-1 group"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400">
                    {tmpl.category}
                  </span>
                  <Icon className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
                </div>
                <h4 className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">
                  {tmpl.title}
                </h4>
                <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                  {tmpl.prompt}
                </p>
              </button>
            );
          })}
        </div>

        <div className="pt-3 border-t border-[#27272a] flex justify-end">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
