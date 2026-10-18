"use client";

import type { ChatMessage } from "@orbaagent/shared";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Bot,
  Calendar,
  Compass,
  FileText,
  Gift,
  Grid,
  HelpCircle,
  Home,
  LayoutGrid,
  Library,
  Loader2,
  Menu,
  MessageSquare,
  Mic,
  Paperclip,
  PenSquare,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Table,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentsModal } from "../../components/AgentsModal";
import {
  AsanaIcon,
  BoxIcon,
  GitHubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDriveIcon,
  LinearIcon,
  NotionIcon,
  OutlookCalendarIcon,
  OutlookIcon,
  SalesforceIcon,
  SharePointIcon,
  SlackIcon,
  TeamsIcon,
} from "../../components/AppIcons";
import { type AttachedFile, AttachmentMenu } from "../../components/AttachmentMenu";
import { ConnectionsModal } from "../../components/ConnectionsModal";
import { ErrorBanner } from "../../components/ErrorBanner";
import { GitHubConnectionModal } from "../../components/GitHubConnectionModal";
import { HelpModal } from "../../components/HelpModal";
import { LibraryModal } from "../../components/LibraryModal";
import { MessageItem } from "../../components/MessageItem";
import { useAgentChat } from "../../components/useAgentChat";

export default function WorkspacePage() {
  const {
    messages,
    isGenerating,
    error,
    activeActivity,
    sendMessage,
    cancelGeneration,
    retryLastMessage,
    clearChat,
    loadMessages,
    reviewFileChange,
  } = useAgentChat();

  interface ChatSession {
    id: string;
    title: string;
    updatedAt: string;
    messages: ChatMessage[];
  }

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `session_${Date.now()}`);

  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [showPlanBanner, setShowPlanBanner] = useState<boolean>(true);
  const [showAppsBar, setShowAppsBar] = useState<boolean>(true);
  const [isConnectionsOpen, setIsConnectionsOpen] = useState<boolean>(false);
  const [selectedInitialApp, setSelectedInitialApp] = useState<string | null>(null);

  // GitHub connection states
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState<boolean>(false);
  const [gitHubConnected, setGitHubConnected] = useState<boolean>(false);
  const [gitHubAccount, setGitHubAccount] = useState<string | undefined>();

  // Modals state
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [isAgentsOpen, setIsAgentsOpen] = useState<boolean>(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);

  // Attachments & Speech state
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Mobile sidebar state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load saved sessions on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("orba_recent_sessions");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSessions(parsed);
        }
      }
    } catch {}
  }, []);

  // Sync active conversation to sessions history
  useEffect(() => {
    if (messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === "user");
    const firstText = firstUser
      ? typeof firstUser.content === "string"
        ? firstUser.content
        : Array.isArray(firstUser.content)
          ? firstUser.content.map((p) => (p.type === "text" ? p.text : "")).join("")
          : "Conversation"
      : "Conversation";
    const title =
      firstText
        .trim()
        .replace(/^\[Attachment\]:[^\n]+\n*/g, "")
        .slice(0, 36) || "Conversation";

    setSessions((prev) => {
      const existingIdx = prev.findIndex((s) => s.id === currentSessionId);
      const updated: ChatSession = {
        id: currentSessionId,
        title,
        updatedAt: new Date().toISOString(),
        messages,
      };
      let next: ChatSession[];
      if (existingIdx >= 0) {
        next = [...prev];
        next[existingIdx] = updated;
      } else {
        next = [updated, ...prev].slice(0, 30);
      }
      try {
        localStorage.setItem("orba_recent_sessions", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [messages, currentSessionId]);

  const handleSelectSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    loadMessages(session.messages);
    setIsMobileSidebarOpen(false);
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      try {
        localStorage.setItem("orba_recent_sessions", JSON.stringify(next));
      } catch {}
      return next;
    });
    if (currentSessionId === sessionId) {
      clearChat();
      setCurrentSessionId(`session_${Date.now()}`);
    }
  };

  const handleStartNewChat = useCallback(() => {
    setCurrentSessionId(`session_${Date.now()}`);
    clearChat();
    setInputPrompt("");
    setAttachedFiles([]);
    setIsMobileSidebarOpen(false);
    textareaRef.current?.focus();
  }, [clearChat]);

  // Fetch initial connection state
  useEffect(() => {
    fetch("/api/connections")
      .then((res) => res.json())
      .then((data) => {
        const gh = data.integrations?.find((i: { name: string }) => i.name === "github");
        if (gh?.connected) {
          setGitHubConnected(true);
          setGitHubAccount(gh.accountName);
        }
      })
      .catch(() => {});
  }, []);

  // Listen for GitHub OAuth postMessage event
  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === "ORBA_GITHUB_CONNECTED") {
        setGitHubConnected(true);
        setGitHubAccount(e.data.username || "GitHub User");
      }
    };
    window.addEventListener("message", handleMsg);
    return () => window.removeEventListener("message", handleMsg);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  // Keyboard shortcut Ctrl+O for New chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleStartNewChat();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleStartNewChat]);

  const toggleListening = () => {
    if (isListening) {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRec =
      (window as unknown as { SpeechRecognition?: any }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRec) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) {
          setInputPrompt((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
      setIsListening(true);
    } catch (e) {
      console.error(e);
      setIsListening(false);
    }
  };

  const handleSend = async () => {
    if ((!inputPrompt.trim() && attachedFiles.length === 0) || isGenerating || isUploading) return;
    const text = inputPrompt.trim();
    const filesToUpload = attachedFiles.filter((a) => (a as any).file);
    if (filesToUpload.length > 0) {
      setIsUploading(true);
      setUploadError(null);
      const form = new FormData();
      const bundle = `bundle_${Date.now()}`;
      form.set("bundle", bundle);
      for (const att of filesToUpload) {
        // @ts-ignore
        const f: File = (att as any).file;
        form.append("files", f);
      }
      try {
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        if (res.ok) {
          const data = await res.json();
          const structured = (data.artifacts || []).map((a: any, idx: number) => ({
            artifactId: a.id,
            name: a.name,
            type: a.type,
            size: a.size,
            relPath: a.relPath,
            url: a.url,
            file: (filesToUpload[idx] as any)?.file,
            previewUrl: (filesToUpload[idx] as any)?.previewUrl || a.url,
          }));
          setIsUploading(false);
          sendMessage(text, structured);
          setInputPrompt("");
          setAttachedFiles([]);
          return;
        }
        setIsUploading(false);
        setUploadError("Attachment upload failed. Please verify the file and try again.");
        return;
      } catch {
        setIsUploading(false);
        setUploadError("Attachment upload failed due to a network error. Click retry to resend.");
        return;
      }
    }
    setIsUploading(false);
    setInputPrompt("");
    setAttachedFiles([]);
    sendMessage(text, undefined);
  };

  const renderAttachmentPreviews = () => {
    if (attachedFiles.length === 0 && !uploadError) return null;

    return (
      <div className="flex flex-col gap-2 pb-2.5 border-b border-[#292929]/80">
        {uploadError && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{uploadError}</span>
            </div>
            <button
              type="button"
              onClick={() => handleSend()}
              className="px-2 py-0.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-[11px] font-medium text-white transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {attachedFiles.map((file) => {
              const isImg =
                file.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);
              const previewSrc =
                (file as any).previewUrl ||
                ((file as any).file ? URL.createObjectURL((file as any).file) : null);

              return (
                <div
                  key={file.id}
                  className="group/att relative flex items-center gap-2 p-1.5 pr-2.5 rounded-xl bg-[#28282c] border border-zinc-700/60 shadow-md transition-all hover:border-zinc-500/60"
                >
                  {isImg && previewSrc ? (
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-black/40 border border-zinc-700/40 shrink-0">
                      <img
                        src={previewSrc}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700/50 text-blue-400 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                  )}

                  <div className="flex flex-col min-w-0 pr-1">
                    <span
                      className="text-xs font-medium text-zinc-200 truncate max-w-[130px]"
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {isUploading
                        ? "Uploading..."
                        : file.size > 0
                          ? file.size > 1024 * 1024
                            ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                            : `${Math.round(file.size / 1024)} KB`
                          : "Ready"}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setAttachedFiles((prev) => prev.filter((f) => f.id !== file.id));
                      setUploadError(null);
                    }}
                    type="button"
                    className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700/80 transition-colors"
                    title="Remove attachment"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openAppConnection = (appName: string) => {
    if (appName.toLowerCase() === "github") {
      setIsGitHubModalOpen(true);
      return;
    }
    setSelectedInitialApp(appName);
    setIsConnectionsOpen(true);
  };

  return (
    <div className="relative flex h-screen w-screen bg-[#111111] text-[#ededed] font-sans antialiased overflow-hidden select-none">
      {/* Mobile Sidebar Overlay Backdrop */}
      {isMobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200 border-none cursor-default"
        />
      )}

      {/* =========================================================================
          LEFT SIDEBAR (Matching media_1791118043558.png)
      ========================================================================= */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#141414] border-r border-[#242424] flex flex-col justify-between h-full p-3.5 transition-transform duration-300 md:static md:w-64 md:translate-x-0 ${
          isMobileSidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          {/* Workspace Header */}
          <div className="flex items-center justify-between px-1.5 py-1">
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded bg-[#2b2b2b] text-white text-xs font-bold flex items-center justify-center">
                H
              </div>
              <span className="text-xs font-semibold text-zinc-200 tracking-tight">
                Hartmann&apos;s Space
              </span>
            </div>
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              type="button"
              className="md:hidden p-1 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
              title="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Top Quick Actions Row */}
          <div className="flex items-center justify-between px-1">
            <button
              onClick={() => {
                clearChat();
                setInputPrompt("");
                setAttachedFiles([]);
              }}
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#242424] text-xs font-medium text-white shadow-sm"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </button>
            <div className="flex items-center gap-1 text-zinc-400">
              <button
                onClick={() => textareaRef.current?.focus()}
                type="button"
                className="p-1.5 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
                title="Focus Chat"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={toggleListening}
                type="button"
                className={`p-1.5 rounded-md transition-colors ${
                  isListening
                    ? "text-red-400 bg-red-950/80 animate-pulse"
                    : "hover:text-white hover:bg-zinc-800"
                }`}
                title={isListening ? "Stop listening" : "Voice input (Auto-detect)"}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsLibraryOpen(true)}
                type="button"
                className="p-1.5 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
                title="Discover Templates"
              >
                <Compass className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsLibraryOpen(true)}
                type="button"
                className="p-1.5 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
                title="Search Library"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Explore Your Plan Card */}
          {showPlanBanner && (
            <div className="relative rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-3 text-xs flex flex-col gap-2">
              <div className="flex items-center justify-between text-zinc-300 font-semibold text-[11px]">
                <span>Explore your plan</span>
                <button
                  onClick={() => setShowPlanBanner(false)}
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-sm">🌴</span>
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="w-1/3 h-full bg-blue-500 rounded-full" />
                </div>
                <Gift className="w-3.5 h-3.5 text-blue-400" />
              </div>
            </div>
          )}

          {/* New Chat Primary Button */}
          <div className="px-1">
            <button
              onClick={handleStartNewChat}
              type="button"
              className="flex items-center justify-between w-full px-3 py-2 rounded-xl bg-[#202023] hover:bg-[#28282d] border border-zinc-700/60 text-xs font-semibold text-white shadow-sm transition-all group/new"
            >
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-violet-400 group-hover/new:rotate-90 transition-transform" />
                <span>New chat</span>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-750">
                Ctrl+O
              </span>
            </button>
          </div>

          {/* Recent Conversations History */}
          <div className="flex flex-col gap-1 pt-1">
            <div className="flex items-center justify-between px-2 text-[11px] font-semibold text-zinc-500">
              <span>Recent chats</span>
              {sessions.length > 0 && (
                <span className="text-[10px] text-zinc-600 font-mono">{sessions.length}</span>
              )}
            </div>
            {sessions.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-zinc-600 italic">No past chats yet</div>
            ) : (
              <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto no-scrollbar">
                {sessions.map((s) => {
                  const isActive = currentSessionId === s.id && messages.length > 0;
                  return (
                    <div
                      key={s.id}
                      onClick={() => handleSelectSession(s)}
                      className={`group/sess flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        isActive
                          ? "bg-[#25252a] text-white font-medium border border-zinc-700/60 shadow-xs"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a1d]"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-70 text-violet-400" />
                        <span className="truncate text-[12px]">{s.title}</span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        type="button"
                        className="opacity-0 group-hover/sess:opacity-100 p-1 hover:text-red-400 rounded transition-opacity"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Navigation Items */}
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => setIsAgentsOpen(true)}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-[#1f1f1f] transition-colors"
            >
              <Bot className="w-3.5 h-3.5 text-amber-400" />
              <span>Add agents</span>
            </button>

            <button
              onClick={() => {
                setInputPrompt(
                  "Draft executive AI Meeting Notes for our project status sync: Include Agenda, Key Decisions, Action Items with Owners, and Next Milestones.",
                );
                textareaRef.current?.focus();
              }}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-[#1f1f1f] transition-colors"
            >
              <Calendar className="w-3.5 h-3.5 text-zinc-400" />
              <span>Try AI Meeting Notes</span>
            </button>

            <button
              onClick={() => setIsLibraryOpen(true)}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-[#1f1f1f] transition-colors"
            >
              <Library className="w-3.5 h-3.5 text-zinc-400" />
              <span>Library</span>
            </button>

            <button
              onClick={() => {
                setSelectedInitialApp(null);
                setIsConnectionsOpen(true);
              }}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-[#1f1f1f] transition-colors"
            >
              <Grid className="w-3.5 h-3.5 text-blue-400" />
              <span>Connections</span>
            </button>

            <button
              onClick={() => setIsHelpOpen(true)}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-[#1f1f1f] transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5 text-zinc-400" />
              <span>Help</span>
            </button>

            <button
              onClick={() => {
                if (window.confirm("Clear this workspace conversation?")) {
                  clearChat();
                  setInputPrompt("");
                  setAttachedFiles([]);
                }
              }}
              type="button"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-[#1f1f1f] transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
              <span>Trash</span>
            </button>
          </div>
        </div>

        {/* Bottom Sidebar Action Bar */}
        <div className="pt-2 border-t border-[#242424] flex items-center justify-between gap-1">
          <button
            onClick={() => {
              clearChat();
              setInputPrompt("");
              setAttachedFiles([]);
              textareaRef.current?.focus();
            }}
            type="button"
            className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#202020] hover:bg-[#282828] text-xs font-medium text-zinc-300 transition-colors"
          >
            <span>New chat</span>
            <span className="text-[10px] text-zinc-500 font-mono">Ctrl+O</span>
          </button>
          <button
            onClick={() => textareaRef.current?.focus()}
            type="button"
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            title="Focus input"
          >
            <PenSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsAgentsOpen(true)}
            type="button"
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            title="Workforce Agents"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* =========================================================================
          MAIN WORKSPACE VIEW (Matching media_1791118043558.png)
      ========================================================================= */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#131313] min-w-0">
        {/* Mobile Header Bar */}
        <div className="flex md:hidden items-center justify-between px-3.5 py-2.5 bg-[#141414] border-b border-[#242424] shrink-0">
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            type="button"
            className="p-1.5 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            title="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <img src="/orba-mascot.svg" alt="OrbaAgent" className="w-5 h-5" />
            <span className="font-bold text-sm text-white tracking-tight">OrbaAgent</span>
          </div>
          <button
            onClick={() => {
              clearChat();
              setInputPrompt("");
            }}
            type="button"
            className="p-1.5 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            title="New chat"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Messages Feed or Center Hero */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-8">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[75vh] max-w-2xl mx-auto text-center px-4">
              {/* Mascot Logo (Exact brand mascot circle) */}
              <div className="mb-6 relative">
                <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-2xl shadow-white/10 ring-1 ring-white/20">
                  <img
                    src="/orba-mascot.svg"
                    alt="OrbaAgent Mascot"
                    className="w-12 h-12 object-contain"
                  />
                </div>
              </div>

              {/* Headline */}
              <h1 className="text-3xl font-semibold tracking-tight text-white mb-8">
                How can I help you today?
              </h1>

              {/* Center Input Card (Matching Mockup) */}
              <div className="w-full rounded-2xl bg-[#1e1e1e] border border-[#2e2e2e] shadow-xl text-left mb-6">
                <div className="p-4 flex flex-col gap-3">
                  {/* Attached Files Visual Previews */}
                  {renderAttachmentPreviews()}

                  <textarea
                    ref={textareaRef}
                    rows={2}
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask OrbaAgent AI"
                    className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <AttachmentMenu
                        onAttachFiles={(files) => setAttachedFiles((prev) => [...prev, ...files])}
                        onInsertSnippet={(s) =>
                          setInputPrompt((prev) => (prev ? `${prev}\n${s}` : s))
                        }
                      />
                      {/* Action Pill: + Review for me */}
                      <button
                        onClick={() =>
                          setInputPrompt(
                            "Review the current codebase and let me know if all is correct so far.",
                          )
                        }
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#2a2a2a] hover:bg-[#333333] text-xs font-medium text-zinc-300 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        <span>Review for me</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleListening}
                        type="button"
                        className={`p-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                          isListening
                            ? "bg-red-950/80 border border-red-500/50 text-red-400 animate-pulse"
                            : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                        }`}
                        title={
                          isListening
                            ? "Listening... click to stop"
                            : "Voice dictation (Auto-detect)"
                        }
                      >
                        <Mic className="w-4 h-4" />
                        {isListening && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-red-300">
                            REC
                          </span>
                        )}
                      </button>
                      {isGenerating ? (
                        <button
                          onClick={cancelGeneration}
                          type="button"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-xs font-medium text-white transition-all shadow-sm"
                        >
                          <Square className="w-2.5 h-2.5 fill-white" />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button
                          onClick={handleSend}
                          disabled={
                            (!inputPrompt.trim() && attachedFiles.length === 0) || isGenerating
                          }
                          type="button"
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ${
                            (inputPrompt.trim() || attachedFiles.length > 0) && !isGenerating
                              ? "bg-white text-black hover:bg-zinc-200"
                              : "bg-[#27272a] text-zinc-600 cursor-not-allowed"
                          }`}
                        >
                          <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-bar: Get better answers from your apps (Matching media_1791118201468.png) */}
                {showAppsBar && (
                  <div className="bg-[#181818] border-t border-[#292929] px-4 py-2.5 flex items-center justify-between text-xs rounded-b-2xl">
                    <span className="text-zinc-400 font-medium text-[11px]">
                      Get better answers from your apps
                    </span>
                    <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar touch-pan-x py-0.5">
                      <button
                        onClick={() => openAppConnection("slack")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Slack"
                      >
                        <SlackIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("gmail")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Gmail"
                      >
                        <GmailIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("google_calendar")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Google Calendar"
                      >
                        <GoogleCalendarIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("outlook")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Outlook Calendar"
                      >
                        <OutlookCalendarIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("google_drive")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Google Drive"
                      >
                        <GoogleDriveIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("teams")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Microsoft Teams"
                      >
                        <TeamsIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("outlook")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Outlook"
                      >
                        <OutlookIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("sharepoint")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="SharePoint & OneDrive"
                      >
                        <SharePointIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("asana")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Asana"
                      >
                        <AsanaIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("box")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Box"
                      >
                        <BoxIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("github")}
                        type="button"
                        className="relative text-white hover:scale-110 transition-transform shrink-0"
                        title={
                          gitHubConnected
                            ? `GitHub (Connected as @${gitHubAccount || "user"})`
                            : "GitHub"
                        }
                      >
                        <GitHubIcon className="w-4 h-4" />
                        {gitHubConnected && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full ring-2 ring-[#1a1a1a]" />
                        )}
                      </button>
                      <button
                        onClick={() => openAppConnection("linear")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Linear"
                      >
                        <LinearIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("notion")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Notion"
                      >
                        <NotionIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openAppConnection("salesforce")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Salesforce"
                      >
                        <SalesforceIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setShowAppsBar(false)}
                        type="button"
                        className="text-zinc-500 hover:text-zinc-300 ml-1 transition-colors shrink-0"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 4 Action Pills below Input Card */}
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  onClick={() =>
                    sendMessage(
                      "Generate an executive slide presentation outline for this project.",
                    )
                  }
                  type="button"
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1b1b1b] border border-[#2b2b2b] hover:bg-[#252525] text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                >
                  <LayoutGrid className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Create Slides</span>
                </button>

                <button
                  onClick={() =>
                    sendMessage(
                      "Create a financial / metrics tracking spreadsheet model for this project.",
                    )
                  }
                  type="button"
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1b1b1b] border border-[#2b2b2b] hover:bg-[#252525] text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                >
                  <Table className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Spreadsheets</span>
                </button>

                <button
                  onClick={() =>
                    sendMessage(
                      "Conduct in-depth technical research on latest architectural best practices.",
                    )
                  }
                  type="button"
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1b1b1b] border border-[#2b2b2b] hover:bg-[#252525] text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Research</span>
                </button>

                <button
                  onClick={() =>
                    sendMessage(
                      "Visualize the full system architecture with components, flow, and dependencies.",
                    )
                  }
                  type="button"
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1b1b1b] border border-[#2b2b2b] hover:bg-[#252525] text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Visualize</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-32 w-full">
              {messages.map((msg: ChatMessage) => (
                <MessageItem
                  key={msg.id || Math.random().toString()}
                  message={msg}
                  onAcceptChange={(changeId, runId) => reviewFileChange("accept", changeId, runId)}
                  onRejectChange={(changeId, runId) => reviewFileChange("reject", changeId, runId)}
                  onAcceptAllChanges={(runId) => reviewFileChange("accept_all", undefined, runId)}
                  onRejectAllChanges={(runId) => reviewFileChange("reject_all", undefined, runId)}
                  onReply={(content) => {
                    const quoted = content
                      .split("\n")
                      .map((l) => `> ${l}`)
                      .join("\n");
                    setInputPrompt((prev) => (prev ? `${prev}\n\n${quoted}\n` : `${quoted}\n`));
                    textareaRef.current?.focus();
                  }}
                />
              ))}


            </div>
          )}
        </div>

        {/* Error Banner */}
        {error && <ErrorBanner error={error} onRetry={retryLastMessage} />}

        {/* Fixed Bottom Input when Conversation is Active */}
        {messages.length > 0 && (
          <div className="p-4 bg-gradient-to-t from-[#131313] via-[#131313] to-transparent">
            <div className="max-w-3xl mx-auto">
              <div className="w-full rounded-3xl bg-[#18181b]/95 border border-zinc-800/80 shadow-2xl backdrop-blur-xl focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-zinc-700/50 transition-all">
                <div className="p-3.5 flex flex-col gap-2">
                  {/* Attached Files Visual Previews */}
                  {renderAttachmentPreviews()}

                  <textarea
                    rows={2}
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Reply to OrbaAgent AI..."
                    className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <AttachmentMenu
                        onAttachFiles={(files) => setAttachedFiles((prev) => [...prev, ...files])}
                        onInsertSnippet={(s) =>
                          setInputPrompt((prev) => (prev ? `${prev}\n${s}` : s))
                        }
                      />
                      <button
                        onClick={() =>
                          setInputPrompt(
                            "Review the repository changes and verify if tests pass cleanly.",
                          )
                        }
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#2a2a2a] hover:bg-[#333333] text-xs font-medium text-zinc-300 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        <span>Review for me</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleListening}
                        type="button"
                        className={`p-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                          isListening
                            ? "bg-red-950/80 border border-red-500/50 text-red-400 animate-pulse"
                            : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                        }`}
                        title={
                          isListening
                            ? "Listening... click to stop"
                            : "Voice dictation (Auto-detect)"
                        }
                      >
                        <Mic className="w-4 h-4" />
                        {isListening && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-red-300">
                            REC
                          </span>
                        )}
                      </button>

                      {isGenerating ? (
                        <button
                          onClick={cancelGeneration}
                          type="button"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-xs font-medium text-white transition-all shadow-sm"
                        >
                          <Square className="w-2.5 h-2.5 fill-white" />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button
                          onClick={handleSend}
                          disabled={
                            (!inputPrompt.trim() && attachedFiles.length === 0) || isGenerating
                          }
                          type="button"
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ${
                            (inputPrompt.trim() || attachedFiles.length > 0) && !isGenerating
                              ? "bg-white text-black hover:bg-zinc-200"
                              : "bg-[#27272a] text-zinc-600 cursor-not-allowed"
                          }`}
                        >
                          <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-bar in chat view */}
                {showAppsBar && (
                  <div className="bg-[#181818] border-t border-[#292929] px-3.5 py-2 flex items-center justify-between text-xs">
                    <span className="text-zinc-500 text-[11px]">Apps &amp; Connectors</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openAppConnection("github")}
                        type="button"
                        className="relative text-white hover:scale-110 transition-transform shrink-0"
                        title={
                          gitHubConnected
                            ? `GitHub (Connected as @${gitHubAccount || "user"})`
                            : "GitHub"
                        }
                      >
                        <GitHubIcon className="w-3.5 h-3.5" />
                        {gitHubConnected && (
                          <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-emerald-400 rounded-full ring-1 ring-[#181818]" />
                        )}
                      </button>
                      <button
                        onClick={() => openAppConnection("slack")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Slack"
                      >
                        <SlackIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openAppConnection("linear")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Linear"
                      >
                        <LinearIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openAppConnection("google_drive")}
                        type="button"
                        className="hover:scale-110 transition-transform shrink-0"
                        title="Google Drive"
                      >
                        <GoogleDriveIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedInitialApp(null);
                          setIsConnectionsOpen(true);
                        }}
                        type="button"
                        className="text-blue-400 text-[11px] hover:underline ml-2 shrink-0"
                      >
                        All apps...
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* =========================================================================
          CONNECTIONS SETTINGS MODAL
      ========================================================================= */}
      <ConnectionsModal
        isOpen={isConnectionsOpen}
        onClose={() => setIsConnectionsOpen(false)}
        initialApp={selectedInitialApp}
      />

      {/* =========================================================================
          DEDICATED GITHUB OAUTH CONNECTION MODAL (Exact match to media_1791124877493.png)
      ========================================================================= */}
      <GitHubConnectionModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        isConnected={gitHubConnected}
        connectedAccount={gitHubAccount}
        onConnectedChange={(connected, account) => {
          setGitHubConnected(connected);
          setGitHubAccount(account);
        }}
      />

      {/* =========================================================================
          WORKFORCE HELP & SHORTCUTS MODAL
      ========================================================================= */}
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      {/* =========================================================================
          MULTI-AGENT WORKFORCE ROSTER MODAL
      ========================================================================= */}
      <AgentsModal
        isOpen={isAgentsOpen}
        onClose={() => setIsAgentsOpen(false)}
        onSelectAgent={(agentName) => {
          setInputPrompt(`[Delegating to ${agentName}]: `);
          textareaRef.current?.focus();
        }}
      />

      {/* =========================================================================
          WORKFLOW TEMPLATES LIBRARY MODAL
      ========================================================================= */}
      <LibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onSelectPrompt={(prompt) => {
          setInputPrompt(prompt);
          textareaRef.current?.focus();
        }}
      />
    </div>
  );
}
