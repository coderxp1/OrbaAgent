"use client";

import type { ChatMessage } from "@orbaagent/shared";
import { Bot, Code2, Cpu, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { Header } from "../components/Header";
import { InputArea } from "../components/InputArea";
import { MessageItem } from "../components/MessageItem";
import { UsageBar } from "../components/UsageBar";
import { useAgentChat } from "../components/useAgentChat";

export default function Home() {
  const {
    messages,
    isGenerating,
    error,
    latestUsage,
    activeTraceId,
    sendMessage,
    cancelGeneration,
    retryLastMessage,
    clearChat,
  } = useAgentChat();

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100 font-sans antialiased overflow-hidden">
      {/* Header Bar */}
      <Header activeTraceId={activeTraceId} onClearChat={clearChat} />

      {/* Main Conversation Feed */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-600 to-indigo-600 shadow-xl shadow-cyan-950/60 mb-6">
              <Bot className="h-9 w-9 text-white" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
              What can OrbaAgent build for you?
            </h2>
            <p className="max-w-md text-sm text-zinc-400 mb-8 leading-relaxed">
              Autonomous Software Engineering Agent. Give OrbaAgent an objective and it will plan,
              execute shell commands, edit code, run tests, and deliver results automatically.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full text-left">
              <button
                onClick={() =>
                  sendMessage("Build a full-stack web application with Next.js & Tailwind CSS.")
                }
                type="button"
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-300 hover:border-cyan-500/50 hover:bg-zinc-900 transition-all group"
              >
                <Code2 className="h-4 w-4 text-cyan-400 shrink-0 group-hover:scale-110 transition-transform" />
                <div>
                  <div className="font-semibold text-zinc-200">Build Full-Stack App</div>
                  <div className="text-zinc-500 text-[11px]">
                    Generate Next.js application & components
                  </div>
                </div>
              </button>

              <button
                onClick={() =>
                  sendMessage("Simulate terminal execution, multi-step planning, and tool calls.")
                }
                type="button"
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-300 hover:border-cyan-500/50 hover:bg-zinc-900 transition-all group"
              >
                <Terminal className="h-4 w-4 text-indigo-400 shrink-0 group-hover:scale-110 transition-transform" />
                <div>
                  <div className="font-semibold text-zinc-200">Execute Terminal Workflow</div>
                  <div className="text-zinc-500 text-[11px]">
                    Simulate CLI tool calls & execution plan
                  </div>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col min-h-full">
            {messages.map((msg: ChatMessage) => (
              <MessageItem key={msg.id || Math.random().toString()} message={msg} />
            ))}
          </div>
        )}
      </main>

      {/* Error Banner */}
      {error && <ErrorBanner error={error} onRetry={retryLastMessage} />}

      {/* Token Usage Accounting Bar */}
      <UsageBar usage={latestUsage} />

      {/* Input Form Bar */}
      <InputArea
        onSendMessage={sendMessage}
        isGenerating={isGenerating}
        onCancelGeneration={cancelGeneration}
      />
    </div>
  );
}
