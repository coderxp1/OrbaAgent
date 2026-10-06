import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Error thrown when a requested path escapes its permitted base directory.
 */
export class PathContainmentError extends Error {
  public readonly code = "PATH_ESCAPE";
  constructor(message = "Requested path escapes the permitted base directory") {
    super(message);
    this.name = "PathContainmentError";
  }
}

/**
 * Resolve an untrusted relative path inside a trusted base directory.
 *
 * Uses `path.relative()` for the containment boundary rather than a string
 * `startsWith()` prefix test. A prefix test is unsafe: with base `/data/uploads`,
 * the sibling path `/data/uploads-evil/x` passes `startsWith("/data/uploads")`
 * because the decoded prefix matches even though the path is outside the base.
 *
 * Rejected inputs:
 * - path segments that are absolute (`/etc/passwd`, `C:\Windows`)
 * - any input that resolves outside `base`, including `../` traversal
 * - sibling paths that merely share a string prefix with `base`
 * - segments containing NUL bytes
 * - percent-encoded traversal (`%2e%2e%2f`), which is decoded before checking
 *
 * @param base  Trusted absolute base directory.
 * @param parts Untrusted path segments (may be URL-encoded).
 * @returns The absolute resolved path, guaranteed to be inside `base`.
 * @throws {PathContainmentError} when the path escapes the base directory.
 */
export function resolveWithinBase(base: string, parts: readonly string[]): string {
  if (!base || !isAbsolute(base)) {
    throw new PathContainmentError("Base directory must be an absolute path");
  }

  const decoded = parts.map((part) => {
    const value = String(part ?? "");
    let out = value;
    try {
      out = decodeURIComponent(value);
    } catch {
      // Malformed percent-encoding: fall back to the raw value and let the
      // containment check below decide.
      out = value;
    }
    if (out.includes("\0")) {
      throw new PathContainmentError("Path segment contains a NUL byte");
    }
    return out;
  });

  // Reject absolute segments outright. `path.join` would silently treat these
  // as relative, which hides an escape attempt rather than reporting it.
  for (const segment of decoded) {
    if (isAbsolute(segment)) {
      throw new PathContainmentError("Absolute path segments are not permitted");
    }
  }

  const baseResolved = resolve(base);
  const target = resolve(baseResolved, ...decoded);

  if (target === baseResolved) {
    return target;
  }

  const rel = relative(baseResolved, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.startsWith(`..${sep}`)) {
    throw new PathContainmentError();
  }

  return target;
}

/**
 * Non-throwing variant of {@link resolveWithinBase}.
 *
 * @returns The resolved path, or `null` when containment fails.
 */
export function tryResolveWithinBase(base: string, parts: readonly string[]): string | null {
  try {
    return resolveWithinBase(base, parts);
  } catch {
    return null;
  }
}
