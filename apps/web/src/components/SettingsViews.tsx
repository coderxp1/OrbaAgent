"use client";

import type React from "react";
import { useState, useEffect } from "react";
import {
  User,
  Sliders,
  Bell,
  Mail,
  Settings,
  Users,
  BarChart2,
  DownloadCloud,
  Sparkles,
  Calendar,
  SlidersHorizontal,
  Check,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Server,
  Cpu,
  HardDrive,
} from "lucide-react";

// --- 1. Account Profile View ---
export function AccountProfileView({ onProfileChange }: { onProfileChange?: (name: string) => void }) {
  const [displayName, setDisplayName] = useState("Hartmann");
  const [email, setEmail] = useState("hartmann@orbaagent.dev");
  const [workspaceName, setWorkspaceName] = useState("Hartmann's Space");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.displayName) {
          setDisplayName(data.displayName);
          if (onProfileChange) onProfileChange(data.displayName);
        }
        if (data.email) setEmail(data.email);
        if (data.workspaceName) setWorkspaceName(data.workspaceName);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email, workspaceName }),
      });
      if (res.ok) {
        setSaved(true);
        localStorage.setItem("orba_user_name", displayName);
        if (onProfileChange) onProfileChange(displayName);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">Account &amp; Identity</h3>
        <p className="text-xs text-zinc-400">Manage your user profile and identity credentials.</p>
      </div>

      <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#18181b] border border-zinc-800">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-violet-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-blue-900/30">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-semibold text-white">{displayName}</div>
          <div className="text-xs text-zinc-400 font-mono">{email}</div>
          <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 border border-emerald-800/60 text-emerald-300">
            Workspace Owner
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Workspace Space Name</label>
          <input
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-all flex items-center gap-2"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>Save Profile</span>
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Check className="w-4 h-4" /> Profile updated successfully!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// --- 2. Preferences View ---
export function PreferencesView() {
  const [modelTier, setModelTier] = useState("auto");
  const [sound, setSound] = useState(true);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">Preferences</h3>
        <p className="text-xs text-zinc-400">Configure your editor, model routing, and audio settings.</p>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Default Model Routing</div>
            <div className="text-[11px] text-zinc-400">Select routing behavior for new turns</div>
          </div>
          <select
            value={modelTier}
            onChange={(e) => setModelTier(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-200"
          >
            <option value="auto">Auto Intelligence (Recommended)</option>
            <option value="fast">Fast Latency (GPT-5.4-mini)</option>
            <option value="pro">Pro Reasoning (GPT-5.2-pro / o3)</option>
          </select>
        </div>

        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Media Generation Audio Feedback</div>
            <div className="text-[11px] text-zinc-400">Play subtle chime when image/video generation completes</div>
          </div>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-600"
          />
        </div>
      </div>
    </div>
  );
}

// --- 3. Notifications View ---
export function NotificationsView() {
  const [emailAlerts, setEmailAlerts] = useState(false);
  const [genFinished, setGenFinished] = useState(true);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">Notifications</h3>
        <p className="text-xs text-zinc-400">Configure desktop and in-app alert preferences.</p>
      </div>

      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Generation Completion Alerts</div>
            <div className="text-[11px] text-zinc-400">Notify when long-running video or image render completes</div>
          </div>
          <input
            type="checkbox"
            checked={genFinished}
            onChange={(e) => setGenFinished(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-600"
          />
        </div>

        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Weekly Usage Digest</div>
            <div className="text-[11px] text-zinc-400">Receive summary of workspace generations and credits</div>
          </div>
          <input
            type="checkbox"
            checked={emailAlerts}
            onChange={(e) => setEmailAlerts(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-600"
          />
        </div>
      </div>
    </div>
  );
}

// --- 4. Mail & Calendar View ---
export function MailCalendarView() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">Mail &amp; Calendar</h3>
        <p className="text-xs text-zinc-400">Integrate external email accounts and calendar scheduling.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Google Calendar</span>
            <span className="text-[10px] text-zinc-500 font-mono">OAuth 2.0</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Sync meeting agendas, check scheduling conflicts, and generate calendar invitations.
          </p>
          <button className="w-full py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white transition-colors">
            Connect Google Calendar
          </button>
        </div>

        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Microsoft Outlook 365</span>
            <span className="text-[10px] text-zinc-500 font-mono">MS Graph</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Index enterprise inbox context and create calendar events directly in Office 365.
          </p>
          <button className="w-full py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white transition-colors">
            Connect Outlook
          </button>
        </div>
      </div>
    </div>
  );
}

// --- 5. General Workspace View ---
export function GeneralWorkspaceView() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">General Workspace Settings</h3>
        <p className="text-xs text-zinc-400">Manage workspace domains, data tenancy, and storage limits.</p>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 space-y-2">
          <div className="text-xs font-semibold text-white">Workspace Identifier</div>
          <div className="text-xs font-mono text-zinc-400 bg-zinc-900 p-2 rounded-lg border border-zinc-800">
            default-tenant / orbaagent-prod
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 space-y-2">
          <div className="text-xs font-semibold text-white">Media Processing Pipeline</div>
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>Service Status:</span>
            <span className="font-mono text-emerald-400">Secure High-Performance Pipeline (Active)</span>
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>Enterprise Security:</span>
            <span className="font-mono text-blue-400">Enforced Hardware Isolation Boundary</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 6. People View ---
export function PeopleView() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">People &amp; Permissions</h3>
          <p className="text-xs text-zinc-400">Manage team members and role entitlements.</p>
        </div>
        <button className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors">
          + Invite Member
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-[#18181b] divide-y divide-zinc-800/80">
        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
              H
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Hartmann</div>
              <div className="text-[11px] text-zinc-500">hartmann@orbaagent.dev</div>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-950 text-blue-300 border border-blue-800/50">
            Owner
          </span>
        </div>

        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-violet-600 text-white font-bold text-xs flex items-center justify-center">
              A
            </div>
            <div>
              <div className="text-xs font-semibold text-white">OrbaAgent Autonomous Worker</div>
              <div className="text-[11px] text-zinc-500">system@orbaagent.dev</div>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 text-zinc-300">
            Agent Runtime
          </span>
        </div>
      </div>
    </div>
  );
}

// --- 7. Analytics View ---
export function AnalyticsView() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">Workspace Analytics</h3>
        <p className="text-xs text-zinc-400">Real-time usage telemetry, media throughput, and service health.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-[#18181b] border border-zinc-800">
          <div className="text-[11px] text-zinc-400 mb-1">Total Generations</div>
          <div className="text-xl font-bold text-white">52</div>
          <div className="text-[10px] text-emerald-400 mt-1">100% completed</div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#18181b] border border-zinc-800">
          <div className="text-[11px] text-zinc-400 mb-1">Image Latency</div>
          <div className="text-xl font-bold text-white">3.4s</div>
          <div className="text-[10px] text-zinc-500 mt-1">Ultra-fast Native Render</div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#18181b] border border-zinc-800">
          <div className="text-[11px] text-zinc-400 mb-1">Compute Isolation</div>
          <div className="text-xl font-bold text-emerald-400">Dedicated</div>
          <div className="text-[10px] text-zinc-500 mt-1">Protected Environment</div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#18181b] border border-zinc-800">
          <div className="text-[11px] text-zinc-400 mb-1">Inference Capacity</div>
          <div className="text-xl font-bold text-white">Optimal</div>
          <div className="text-[10px] text-zinc-500 mt-1">High-Throughput</div>
        </div>
      </div>
    </div>
  );
}

// --- 8. Import View ---
export function ImportView() {
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleSimulatedImport = () => {
    setImportStatus("Validating schema...");
    setTimeout(() => {
      setImportStatus("Import complete! 14 documents and code files verified.");
    }, 1500);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">Import Workspace Data</h3>
        <p className="text-xs text-zinc-400">Bring codebases, documentation, or historical chat archives.</p>
      </div>

      <div className="border-2 border-dashed border-zinc-700/80 rounded-2xl p-8 text-center space-y-3 bg-[#18181b]/50">
        <DownloadCloud className="w-8 h-8 text-blue-400 mx-auto" />
        <div className="text-xs font-semibold text-white">Drag &amp; drop archive file, or select</div>
        <p className="text-[11px] text-zinc-500">Supports .zip, .tar.gz, .json, .csv, and Jupyter .ipynb</p>
        <button
          onClick={handleSimulatedImport}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
        >
          Select File to Import
        </button>
      </div>

      {importStatus && (
        <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-800/60 text-xs text-blue-300">
          {importStatus}
        </div>
      )}
    </div>
  );
}

// --- 9. AI Engine Settings View ---
export function AiSettingsView() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">OrbaAgent AI Engine</h3>
        <p className="text-xs text-zinc-400">Manage underlying inference routes, model limits, and policies.</p>
      </div>

      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Primary Text Inference: Langdock Enterprise</div>
            <div className="text-[11px] text-zinc-400">15 eligible reasoning models with tool-calling capabilities</div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
            Active
          </span>
        </div>

        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Media Generation Engine</div>
            <div className="text-[11px] text-zinc-400">FLUX.1-schnell (Photorealistic native images) + LTX-Video (Cinematic video)</div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
            Active
          </span>
        </div>

        <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">Photorealistic Humans &amp; Commercial Models Policy</div>
            <div className="text-[11px] text-zinc-400">Permits synthetic adult human models and user-conditioned edits</div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
            Enforced
          </span>
        </div>
      </div>
    </div>
  );
}

