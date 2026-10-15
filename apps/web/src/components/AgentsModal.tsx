"use client";

import { Bot, Check, Code, Cpu, Sparkles, Terminal, X, Zap } from "lucide-react";
import { useState } from "react";

interface AgentProfile {
  id: string;
  name: string;
  description: string;
  role: string;
  icon: string;
  capabilities: string[];
  status: "active" | "standby";
}

const AGENTS: AgentProfile[] = [
  {
    id: "lead-dev",
    name: "Full-Stack Engineer Agent",
    role: "Primary Autonomous Developer",
    description: "Specialized in TypeScript, Next.js, Docker, API architectures, and debugging.",
    icon: "💻",
    capabilities: ["Git operations", "File editing", "Linter execution", "Test suites"],
    status: "active",
  },
  {
    id: "reviewer",
    name: "Code Review & Security Auditor",
    role: "Static Analysis & Vulnerability Guard",
    description:
      "Analyzes pull requests, enforces security best practices, and identifies edge-case bugs.",
    icon: "🛡️",
    capabilities: ["OWASP auditing", "Type safety", "Performance profiling"],
    status: "active",
  },
  {
    id: "devops",
    name: "DevOps & Infrastructure Worker",
    role: "CI/CD & Cloud Orchestrator",
    description:
      "Configures Docker containers, reverse proxies, GitHub Actions, and production deployments.",
    icon: "🚀",
    capabilities: ["Docker compose", "Traefik routing", "Environment management"],
    status: "active",
  },
  {
    id: "researcher",
    name: "Documentation & Technical Researcher",
    role: "Deep Knowledge Synthesis",
    description:
      "Researches public API specs, libraries, and open-source documentation to solve integration hurdles.",
    icon: "📚",
    capabilities: ["Web fetching", "API extraction", "Architecture briefs"],
    status: "active",
  },
];

interface AgentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAgent: (agentName: string) => void;
}

export function AgentsModal({ isOpen, onClose, onSelectAgent }: AgentsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl rounded-2xl border border-[#27272a] bg-[#161616] p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">OrbaAgent Workforce Roster</h2>
              <p className="text-[11px] text-zinc-400">
                Select specialized autonomous agents for your objective
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

        <div className="py-4 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          {AGENTS.map((agent) => (
            <div
              key={agent.id}
              className="p-3.5 rounded-xl bg-[#1f1f22] border border-[#2e2e32] hover:border-zinc-500 transition-colors flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{agent.icon}</span>
                  <div>
                    <h4 className="text-xs font-bold text-white">{agent.name}</h4>
                    <span className="text-[10px] text-amber-400 font-mono">{agent.role}</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    onSelectAgent(agent.name);
                    onClose();
                  }}
                  type="button"
                  className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-white hover:text-black text-[11px] font-semibold text-zinc-200 transition-colors"
                >
                  Delegate Task
                </button>
              </div>

              <p className="text-[11px] text-zinc-400 leading-relaxed">{agent.description}</p>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-2 py-0.5 rounded-md bg-[#28282c] text-[10px] text-zinc-300 font-mono"
                  >
                    ✓ {cap}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-[#27272a] flex justify-between items-center text-[11px] text-zinc-500">
          <span>Autonomous agents communicate and cooperate within your isolated container</span>
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
