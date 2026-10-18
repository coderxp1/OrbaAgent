"use client";

import type { IntegrationName, IntegrationStatus } from "@orbaagent/shared";
import {
  ArrowRight,
  BarChart2,
  Bell,
  Bot,
  Calendar,
  Check,
  ChevronRight,
  DownloadCloud,
  ExternalLink,
  Grid,
  Mail,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
  AlertCircle,
  Activity,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  AsanaIcon,
  BoxIcon,
  GitHubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDriveIcon,
  LinearIcon,
  NotionIcon,
  OutlookIcon,
  SalesforceIcon,
  SharePointIcon,
  SlackIcon,
  TeamsIcon,
} from "./AppIcons";
import { GitHubConnectionModal } from "./GitHubConnectionModal";
import {
  AccountProfileView,
  PreferencesView,
  NotificationsView,
  MailCalendarView,
  GeneralWorkspaceView,
  PeopleView,
  AnalyticsView,
  ImportView,
  AiSettingsView,
  MeetingNotesView,
  McpSettingsView,
} from "./SettingsViews";

interface ConnectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialApp?: string | null;
}

interface AppCardInfo {
  id: IntegrationName;
  name: string;
  category: string;
  icon: React.ReactNode;
  description: string;
  useCases: string[];
  requiredScopes?: string[];
  docUrl?: string;
}

type SettingsNavId =
  | "connections"
  | "account"
  | "preferences"
  | "notifications"
  | "mail_calendar"
  | "general"
  | "people"
  | "analytics"
  | "import"
  | "ai_settings"
  | "meeting_notes"
  | "mcp";

