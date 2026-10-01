"use client";

import { Bot, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { Header } from "../components/Header";
import { InputArea } from "../components/InputArea";
import { MessageItem } from "../components/MessageItem";
import { UsageBar } from "../components/UsageBar";
import { useAgentChat } from "../components/useAgentChat";

export default function Home() {
  const {
    modelId,
    setModelId,
    messages,
    isGenerating,
    error,
    latestUsage,
    activeTraceId,
    sendMessage,
    cancelGeneration,
    retryLastMessage,
    clearChat,
  } = useAgentChat("grok-2-latest");

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100 font-sans antialiased overflow-hidden">
      {/* Header Bar */}
      <Header
        modelId={modelId}
        onSelectModel={setModelId}
        activeTraceId={activeTraceId}
        onClearChat={clearChat}
      />

      {/* Main Conversation Feed */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-600 to-indigo-600 shadow-xl shadow-cyan-950/60 mb-6">
              <Bot className="h-9 w-9 text-white" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
              Welcome to OrbaAgent
            </h2>
            <p className="max-w-md text-sm text-zinc-400 mb-8 leading-relaxed">
              Autonomous AI Agent Platform powered by normalized Model Gateway. Ask questions,
              explore code, or simulate tool calls with xAI Grok, Claude, GPT-4o, and Gemini.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full text-left">
              <button
                onClick={() => sendMessage("What is the architecture of OrbaAgent?")}
                type="button"
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-300 hover:border-cyan-500/50 hover:bg-zinc-900 transition-all group"
              >
                <Sparkles className="h-4 w-4 text-cyan-400 shrink-0 group-hover:scale-110 transition-transform" />
                <span>Explain OrbaAgent Architecture</span>
              </button>

              <button
                onClick={() => sendMessage("Demonstrate tool execution and agent thought process.")}
                type="button"
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-300 hover:border-cyan-500/50 hover:bg-zinc-900 transition-all group"
              >
                <Sparkles className="h-4 w-4 text-indigo-400 shrink-0 group-hover:scale-110 transition-transform" />
                <span>Simulate Agent Tool Calling</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col min-h-full">
            {messages.map((msg) => (
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
