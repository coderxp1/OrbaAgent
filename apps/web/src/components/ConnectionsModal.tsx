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
}

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
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "AI connector",
    icon: <SalesforceIcon className="w-8 h-8" />,
    description:
      "Connect Salesforce to query customer accounts, opportunities, lead statuses, and support tickets.",
    useCases: [
      "Look up customer account tier and SLA requirements",
      "Cross-reference engineering bugs with enterprise customer accounts",
      "Generate customer impact reports for scheduled maintenance",
    ],
  },
  {
    id: "asana",
    name: "Asana",
    category: "AI connector",
    icon: <AsanaIcon className="w-8 h-8" />,
    description:
      "Connect Asana to track sprint tasks, project milestones, and assign engineering issues automatically.",
    useCases: [
      "Sync sprint tasks and backlog items",
      "Update task completion states after testing passes",
      "Link code commits to Asana project deliverables",
    ],
  },
  {
    id: "atlassian",
    name: "Atlassian",
    category: "AI connector",
    icon: (
      <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white text-base">
        A
      </div>
    ),
    description:
      "Connect Atlassian Jira and Confluence to read issues, update sprint boards, and search company wikis.",
    useCases: [
      "Retrieve Jira ticket details and acceptance criteria",
      "Search Confluence architecture specs and runbooks",
      "Update issue status to 'In Code Review' upon branch creation",
    ],
  },
  {
    id: "box",
    name: "Box",
    category: "AI connector",
    icon: <BoxIcon className="w-8 h-8" />,
    description:
      "Connect Box to index and retrieve enterprise documents, architectural diagrams, and compliance assets.",
    useCases: [
      "Search design documents and security policies",
      "Export generated technical reports to shared Box folders",
      "Verify compliance guidelines against proposed changes",
    ],
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
  },
  {
    id: "linear",
    name: "Linear",
    category: "AI connector",
    icon: <LinearIcon className="w-8 h-8" />,
    description:
      "Connect Linear to streamline issue tracking, git branch creation, and pull request linking.",
    useCases: [
      "Look up active cycle issues and priority bugs",
      "Associate autonomous agent runs with Linear issue IDs",
      "Auto-close resolved tickets when tests verify clean passes",
    ],
  },
  {
    id: "sharepoint",
    name: "SharePoint & OneDrive",
    category: "AI connector",
    icon: <SharePointIcon className="w-8 h-8" />,
    description:
      "Connect SharePoint & OneDrive to index Microsoft 365 organization knowledge and documents.",
    useCases: [
      "Search enterprise documentation and SharePoint wikis",
      "Access internal company architecture standards",
      "Safely retrieve corporate compliance checklists",
    ],
  },
];