const APPS: AppCardInfo[] = [
  {
    id: "google_calendar",
    name: "Google Calendar",
    category: "AI connector",
    icon: <GoogleCalendarIcon className="w-8 h-8" />,
    description:
      "Install Google Calendar connector to schedule meetings, inspect calendar conflicts, and prepare agenda briefs directly in OrbaAgent.",
    useCases: [
      "Check daily schedules and upcoming meeting links",
      "Inspect team availability and suggest open slots",
      "Draft pre-meeting briefing docs automatically",
    ],
    requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    category: "AI connector",
    icon: <TeamsIcon className="w-8 h-8" />,
    description:
      "Connect Microsoft Teams to inspect team channels, retrieve shared messages, and post automated status summaries.",
    useCases: [
      "Search team conversations and thread decisions",
      "Summarize daily standup notes from engineering channels",
      "Send completion updates directly to Microsoft Teams",
    ],
    requiredScopes: ["ChannelMessage.Read.All", "Chat.Read", "User.Read"],
  },
  {
    id: "outlook",
    name: "Outlook",
    category: "AI connector",
    icon: <OutlookIcon className="w-8 h-8" />,
    description:
      "Connect Outlook to read and compose emails, manage calendar events, and streamline communications.",
    useCases: [
      "Search inbox for customer feedback or incident reports",
      "Draft replies and summary threads with technical context",
      "Sync Outlook events directly with agent tasks",
    ],
    requiredScopes: ["Mail.Read", "Calendars.ReadWrite", "User.Read"],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "AI connector",
    icon: <SalesforceIcon className="w-8 h-8" />,
    description:
      "Connect Salesforce to query CRM contacts, inspect deal pipelines, and update lead notes.",
    useCases: [
      "Retrieve customer record details during customer escalations",
      "Summarize recent account activities and deal milestones",
      "Log conversation action items back to Salesforce leads",
    ],
    requiredScopes: ["api", "refresh_token", "offline_access"],
  },
  {
    id: "asana",
    name: "Asana",
    category: "AI connector",
    icon: <AsanaIcon className="w-8 h-8" />,
    description:
      "Connect Asana to sync project tasks, assign milestones, and keep roadmap items updated.",
    useCases: [
      "Fetch active sprint tasks and blockers",
      "Create follow-up action items directly from agent plans",
      "Update task status upon verification completion",
    ],
    requiredScopes: ["default"],
  },
  {
    id: "atlassian",
    name: "Atlassian",
    category: "AI connector",
    icon: <SharePointIcon className="w-8 h-8" />,
    description:
      "Connect Jira and Confluence to read project issues, track bug tickets, and reference team knowledge bases.",
    useCases: [
      "Find Jira issues associated with pull requests and commits",
      "Query Confluence design documents for architecture guidelines",
      "Transition issue status upon successful deployment",
    ],
    requiredScopes: ["read:jira-work", "read:confluence-content.all"],
  },
  {
    id: "box",
    name: "Box",
    category: "AI connector",
    icon: <BoxIcon className="w-8 h-8" />,
    description:
      "Connect Box to securely index enterprise files, technical whitepapers, and shared workspace documents.",
    useCases: [
      "Search design documents and security policies",
      "Export generated technical reports to shared Box folders",
      "Verify compliance guidelines against proposed changes",
    ],
    requiredScopes: ["root_readwrite"],
  },
  {
    id: "github",
    name: "GitHub",
    category: "AI connector",
    icon: (
      <div className="text-white">
        <GitHubIcon className="w-8 h-8" />
      </div>
    ),
    description:
      "Install the GitHub AI connector to pull relevant context from PRs, issues, code, and READMEs, so you can understand what changed without leaving OrbaAgent.",
    useCases: [
      "Get quick context on what shipped (and why)",
      "Find examples and implementations across repos",
      "Ask questions like 'What changed in the last deploy?'",
    ],
    requiredScopes: ["repo", "read:user"],
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "AI connector",
    icon: <GmailIcon className="w-8 h-8" />,
    description:
      "Connect Gmail to search threads, monitor alerts, and draft emails with full agent workspace context.",
    useCases: [
      "Inspect deployment alerts and pager notifications",
      "Find customer bug reports and error stack traces",
      "Draft concise technical update emails for leadership",
    ],
    requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  },
  {
    id: "google_drive",
    name: "Google Drive",
    category: "AI connector",
    icon: <GoogleDriveIcon className="w-8 h-8" />,
    description:
      "Connect Google Drive to read Docs, Sheets, and Slides to gather project specs and requirements.",
    useCases: [
      "Read product requirements docs (PRDs) and RFCs",
      "Extract data from team spreadsheets for analysis",
      "Verify technical implementation against design specifications",
    ],
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
  },
  {
    id: "linear",
    name: "Linear",
    category: "AI connector",
    icon: <LinearIcon className="w-8 h-8" />,
    description:
      "Connect Linear to streamline issue tracking, resolve bug tickets, and update cycles seamlessly.",
    useCases: [
      "Look up project roadmap issues and linked git branches",
      "Automatically triage bug reports with reproduction steps",
      "Comment on issues with generation results and code diffs",
    ],
    requiredScopes: ["read", "write", "issues:create"],
  },
  {
    id: "sharepoint",
    name: "SharePoint & OneDrive",
    category: "AI connector",
    icon: <SharePointIcon className="w-8 h-8" />,
    description:
      "Connect SharePoint & OneDrive to index team drives, shared folders, and corporate presentations.",
    useCases: [
      "Search team drives for brand assets and design logos",
      "Read internal engineering guidelines and compliance docs",
      "Extract tables and figures from Office documents",
    ],
    requiredScopes: ["Files.Read.All", "Sites.Read.All"],
  },
];

