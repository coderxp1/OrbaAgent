import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { authorize, authorizeTenant, resolveRequestIdentity } from "@/lib/auth/guard";
import { inferContentType, uploadBaseDir } from "@/lib/media";
import { PathContainmentError, resolveWithinBase } from "@orbaagent/shared";

/**
 * Workspace identity used by the existing upload/artifact model.
 *
 * `POST /api/uploads` writes artifacts under `<ORBA_UPLOAD_DIR>/<workspace>/<bundle>/...`
 * where `workspace` is the tenant the caller's identity resolved to. This route
 * resolves the SAME identity for the request and refuses any workspace that is
 * not the caller's tenant, before touching the filesystem.
 */

export async function GET(
  req: Request,
  ctx: { params: Promise<{ workspace: string; bundle: string; relPath: string[] }> },
) {
  // Next.js 16 passes route params as a Promise.
  const { workspace, bundle, relPath } = await ctx.params;

  // Authentication: the deployment policy decides whether an anonymous caller
  // is acceptable at all.
  const { identity, mode } = await resolveRequestIdentity(req);
  const unauthenticated = authorize(identity, mode, req);
  if (unauthenticated) return unauthenticated;

  // Authorization: an artifact may only be read from the tenant this request
  // resolved to. Attempts to read another tenant's artifacts are rejected
  // before any filesystem access, which prevents cross-tenant disclosure.
  const crossTenant = authorizeTenant(identity, workspace);
  if (crossTenant) return crossTenant;

  const baseDir = uploadBaseDir();
  // Containment is checked against the TENANT directory, not merely against
  // the upload root. Resolving against the upload root alone would let
  // `../../other-tenant/...` escape into another tenant's artifacts even
  // though the URL segment named this caller's own tenant.
  const tenantBase = join(baseDir, workspace);
  const segments = [bundle, ...(Array.isArray(relPath) ? relPath : [])];

  let filePath: string;
  try {
    filePath = resolveWithinBase(tenantBase, segments);
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
