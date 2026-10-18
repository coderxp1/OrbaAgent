"use client";

import { FileText, Mic, MicOff, Send, Square, Volume2, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type AttachedFile, AttachmentMenu } from "./AttachmentMenu";

interface InputAreaProps {
  onSendMessage: (text: string, attachments?: AttachedFile[]) => void;
  isGenerating: boolean;
  onCancelGeneration: () => void;
}

export function InputArea({ onSendMessage, isGenerating, onCancelGeneration }: InputAreaProps) {
  const [text, setText] = useState<string>("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleToggleRecord = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const ext = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice_note_${Date.now()}.${ext}`, {
          type: blob.type,
        });
        const attached: AttachedFile = {
          id: `voice_${Date.now()}`,
          name: file.name,
          size: file.size,
          type: file.type,
          file,
        };
        setAttachments((prev) => [...prev, attached]);
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      alert("Microphone permission was not granted or audio recording is unavailable.");
    }
  };

  const handleSend = async () => {
    if ((!text.trim() && attachments.length === 0) || isGenerating) return;
    const content = text;
    // Upload files if present
    const filesToUpload = attachments.filter((a) => a.file).map((a) => a);
    if (filesToUpload.length > 0) {
      const form = new FormData();
      const bundle = `bundle_${Date.now()}`;
      form.set("bundle", bundle);
      for (const att of filesToUpload) {
        const f = att.file as File;
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
            file: filesToUpload[idx]?.file,
            previewUrl: (filesToUpload[idx] as any)?.previewUrl || a.url,
          }));
          onSendMessage(content, structured);
          setText("");
          setAttachments([]);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      } catch {
        // If upload fails, send without URLs
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
        {/* Live Voice Recording Indicator */}
        {isRecording && (
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-200 text-xs shadow-lg animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              <span className="font-semibold text-rose-100">Recording voice note...</span>
              <span className="font-mono text-rose-300 bg-rose-900/60 px-2 py-0.5 rounded-md text-[11px]">
                {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleRecord}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        )}

        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2.5 px-1 pb-1">
            {attachments.map((att) => {
              const isImg =
                att.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(att.name);
              const isAudio =
                att.type?.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|webm|flac)$/i.test(att.name);
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
                  ) : isAudio ? (
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-zinc-900 border border-amber-600/50 text-amber-400 shrink-0">
                      <Volume2 className="w-4 h-4" />
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
            placeholder={isRecording ? "Recording voice note..." : "Ask OrbaAgent anything or issue a goal..."}
            rows={1}
            className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />

          {/* Microphone Recording Button */}
          <button
            onClick={handleToggleRecord}
            type="button"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all mr-1.5 ${
              isRecording
                ? "bg-rose-600 text-white animate-pulse shadow-lg shadow-rose-950"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            title={isRecording ? "Stop recording voice note" : "Record voice note"}
          >
            {isRecording ? <Square className="h-4 w-4 fill-white" /> : <Mic className="h-4 w-4" />}
          </button>

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
          <span>OrbaAgent Phase 1 & 2 — Powered by Model Gateway</span>
        </div>
      </div>
    </div>
  );
}
