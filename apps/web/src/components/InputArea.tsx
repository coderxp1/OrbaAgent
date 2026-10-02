"use client";

import { Paperclip, Send, Square } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

interface InputAreaProps {
  onSendMessage: (text: string) => void;
  isGenerating: boolean;
  onCancelGeneration: () => void;
}

export function InputArea({ onSendMessage, isGenerating, onCancelGeneration }: InputAreaProps) {
  const [text, setText] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!text.trim() || isGenerating) return;
    onSendMessage(text);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="relative flex items-end rounded-2xl border border-zinc-800 bg-zinc-900/90 p-2 shadow-inner focus-within:border-cyan-500/50 transition-colors">
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            title="Attach file or image"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask OrbaAgent anything or issue a goal..."
            rows={1}
            className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />

          {isGenerating ? (
            <button
              onClick={onCancelGeneration}
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-md shadow-red-950 hover:bg-red-500 transition-colors"
              title="Stop Generation"
            >
              <Square className="h-4 w-4 fill-white" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-950/50 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title="Send Message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-500 px-2 font-mono">
          <span>
            Press <kbd className="rounded bg-zinc-800 px-1 text-zinc-400">Enter</kbd> to send,{" "}
            <kbd className="rounded bg-zinc-800 px-1 text-zinc-400">Shift + Enter</kbd> for line
            break
          </span>
          <span>OrbaAgent Phase 1 — Powered by Model Gateway</span>
        </div>
      </div>
    </div>
  );
}
