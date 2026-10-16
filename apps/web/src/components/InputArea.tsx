"use client";

import { FileText, Send, Square, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { type AttachedFile, AttachmentMenu } from "./AttachmentMenu";

interface InputAreaProps {
  onSendMessage: (text: string, attachments?: AttachedFile[]) => void;
  isGenerating: boolean;
  onCancelGeneration: () => void;
}

export function InputArea({ onSendMessage, isGenerating, onCancelGeneration }: InputAreaProps) {
  const [text, setText] = useState<string>("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    if ((!text.trim() && attachments.length === 0) || isGenerating) return;
    const content = text;
    const uploaded = attachments;
    // Upload files if present
    const filesToUpload = attachments.filter((a) => a.file).map((a) => a);
    if (filesToUpload.length > 0) {
      const form = new FormData();
      const bundle = `bundle_${Date.now()}`;
      form.set("bundle", bundle);
      for (const att of filesToUpload) {
        const f = att.file as File;
        // Preserve relative path when available by renaming the File with path; browsers ignore path but server relies on webkitRelativePath sent by the browser
        form.append("files", f);
      }
      try {
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        if (res.ok) {
          const data = await res.json();
          const urls: string[] = (data.artifacts || []).map((a: any) => a.url);
          const structured = (data.artifacts || []).map((a: any, idx: number) => ({
            artifactId: a.id,
            name: a.name,
            type: a.type,
            size: a.size,
            relPath: a.relPath,
            url: a.url,
            file: filesToUpload[idx]?.file,
            previewUrl: (filesToUpload[idx] as any)?.previewUrl || a.url,
          }));
          // Send structured attachments to /api/chat WITHOUT prepending raw prefix to content
          onSendMessage(content, structured);
          setText("");
          setAttachments([]);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      } catch {
        // If upload fails, send without URLs (agent will lack artifact access)
      }
    }
    onSendMessage(content, undefined);
    setText("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  const handleAttachFiles = (files: AttachedFile[]) => {
    setAttachments((prev) => [...prev, ...files]);
  };

  const handleInsertSnippet = (snippet: string) => {
    setText((prev) => (prev ? `${prev}\n${snippet}` : snippet));
    textareaRef.current?.focus();
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2.5 px-1 pb-1">
            {attachments.map((att) => {
              const isImg =
                att.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(att.name);
              const previewSrc =
                att.previewUrl || (att.file ? URL.createObjectURL(att.file) : null);

              return (
                <div
                  key={att.id}
                  className="group/att relative flex items-center gap-2 p-1.5 pr-2.5 rounded-xl bg-zinc-800 border border-zinc-700/60 shadow-md transition-all hover:border-zinc-500/60"
                >
                  {isImg && previewSrc ? (
                    <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-black/40 border border-zinc-700/40 shrink-0">
                      <img src={previewSrc} alt={att.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-700/50 text-blue-400 shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                  )}

                  <div className="flex flex-col min-w-0 pr-1">
                    <span
                      className="text-xs font-medium text-zinc-200 truncate max-w-[120px]"
                      title={att.name}
                    >
                      {att.name}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {att.size > 0
                        ? att.size > 1024 * 1024
                          ? `${(att.size / (1024 * 1024)).toFixed(1)} MB`
                          : `${Math.round(att.size / 1024)} KB`
                        : "Ready"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
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

        <div className="relative flex items-end rounded-2xl border border-zinc-800 bg-zinc-900/90 p-2 shadow-inner focus-within:border-cyan-500/50 transition-colors">
          {/* Attachment Menu (+ button) */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center">
            <AttachmentMenu
              onAttachFiles={handleAttachFiles}
              onInsertSnippet={handleInsertSnippet}
            />
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask OrbaAgent anything or issue a goal..."
            rows={1}
            className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />

          {isGenerating ? (
            <button
              onClick={onCancelGeneration}
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-md shadow-red-950 hover:bg-red-500 transition-colors"
              title="Stop Generation"
            >
              <Square className="h-4 w-4 fill-white" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim() && attachments.length === 0}
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-950/50 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title="Send Message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-500 px-2 font-mono">
          <span>
            Press <kbd className="rounded bg-zinc-800 px-1 text-zinc-400">Enter</kbd> to send,{" "}
            <kbd className="rounded bg-zinc-800 px-1 text-zinc-400">Shift + Enter</kbd> for line
            break
          </span>
          <span>OrbaAgent Phase 1 — Powered by Model Gateway</span>
        </div>
      </div>
    </div>
  );
}
