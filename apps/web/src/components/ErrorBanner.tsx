"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBannerProps {
  error: { code: string; message: string };
  onRetry: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-y border-red-900/40 bg-red-950/30 px-6 py-2.5 text-xs text-red-200">
      <div className="flex items-center gap-2 overflow-hidden">
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
        <span className="truncate">
          <strong className="font-mono uppercase text-red-400">[{error.code}]</strong>{" "}
          {error.message}
        </span>
      </div>

      <button
        onClick={onRetry}
        type="button"
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-red-800 bg-red-950 px-3 py-1 font-medium text-red-300 hover:bg-red-900 transition-colors"
      >
        <RotateCcw className="h-3 w-3" />
        Retry Generation
      </button>
    </div>
  );
}
