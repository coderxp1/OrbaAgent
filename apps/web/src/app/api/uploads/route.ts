import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { resolveWithinBase } from "@orbaagent/shared";

function safeJoin(base: string, rel: string) {
  // Containment via path.relative (see @orbaagent/shared). Rejects `../`
  // traversal, absolute escapes, and sibling directories that share a string
  // prefix with the base.
  return resolveWithinBase(base, [rel]);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files");
    const note = form.get("note") as string | null;
    const figmaUrl = form.get("figmaUrl") as string | null;
    const bundle = (form.get("bundle") as string | null) || randomUUID();

    // turbopackIgnore prevents the bundler from tracing the whole project into the
    // server output when it cannot statically scope this filesystem path.
    const baseDir =
      process.env.ORBA_UPLOAD_DIR || join(/* turbopackIgnore: true */ process.cwd(), ".uploads");
    // Tenant comes from the server-resolved caller identity only; it is never
    // taken from client input (see @orbaagent/shared and ADR-004).
    const { identity, mode } = await resolveRequestIdentity(request);
    const unauthenticated = authorize(identity, mode);
    if (unauthenticated) return unauthenticated;
    const workspace = identity.tenantId;
    const uploadRoot = join(/* turbopackIgnore: true */ baseDir, workspace, bundle);

    const artifacts: Array<{
      id: string; // artifactId
      name: string;
      size: number;
      type: string;
      relPath: string;
      url: string;
    }> = [];

    await mkdir(uploadRoot, { recursive: true });

    for (const item of files) {
      if (!(item instanceof File)) continue;
      const id = randomUUID();
      const relPath = (item as any).webkitRelativePath || item.name;
      const targetPath = safeJoin(uploadRoot, relPath);
      await mkdir(dirname(targetPath), { recursive: true });
      const buf = Buffer.from(await item.arrayBuffer());
      await writeFile(targetPath, buf);

      const url = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
        bundle,
      )}/${encodeURIComponent(relPath)}`;
      const artifactId = Buffer.from(
        JSON.stringify({ w: workspace, b: bundle, p: relPath }),
      ).toString("base64url");
      artifacts.push({
        id: artifactId,
        name: item.name,
        size: item.size,
        type: item.type || "",
        relPath,
        url,
      });
    }

    // Persist text note as an artifact file if present
    if (note && note.trim().length > 0) {
      const id = randomUUID();
      const relPath = `note-${Date.now()}.txt`;
      const path = safeJoin(uploadRoot, relPath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(note, "utf-8"));
      const url = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
        bundle,
      )}/${encodeURIComponent(relPath)}`;
      const artifactId = Buffer.from(
        JSON.stringify({ w: workspace, b: bundle, p: relPath }),
      ).toString("base64url");
      artifacts.push({
        id: artifactId,
        name: relPath,
        size: Buffer.byteLength(note),
        type: "text/plain",
        relPath,
        url,
      });
    }

    // Persist figma link as a reference text file for now
    if (figmaUrl && /^https?:\/\/([\w.-]+\.)?figma\.com\//i.test(figmaUrl)) {
      const id = randomUUID();
      const relPath = `figma-link-${Date.now()}.url.txt`;
      const path = safeJoin(uploadRoot, relPath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(figmaUrl, "utf-8"));
      const url = `/api/artifacts/${encodeURIComponent(workspace)}/${encodeURIComponent(
        bundle,
      )}/${encodeURIComponent(relPath)}`;
      const artifactId = Buffer.from(
        JSON.stringify({ w: workspace, b: bundle, p: relPath }),
      ).toString("base64url");
      artifacts.push({
        id: artifactId,
        name: relPath,
        size: Buffer.byteLength(figmaUrl),
        type: "text/uri-list",
        relPath,
        url,
      });
    }

    return Response.json(
      {
        bundle,
        workspace,
        artifacts,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
