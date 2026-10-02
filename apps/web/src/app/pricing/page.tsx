"use client";

import { ArrowRight, Check, Cpu, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  priceDisplay: string;
  includedUsage: string;
  isPopular?: boolean;
  ctaText: string;
  ctaHref: string;
  features: string[];
  limits: string[];
}

export const PLAN_CONFIGS: PricingPlan[] = [
  {
    id: "developer",
    name: "Developer",
    description:
      "Configurable tier for individual developers building and testing autonomous software agents.",
    priceDisplay: "Provisional",
    includedUsage: "50 agent runs / month",
    ctaText: "Launch Agent Studio",
    ctaHref: "/app",
    features: [
      "Automatic intelligence route selection",
      "Automatic failover architecture",
      "Terminal & shell tool execution",
      "Git branch & commit automation",
      "Standard audit log retention",
    ],
    limits: ["Single concurrent agent run", "Standard queue priority"],
  },
  {
    id: "team",
    name: "Team",
    description:
      "Configurable tier for engineering teams requiring scale, resilience, and GitHub PR workflows.",
    priceDisplay: "Provisional",
    includedUsage: "1,000 agent runs / month",
    isPopular: true,
    ctaText: "Launch Agent Studio",
    ctaHref: "/app",
    features: [
      "Multi-provider failover architecture",
      "Multi-dimensional Intelligence Router",
      "Automated GitHub Pull Request creation",
      "Vitest & Docker build verification",
      "Detailed audit log telemetry",
      "Concurrent execution runs",
    ],
    limits: ["Priority queue allocation"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description:
      "Custom deployment, dedicated compute instances, and compliance controls for enterprise fleets.",
    priceDisplay: "Custom",
    includedUsage: "Configurable usage allocation",
    ctaText: "Contact Engineering",
    ctaHref: "mailto:contact@orbaagent.dev",
    features: [
      "Custom provider endpoint integrations",
      "Isolated container execution environments",
      "SSO & SAML authentication",
      "Custom audit log retention",
      "Dedicated SLA support",
      "Custom rate limits and context allocations",
    ],
    limits: [],
  },
];

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");

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
            <Link href="/#features" className="hover:text-zinc-100 transition-colors">
              Features
            </Link>
            <Link href="/#workflow" className="hover:text-zinc-100 transition-colors">
              Workflow
            </Link>
            <Link href="/pricing" className="text-white font-semibold">
              Pricing
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 transition-colors"
            >
              Launch Agent Studio
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Header */}
      <section className="pt-16 pb-12 px-6 text-center">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3.5 py-1.5 text-xs text-zinc-400 mb-6 font-mono">
            Configurable Pricing Architecture • Final Rates Pending Launch Approval
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-white mb-4">
            Transparent Agent Pricing
          </h1>
          <p className="text-base text-zinc-400 leading-relaxed mb-8">
            Modular plan architecture designed for software development teams.
          </p>

          {/* Billing Cycle Toggle */}
          <div className="inline-flex items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900 p-1">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                billingCycle === "monthly"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Monthly Cycle
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("annual")}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                billingCycle === "annual"
                  ? "bg-cyan-500 text-zinc-950 font-bold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Annual Cycle
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards Grid */}
      <section className="py-12 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {PLAN_CONFIGS.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl border flex flex-col justify-between p-8 relative transition-all ${
                plan.isPopular
                  ? "border-cyan-500 bg-zinc-900 shadow-xl shadow-cyan-950/20"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
              }`}
            >
              {plan.isPopular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-3 py-0.5 text-[11px] font-bold text-zinc-950 uppercase tracking-wider">
                  Configured Tier
                </div>
              )}

              <div>
                <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                <p className="text-xs text-zinc-400 min-h-[40px] leading-relaxed mb-6">
                  {plan.description}
                </p>

                <div className="mb-6 border-b border-zinc-800/80 pb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-white">{plan.priceDisplay}</span>
                  </div>
                  <div className="mt-2 inline-block rounded-md bg-zinc-800/60 px-2.5 py-1 font-mono text-[11px] text-cyan-400 font-medium">
                    {plan.includedUsage}
                  </div>
                </div>

                <div className="space-y-3 mb-8">
                  <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Included Capabilities
                  </div>
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-2.5 text-xs text-zinc-300">
                      <Check className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Link
                  href={plan.ctaHref}
                  className={`w-full inline-flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-semibold transition-colors shadow-sm ${
                    plan.isPopular
                      ? "bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                      : "bg-zinc-800 text-white hover:bg-zinc-750"
                  }`}
                >
                  {plan.ctaText}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Security & Failover Guarantee Banner */}
      <section className="py-12 px-6 max-w-5xl mx-auto border-t border-zinc-800/80 mt-8">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 flex flex-col sm:flex-row items-center gap-5">
          <div className="h-10 w-10 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-white mb-1">
              Production Gateway & Data Protection
            </h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              All plans run on OrbaAgent&apos;s provider-independent Model Gateway. Source code,
              credentials, and execution data remain secure at all times.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 bg-zinc-950 py-12 px-6 mt-16">
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
            <Link href="/pricing" className="text-white font-semibold">
              Pricing
            </Link>
            <Link href="/app" className="hover:text-white transition-colors">
              Agent Studio
            </Link>
          </div>

          <div className="text-xs text-zinc-500 font-mono">
            © {new Date().getFullYear()} OrbaAgent Platform. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
