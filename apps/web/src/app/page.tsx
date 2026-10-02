"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Cpu,
  GitBranch,
  GitPullRequest,
  Layers,
  Play,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<"terminal" | "diff" | "pr">("terminal");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-700 text-cyan-400 group-hover:border-cyan-500 transition-colors">
              <Cpu className="h-4 w-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">
              OrbaAgent<span className="text-zinc-500 text-xs ml-1 font-mono">dev</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <a href="#features" className="hover:text-zinc-100 transition-colors">
              Features
            </a>
            <a href="#workflow" className="hover:text-zinc-100 transition-colors">
              Workflow
            </a>
            <a href="#capabilities" className="hover:text-zinc-100 transition-colors">
              Capabilities
            </a>
            <Link href="/pricing" className="hover:text-zinc-100 transition-colors">
              Pricing
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <Link
              href="/pricing"
              className="hidden sm:inline-flex text-sm font-medium text-zinc-400 hover:text-white transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 transition-colors shadow-sm shadow-cyan-950/50"
            >
              Launch Agent Studio
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-16 px-6 overflow-hidden">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.1] mb-6">
            Autonomous Software Engineering <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-100 via-zinc-300 to-zinc-500">
              at Production Scale
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-base sm:text-lg text-zinc-400 mb-10 leading-relaxed">
            OrbaAgent analyzes software tasks, formulates execution plans, writes code, executes
            shell commands, runs test suites, and manages GitHub pull requests automatically.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/app"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-cyan-400 transition-colors shadow-lg shadow-cyan-950/40"
            >
              Start Agent Task
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#features"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-300 hover:border-zinc-700 hover:bg-zinc-850 hover:text-white transition-all"
            >
              Explore Features
            </a>
          </div>
        </div>

        {/* Product Terminal & UI Demonstration Component */}
        <div className="mx-auto max-w-5xl mt-16 rounded-xl border border-zinc-800 bg-zinc-900/90 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-zinc-700" />
              <span className="h-3 w-3 rounded-full bg-zinc-700" />
              <span className="h-3 w-3 rounded-full bg-zinc-700" />
              <span className="ml-2 font-mono text-xs text-zinc-400">
                orbaagent-runtime / execution-session
              </span>
            </div>
            <div className="flex items-center gap-1 font-mono text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("terminal")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "terminal"
                    ? "bg-zinc-800 text-cyan-400 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Terminal Output
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("diff")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "diff"
                    ? "bg-zinc-800 text-cyan-400 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Code Diff
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("pr")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === "pr"
                    ? "bg-zinc-800 text-cyan-400 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Pull Request
              </button>
            </div>
          </div>

          <div className="p-6 font-mono text-xs leading-relaxed min-h-[340px] bg-zinc-950/60">
            {activeTab === "terminal" && (
              <div className="space-y-3 text-zinc-300">
                <div className="text-zinc-500">
                  Execution route selected. Planning complete. Starting implementation...
                </div>
                <div className="text-cyan-400 font-semibold flex items-center gap-2">
                  <Play className="h-3.5 w-3.5" /> Step 1/4: Analyzing repository structure and
                  typescript definitions...
                </div>
                <div className="pl-4 text-zinc-400 border-l border-zinc-800">
                  $ git checkout -b feat/add-authentication <br />$ pnpm exec biome check . <br />
                  Checked 56 files. 0 errors found.
                </div>
                <div className="text-indigo-400 font-semibold flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5" /> Step 2/4: Running Vitest unit test suite...
                </div>
                <div className="pl-4 text-emerald-400 border-l border-zinc-800">
                  ✓ services/model-gateway/src/gateway.test.ts (9 tests) <br />✓
                  services/model-gateway/src/router.test.ts (3 tests) <br />
                  Test Files 4 passed | Tests 19 passed
                </div>
                <div className="text-emerald-400 font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Step 4/4 Complete: Pull Request created
                  cleanly.
                </div>
              </div>
            )}

            {activeTab === "diff" && (
              <div className="space-y-1 font-mono text-xs">
                <div className="text-zinc-500 mb-2">
                  --- a/services/model-gateway/src/gateway.ts
                </div>
                <div className="text-zinc-500 mb-2">
                  +++ b/services/model-gateway/src/gateway.ts
                </div>
                <div className="bg-emerald-950/40 text-emerald-300 px-2 py-1 rounded">
                  + export class ModelGateway &#123;
                </div>
                <div className="bg-emerald-950/40 text-emerald-300 px-2 py-1 rounded">
                  + &nbsp;&nbsp;async *streamChat(request: ChatCompletionRequest):
                  AsyncGenerator&lt;NormalizedEvent&gt; &#123;
                </div>
                <div className="bg-emerald-950/40 text-emerald-300 px-2 py-1 rounded">
                  + &nbsp;&nbsp;&nbsp;&nbsp;const routing = this.router.selectRouting(request);
                </div>
                <div className="bg-emerald-950/40 text-emerald-300 px-2 py-1 rounded">
                  {"+     // Execution route failover optimization"}
                </div>
                <div className="bg-emerald-950/40 text-emerald-300 px-2 py-1 rounded">
                  + &nbsp;&nbsp;&#125;
                </div>
              </div>
            )}

            {activeTab === "pr" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <GitPullRequest className="h-4 w-4 text-emerald-400" />
                    <span className="font-semibold text-white">
                      feat: implement automated software engineering workflow
                    </span>
                  </div>
                  <span className="rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 text-[11px] font-semibold">
                    Open
                  </span>
                </div>
                <p className="text-zinc-300 text-xs leading-relaxed">
                  Automated Pull Request generated by OrbaAgent. Includes clean code changes, unit
                  test coverage, and passing CI validation.
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                    <div className="text-zinc-400 text-[11px]">CI Verification</div>
                    <div className="font-semibold text-emerald-400 mt-1">All Checks Passing</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                    <div className="text-zinc-400 text-[11px]">Branch</div>
                    <div className="font-mono font-semibold text-zinc-200 mt-1">
                      feat/add-authentication
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section id="features" className="py-20 border-t border-zinc-800/80 bg-zinc-950">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-white mb-4">
              Engineered for Production Autonomy
            </h2>
            <p className="text-zinc-400 text-base leading-relaxed">
              OrbaAgent operates behind a unified intelligence architecture, ensuring resilience,
              speed, and clean code output.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 hover:border-zinc-700 transition-colors">
              <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 mb-5">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Automated Route Failover</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Seamless automatic failover handling across intelligence routes on rate limits,
                server errors, or timeouts.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 hover:border-zinc-700 transition-colors">
              <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-indigo-950 border border-indigo-800 text-indigo-400 mb-5">
                <Layers className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Intelligence Router</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Evaluates task complexity, context requirements, tool dependencies, and availability
                automatically without manual configuration.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 hover:border-zinc-700 transition-colors">
              <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-400 mb-5">
                <GitBranch className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">GitHub Native Workflow</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Creates branches, commits clean code, runs local build & test verification, and
                manages GitHub Pull Requests.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Agent Workflow Steps */}
      <section id="workflow" className="py-20 border-t border-zinc-800/80 bg-zinc-900/30">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-white mb-4">
              Autonomous 5-Step Workflow
            </h2>
            <p className="text-zinc-400 text-base">
              How OrbaAgent turns natural language objectives into verified pull requests.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                step: "01",
                title: "Analyze",
                desc: "Inspects repository, types, dependencies, and requirements.",
              },
              {
                step: "02",
                title: "Plan",
                desc: "Formulates step-by-step execution graph and tool calls.",
              },
              {
                step: "03",
                title: "Execute",
                desc: "Edits source code, adds tests, and runs shell commands.",
              },
              {
                step: "04",
                title: "Verify",
                desc: "Executes linting, typechecking, and unit test suites.",
              },
              {
                step: "05",
                title: "Ship",
                desc: "Commits to git branch and opens verified GitHub PR.",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 relative"
              >
                <div className="font-mono text-xs font-bold text-cyan-400 mb-3">{s.step}</div>
                <h4 className="text-base font-semibold text-white mb-1.5">{s.title}</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities Section */}
      <section id="capabilities" className="py-20 border-t border-zinc-800/80 bg-zinc-950">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-white mb-6">
                Built for Real Engineering Work
              </h2>
              <div className="space-y-4">
                {[
                  "Full-stack web applications (Next.js, React, Node.js, Python)",
                  "Terminal and CLI execution in isolated environments",
                  "Automated test-driven verification (Vitest, Jest, PyTest)",
                  "Containerized Docker build and compose validation",
                  "Multi-provider failover telemetry & audit logging",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <div className="h-5 w-5 rounded-full bg-cyan-950 border border-cyan-700 text-cyan-400 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="h-3 w-3" />
                    </div>
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 font-mono text-xs">
              <div className="text-zinc-500 mb-3">{/* Architectural Control Flow */}</div>
              <div className="text-zinc-300">
                User Request <br />↓ <br />
                <span className="text-cyan-400">OrbaAgent Orchestrator</span> <br />↓ <br />
                <span className="text-indigo-400">Intelligence Router</span> <br />↓ <br />
                <span className="text-emerald-400">Primary Execution Route</span> →{" "}
                <span className="text-amber-400">[Failover Route]</span> <br />↓ <br />
                Execution Runtime & Tool Call Loop <br />↓ <br />
                Verified Output & GitHub Pull Request
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 border-t border-zinc-800/80 bg-zinc-900/30">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-3xl font-bold tracking-tight text-white text-center mb-12">
            Frequently Asked Questions
          </h2>

          <div className="space-y-4">
            {[
              {
                q: "Do I select which model to use?",
                a: "No. OrbaAgent automatically routes tasks using its internal Intelligence Router based on complexity, context requirements, latency, and provider health. Model selection is handled entirely by OrbaAgent.",
              },
              {
                q: "What happens if a route experiences an outage or rate limit?",
                a: "OrbaAgent automatically detects rate limits, server errors, or timeouts and seamlessly fails over to alternate eligible routes without corrupting output.",
              },
              {
                q: "How are API credentials handled?",
                a: "API keys are securely held in server environment variables and are never committed to git or exposed to client browser script bundles.",
              },
            ].map((faq, idx) => (
              <div
                key={faq.q}
                className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center justify-between p-5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-850 transition-colors"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-zinc-400 transition-transform ${
                      openFaq === idx ? "rotate-180 text-cyan-400" : ""
                    }`}
                  />
                </button>
                {openFaq === idx && (
                  <div className="px-5 pb-5 text-xs text-zinc-400 leading-relaxed border-t border-zinc-800/60 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 bg-zinc-950 py-12 px-6">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-bold text-white">OrbaAgent</span>
            <span className="text-xs text-zinc-500 font-mono">orbaagent.dev</span>
          </div>

          <div className="flex items-center gap-6 text-xs text-zinc-400 font-medium">
            <Link href="/" className="hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/pricing" className="hover:text-white transition-colors">
              Pricing
            </Link>
            <Link href="/app" className="hover:text-white transition-colors">
              Agent Studio
            </Link>
            <a
              href="https://github.com/coderxp1/OrbaAgent"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub Repository
            </a>
          </div>

          <div className="text-xs text-zinc-500 font-mono">
            © {new Date().getFullYear()} OrbaAgent Platform. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
