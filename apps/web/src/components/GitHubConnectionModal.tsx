"use client";

import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Key,
  Lock,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { GitHubIcon } from "./AppIcons";

interface GitHubConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected?: boolean;
  connectedAccount?: string;
  onConnectedChange?: (connected: boolean, account?: string) => void;
}

export function GitHubConnectionModal({
  isOpen,
  onClose,
  isConnected = false,
  connectedAccount,
  onConnectedChange,
}: GitHubConnectionModalProps) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const [showPatInput, setShowPatInput] = useState(false);
  const [patToken, setPatToken] = useState("");
  const [savingPat, setSavingPat] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "ORBA_GITHUB_CONNECTED") {
        setConnecting(false);
        const username = event.data.username || "GitHub User";
        onConnectedChange?.(true, username);
      } else if (event.data?.type === "ORBA_GITHUB_ERROR") {
        setConnecting(false);
        setErrorMsg(event.data.error || "GitHub authorization failed");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isOpen, onConnectedChange]);

  if (!isOpen) return null;

  const handleStartConnection = () => {
    setConnecting(true);
    setErrorMsg(null);

    // Open GitHub OAuth popup
    const width = 600;
    const height = 750;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    let popup: Window | null = null;
    try {
      popup = window.open(
        "/api/auth/github",
        "orba_gh_oauth",
        `width=${width},height=${height},left=${left},top=${top},status=yes,toolbar=no,menubar=no`,
      );
    } catch (openErr) {
      console.warn("Failed to open popup:", openErr);
    }

    let pollAttempts = 0;
    const maxAttempts = 40; // 60 seconds (1500ms * 40)

    const pollTimer = setInterval(async () => {
      pollAttempts++;

      // Active verification via /api/connections endpoint
      try {
        const res = await fetch("/api/connections");
        if (res.ok) {
          const data = await res.json();
          const gh = data.integrations?.find((i: { name: string }) => i.name === "github");
          if (gh?.connected) {
            clearInterval(pollTimer);
            setConnecting(false);
            onConnectedChange?.(true, gh.accountName || "GitHub User");
            if (popup && !popup.closed) {
              try {
                popup.close();
              } catch {}
            }
            return;
          }
        }
      } catch {}

      // Safe check for popup closure
      let isPopupClosed = false;
      try {
        isPopupClosed = popup ? popup.closed : false;
      } catch {
        isPopupClosed = false;
      }

      if (isPopupClosed || pollAttempts >= maxAttempts) {
        clearInterval(pollTimer);
        setConnecting(false);
      }
    }, 1500);
  };

  const handleConnectWithPat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patToken.trim()) return;

    setSavingPat(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: patToken.trim(),
          status: {
            name: "github",
            displayName: "GitHub",
            connected: true,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to authorize GitHub token");
      }

      const account = data.updated?.accountName || "GitHub User";
      onConnectedChange?.(true, account);
      setShowPatInput(false);
      setPatToken("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setSavingPat(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/auth/github/disconnect", { method: "POST" });
      if (res.ok) {
        onConnectedChange?.(false, undefined);
      }
    } catch (e) {
      console.error("Failed to disconnect", e);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-[460px] bg-[#1a1a1a] text-[#ededed] rounded-2xl p-6 sm:p-8 shadow-2xl border border-[#2e2e2e] overflow-hidden">
        {/* Close Button top-right */}
        <button
          onClick={onClose}
          type="button"
          className="absolute top-4 right-4 w-7 h-7 rounded-full bg-[#242424] border border-[#333] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-[#2e2e2e] transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Top Connecting Logos (Orba Mascot <-> GitHub) */}
        <div className="flex items-center justify-center gap-3.5 mb-5 mt-1">
          <div className="w-12 h-12 rounded-xl bg-[#222222] border border-[#333] flex items-center justify-center shadow-md">
            <img src="/orba-mascot.svg" alt="OrbaAgent" className="w-7 h-7" />
          </div>

          <div className="text-zinc-500 font-mono text-base select-none">⇄</div>

          <div className="w-12 h-12 rounded-xl bg-[#222222] border border-[#333] flex items-center justify-center text-white shadow-md">
            <GitHubIcon className="w-7 h-7 text-white" />
          </div>
        </div>

        {/* Heading */}
        <h2 className="text-base sm:text-lg font-bold text-white text-center mb-6 leading-snug px-2">
          {isConnected
            ? "GitHub is connected to OrbaAgent"
            : "To start, install the OrbaAgent app in GitHub"}
        </h2>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-red-900/30 border border-red-700/50 flex items-start gap-2.5 text-xs text-red-200">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {isConnected ? (
          <div className="space-y-4 mb-6">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-white">Active Connection</div>
                  <div className="text-[11px] text-zinc-400">
                    Connected as{" "}
                    <span className="text-emerald-300 font-mono">
                      @{connectedAccount || "GitHub User"}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                Authorized
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              OrbaAgent has permission to inspect pull requests, inspect repositories, and execute
              autonomous git operations on your behalf.
            </p>
          </div>
        ) : (
          /* 3 Callout rows matching mockup */
          <div className="space-y-4 mb-6">
            {/* Row 1: External Link */}
            <div className="flex items-start gap-3.5">
              <div className="w-5 h-5 rounded flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-white">
                  GitHub will open in a new tab
                </h4>
                <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                  Click &ldquo;Start connection&rdquo; below, then authenticate and accept terms in
                  the new tab
                </p>
              </div>
            </div>

            {/* Row 2: Permissions Key */}
            <div className="flex items-start gap-3.5">
              <div className="w-5 h-5 rounded flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                <Key className="w-4 h-4 stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-white">
                  GitHub permissions are strictly respected
                </h4>
                <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                  Members can only get AI answers about content they are authorized to see in
                  GitHub.
                </p>
              </div>
            </div>

            {/* Row 3: Security Lock */}
            <div className="flex items-start gap-3.5">
              <div className="w-5 h-5 rounded flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                <Lock className="w-4 h-4 stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-white">
                  OrbaAgent does not train models on your GitHub data
                </h4>
              </div>
            </div>
          </div>
        )}

        {/* Step-by-step guide dropdown */}
        {showGuide && (
          <div className="mb-4 p-3.5 rounded-xl bg-[#202020] border border-[#333] text-xs text-zinc-300 space-y-2 animate-in fade-in duration-150">
            <div className="font-semibold text-white">Step-by-step connection guide:</div>
            <ol className="list-decimal list-inside space-y-1 text-zinc-400 text-[11px]">
              <li>
                Click &ldquo;Start connection&rdquo; to launch the GitHub OAuth consent dialog.
              </li>
              <li>Sign in to GitHub if you are not already logged in.</li>
              <li>Select your organization or personal repositories to grant access.</li>
              <li>Click &ldquo;Authorize OrbaAgent&rdquo; to complete integration.</li>
            </ol>
          </div>
        )}

        {/* Alternative PAT Form */}
        {!isConnected && (
          <div className="mb-4">
            <button
              onClick={() => setShowPatInput(!showPatInput)}
              type="button"
              className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-4 transition-colors flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5 text-zinc-400" />
              <span>
                {showPatInput
                  ? "Hide Personal Access Token input"
                  : "Or connect using Personal Access Token (PAT)"}
              </span>
            </button>

            {showPatInput && (
              <form
                onSubmit={handleConnectWithPat}
                className="mt-2.5 p-3 rounded-xl bg-[#202020] border border-[#333] space-y-2.5 animate-in fade-in duration-150"
              >
                <div className="text-[11px] text-zinc-400 leading-snug">
                  Paste a Personal Access Token with{" "}
                  <code className="text-zinc-300 bg-zinc-800 px-1 py-0.5 rounded font-mono">
                    repo
                  </code>{" "}
                  and{" "}
                  <code className="text-zinc-300 bg-zinc-800 px-1 py-0.5 rounded font-mono">
                    read:user
                  </code>{" "}
                  scopes.
                </div>
                <input
                  type="password"
                  value={patToken}
                  onChange={(e) => setPatToken(e.target.value)}
                  placeholder="ghp_... or github_pat_..."
                  className="w-full px-3 py-2 rounded-lg bg-[#141414] border border-[#383838] text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={savingPat || !patToken.trim()}
                  className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs transition-colors flex items-center justify-center gap-2"
                >
                  {savingPat ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying token...</span>
                    </>
                  ) : (
                    <span>Save and Connect Token</span>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5">
          {isConnected ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                type="button"
                className="flex-1 py-2.5 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-medium text-xs sm:text-sm transition-all flex items-center justify-center gap-2"
              >
                {disconnecting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Disconnecting...</span>
                  </>
                ) : (
                  <span>Disconnect GitHub</span>
                )}
              </button>
              <button
                onClick={onClose}
                type="button"
                className="py-2.5 px-5 rounded-xl bg-[#0070f3] hover:bg-blue-600 font-medium text-xs sm:text-sm text-white transition-all"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartConnection}
              disabled={connecting}
              type="button"
              className="w-full py-2.5 sm:py-3 px-4 rounded-xl bg-[#0070f3] hover:bg-blue-600 active:scale-[0.99] font-medium text-xs sm:text-sm text-white shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
            >
              {connecting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Connecting in popup tab...</span>
                </>
              ) : (
                <span>Start connection</span>
              )}
            </button>
          )}

          <button
            onClick={() => setShowGuide(!showGuide)}
            type="button"
            className="w-full py-2 sm:py-2.5 px-4 rounded-xl bg-transparent hover:bg-[#252525] border border-[#333] font-medium text-xs text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2"
          >
            <BookOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span>Read our step-by-step guide</span>
          </button>
        </div>
      </div>
    </div>
  );
}
