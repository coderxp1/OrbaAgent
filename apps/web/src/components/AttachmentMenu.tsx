"use client";

import {
  Code,
  FileCode,
  FileText,
  FolderUp,
  Image,
  Paperclip,
  Plus,
  Video,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
}

interface AttachmentMenuProps {
  onAttachFiles: (files: AttachedFile[]) => void;
  onInsertSnippet: (snippet: string) => void;
}

export function AttachmentMenu({ onAttachFiles, onInsertSnippet }: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

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
      newAttachments.push({
        id: `att_${Date.now()}_${i}`,
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        content,
      });
    }

    onAttachFiles(newAttachments);
    setIsOpen(false);
    if (e.target) e.target.value = "";
  };

  const handleFigmaPrompt = () => {
    const figmaUrl = prompt("Enter Figma file or component URL:");
    if (figmaUrl && figmaUrl.trim()) {
      onInsertSnippet(`[Figma Design Reference]: ${figmaUrl.trim()}\nAnalyze this UI layout and implement it in our Tailwind/Next.js workspace.`);
    }
    setIsOpen(false);
  };

  const handleTextPrompt = () => {
    const note = prompt("Enter quick text or specification note:");
    if (note && note.trim()) {
      onInsertSnippet(`[Specification Note]:\n${note.trim()}`);
    }
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

      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${
          isOpen
            ? "bg-zinc-700 text-white"
            : "text-zinc-400 hover:text-white hover:bg-zinc-800"
        }`}
        title="Add attachments or context"
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Dropdown Menu (Matching Mockup) */}
      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 w-48 rounded-xl border border-[#2e2e32] bg-[#1a1a1d] shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 flex flex-col">
          <button
            onClick={() => fileInputRef.current?.click()}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <Paperclip className="w-3.5 h-3.5 text-blue-400" />
            <span>Files</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <FolderUp className="w-3.5 h-3.5 text-amber-400" />
            <span>Folders</span>
          </button>

          <button
            onClick={() => imageInputRef.current?.click()}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <Image className="w-3.5 h-3.5 text-purple-400" />
            <span>Images</span>
          </button>

          <button
            onClick={() => videoInputRef.current?.click()}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <Video className="w-3.5 h-3.5 text-red-400" />
            <span>Videos</span>
          </button>

          <button
            onClick={handleTextPrompt}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>Text Note</span>
          </button>

          <button
            onClick={handleFigmaPrompt}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <FileCode className="w-3.5 h-3.5 text-pink-400" />
            <span>Figma Link</span>
          </button>
        </div>
      )}
    </div>
  );
}
