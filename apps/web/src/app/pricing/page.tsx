"use client";

import { ArrowRight, Check, Cpu, HelpCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number | "Custom";
  annualMonthlyPrice: number | "Custom";
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
    description: "Ideal for individual developers building and testing autonomous software agents.",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    includedUsage: "50 agent runs / month",
    ctaText: "Get Started Free",
    ctaHref: "/app",
    features: [
      "Langdock API primary routing",
      "Automatic failover architecture",
      "Terminal & shell tool execution",
      "Git branch & commit automation",
      "Standard audit log retention (7 days)",
    ],
    limits: ["Single concurrent agent run", "Standard queue priority"],
  },
  {
    id: "team",
    name: "Team",
    description:
      "Designed for software engineering teams requiring scale, resilience, and GitHub PR workflows.",
    monthlyPrice: 49,
    annualMonthlyPrice: 39,
    includedUsage: "1,000 agent runs / month",
    isPopular: true,
    ctaText: "Start Team Trial",
    ctaHref: "/app",
    features: [
      "Langdock + OpenRouter multi-provider failover",
      "Multi-dimensional Intelligence Router",
      "Automated GitHub Pull Request creation",
      "Vitest & Docker build verification",
      "30-day detailed audit log telemetry",
      "5 concurrent agent execution runs",
    ],
    limits: ["Priority email & Discord support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description:
      "Custom deployment, dedicated compute instances, and compliance controls for enterprise fleets.",
    monthlyPrice: "Custom",
    annualMonthlyPrice: "Custom",
    includedUsage: "Unlimited agent runs",
    ctaText: "Contact Sales",
    ctaHref: "mailto:sales@orbaagent.dev",
    features: [
      "Custom provider endpoint integrations",
      "Isolated container execution environments",
      "SSO & SAML authentication",
      "Unlimited audit log retention",
      "Dedicated account manager & 99.9% SLA",
      "Custom rate limits and context allocations",
    ],
    limits: [],
  },
];

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(true);

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
          <h1 className="text-4xl font-extrabold tracking-tight text-white mb-4">
            Simple, Transparent Pricing for Software Teams
          </h1>
          <p className="text-base text-zinc-400 leading-relaxed mb-8">
            Clear usage limits and production-grade provider failover. No hidden tokens or
            artificial surprises.
          </p>

          {/* Monthly / Annual Toggle */}
          <div className="inline-flex items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900 p-1">
            <button
              type="button"
              onClick={() => setIsAnnual(false)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                !isAnnual ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-white"
              }`}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => setIsAnnual(true)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                isAnnual ? "bg-cyan-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
              }`}
            >
              Annual Billing (Save 20%)
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards Grid */}
      <section className="py-12 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {PLAN_CONFIGS.map((plan) => {
            const price = isAnnual ? plan.annualMonthlyPrice : plan.monthlyPrice;
            return (
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
                    Most Popular
                  </div>
                )}

                <div>
                  <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                  <p className="text-xs text-zinc-400 min-h-[40px] leading-relaxed mb-6">
                    {plan.description}
                  </p>

                  <div className="mb-6 border-b border-zinc-800/80 pb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-white">
                        {typeof price === "number" ? `$${price}` : price}
                      </span>
                      {typeof price === "number" && (
                        <span className="text-xs text-zinc-400">/ month</span>
                      )}
                    </div>
                    <div className="mt-2 inline-block rounded-md bg-zinc-800/60 px-2.5 py-1 font-mono text-[11px] text-cyan-400 font-medium">
                      Included: {plan.includedUsage}
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
            );
          })}
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
              Production Gateway & Zero Vendor Lock-in
            </h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              All plans benefit from OrbaAgent&apos;s provider-independent Model Gateway. Your code,
              API keys, and repository metadata remain private and secure at all times.
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
