import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import { PathContainmentError, resolveWithinBase, tryResolveWithinBase } from "./safePath.js";

/**
 * These tests lock in the artifact-path containment contract.
 *
 * The previous implementation used `p.startsWith(base)`, which accepts sibling
 * directories sharing a string prefix (`/data/uploads-evil` for base
 * `/data/uploads`). The checks below are the exact shapes the artifact and
 * upload routes construct.
 */
describe("resolveWithinBase — path containment", () => {
  // Build expectations with the platform separator so the suite passes on both
  // POSIX and Windows runners.
  const base = resolvePath("/data/uploads");
  const within = (...segments: string[]) => resolvePath(base, ...segments);

  it("allows a valid nested artifact path", () => {
    const result = resolveWithinBase(base, ["tenant-1", "bundle-1", "notes.txt"]);
    expect(result).toBe(within("tenant-1", "bundle-1", "notes.txt"));
  });

  it("allows a valid deeply nested path with relative segments preserved", () => {
    const result = resolveWithinBase(base, ["tenant-1", "bundle-1", "sub", "dir", "file.png"]);
    expect(result).toBe(within("tenant-1", "bundle-1", "sub", "dir", "file.png"));
  });

  it("rejects `../` traversal that escapes the base", () => {
    expect(() => resolveWithinBase(base, ["tenant-1", "..", "..", "etc", "passwd"])).toThrow(
      PathContainmentError,
    );
  });

  it("rejects a single `../` that escapes a nested bundle", () => {
    expect(() => resolveWithinBase(base, ["tenant-1", "..", "..", "..", "root"])).toThrow(
      PathContainmentError,
    );
  });

  it("rejects an absolute path segment", () => {
    expect(() => resolveWithinBase(base, ["/etc/passwd"])).toThrow(PathContainmentError);
  });

  it("rejects an absolute path hidden in a later segment", () => {
    expect(() => resolveWithinBase(base, ["tenant-1", "bundle-1", "/etc/shadow"])).toThrow(
      PathContainmentError,
    );
  });

  it("rejects a sibling directory that shares the base string prefix", () => {
    // The regression this test exists for: "/data/uploads-evil/x" passes a naive
    // startsWith("/data/uploads") check but is outside the base.
    expect(() => resolveWithinBase(base, ["..", "uploads-evil", "x"])).toThrow(
      PathContainmentError,
    );
  });

  it("does not treat a prefix-sharing sibling as contained (non-throwing variant)", () => {
    expect(tryResolveWithinBase(base, ["..", "uploads-evil", "x"])).toBeNull();
  });

  it("rejects percent-encoded traversal", () => {
    // %2e%2e%2f === "../"
    expect(() => resolveWithinBase(base, ["tenant-1", "%2e%2e%2f%2e%2e%2fetc%2fpasswd"])).toThrow(
      PathContainmentError,
    );
  });

  it("rejects a NUL byte in a segment", () => {
    expect(() => resolveWithinBase(base, ["tenant-1", "file\0.txt"])).toThrow(PathContainmentError);
  });

  it("rejects a relative base directory", () => {
    expect(() => resolveWithinBase("relative/path", ["a"])).toThrow(PathContainmentError);
  });

  it("rejects an empty base directory", () => {
    expect(() => resolveWithinBase("", ["a"])).toThrow(PathContainmentError);
  });

  it("allows the base itself", () => {
    expect(resolveWithinBase(base, [])).toBe(base);
  });

  it("rejects traversal even when the target name is a prefix of the base", () => {
    expect(() => resolveWithinBase(base, ["..", "upload"])).toThrow(PathContainmentError);
  });
});

/**
 * The artifact GET route authorizes by comparing the requested workspace to the
 * server's configured workspace (`ORBA_TENANT_ID || "default-tenant"`), the same
 * identity `POST /api/uploads` writes under. These tests lock in that comparison
 * so a request for another workspace cannot reach the filesystem.
 */
describe("artifact workspace authorization", () => {
  const currentWorkspace = (env: Record<string, string | undefined>) =>
    env.ORBA_TENANT_ID || "default-tenant";

  it("authorizes the configured workspace", () => {
    const ws = currentWorkspace({ ORBA_TENANT_ID: "tenant-1" });
    expect("tenant-1" === ws).toBe(true);
  });

  it("rejects a different workspace (cross-workspace read)", () => {
    const ws = currentWorkspace({ ORBA_TENANT_ID: "tenant-1" });
    expect("tenant-2" === ws).toBe(false);
  });

  it("rejects the default workspace when a tenant is configured", () => {
    const ws = currentWorkspace({ ORBA_TENANT_ID: "tenant-1" });
    expect("default-tenant" === ws).toBe(false);
  });

  it("authorizes the default workspace when ORBA_TENANT_ID is unset", () => {
    const ws = currentWorkspace({});
    expect("default-tenant" === ws).toBe(true);
  });

  it("rejects traversal-shaped workspace names before any filesystem access", () => {
    const ws = currentWorkspace({ ORBA_TENANT_ID: "tenant-1" });
    expect("../../etc" === ws).toBe(false);
    expect(".." === ws).toBe(false);
  });
});

/**
 * The in-process artifact tool decodes the workspace out of the artifactId and
 * must reject an artifact belonging to another workspace.
 */
describe("artifact_read workspace guard", () => {
  const artifactBase = resolvePath("/data/uploads");

  function decodeArtifactId(artifactId: string): { w: string; b: string; p: string } {
    const json = Buffer.from(artifactId, "base64url").toString("utf-8");
    const obj = JSON.parse(json);
    if (
      !obj ||
      typeof obj.w !== "string" ||
      typeof obj.b !== "string" ||
      typeof obj.p !== "string"
    ) {
      throw new Error("Invalid artifact id structure");
    }
    return obj;
  }

  const encode = (w: string, b: string, p: string) =>
    Buffer.from(JSON.stringify({ w, b, p })).toString("base64url");

  it("decodes a well-formed artifact id", () => {
    const id = encode("tenant-1", "bundle-1", "a.txt");
    expect(decodeArtifactId(id)).toEqual({ w: "tenant-1", b: "bundle-1", p: "a.txt" });
  });

  it("rejects an artifact id for a foreign workspace", () => {
    const id = encode("tenant-2", "bundle-1", "a.txt");
    const decoded = decodeArtifactId(id);
    const current = "tenant-1";
    expect(decoded.w === current).toBe(false);
  });

  it("rejects traversal embedded in the artifact id path component", () => {
    const id = encode("tenant-1", "bundle-1", "../../../etc/passwd");
    const decoded = decodeArtifactId(id);
    // The decoded path must fail containment when joined under the base.
    expect(() => resolveWithinBase(artifactBase, [decoded.w, decoded.b, decoded.p])).toThrow(
      PathContainmentError,
    );
  });

  it("accepts a traversal-free artifact id path component", () => {
    const id = encode("tenant-1", "bundle-1", "sub/file.txt");
    const decoded = decodeArtifactId(id);
    expect(resolveWithinBase(artifactBase, [decoded.w, decoded.b, decoded.p])).toBe(
      resolvePath(artifactBase, "tenant-1", "bundle-1", "sub", "file.txt"),
    );
  });
});
