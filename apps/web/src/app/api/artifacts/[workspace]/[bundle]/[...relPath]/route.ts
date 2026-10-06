import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { PathContainmentError, resolveWithinBase } from "@orbaagent/shared";

/**
 * Workspace identity used by the existing upload/artifact model.
 *
 * `POST /api/uploads` writes artifacts under `<ORBA_UPLOAD_DIR>/<workspace>/<bundle>/...`
 * where `workspace` is `ORBA_TENANT_ID || "default-tenant"`. This route reuses that
 * same server-side workspace identity rather than introducing a second auth system.
 */
function currentWorkspace(): string {
  return process.env.ORBA_TENANT_ID || "default-tenant";
}

function uploadBaseDir(): string {
  return process.env.ORBA_UPLOAD_DIR || join(process.cwd(), ".uploads");
}

function inferContentType(filename: string): string {
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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspace: string; bundle: string; relPath: string[] }> },
) {
  // Next.js 16 passes route params as a Promise.
  const { workspace, bundle, relPath } = await ctx.params;

  // Authorization: an artifact may only be read from the workspace this server is
  // configured for. Attempts to read another workspace are rejected before any
  // filesystem access, which prevents cross-workspace artifact disclosure.
  if (workspace !== currentWorkspace()) {
    return new Response("Forbidden", { status: 403 });
  }

  const baseDir = uploadBaseDir();
  const segments = [workspace, bundle, ...(Array.isArray(relPath) ? relPath : [])];

  let filePath: string;
  try {
    filePath = resolveWithinBase(baseDir, segments);
  } catch (err: unknown) {
    if (err instanceof PathContainmentError) {
      // Traversal, absolute escape, or sibling-prefix escape.
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const st = await stat(filePath);
    if (!st.isFile()) return new Response("Not Found", { status: 404 });

    const data = await readFile(filePath);
    const filename = segments[segments.length - 1] || "file";

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": inferContentType(filename),
        "Content-Length": String(st.size),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return new Response("Not Found", { status: 404 });
    }
    return new Response("Internal Server Error", { status: 500 });
  }
}
