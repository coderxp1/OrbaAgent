"use client";

import {
  Book,
  ChevronRight,
  Code,
  FileCode,
  FileText,
  HardDrive,
  Image,
  ImagePlus,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  Video,
  Volume2,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
  file?: File; // raw browser File for upload pipeline
  relativePath?: string; // preserved when selecting directories
  previewUrl?: string; // object URL or data URL for instant image previews
}

interface AttachmentMenuProps {
  onAttachFiles: (files: AttachedFile[]) => void;
  onInsertSnippet: (snippet: string) => void;
  onStartVoiceNote?: () => void;
  onOpenDrive?: () => void;
}

export function AttachmentMenu({
  onAttachFiles,
  onInsertSnippet,
  onStartVoiceNote,
  onOpenDrive,
}: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [driveUrlInput, setDriveUrlInput] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const notebookInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: AttachedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let content = "";
      if (
        file.type.startsWith("text/") ||
        file.name.match(/\.(ts|tsx|js|jsx|json|md|py|go|rs|sql|css|html|yaml|yml)$/i)
      ) {
        try {
          content = await file.text();
        } catch {}
      }

      let previewUrl: string | undefined;
      if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)) {
        try {
          previewUrl = URL.createObjectURL(file);
        } catch {}
      }

      newAttachments.push({
        id: `att_${Date.now()}_${i}`,
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        content,
        file,
        previewUrl,
        // @ts-ignore — Chromium-only webkitRelativePath
        relativePath: (file as any).webkitRelativePath || undefined,
      });
    }

    onAttachFiles(newAttachments);
    setIsOpen(false);
    if (e.target) e.target.value = "";
  };

  const handleCodeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: AttachedFile[] = [];
    let codeSnippets = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let content = "";
      try {
        content = await file.text();
      } catch (err) {
        console.warn("Could not read code file:", err);
      }

      newAttachments.push({
        id: `code_${Date.now()}_${i}`,
        name: file.name,
        size: file.size,
        type: file.type || "text/plain",
        content,
        file,
      });

      const ext = file.name.split(".").pop() || "txt";
      codeSnippets += `\n[Imported Code: ${file.name}]\n\`\`\`${ext}\n${content.slice(0, 3000)}${content.length > 3000 ? "\n// ... (remaining code preserved in workspace file)" : ""}\n\`\`\`\n`;
    }

    onAttachFiles(newAttachments);
    if (codeSnippets) {
      onInsertSnippet(codeSnippets.trim());
    }
    setIsOpen(false);
    if (e.target) e.target.value = "";
  };

  const handleNotebookFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: AttachedFile[] = [];
    let notebookSnippets = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let rawText = "";
      try {
        rawText = await file.text();
      } catch (err) {
        console.warn("Could not read notebook file:", err);
      }

      let parsedSummary = "";
      try {
        const nb = JSON.parse(rawText);
        if (nb && Array.isArray(nb.cells)) {
          const cells = nb.cells;
          const codeCells = cells.filter((c: any) => c.cell_type === "code");
          const mdCells = cells.filter((c: any) => c.cell_type === "markdown");
          parsedSummary = `[Jupyter Notebook: ${file.name}] (${cells.length} cells: ${codeCells.length} code, ${mdCells.length} markdown)\n`;
          for (let cIdx = 0; cIdx < Math.min(cells.length, 6); cIdx++) {
            const cell = cells[cIdx];
            const src = Array.isArray(cell.source)
              ? cell.source.join("")
              : String(cell.source || "");
            if (cell.cell_type === "code") {
              parsedSummary += `\nCell [${cIdx + 1}] (code):\n\`\`\`python\n${src.slice(0, 500)}\n\`\`\`\n`;
            } else {
              parsedSummary += `\nCell [${cIdx + 1}] (markdown): ${src.slice(0, 300)}\n`;
            }
          }
          if (cells.length > 6) {
            parsedSummary += `\n... (${cells.length - 6} additional cells attached for execution)\n`;
          }
        }
      } catch {
        parsedSummary = `[Imported Notebook: ${file.name}] (Raw JSON notebook format)\n`;
      }

      newAttachments.push({
        id: `nb_${Date.now()}_${i}`,
        name: file.name,
        size: file.size,
        type: "application/x-ipynb+json",
        content: rawText,
        file,
      });

      if (parsedSummary) {
        notebookSnippets += parsedSummary;
      }
    }

    onAttachFiles(newAttachments);
    if (notebookSnippets) {
      onInsertSnippet(notebookSnippets.trim());
    }
    setIsOpen(false);
    if (e.target) e.target.value = "";
  };

  const handleDriveImport = () => {
    if (!driveUrlInput.trim()) return;
    const url = driveUrlInput.trim();
    onInsertSnippet(`[Google Drive Reference]: ${url}\nPlease review and integrate this document into our workspace.`);
    setDriveUrlInput("");
    setIsDriveModalOpen(false);
    setIsOpen(false);
  };

  const handleCreateImage = () => {
    onInsertSnippet("Please generate a high-resolution photorealistic image of: ");
    setIsOpen(false);
  };

  const handleCreateVideo = () => {
    onInsertSnippet("Please generate a vertical video of: ");
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory
        // @ts-ignore
        directory
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={codeInputRef}
        type="file"
        accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.json,.yaml,.yml,.toml,.md,.sql,.html,.css,.sh,.bash,.c,.cpp,.h"
        multiple
        className="hidden"
        onChange={handleCodeFileChange}
      />
      <input
        ref={notebookInputRef}
        type="file"
        accept=".ipynb,application/x-ipynb+json"
        multiple
        className="hidden"
        onChange={handleNotebookFileChange}
      />

      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${
          isOpen ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800"
        }`}
        title="Add attachments or context"
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 w-56 rounded-xl border border-[#2e2e32] bg-[#1a1a1d] shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 flex flex-col">
          <button
            onClick={() => fileInputRef.current?.click()}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <Paperclip className="w-4 h-4 text-blue-400" />
            <span>Upload files</span>
          </button>

          <button
            onClick={() => {
              if (onStartVoiceNote) {
                onStartVoiceNote();
                setIsOpen(false);
              } else {
                audioInputRef.current?.click();
              }
            }}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <Volume2 className="w-4 h-4 text-amber-400" />
            <span>Audio / Voice note</span>
          </button>

          <button
            onClick={() => {
              if (onOpenDrive) {
                onOpenDrive();
                setIsOpen(false);
              } else {
                setIsDriveModalOpen(true);
              }
            }}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <HardDrive className="w-4 h-4 text-zinc-400" />
            <span>Add from Drive</span>
          </button>

          <div className="relative group">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                <MoreHorizontal className="w-4 h-4 text-zinc-400" />
                <span>More uploads</span>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </button>
            <div className="absolute left-full top-0 ml-1 w-48 rounded-xl border border-[#2e2e32] bg-[#1a1a1d] shadow-2xl py-1.5 hidden group-hover:flex flex-col z-50">
              <button
                onClick={() => codeInputRef.current?.click()}
                type="button"
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
              >
                <Code className="w-4 h-4 text-emerald-400" />
                <span>Import code</span>
              </button>
              <button
                onClick={() => notebookInputRef.current?.click()}
                type="button"
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
              >
                <Book className="w-4 h-4 text-amber-400" />
                <span>Notebooks (.ipynb)</span>
              </button>
            </div>
          </div>

          <div className="h-px bg-[#2e2e32] my-1.5 mx-2" />

          <button
            onClick={handleCreateImage}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <ImagePlus className="w-4 h-4 text-purple-400" />
            <span>Create image</span>
          </button>

          <button
            onClick={handleCreateVideo}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <Video className="w-4 h-4 text-cyan-400" />
            <span>Create video</span>
          </button>
        </div>
      )}

      {/* Google Drive Import Modal */}
      {isDriveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#18181b] p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Import from Google Drive</h3>
              </div>
              <button
                onClick={() => setIsDriveModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>
            <div className="py-4 space-y-3">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Paste a Google Drive file link, or select a document to bring its content directly into the conversation workspace:
              </p>
              <input
                type="text"
                placeholder="https://drive.google.com/file/d/..."
                value={driveUrlInput}
                onChange={(e) => setDriveUrlInput(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsDriveModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDriveImport}
                disabled={!driveUrlInput.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
              >
                Import Reference
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
