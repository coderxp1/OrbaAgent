"use client";

import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  Cpu,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Globe,
  Layers,
  Monitor,
  Play,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function LandingPage() {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<
    "outbound" | "auditor" | "architect" | "sandbox"
  >("outbound");

  const [activeExecutionStep, setActiveExecutionStep] = useState<number>(2);

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] font-sans antialiased selection:bg-white/20 selection:text-white">
      {/* Top Announcement Bar */}
      <div className="border-b border-zinc-800/60 bg-[#0d0d11] px-4 py-2.5 text-center text-xs font-medium text-zinc-400">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-200 border border-zinc-700">
            OrbaAgent v1.0 Live
          </span>
          <span>Autonomous AI Workforce Platform is officially operational.</span>
          <a
            href="#capabilities"
            className="inline-flex items-center gap-0.5 text-zinc-200 hover:text-white underline font-semibold transition-colors ml-1"
          >
            See capabilities <ChevronRight className="h-3 w-3 inline" />
          </a>
        </div>
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative h-9 w-9 overflow-hidden rounded-full bg-white p-0.5 shadow-md shadow-white/10 group-hover:scale-105 transition-transform">
              <Image
                src="/orba-mascot.svg"
                alt="OrbaAgent Mascot"
                width={36}
                height={36}
                className="h-full w-full object-contain"
                priority
              />
            </div>
            <span className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
              ORBAAGENT
              <span className="rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-zinc-700/60">
                PROD
              </span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#execution" className="hover:text-white transition-colors">
              Execution Pipeline
            </a>
            <a href="#capabilities" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <a href="#roadmap" className="hover:text-white transition-colors">
              Roadmap
            </a>
            <Link href="/pricing" className="hover:text-white transition-colors">
              Pricing
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <Link
              href="/pricing"
              className="hidden sm:inline-flex text-sm font-medium text-zinc-400 hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-zinc-200 transition-all shadow-lg shadow-white/10 hover:shadow-white/20 active:scale-95"
            >
              Launch Agent
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-16 pb-20 px-6 overflow-hidden">
        <div className="mx-auto max-w-5xl text-center">
          {/* Release Badge */}
          <div className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-1.5 border border-zinc-800 text-xs text-zinc-300 mb-8 shadow-inner">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Autonomous AI Teammates Ready for Execution</span>
            <span className="text-zinc-500">|</span>
            <span className="text-zinc-400">Read launch note ↗</span>
          </div>

          {/* Main Headline with Mascot Logo */}
          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-white leading-[1.08] mb-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <span>Meet</span>
            <span className="inline-flex items-center gap-3">
              <span className="relative inline-block h-12 w-12 sm:h-16 sm:w-16 overflow-hidden rounded-full bg-white p-1 shadow-2xl shadow-white/20 align-middle transform -translate-y-1">
                <Image
                  src="/orba-mascot.svg"
                  alt="OrbaAgent Mascot"
                  width={64}
                  height={64}
                  className="h-full w-full object-contain"
                  priority
                />
              </span>
              <span className="bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                OrbaAgent
              </span>
            </span>
          </h1>

          <p className="mx-auto max-w-3xl text-lg sm:text-2xl text-zinc-300 font-normal leading-relaxed mb-10">
            Give OrbaAgent the task. Let the agent do the work.
          </p>

          <p className="mx-auto max-w-2xl text-sm sm:text-base text-zinc-400 mb-10 leading-normal">
            AI teammates you can assign real objectives to. Agents analyze requirements, formulate
            plans, run terminal tools, edit files, verify test suites, and deliver finished work.
          </p>

          {/* Hero CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href="/app"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-zinc-950 hover:bg-zinc-200 transition-all shadow-xl shadow-white/10 hover:shadow-white/20"
            >
              Launch Agent Studio
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/90 px-8 py-3.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 hover:border-zinc-700 transition-all"
            >
              See How It Works
            </a>
          </div>

          {/* Key Principle Banner */}
          <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 text-xs sm:text-sm text-zinc-400 backdrop-blur-md">
            <span className="font-semibold text-white">No Model Picker. No API Key Overhead.</span>{" "}
            You describe the objective — OrbaAgent automatically selects internal intelligence
            routes and manages container sandboxes.
          </div>
        </div>

        {/* HERO MOCK WORKSPACE VISUALIZATION */}
        <div className="mx-auto max-w-6xl mt-14">
          <div className="rounded-2xl border border-zinc-800 bg-[#121215] shadow-2xl overflow-hidden text-left">
            {/* Window Header */}
            <div className="flex items-center justify-between border-b border-zinc-800/80 bg-[#18181b] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-500/80" />
                <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                <span className="ml-4 text-xs font-mono text-zinc-400">
                  OrbaAgent Workspace / Production Operations
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-800/50">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Agent Execution Active
                </span>
              </div>
            </div>

            {/* Main Workspace Body */}
            <div className="grid grid-cols-1 md:grid-cols-12 min-h-[460px]">
              {/* Sidebar: Teammate / Agent Selector */}
              <div className="md:col-span-4 border-r border-zinc-800/80 bg-[#101013] p-4 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3 px-2">
                    Active AI Teammates
                  </div>
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveWorkspaceTab("outbound")}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                        activeWorkspaceTab === "outbound"
                          ? "bg-zinc-800/90 text-white border border-zinc-700/80 shadow-sm"
                          : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 flex items-center justify-center font-bold text-xs">
                          SO
                        </div>
                        <div>
                          <div className="text-xs font-semibold">Sales Outbound</div>
                          <div className="text-[11px] text-zinc-500 truncate max-w-[140px]">
                            Processed 52 accounts
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
                        Done
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveWorkspaceTab("auditor")}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                        activeWorkspaceTab === "auditor"
                          ? "bg-zinc-800/90 text-white border border-zinc-700/80 shadow-sm"
                          : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-bold text-xs">
                          CA
                        </div>
                        <div>
                          <div className="text-xs font-semibold">Code Auditor</div>
                          <div className="text-[11px] text-zinc-500 truncate max-w-[140px]">
                            0 vulnerabilities found
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
                        Done
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveWorkspaceTab("architect")}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                        activeWorkspaceTab === "architect"
                          ? "bg-zinc-800/90 text-white border border-zinc-700/80 shadow-sm"
                          : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold text-xs">
                          RA
                        </div>
                        <div>
                          <div className="text-xs font-semibold">Repo Architect</div>
                          <div className="text-[11px] text-zinc-500 truncate max-w-[140px]">
                            Indexed 42 modules
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono bg-blue-950 text-blue-400 border border-blue-800 px-1.5 py-0.5 rounded">
                        Active
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveWorkspaceTab("sandbox")}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                        activeWorkspaceTab === "sandbox"
                          ? "bg-zinc-800/90 text-white border border-zinc-700/80 shadow-sm"
                          : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-xs">
                          TR
                        </div>
                        <div>
                          <div className="text-xs font-semibold">Task Runner</div>
                          <div className="text-[11px] text-zinc-500 truncate max-w-[140px]">
                            29/29 test suites passed
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
                        Verified
                      </span>
                    </button>
                  </div>
                </div>

                {/* Agent Platform Status Footnote */}
                <div className="pt-4 border-t border-zinc-800/60 text-[11px] text-zinc-500 flex items-center justify-between">
                  <span>Routing Engine</span>
                  <span className="text-zinc-300 font-mono">Auto Intelligence</span>
                </div>
              </div>

              {/* Center Panel: Live Execution Log & Checkmarks */}
              <div className="md:col-span-8 p-6 bg-[#141418] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-white p-0.5 flex items-center justify-center">
                        <Image
                          src="/orba-mascot.svg"
                          alt="Orba"
                          width={20}
                          height={20}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <span className="text-xs font-bold text-white">
                        {activeWorkspaceTab === "outbound" && "Sales Outbound Routine"}
                        {activeWorkspaceTab === "auditor" && "Code Security Audit Routine"}
                        {activeWorkspaceTab === "architect" && "Architecture Refactoring Task"}
                        {activeWorkspaceTab === "sandbox" && "Automated Verification Routine"}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      Target: Production Deployment
                    </span>
                  </div>

                  {/* Log Checkmarks Stream */}
                  <div className="space-y-3 font-mono text-xs mb-6 bg-[#0c0c0f] p-4 rounded-xl border border-zinc-800/80">
                    <div className="flex items-start gap-2.5 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-zinc-200">Repository Analysis</strong> → 42 modules
                        indexed in 140ms
                      </span>
                    </div>

                    <div className="flex items-start gap-2.5 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-zinc-200">Execution Plan</strong> → 5 steps
                        synthesized (Analyze → Edit → Test → SSL → Deploy)
                      </span>
                    </div>

                    <div className="flex items-start gap-2.5 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-zinc-200">Terminal Sandbox</strong> → pnpm test
                        passed (29/29 tests green)
                      </span>
                    </div>

                    <div className="flex items-start gap-2.5 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-zinc-200">File System Operations</strong> → 14 files
                        updated & formatted
                      </span>
                    </div>

                    <div className="flex items-start gap-2.5 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-zinc-200">Production Verification</strong> → HTTPS
                        SSL certificate issued & 200 OK verified
                      </span>
                    </div>
                  </div>

                  {/* Conversation Exchange Box */}
                  <div className="space-y-3">
                    <div className="flex items-end justify-end">
                      <div className="rounded-2xl rounded-br-none bg-white text-zinc-950 px-4 py-2.5 text-xs font-medium max-w-md shadow-md">
                        "Deploy feature branch to production, verify SSL certificates, and report
                        status."
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-white p-0.5 shrink-0">
                        <Image
                          src="/orba-mascot.svg"
                          alt="Orba"
                          width={24}
                          height={24}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="rounded-2xl rounded-tl-none bg-zinc-800/90 text-zinc-200 border border-zinc-700/80 px-4 py-2.5 text-xs max-w-md">
                        Done. Deployed to 85.215.156.241 (https://orbaagent.dev). SSL certificates
                        issued, 29 unit tests passed, and production health check returned 200 OK.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Interactive Simulated Prompt Input */}
                <div className="mt-6 pt-3 border-t border-zinc-800">
                  <div className="flex items-center gap-2 bg-[#0a0a0d] border border-zinc-800 rounded-xl px-3 py-2 text-xs">
                    <span className="text-zinc-500 font-bold">+</span>
                    <input
                      type="text"
                      readOnly
                      value="Give OrbaAgent a new objective..."
                      className="bg-transparent text-zinc-400 w-full focus:outline-none"
                    />
                    <button
                      type="button"
                      className="h-6 w-6 rounded-lg bg-white text-zinc-950 flex items-center justify-center font-bold"
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: "You give the objective. OrbaAgent does the work." */}
      <section id="how-it-works" className="py-24 px-6 border-t border-zinc-800/80 bg-[#0b0b0e]">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3.5 py-1 text-xs font-semibold text-zinc-300 border border-zinc-800 mb-6">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            Autonomous Execution Principle
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-6">
            You give the objective. <br />
            OrbaAgent does the work.
          </h2>

          <p className="text-base sm:text-lg text-zinc-400 leading-relaxed mb-12">
            Stop micro-managing prompts and switching between AI models. Tell OrbaAgent what you
            need to accomplish, and the agent plans the steps, executes commands in an isolated
            environment, and verifies the outcome.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 hover:border-zinc-700 transition-colors">
              <div className="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-white font-bold mb-4">
                1
              </div>
              <h3 className="text-lg font-bold text-white mb-2">State the Goal</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Describe your objective in plain English — whether it's refactoring code, deploying
                an application, or running tests.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 hover:border-zinc-700 transition-colors">
              <div className="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-white font-bold mb-4">
                2
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Internal Intelligence</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                OrbaAgent automatically selects optimal intelligence routes and operates tools in a
                secure, isolated container.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 hover:border-zinc-700 transition-colors">
              <div className="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-white font-bold mb-4">
                3
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Verified Delivery</h3>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                The agent verifies test passes, HTTP responses, and build outputs before delivering
                the finished result.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: 5-STEP AUTONOMOUS EXECUTION PIPELINE */}
      <section id="execution" className="py-24 px-6 border-t border-zinc-800/80 bg-[#09090b]">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
              The Autonomous Execution Pipeline
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto">
              How OrbaAgent turns high-level user directives into verified, production-ready work.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[
              {
                step: "01",
                title: "Analyze",
                desc: "Indexes codebase, parses dependencies, and inspects files.",
              },
              {
                step: "02",
                title: "Plan",
                desc: "Synthesizes multi-step tool execution path and safety bounds.",
              },
              {
                step: "03",
                title: "Execute",
                desc: "Runs terminal commands, modifies code, and performs web searches.",
              },
              {
                step: "04",
                title: "Verify",
                desc: "Executes unit tests, linter checks, and HTTP health probes.",
              },
              {
                step: "05",
                title: "Deliver",
                desc: "Creates PRs, deploys to production, and presents audit log.",
              },
            ].map((item, idx) => (
              <div
                key={item.step}
                className="rounded-2xl border border-zinc-800/80 bg-[#111114] p-5 hover:border-zinc-700 transition-all hover:-translate-y-0.5"
              >
                <div className="text-xs font-mono font-bold text-zinc-500 mb-2">{item.step}</div>
                <h3 className="text-base font-bold text-white mb-1.5">{item.title}</h3>
                <p className="text-xs text-zinc-400 leading-normal">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 4: CAPABILITIES GRID */}
      <section id="capabilities" className="py-24 px-6 border-t border-zinc-800/80 bg-[#0b0b0e]">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-emerald-400 border border-zinc-800 mb-4">
              [AVAILABLE NOW]
            </div>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-4">
              Full-Stack Agent Capabilities
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto">
              Equipped with complete tools to plan, build, test, and deploy applications.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Terminal,
                title: "Terminal Execution",
                desc: "Executes shell commands, scripts, builds, and package management in isolated sandboxes.",
              },
              {
                icon: Globe,
                title: "Browser & Research",
                desc: "Inspects documentation, fetches APIs, and researches technical specifications.",
              },
              {
                icon: FileCode2,
                title: "File Operations",
                desc: "Reads, writes, refactors, and inspects file structures with precision diffs.",
              },
              {
                icon: FolderGit2,
                title: "Git & GitHub Integration",
                desc: "Creates branches, commits changes, manages PRs, and handles repository workflows.",
              },
              {
                icon: CheckCircle2,
                title: "Automated Testing",
                desc: "Runs Vitest, Jest, PyTest, and custom test suites to guarantee zero regression.",
              },
              {
                icon: Server,
                title: "Build & Deployment",
                desc: "Compiles production artifacts, configures Docker containers, and manages reverse proxies.",
              },
              {
                icon: ShieldCheck,
                title: "Audit & Security Logs",
                desc: "Generates structured execution logs and administrative audit traces for every step.",
              },
              {
                icon: Zap,
                title: "Automatic Intelligence Routing",
                desc: "Dynamically routes prompts to optimal internal providers without user overhead.",
              },
              {
                icon: Layers,
                title: "Isolated Sandboxes",
                desc: "Strict container isolation per tenant and conversation ensuring full security.",
              },
            ].map((cap, i) => (
              <div
                key={cap.title}
                className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 hover:border-zinc-700 transition-all hover:bg-[#15151a]"
              >
                <div className="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-white mb-4">
                  <cap.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{cap.title}</h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">{cap.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5: INTELLIGENCE ROUTING ENGINE */}
      <section className="py-24 px-6 border-t border-zinc-800/80 bg-[#09090b]">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-6">
            Internal Intelligence Routing
          </h2>
          <p className="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-2xl mx-auto mb-10">
            OrbaAgent operates a server-side Model Gateway that automatically selects the optimal
            provider route (Langdock, OpenRouter) with automatic circuit breaker failover.
          </p>

          <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 sm:p-8 text-left font-mono text-xs sm:text-sm text-zinc-300">
            <div className="text-zinc-500 mb-2">
              {/* Internal Gateway Execution Log (Zero User Friction) */}
            </div>
            <div className="space-y-2">
              <div>
                <span className="text-cyan-400">[Gateway]</span> Request received: modelId = "auto"
              </div>
              <div>
                <span className="text-emerald-400">[Route 1]</span> Evaluating primary route
                (Langdock)...
              </div>
              <div>
                <span className="text-amber-400">[Failover]</span> Langdock 5xx detected → Circuit
                breaker open
              </div>
              <div>
                <span className="text-purple-400">[Route 2]</span> Falling back to secondary route
                (OpenRouter)...
              </div>
              <div>
                <span className="text-emerald-400">[Success]</span> Stream established · 200 OK ·
                Tool idempotency preserved
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6: ROADMAP / FUTURE CAPABILITIES */}
      <section id="roadmap" className="py-24 px-6 border-t border-zinc-800/80 bg-[#0b0b0e]">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-4">
              Product Vision & Roadmap
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto">
              Distinguishing features available today from future autonomous workforce capabilities.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Multi-Agent Roadmap */}
            <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-8 relative overflow-hidden">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-950/80 px-3 py-1 text-xs font-semibold text-purple-400 border border-purple-800 mb-6">
                <Users className="h-3.5 w-3.5" />
                [PRO ROADMAP]
              </span>
              <h3 className="text-2xl font-bold text-white mb-4">Work with Many Agents at Once</h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                Create an Agent, give it a task, and add another when the work grows — one on code
                auditing, one on outbound, one on systems. AI teammates will work in parallel,
                collaborate where it makes sense, and keep working 24/7.
              </p>
              <div className="text-xs text-zinc-500 font-mono">
                Status: In active development for Phase 2
              </div>
            </div>

            {/* Desktop / Local Machine Roadmap */}
            <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-8 relative overflow-hidden">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-950/80 px-3 py-1 text-xs font-semibold text-blue-400 border border-blue-800 mb-6">
                <Monitor className="h-3.5 w-3.5" />
                [DESKTOP ROADMAP]
              </span>
              <h3 className="text-2xl font-bold text-white mb-4">
                Desktop & Local Machine Authorization
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                Connect OrbaAgent to your authorized local machine for hands-on desktop workflows,
                local terminal tasks, and local browser interactions with explicit permissions.
              </p>
              <div className="text-xs text-zinc-500 font-mono">
                Status: Planned for Desktop Bridge release
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 7: TRANSPARENT PRICING */}
      <section id="pricing" className="py-24 px-6 border-t border-zinc-800/80 bg-[#09090b]">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto">
              No hidden model fees. All tiers include server-side intelligence routing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Starter Plan */}
            <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-8 flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Starter</h3>
                <div className="text-3xl font-extrabold text-white mb-4">
                  $0 <span className="text-xs font-normal text-zinc-400">/ month</span>
                </div>
                <p className="text-xs text-zinc-400 mb-6">
                  For individual developers exploring autonomous AI agent capabilities.
                </p>
                <ul className="space-y-3 text-xs text-zinc-300 mb-8">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> 500 requests / month
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> Terminal & File sandbox
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> Auto intelligence routing
                  </li>
                </ul>
              </div>
              <Link
                href="/app"
                className="w-full inline-flex items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 py-3 text-xs font-bold text-white hover:bg-zinc-800 transition-colors"
              >
                Get Started Free
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="rounded-2xl border-2 border-white bg-[#15151a] p-8 flex flex-col justify-between relative shadow-2xl shadow-white/10">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-0.5 text-[10px] font-extrabold text-zinc-950 uppercase tracking-wider">
                Most Popular
              </span>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
                <div className="text-3xl font-extrabold text-white mb-4">
                  $29 <span className="text-xs font-normal text-zinc-400">/ month</span>
                </div>
                <p className="text-xs text-zinc-400 mb-6">
                  For professional builders requiring unlimited agent execution tasks.
                </p>
                <ul className="space-y-3 text-xs text-zinc-300 mb-8">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> Unlimited agent tasks
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> Priority intelligence routes
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> GitHub PR & deployment tools
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> Multi-agent routine preview
                  </li>
                </ul>
              </div>
              <Link
                href="/app"
                className="w-full inline-flex items-center justify-center rounded-full bg-white py-3 text-xs font-bold text-zinc-950 hover:bg-zinc-200 transition-colors shadow-lg"
              >
                Start Pro Trial
              </Link>
            </div>

            {/* Enterprise Plan */}
            <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-8 flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Enterprise</h3>
                <div className="text-3xl font-extrabold text-white mb-4">Custom</div>
                <p className="text-xs text-zinc-400 mb-6">
                  For teams requiring dedicated sandboxes, SLA guarantees, and audit logs.
                </p>
                <ul className="space-y-3 text-xs text-zinc-300 mb-8">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> Dedicated container clusters
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> Custom audit log retention
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" /> 99.9% SLA & 24/7 support
                  </li>
                </ul>
              </div>
              <button
                type="button"
                className="w-full inline-flex items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 py-3 text-xs font-bold text-white hover:bg-zinc-800 transition-colors"
              >
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 8: FINAL CTA */}
      <section className="py-24 px-6 border-t border-zinc-800/80 bg-[#0c0c0f] text-center">
        <div className="mx-auto max-w-4xl">
          <div className="relative inline-block h-16 w-16 overflow-hidden rounded-full bg-white p-1 shadow-2xl shadow-white/20 mb-6">
            <Image
              src="/orba-mascot.svg"
              alt="Orba"
              width={64}
              height={64}
              className="h-full w-full object-contain"
            />
          </div>

          <h2 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight mb-6">
            Give OrbaAgent the task. <br />
            Let the agent do the work.
          </h2>

          <p className="text-base sm:text-lg text-zinc-400 mb-10 max-w-2xl mx-auto">
            Experience true autonomous AI execution. No model configuration required.
          </p>

          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-full bg-white px-9 py-4 text-base font-bold text-zinc-950 hover:bg-zinc-200 transition-all shadow-2xl shadow-white/20"
          >
            Launch Agent Studio
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-zinc-800/80 bg-[#09090b] py-12 px-6 text-xs text-zinc-500">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 overflow-hidden rounded-full bg-white p-0.5">
              <Image
                src="/orba-mascot.svg"
                alt="Orba Mascot"
                width={24}
                height={24}
                className="h-full w-full object-contain"
              />
            </div>
            <span className="font-bold text-zinc-300">ORBAAGENT</span>
            <span>© {new Date().getFullYear()} OrbaAgent Inc. All rights reserved.</span>
          </div>

          <div className="flex items-center gap-6 text-zinc-400">
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#capabilities" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <Link href="/pricing" className="hover:text-white transition-colors">
              Pricing
            </Link>
            <a href="/health" className="hover:text-white transition-colors font-mono">
              /health
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
