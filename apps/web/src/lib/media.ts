import { join } from "node:path";

/**
 * Shared media handling for artifact ingest and serving.
 *
 * The ingest endpoint must not trust the client-declared MIME type: a caller can
 * label anything `image/png`. Every accepted type therefore also has a magic-byte
 * check, and the stored extension is derived from the sniffed content rather than
 * from the request.
 */

export const DEFAULT_MAX_ARTIFACT_BYTES = 256 * 1024 * 1024; // 256 MiB

/**
 * Maximum artifact size accepted for ingest.
 *
 * Read from the environment so a deployment can tighten it, and so the size gate
 * is testable without allocating hundreds of megabytes.
 */
export function maxArtifactBytes(): number {
  const raw = (process.env.ORBA_MAX_ARTIFACT_BYTES || "").trim();
  if (!raw) return DEFAULT_MAX_ARTIFACT_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_ARTIFACT_BYTES;
  return Math.floor(parsed);
}

export interface MediaType {
  /** MIME type reported to clients. */
  contentType: string;
  /** File extension stored on disk (no leading dot). */
  extension: string;
  /** Verifies the leading bytes match this type. */
  matches: (head: Uint8Array) => boolean;
}

function startsWith(head: Uint8Array, signature: number[], offset = 0): boolean {
  if (head.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (head[offset + i] !== signature[i]) return false;
  }
  return true;
}

function isLikelyText(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  for (const byte of head) {
    // Reject NUL and most C0 control bytes; allow tab, LF, CR.
    if (byte === 0) return false;
    if (byte < 0x09) return false;
    if (byte > 0x0d && byte < 0x20) return false;
  }
  return true;
}

export const ACCEPTED_MEDIA_TYPES: MediaType[] = [
  {
    contentType: "image/png",
    extension: "png",
    matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    contentType: "image/jpeg",
    extension: "jpg",
    matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  },
  {
    contentType: "image/webp",
    extension: "webp",
    matches: (h) =>
      startsWith(h, [0x52, 0x49, 0x46, 0x46]) && startsWith(h, [0x57, 0x45, 0x42, 0x50], 8),
  },
  {
    contentType: "image/gif",
    extension: "gif",
    matches: (h) => startsWith(h, [0x47, 0x49, 0x46, 0x38]),
  },
  {
    contentType: "video/mp4",
    extension: "mp4",
    // ISO-BMFF: 'ftyp' box at offset 4.
    matches: (h) => startsWith(h, [0x66, 0x74, 0x79, 0x70], 4),
  },
  {
    contentType: "video/webm",
    extension: "webm",
    matches: (h) => startsWith(h, [0x1a, 0x45, 0xdf, 0xa3]),
  },
  {
    contentType: "application/octet-stream",
    extension: "bin",
    matches: () => true, // fallback, only reached when nothing else matched
  },
];

/** Sniff a media type from leading bytes. Returns null when nothing matches. */
export function sniffMediaType(head: Uint8Array): MediaType | null {
  for (const type of ACCEPTED_MEDIA_TYPES) {
    if (type.extension === "bin") continue; // fallback handled separately
    if (type.matches(head)) return type;
  }
  return null;
}

/** Media type used when serving a file, inferred from its stored extension. */
export function inferContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".txt") || lower.endsWith(".url.txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

/** Whether a filename is safe to use as a single path segment. */
export function isSafeFilename(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes("\0")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/** Canonical artifact id: base64url of {w,b,p}, matching the upload route. */
export function encodeArtifactId(workspace: string, bundle: string, relPath: string): string {
  return Buffer.from(JSON.stringify({ w: workspace, b: bundle, p: relPath })).toString("base64url");
}

/** Server-side workspace identity, consistent across upload/artifact/ingest. */
export function currentWorkspace(): string {
  return process.env.ORBA_TENANT_ID || "default-tenant";
}

/** Root directory for uploaded and ingested artifacts. */
export function uploadBaseDir(): string {
  return process.env.ORBA_UPLOAD_DIR || join(process.cwd(), ".uploads");
}

export { isLikelyText };
