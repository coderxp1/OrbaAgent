"use client";

import { ChevronRight, FileCode, FileText, FolderUp, HardDrive, Image, ImagePlus, MoreHorizontal, Paperclip, Plus, Video } from "lucide-react";
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
}

interface AttachmentMenuProps {
  onAttachFiles: (files: AttachedFile[]) => void;
  onInsertSnippet: (snippet: string) => void;
}

export function AttachmentMenu({ onAttachFiles, onInsertSnippet }: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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
        file,
        // @ts-ignore — Chromium-only webkitRelativePath
        relativePath: (file as any).webkitRelativePath || undefined,
      });
    }

    onAttachFiles(newAttachments);
    setIsOpen(false);
    if (e.target) e.target.value = "";
  };

  const handleFigmaPrompt = () => {
    const figmaUrl = prompt("Enter Figma file or component URL:");
    if (figmaUrl?.trim()) {
      onInsertSnippet(
        `[Figma Design Reference]: ${figmaUrl.trim()}\nAnalyze this UI layout and implement it in our Tailwind/Next.js workspace.`,
      );
    }
    setIsOpen(false);
  };

  const handleTextPrompt = () => {
    const note = prompt("Enter quick text or specification note:");
    if (note?.trim()) {
      onInsertSnippet(`[Specification Note]:\n${note.trim()}`);
    }
    setIsOpen(false);
  };

  const handleScreenshot = async () => {
    setIsOpen(false);
    try {
      const stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia: (c: DisplayMediaStreamOptions) => Promise<MediaStream>;
      }).getDisplayMedia({ video: true, preferCurrentTab: false } as DisplayMediaStreamOptions);
      const track = stream.getVideoTracks()[0];
      // @ts-ignore - ImageCapture may not be in all TS lib defs
      const capture = new (window as unknown as { ImageCapture: new (t: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }).ImageCapture(track);
      const bitmap = await capture.grabFrame();
      track.stop();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const name = `screenshot-${Date.now()}.png`;
        onAttachFiles([{ id: `att_${Date.now()}`, name, size: blob.size, type: "image/png" }]);
      }, "image/png");
    } catch {
      // User cancelled or browser doesn't support
    }
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
        // Some browsers require these non-standard boolean attributes for directory selection
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

      {/* Dropdown Menu (Matching Mockup) */}
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
            onClick={() => alert("Google Drive integration coming soon")}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <HardDrive className="w-4 h-4 text-zinc-400" />
            <span>Add from Drive</span>
          </button>

          <button
            type="button"
            className="flex items-center justify-between px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <div className="flex items-center gap-2.5">
              <MoreHorizontal className="w-4 h-4 text-zinc-400" />
              <span>More uploads</span>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </button>

          <div className="h-px bg-[#2e2e32] my-1.5 mx-2" />

          <button
            onClick={() => alert("Image generation is a separate capability not yet enabled")}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <ImagePlus className="w-4 h-4 text-zinc-300" />
            <span>Create image</span>
          </button>

          <button
            onClick={() => alert("Video generation is a separate capability not yet enabled")}
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:text-white hover:bg-[#252529] transition-colors text-left"
          >
            <Video className="w-4 h-4 text-zinc-300" />
            <span>Create video</span>
          </button>
        </div>
      )}
    </div>
  );
}
