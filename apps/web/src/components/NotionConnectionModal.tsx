"use client";

import { useEffect, useState } from "react";

interface NotionConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected?: boolean;
  connectedAccount?: string;
  onConnectedChange?: (connected: boolean, account?: string) => void;
}

/**
 * Connect/disconnect Notion, mirroring GitHubConnectionModal's flow:
 * OAuth in a popup (when the server has a public integration
 * configured), completion detected via the callback's postMessage and
 * by polling /api/connections (which verifies the token server-side
 * against the Notion API before reporting connected).
 *
 * When OAuth is not configured, the modal explains the internal
 * integration token path instead of offering a dead button.
 */
export function NotionConnectionModal({
  isOpen,
  onClose,
  isConnected,
  connectedAccount,
  onConnectedChange,
}: NotionConnectionModalProps) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    fetch("/api/connections")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setOauthConfigured(Boolean(data?.oauthConfigured?.notion)))
      .catch(() => setOauthConfigured(false));

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "ORBA_NOTION_CONNECTED") {
        setConnecting(false);
        onConnectedChange?.(true, connectedAccount || "Notion Workspace");
      } else if (event.data?.type === "ORBA_NOTION_ERROR") {
        setConnecting(false);
        setErrorMsg(event.data.message || "Notion authorization failed");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isOpen, onConnectedChange, connectedAccount]);

  if (!isOpen) return null;

  const handleStartConnection = () => {
    setConnecting(true);
    setErrorMsg(null);
    const width = 600;
    const height = 750;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    let popup: Window | null = null;
    try {
      popup = window.open(
        "/api/auth/notion",
        "orba_notion_oauth",
        `width=${width},height=${height},left=${left},top=${top},status=yes,toolbar=no,menubar=no`,
      );
    } catch {
      // Popup blocked; polling below will simply time out.
    }
    let attempts = 0;
    const pollTimer = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch("/api/connections");
        if (res.ok) {
          const data = await res.json();
          const notion = data.integrations?.find((i: { name: string }) => i.name === "notion");
          if (notion?.connected) {
            clearInterval(pollTimer);
            setConnecting(false);
            onConnectedChange?.(true, notion.accountName || "Notion Workspace");
            if (popup && !popup.closed) {
              try {
                popup.close();
              } catch {}
            }
            return;
          }
        }
      } catch {}
      let closed = false;
      try {
        closed = popup ? popup.closed : false;
      } catch {}
      if (closed || attempts >= 40) {
        clearInterval(pollTimer);
        setConnecting(false);
      }
    }, 1500);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/auth/notion/disconnect", { method: "POST" });
      onConnectedChange?.(false, undefined);
    } catch {
      setErrorMsg("Failed to disconnect Notion.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100">
        <h3 className="text-lg font-semibold">Notion</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Search, read, and update pages and databases in your Notion workspace. Orba only sees
          content that is shared with the integration.
        </p>

        {errorMsg && <p className="mt-3 text-sm text-red-400">{errorMsg}</p>}

        {isConnected ? (
          <div className="mt-4">
            <p className="text-sm text-zinc-300">
              Connected{connectedAccount ? ` — ${connectedAccount}` : ""}.
            </p>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="mt-4 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : oauthConfigured ? (
          <button
            type="button"
            onClick={handleStartConnection}
            disabled={connecting}
            className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-50"
          >
            {connecting ? "Waiting for Notion…" : "Connect with Notion"}
          </button>
        ) : oauthConfigured === false ? (
          <div className="mt-4 text-sm leading-6 text-zinc-400">
            <p>OAuth is not configured on this server. To connect via an internal integration:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Create an integration at notion.so/my-integrations (read, insert, update content).
              </li>
              <li>Share the pages and databases Orba may use with that integration.</li>
              <li>Set NOTION_API_TOKEN on the server from the integration's secret.</li>
            </ol>
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-400">Checking configuration…</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}
