import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrbaAgent — Autonomous Software Engineering Platform",
  description:
    "OrbaAgent plans, writes code, executes shell commands, runs tests, and creates GitHub pull requests autonomously.",
  metadataBase: new URL("https://orbaagent.dev"),
  keywords: [
    "Autonomous AI Agent",
    "Software Engineering Agent",
    "Code Generation",
    "Model Gateway",
    "GitHub Workflow",
    "DevOps Automation",
  ],
  openGraph: {
    title: "OrbaAgent — Autonomous Software Engineering Platform",
    description:
      "Production-grade autonomous AI software engineering agent that plans, builds, tests, and deploys applications.",
    url: "https://orbaagent.dev",
    siteName: "OrbaAgent",
    images: [
      {
        url: "https://orbaagent.dev/og-image.png",
        width: 1200,
        height: 630,
        alt: "OrbaAgent Autonomous Software Engineering Platform",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OrbaAgent — Autonomous Software Engineering Platform",
    description:
      "Production-grade autonomous AI software engineering agent that plans, builds, tests, and deploys applications.",
    images: ["https://orbaagent.dev/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased selection:bg-cyan-500/20 selection:text-cyan-300">
        {children}
      </body>
    </html>
  );
}