export function ConnectionsModal({ isOpen, onClose, initialApp }: ConnectionsModalProps) {
  const [activeNav, setActiveNav] = useState<SettingsNavId>("connections");
  const [userName, setUserName] = useState<string>("Hartmann");
  const [selectedApp, setSelectedApp] = useState<AppCardInfo | null>(null);
  const [activeTab, setActiveTab] = useState<"discover" | "installed" | "manage">("discover");
  const [activeFilter, setActiveFilter] = useState<string>("AI connector");
  const [connections, setConnections] = useState<Record<string, IntegrationStatus>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState<boolean>(false);

  // Diagnostic verification state
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifyResult, setVerifyResult] = useState<{
    success: boolean;
    status: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Load user profile
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data?.displayName) setUserName(data.displayName);
      })
      .catch(() => {});

    if (initialApp) {
      const match = APPS.find(
        (a) => a.id === initialApp || a.name.toLowerCase() === initialApp.toLowerCase(),
      );
      if (match) {
        setSelectedApp(match);
        setActiveNav("connections");
      }
    } else {
      setSelectedApp(null);
    }

    // Fetch live connections from server
    const fetchConnections = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/connections");
        if (res.ok) {
          const data = await res.json();
          const map: Record<string, IntegrationStatus> = {};
          for (const item of data.integrations || []) {
            map[item.name] = item;
          }
          setConnections(map);
        }
      } catch (e) {
        console.error("Failed to load connections", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchConnections();
  }, [isOpen, initialApp]);

  if (!isOpen) return null;

  const handleToggleConnection = async (app: AppCardInfo) => {
    if (app.id === "github" && !connections.github?.connected) {
      setIsGitHubModalOpen(true);
      return;
    }

    setActionLoading(true);
    setVerifyResult(null);
    const currentStatus = connections[app.id]?.connected || false;

    if (app.id === "github" && currentStatus) {
      try {
        await fetch("/api/auth/github/disconnect", { method: "POST" });
        setConnections((prev) => ({
          ...prev,
          github: {
            name: "github",
            displayName: "GitHub",
            connected: false,
            accountName: undefined,
          },
        }));
      } catch (e) {
        console.error("Failed to disconnect GitHub", e);
      } finally {
        setActionLoading(false);
      }
      return;
    }

    const newStatus: IntegrationStatus = {
      name: app.id,
      displayName: app.name,
      connected: !currentStatus,
      accountName: !currentStatus ? `${userName} (${app.name})` : undefined,
      lastSyncedAt: !currentStatus ? new Date().toISOString() : undefined,
    };

    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setConnections((prev) => ({
          ...prev,
          [app.id]: newStatus,
        }));
      }
    } catch (e) {
      console.error("Failed to toggle connection", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunDiagnostic = async (appId: string) => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/connections/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: appId }),
      });
      const data = await res.json();
      setVerifyResult(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setVerifyResult({
        success: false,
        status: "ERROR",
        message: `Diagnostic request failed: ${msg}`,
      });
    } finally {
      setVerifying(false);
    }
  };

  const filteredApps = APPS.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (activeTab === "installed") {
      return Boolean(connections[app.id]?.connected);
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="relative flex flex-col md:flex-row w-full max-w-5xl h-[92vh] sm:h-[85vh] max-h-[760px] bg-[#191919] text-[#e0e0e0] rounded-2xl shadow-2xl border border-[#2b2b2b] overflow-hidden">
        {/* Close Button top-right */}
        <button
          onClick={onClose}
          type="button"
          aria-label="Close settings"
          className="absolute top-4 right-4 z-20 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Global Modal Left Navigation Pane */}
        <div className="hidden md:flex w-64 bg-[#141414] border-r border-[#262626] p-4 flex-col justify-between shrink-0">
          <div className="overflow-y-auto">
            {/* Search Bar top */}
            <div className="relative mb-5">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search settings"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#1e1e1e] border border-blue-500/40 rounded-lg pl-8 pr-12 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="absolute right-2 top-2 text-[9px] bg-zinc-800 text-zinc-400 px-1 py-0.5 rounded font-mono">
                Beta
              </span>
            </div>

            {/* Account Section */}
            <div className="mb-4">
              <div className="text-[11px] font-semibold text-zinc-500 px-2.5 mb-1">Account</div>
              <button
                type="button"
                onClick={() => {
                  setActiveNav("account");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "account"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-300 hover:bg-zinc-800/50"
                }`}
              >
                <div className="w-4 h-4 rounded bg-gradient-to-tr from-blue-600 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {userName.slice(0, 1).toUpperCase()}
                </div>
                <span className="truncate">{userName}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("preferences");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "preferences"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Sliders className="w-3.5 h-3.5 shrink-0" />
                <span>Preferences</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("notifications");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "notifications"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Bell className="w-3.5 h-3.5 shrink-0" />
                <span>Notifications</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("mail_calendar");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "mail_calendar"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Mail className="w-3.5 h-3.5 shrink-0" />
                <span>Mail &amp; Calendar</span>
              </button>
            </div>

            {/* Workspace Section */}
            <div className="mb-4">
              <div className="text-[11px] font-semibold text-zinc-500 px-2.5 mb-1">Workspace</div>
              <button
                type="button"
                onClick={() => {
                  setActiveNav("general");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "general"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Settings className="w-3.5 h-3.5 shrink-0" />
                <span>General</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("people");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "people"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Users className="w-3.5 h-3.5 shrink-0" />
                <span>People</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("analytics");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "analytics"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                <span>Analytics</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("import");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "import"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <DownloadCloud className="w-3.5 h-3.5 shrink-0" />
                <span>Import</span>
              </button>
            </div>

            {/* Features Section */}
            <div>
              <div className="text-[11px] font-semibold text-zinc-500 px-2.5 mb-1">Features</div>
              <button
                type="button"
                onClick={() => {
                  setActiveNav("ai_settings");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "ai_settings"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>OrbaAgent AI</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("meeting_notes");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "meeting_notes"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span>Meeting notes</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("connections");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "connections"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <Grid className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Connections</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav("mcp");
                  setSelectedApp(null);
                  setVerifyResult(null);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  activeNav === "mcp"
                    ? "bg-zinc-800/90 text-white font-semibold"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span>OrbaAgent MCP</span>
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800/60 text-[11px] text-zinc-500">
            OrbaAgent v0.1.0 • Phase 1
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Mobile Back / Destination switcher */}
          <div className="md:hidden p-3 bg-[#141414] border-b border-[#262626] flex items-center justify-between">
            <span className="text-xs font-semibold text-white capitalize">{activeNav.replace("_", " ")}</span>
            <button
              onClick={() => {
                setActiveNav("connections");
                setSelectedApp(null);
              }}
              className="text-xs text-blue-400"
            >
              All Sections
            </button>
          </div>

          {/* Render selected app detail */}
          {activeNav === "connections" && selectedApp ? (
            <div className="flex-1 p-4 sm:p-8 overflow-y-auto flex flex-col justify-between min-w-0">
              <div>
                <button
                  onClick={() => {
                    setSelectedApp(null);
                    setVerifyResult(null);
                  }}
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white mb-4 transition-colors"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" />
                  <span>Back to connections</span>
                </button>

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-zinc-800/80">{selectedApp.icon}</div>
                    <div>
                      <h3 className="text-xl font-bold text-white">{selectedApp.name}</h3>
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" /> OrbaAgent Verified AI Connector
                      </span>
                    </div>
                  </div>
                  <div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        connections[selectedApp.id]?.connected
                          ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/50"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {connections[selectedApp.id]?.connected ? "Installed & Active" : "Not connected"}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed mb-5">
                  {selectedApp.description}
                </p>

                {/* Capability & Use cases */}
                <div className="mb-6 p-4 rounded-xl bg-[#141414] border border-zinc-800 space-y-3">
                  <h5 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Supported Read &amp; Execution Scopes
                  </h5>
                  <div className="space-y-2">
                    {selectedApp.useCases.map((uc) => (
                      <div key={uc} className="flex items-center gap-2.5 text-xs text-zinc-300">
                        <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>{uc}</span>
                      </div>
                    ))}
                  </div>
                  {selectedApp.requiredScopes && (
                    <div className="pt-2 text-[11px] text-zinc-500 font-mono">
                      Required Scopes: {selectedApp.requiredScopes.join(", ")}
                    </div>
                  )}
                </div>

                {/* Live Diagnostic Verification Box */}
                {verifyResult && (
                  <div
                    className={`p-4 rounded-xl border mb-6 text-xs transition-all ${
                      verifyResult.success
                        ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                        : "bg-amber-950/40 border-amber-800/60 text-amber-200"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold mb-1">
                      {verifyResult.success ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      )}
                      <span>Status: {verifyResult.status}</span>
                    </div>
                    <p className="leading-relaxed">{verifyResult.message}</p>
                  </div>
                )}
              </div>

              {/* Action buttons footer */}
              <div className="pt-6 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => handleRunDiagnostic(selectedApp.id)}
                  disabled={verifying}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors border border-zinc-700"
                >
                  {verifying ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Activity className="w-3.5 h-3.5 text-blue-400" />
                  )}
                  <span>Test Live Read-Only Access</span>
                </button>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggleConnection(selectedApp)}
                    disabled={actionLoading}
                    type="button"
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-md ${
                      connections[selectedApp.id]?.connected
                        ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30"
                        : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30"
                    }`}
                  >
                    {actionLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : connections[selectedApp.id]?.connected ? (
                      <span>Disconnect integration</span>
                    ) : (
                      <span>+ Add for workspace</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : activeNav === "connections" ? (
            /* Connections Grid */
            <div className="flex-1 p-4 sm:p-8 overflow-y-auto min-w-0">
              <h2 className="text-2xl font-bold text-white mb-2">Connections</h2>
              <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed mb-4">
                Connect apps to use in OrbaAgent. Let OrbaAgent and OrbaAgent AI search, sync, and
                take actions across your workspace tools.{" "}
                <span className="text-blue-400 hover:underline cursor-pointer">Learn more</span>
              </p>

              <div className="text-xs text-zinc-400 mb-6 flex items-center gap-1.5">
                <span>Use OrbaAgent in ChatGPT, Claude, and Cursor:</span>
                <span
                  onClick={() => setActiveNav("mcp")}
                  className="text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
                >
                  OrbaAgent MCP <ArrowRight className="w-3 h-3" />
                </span>
              </div>

              {/* Main Tabs (Discover, Installed, Manage) */}
              <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 mb-6">
                <button
                  onClick={() => setActiveTab("discover")}
                  type="button"
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeTab === "discover"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Discover
                </button>
                <button
                  onClick={() => setActiveTab("installed")}
                  type="button"
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeTab === "installed"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Installed ({Object.values(connections).filter((c) => c.connected).length})
                </button>
                <button
                  onClick={() => setActiveTab("manage")}
                  type="button"
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeTab === "manage"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Manage
                </button>
              </div>

              {/* Section Header */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">Discover connections</h3>
                <p className="text-xs text-zinc-500">
                  Explore available connections for your workspace
                </p>
              </div>

              {/* Filter Chips Bar */}
              <div className="flex flex-wrap items-center gap-2 mb-6">
                {[
                  "MCP",
                  "AI connector",
                  "Preview",
                  "Public",
                  "Database sync",
                  "Automation action",
                  "DLP",
                  "SIEM",
                ].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    type="button"
                    className={`px-3 py-1 rounded-full text-xs transition-colors ${
                      activeFilter === filter
                        ? "bg-zinc-800 text-white font-medium"
                        : "text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800/40"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              {/* Apps Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {filteredApps.map((app) => {
                  const isConnected = Boolean(connections[app.id]?.connected);
                  return (
                    <button
                      type="button"
                      key={app.id}
                      onClick={() => {
                        setSelectedApp(app);
                        setVerifyResult(null);
                      }}
                      className="group flex w-full text-left items-center justify-between p-4 rounded-xl bg-[#141414] border border-[#262626] hover:border-zinc-700 hover:bg-[#1a1a1a] transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-1 rounded-lg shrink-0">{app.icon}</div>
                        <span className="text-xs font-medium text-zinc-200 group-hover:text-white truncate">
                          {app.name}
                        </span>
                      </div>
                      {isConnected ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
                          Active
                        </span>
                      ) : (
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Dedicated Settings Views for all 11 destinations */
            <div className="flex-1 p-4 sm:p-8 overflow-y-auto min-w-0">
              {activeNav === "account" && (
                <AccountProfileView onProfileChange={(name) => setUserName(name)} />
              )}
              {activeNav === "preferences" && <PreferencesView />}
              {activeNav === "notifications" && <NotificationsView />}
              {activeNav === "mail_calendar" && <MailCalendarView />}
              {activeNav === "general" && <GeneralWorkspaceView />}
              {activeNav === "people" && <PeopleView />}
              {activeNav === "analytics" && <AnalyticsView />}
              {activeNav === "import" && <ImportView />}
              {activeNav === "ai_settings" && <AiSettingsView />}
              {activeNav === "meeting_notes" && <MeetingNotesView />}
              {activeNav === "mcp" && <McpSettingsView />}
            </div>
          )}
        </div>

        <GitHubConnectionModal
          isOpen={isGitHubModalOpen}
          onClose={() => setIsGitHubModalOpen(false)}
          isConnected={Boolean(connections.github?.connected)}
          connectedAccount={connections.github?.accountName}
          onConnectedChange={(connected, account) => {
            setConnections((prev) => ({
              ...prev,
              github: {
                name: "github",
                displayName: "GitHub",
                connected,
                accountName: account,
                lastSyncedAt: connected ? new Date().toISOString() : undefined,
              },
            }));
            setIsGitHubModalOpen(false);
          }}
        />
      </div>
    </div>
  );
}