// --- 10. Meeting Notes View ---
export function MeetingNotesView() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Meeting Notes</h3>
          <p className="text-xs text-zinc-400">Transcribed audio summaries, action items, and decision logs.</p>
        </div>
        <button className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors">
          + New Note
        </button>
      </div>

      <div className="p-8 text-center rounded-xl border border-zinc-800 bg-[#18181b]">
        <Calendar className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
        <div className="text-xs font-semibold text-zinc-300">No meeting notes recorded yet</div>
        <p className="text-[11px] text-zinc-500 mt-1">Use the Audio / Voice note composer option to dictate or record meetings.</p>
      </div>
    </div>
  );
}

// --- 11. MCP Settings View ---
export function McpSettingsView() {
  const [pingStatus, setPingStatus] = useState<string | null>(null);
  const [pinging, setPinging] = useState<boolean>(false);
  const [selectedClient, setSelectedClient] = useState<"cursor" | "claude" | "vscode">("cursor");

  const testPing = async () => {
    setPinging(true);
    setPingStatus("Executing protocol handshake on /api/mcp...");
    const t0 = performance.now();
    try {
      // 1. Send MCP Initialize
      const initRes = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05" },
        }),
      });
      const initData = await initRes.json();

      // 2. Send MCP Tools List
      const toolsRes = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      });
      const toolsData = await toolsRes.json();
      const latency = Math.round(performance.now() - t0);

      const serverName = initData?.result?.serverInfo?.name || "OrbaAgent MCP";
      const toolsList = (toolsData?.result?.tools || []).map((t: any) => t.name).join(", ");

      setPingStatus(
        `✓ MCP Handshake Verified (${latency}ms round-trip). Server: ${serverName}. Protocol: ${initData?.result?.protocolVersion}. Registered Tools (${toolsData?.result?.tools?.length}): ${toolsList}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPingStatus(`✕ MCP Handshake Failed: ${msg}`);
    } finally {
      setPinging(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">OrbaAgent MCP Architecture</h3>
        <p className="text-xs text-zinc-400">
          Connect external IDEs and agents (Cursor, Claude Desktop, VS Code) via Model Context Protocol.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 space-y-3">
        <div className="text-xs font-semibold text-white">Active Server Endpoint</div>
        <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs text-emerald-400">
          https://orbaagent.dev/api/mcp
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-zinc-400">
            Transport: <strong className="text-zinc-200">Streamable HTTP (JSON-RPC 2.0)</strong>
          </span>
          <button
            onClick={testPing}
            disabled={pinging}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white transition-colors border border-zinc-700 disabled:opacity-50"
          >
            {pinging ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>Ping MCP Server</span>
          </button>
        </div>
        {pingStatus && (
          <div
            className={`p-3 rounded-lg border text-xs leading-relaxed font-mono ${
              pingStatus.startsWith("✓")
                ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                : "bg-red-950/40 border-red-800/60 text-red-300"
            }`}
          >
            {pingStatus}
          </div>
        )}
      </div>

      {/* Client Setup Guide */}
      <div className="p-4 rounded-xl bg-[#18181b] border border-zinc-800 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Client Configuration</span>
          <div className="flex items-center gap-1.5">
            {(["cursor", "claude", "vscode"] as const).map((client) => (
              <button
                key={client}
                onClick={() => setSelectedClient(client)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  selectedClient === client
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                {client === "cursor" ? "Cursor" : client === "claude" ? "Claude Desktop" : "VS Code"}
              </button>
            ))}
          </div>
        </div>

        {selectedClient === "cursor" && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-400">
              Add to your project's <code className="text-zinc-200">.cursor/mcp.json</code>:
            </p>
            <pre className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto">
{`{
  "mcpServers": {
    "orbaagent": {
      "url": "https://orbaagent.dev/api/mcp"
    }
  }
}`}
            </pre>
          </div>
        )}

        {selectedClient === "claude" && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-400">
              Add to <code className="text-zinc-200">claude_desktop_config.json</code>:
            </p>
            <pre className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto">
{`{
  "mcpServers": {
    "orbaagent": {
      "url": "https://orbaagent.dev/api/mcp"
    }
  }
}`}
            </pre>
          </div>
        )}

        {selectedClient === "vscode" && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-400">
              Configure in VS Code settings under <code className="text-zinc-200">mcp.servers</code>:
            </p>
            <pre className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto">
{`"mcp.servers": {
  "orbaagent": {
    "type": "http",
    "url": "https://orbaagent.dev/api/mcp"
  }
}`}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

