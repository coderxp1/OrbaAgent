"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export interface CopyMessageButtonProps {
  message: string;
  className?: string;
}

export function CopyMessageButton({ message, className = "" }: CopyMessageButtonProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!message || message.trim().length === 0) return;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
      } else {
        // Fallback for older browsers or insecure origins
        const textarea = document.createElement("textarea");
        textarea.value = message;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!successful) throw new Error("Fallback copy command failed");
      }

      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  };

  const isCopied = copyStatus === "copied";
  const isError = copyStatus === "error";

  const label = isCopied ? "Copied" : isError ? "Copy failed" : "Copy message";

  return (
    <div className="relative inline-flex items-center">
      <button
        onClick={handleCopy}
        type="button"
        aria-label={label}
        title={label}
        disabled={!message}
        className={`group flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-zinc-600 ${
          isCopied
            ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-400"
            : isError
              ? "border-red-500/40 bg-red-950/30 text-red-400"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200"
        } ${className}`}
      >
        {isCopied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[2.2]" />
        ) : (
          <Copy className="h-3.5 w-3.5 transition-transform group-hover:scale-105" />
        )}
      </button>

      {/* Floating tooltip feedback */}
      {isCopied && (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 shadow-lg border border-zinc-700 whitespace-nowrap animate-in fade-in zoom-in-95 duration-100">
          Copied
        </span>
      )}
      {isError && (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-red-300 shadow-lg border border-zinc-700 whitespace-nowrap animate-in fade-in zoom-in-95 duration-100">
          Copy failed
        </span>
      )}
    </div>
  );
}

