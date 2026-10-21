/**
 * Canonical artifact references.
 *
 * Uploads are identified by an artifactId: base64url-encoded JSON
 * { w: workspace, b: bundle, p: relative path }, and served from
 * /api/artifacts/<w>/<b>/<p>. Historically, several call sites
 * reconstructed that URL ad hoc — one hardcoded a "default-tenant"
 * workspace and treated the artifactId blob as a path segment, and
 * others fell back to preview URLs or bare filenames, which could
 * resolve to a low-resolution preview or, via filename matching, an
 * entirely different file (incident 2026-10-21). These helpers are
 * the single canonical way to turn an attachment into the URL of the
 * exact uploaded artifact — or to conclude there is no usable
 * reference (undefined), never a guess.
 */

export interface ArtifactIdParts {
  w: string;
  b: string;
  p: string;
}

/** Decode and validate an artifactId. Returns null for anything else. */
export function decodeArtifactId(artifactId: unknown): ArtifactIdParts | null {
  if (typeof artifactId !== "string" || artifactId.length === 0) return null;
  try {
    const decoded = JSON.parse(Buffer.from(artifactId, "base64url").toString("utf-8"));
    if (
      decoded &&
      typeof decoded.w === "string" &&
      typeof decoded.b === "string" &&
      typeof decoded.p === "string" &&
      decoded.w.length > 0 &&
      decoded.b.length > 0 &&
      decoded.p.length > 0
    ) {
      return { w: decoded.w, b: decoded.b, p: decoded.p };
    }
  } catch {
    // Not a base64url JSON artifactId.
  }
  return null;
}

/** Build the canonical artifact URL for an artifactId, or null. */
export function canonicalArtifactUrl(artifactId: unknown): string | null {
  const parts = decodeArtifactId(artifactId);
  if (!parts) return null;
  return `/api/artifacts/${encodeURIComponent(parts.w)}/${encodeURIComponent(parts.b)}/${encodeURIComponent(parts.p)}`;
}

/**
 * Resolve a chat attachment to the canonical URL of the exact
 * uploaded artifact. Accepts a direct artifact URL (relative
 * /api/artifacts/... or absolute http(s) URL) or an artifactId.
 * Deliberately ignores previewUrl (a low-resolution derivative) and
 * bare filenames (not an identity) — a media tool must condition on
 * the original upload or fail honestly, never on a look-alike.
 */
export function resolveAttachmentArtifactUrl(att: {
  url?: unknown;
  artifactId?: unknown;
  id?: unknown;
}): string | undefined {
  if (typeof att?.url === "string" && att.url.length > 0) {
    if (att.url.startsWith("/") || att.url.startsWith("http://") || att.url.startsWith("https://")) {
      return att.url;
    }
  }
  return (
    canonicalArtifactUrl(att?.artifactId) ?? canonicalArtifactUrl(att?.id) ?? undefined
  );
}