export function ConnectionsModal({ isOpen, onClose, initialApp }: ConnectionsModalProps) {
  const [selectedApp, setSelectedApp] = useState<AppCardInfo | null>(null);
  const [activeTab, setActiveTab] = useState<"discover" | "installed" | "manage">("discover");
  const [activeFilter, setActiveFilter] = useState<string>("AI connector");
  const [connections, setConnections] = useState<Record<string, IntegrationStatus>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;

    if (initialApp) {
      const match = APPS.find(
        (a) => a.id === initialApp || a.name.toLowerCase() === initialApp.toLowerCase(),
      );
      if (match) setSelectedApp(match);
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
    setActionLoading(true);
    const currentStatus = connections[app.id]?.connected || false;
    const newStatus: IntegrationStatus = {
      name: app.id,
      displayName: app.name,
      connected: !currentStatus,
      accountName: !currentStatus ? `Hartmann (${app.name})` : undefined,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative flex w-full max-w-5xl h-[85vh] max-h-[760px] bg-[#191919] text-[#e0e0e0] rounded-2xl shadow-2xl border border-[#2b2b2b] overflow-hidden">
        {/* Close Button top-right */}
        <button
          onClick={onClose}
          type="button"
          className="absolute top-4 right-4 z-20 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* If detail modal for a specific app is selected */}
        {selectedApp ? (
          <div className="flex w-full h-full">
            {/* Left Column of Detail: Navigation & Tabs */}
            <div className="w-72 bg-[#141414] border-r border-[#262626] p-6 flex flex-col justify-between shrink-0">
              <div>
                <button
                  onClick={() => setSelectedApp(null)}
                  type="button"
                  className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-white mb-6 transition-colors"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" />
                  <span>Back to connections</span>
                </button>

                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 rounded-xl bg-zinc-800/80">{selectedApp.icon}</div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{selectedApp.name}</h3>
                    <p className="text-[11px] text-zinc-400">
                      {connections[selectedApp.id]?.connected
                        ? "1 of 4 connection types installed"
                        : "0 of 4 connection types installed"}
                    </p>
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-1.5">
                  <button
                    type="button"
                    className="flex flex-col text-left p-3 rounded-xl border border-zinc-800/50 hover:bg-zinc-800/30 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2 font-medium text-zinc-300">
                      <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Link preview &amp; legacy sync</span>
                    </div>
                    <span className="text-[11px] text-zinc-500 mt-0.5">
                      Sync and view updates in OrbaAgent
                    </span>
                  </button>

                  <button
                    type="button"
                    className="flex flex-col text-left p-3 rounded-xl border border-zinc-800/50 hover:bg-zinc-800/30 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2 font-medium text-zinc-300">
                      <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Database sync</span>
                    </div>
                    <span className="text-[11px] text-zinc-500 mt-0.5">
                      Sync data to your databases
                    </span>
                  </button>

                  <button
                    type="button"
                    className="flex flex-col text-left p-3 rounded-xl border border-blue-500/50 bg-blue-500/10 text-xs text-blue-200"
                  >
                    <div className="flex items-center gap-2 font-semibold text-blue-400">
                      <Bot className="w-3.5 h-3.5" />
                      <span>AI connector</span>
                    </div>
                    <span className="text-[11px] text-zinc-400 mt-0.5">
                      Get answers in OrbaAgent AI
                    </span>
                  </button>

                  <button
                    type="button"
                    className="flex flex-col text-left p-3 rounded-xl border border-zinc-800/50 hover:bg-zinc-800/30 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2 font-medium text-zinc-300">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                      <span>MCP server</span>
                    </div>
                    <span className="text-[11px] text-zinc-500 mt-0.5">
                      Enable tool access in OrbaAgent AI
                    </span>
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-zinc-500 pt-4 border-t border-zinc-800/60">
                Managed securely with enterprise permission isolation
              </div>
            </div>

            {/* Right Column of Detail: Feature Showcase & Connect Action */}
            <div className="flex-1 p-8 overflow-y-auto flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl font-bold text-white">AI connector</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-300 font-medium">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" /> OrbaAgent Verified
                  </span>
                </div>

                {/* Illustration Box */}
                <div className="w-full h-44 rounded-2xl bg-[#121212] border border-[#262626] flex items-center justify-center p-6 mb-6 relative overflow-hidden">
                  <div className="flex items-center gap-6 z-10">
                    <div className="w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center shadow-lg">
                      {selectedApp.icon}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                      <div className="w-10 h-0.5 bg-gradient-to-r from-blue-500 to-indigo-500" />
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-700 flex items-center justify-center shadow-lg">
                      <img src="/orba-mascot.svg" alt="OrbaAgent" className="w-9 h-9" />
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.08),transparent_70%)]" />
                </div>

                <h4 className="text-base font-bold text-white mb-2">
                  Search and run tasks across {selectedApp.name} from OrbaAgent
                </h4>
                <p className="text-xs text-zinc-400 leading-relaxed mb-6">
                  {selectedApp.description}
                </p>

                <div className="mb-6">
                  <h5 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-3">
                    Use cases
                  </h5>
                  <div className="space-y-2.5">
                    {selectedApp.useCases.map((uc) => (
                      <div key={uc} className="flex items-center gap-2.5 text-xs text-zinc-300">
                        <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>{uc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Button at bottom */}
              <div className="pt-6 border-t border-zinc-800 flex items-center justify-between">
                <div className="text-xs text-zinc-400">
                  Status:{" "}
                  <span
                    className={
                      connections[selectedApp.id]?.connected
                        ? "text-emerald-400 font-semibold"
                        : "text-zinc-500"
                    }
                  >
                    {connections[selectedApp.id]?.connected
                      ? "Installed & Active"
                      : "Not connected"}
                  </span>
                </div>
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
        ) : (
          /* Normal Settings View */
          <div className="flex w-full h-full">
            {/* Left Nav Pane (Matching mockups media_1791118351272.png) */}
            <div className="w-64 bg-[#141414] border-r border-[#262626] p-4 flex flex-col justify-between shrink-0">
              <div className="overflow-y-auto">
                {/* Search Bar top */}
                <div className="relative mb-6">
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
                <div className="mb-5">
                  <div className="text-[11px] font-semibold text-zinc-500 px-2.5 mb-1">Account</div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800/50 cursor-pointer">
                    <div className="w-4 h-4 rounded bg-zinc-700 text-white text-[10px] font-bold flex items-center justify-center">
                      H
                    </div>
                    <span>Hartmann</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Preferences</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <Bell className="w-3.5 h-3.5" />
                    <span>Notifications</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <Mail className="w-3.5 h-3.5" />
                    <span>Mail &amp; Calendar</span>
                  </div>
                </div>

                {/* Workspace Section */}
                <div className="mb-5">
                  <div className="text-[11px] font-semibold text-zinc-500 px-2.5 mb-1">
                    Workspace
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <Settings className="w-3.5 h-3.5" />
                    <span>General</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <Users className="w-3.5 h-3.5" />
                    <span>People</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span>Analytics</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <DownloadCloud className="w-3.5 h-3.5" />
                    <span>Import</span>
                  </div>
                </div>

                {/* Features Section */}
                <div>
                  <div className="text-[11px] font-semibold text-zinc-500 px-2.5 mb-1">
                    Features
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>OrbaAgent AI</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Meeting notes</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800/90 text-white cursor-pointer">
                    <Grid className="w-3.5 h-3.5 text-blue-400" />
                    <span>Connections</span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50 cursor-pointer">
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>OrbaAgent MCP</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800/60 text-[11px] text-zinc-500">
                OrbaAgent v0.1.0 • Phase 1
              </div>
            </div>

            {/* Main Content Pane */}
            <div className="flex-1 p-8 overflow-y-auto">
              <h2 className="text-2xl font-bold text-white mb-2">Connections</h2>
              <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed mb-4">
                Connect apps to use in OrbaAgent. Let OrbaAgent and OrbaAgent AI search, sync, and
                take actions in Slack, Drive, Jira and more.{" "}
                <span className="text-blue-400 hover:underline cursor-pointer">Learn more</span>
              </p>

              <div className="text-xs text-zinc-400 mb-6 flex items-center gap-1.5">
                <span>Use OrbaAgent in ChatGPT, Claude, and Cursor:</span>
                <span className="text-blue-400 hover:underline cursor-pointer flex items-center gap-1">
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
                <span className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
                  1 more...
                </span>
              </div>

              {/* Apps Grid (Matching media_1791118353705.png) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {filteredApps.map((app) => {
                  const isConnected = Boolean(connections[app.id]?.connected);
                  return (
                    <button
                      type="button"
                      key={app.id}
                      onClick={() => setSelectedApp(app)}
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
          </div>
        )}
      </div>
    </div>
  );
}
