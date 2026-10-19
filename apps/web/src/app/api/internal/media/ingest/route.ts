import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  currentWorkspace,
  encodeArtifactId,
  isSafeFilename,
  maxArtifactBytes,
  sniffMediaType,
  uploadBaseDir,
} from "@/lib/media";
import { resolveWithinBase } from "@orbaagent/shared";

/**
 * Internal artifact ingest.
 *
 * The GPU worker runs on a different host with no shared filesystem, so it pushes
 * generated artifacts here. This endpoint is deliberately NOT part of the public
 * upload authorization model:
 *
 *  - a dedicated ingest secret is required (ORBA_INTERNAL_INGEST_TOKEN)
 *  - the endpoint is inert (503) when that secret is not configured
 *  - the client-declared MIME type is never trusted; content is sniffed
 *  - size is capped before anything is written
 *  - the stored filename is generated server-side, so no caller path is used
 *
 * It returns only ids and metadata, never a filesystem path.
 */

const INGEST_TOKEN_ENV = "ORBA_INTERNAL_INGEST_TOKEN";

function ingestToken(): string {
  return (process.env[INGEST_TOKEN_ENV] || "").trim();
}

function readBearer(header: string | null): string {
  if (!header) return "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request) {
  const configured = ingestToken();

  // Inert until explicitly configured. Never falls back to the public model.
  if (!configured) {
    return Response.json(
      { error: "Internal artifact ingest is not configured on this deployment" },
      { status: 503 },
    );
  }

  const presented = readBearer(request.headers.get("authorization"));
  if (!presented) {
    return Response.json({ error: "Missing bearer token" }, { status: 401 });
  }
  if (!timingSafeEqual(presented, configured)) {
    return Response.json({ error: "Invalid ingest token" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing 'file' part" }, { status: 400 });
  }

  // Size gate before buffering the whole body.
  const limit = maxArtifactBytes();
  if (file.size <= 0) {
    return Response.json({ error: "Empty artifact rejected" }, { status: 400 });
  }
  if (file.size > limit) {
    return Response.json(
      { error: `Artifact exceeds maximum size of ${limit} bytes` },
      { status: 413 },
    );
  }

  // Workspaces this deployment serves. The deployment's own workspace is
  // always served; additional tenants are declared with ORBA_TENANTS. With no
  // ORBA_TENANTS the served set is exactly {currentWorkspace()}, so the
  // behaviour is unchanged from before.
  const allowedWorkspaces = new Set<string>([currentWorkspace()]);
  for (const extra of (process.env.ORBA_TENANTS || "").split(",")) {
    const name = extra.trim();
    if (isSafeFilename(name)) allowedWorkspaces.add(name);
  }

  // The worker must target a workspace this deployment serves.
  const requestedWorkspace = String(form.get("workspace") || "").trim();
  const workspace = requestedWorkspace || currentWorkspace();
  if (!allowedWorkspaces.has(workspace)) {
    return Response.json({ error: "Workspace mismatch" }, { status: 403 });
  }

  const rawBundle = String(form.get("bundle") || "").trim();
  const bundle = isSafeFilename(rawBundle) ? rawBundle : `bundle-${randomUUID()}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > limit) {
    return Response.json({ error: "Artifact exceeds maximum size" }, { status: 413 });
  }

  // Content sniffing is authoritative; the declared type is ignored.
  const sniffed = sniffMediaType(bytes.subarray(0, 64));
  if (!sniffed) {
    return Response.json(
      {
        error: "Unsupported artifact content: not a recognized image, video, or binary payload",
      },
      { status: 415 },
    );
  }

  const filename = `${randomUUID()}.${sniffed.extension}`;

  let baseDir: string;
  let targetPath: string;
  try {
    baseDir = uploadBaseDir();
    targetPath = resolveWithinBase(baseDir, [workspace, bundle, filename]);
  } catch {
    return Response.json({ error: "Invalid storage path" }, { status: 400 });
  }

  try {
    await mkdir(join(baseDir, workspace, bundle), { recursive: true });
    await writeFile(targetPath, bytes);
  } catch {
    return Response.json({ error: "Failed to store artifact" }, { status: 500 });
  }

  const artifactId = encodeArtifactId(workspace, bundle, filename);
  const url = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
    bundle,
  )}/${encodeURIComponent(filename)}`;

  let metadata: unknown = undefined;
  const rawMetadata = form.get("metadata");
  if (typeof rawMetadata === "string" && rawMetadata.length > 0 && rawMetadata.length < 8192) {
    try {
      metadata = JSON.parse(rawMetadata);
    } catch {
      metadata = undefined;
    }
  }

  return Response.json(
    {
      artifactId,
      url,
      workspace,
      bundle,
      name: filename,
      type: sniffed.contentType,
      size: bytes.byteLength,
      metadata,
    },
    { status: 201 },
  );
}
