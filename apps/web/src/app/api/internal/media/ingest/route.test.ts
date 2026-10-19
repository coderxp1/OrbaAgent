import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

/**
 * Tests for the internal artifact ingest endpoint.
 *
 * The GPU worker runs on a different host with no shared filesystem, so it pushes
 * generated artifacts here. This endpoint must NOT reuse the public upload
 * authorization model: it requires a dedicated secret and is inert without one.
 */

const TOKEN = "ingest-token-for-tests-long-enough-123456";

let uploadDir: string;
const savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = [
  "ORBA_UPLOAD_DIR",
  "ORBA_INTERNAL_INGEST_TOKEN",
  "ORBA_TENANT_ID",
  "ORBA_TENANTS",
  "ORBA_MAX_ARTIFACT_BYTES",
] as const;

beforeEach(() => {
  uploadDir = mkdtempSync(join(tmpdir(), "orba-ingest-"));
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.ORBA_UPLOAD_DIR = uploadDir;
  process.env.ORBA_INTERNAL_INGEST_TOKEN = TOKEN;
  process.env.ORBA_TENANT_ID = "test-tenant";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    // Assign rather than delete: every consumer treats an empty value as unset,
    // and `delete process.env.X` is a known de-optimisation.
    process.env[key] = savedEnv[key] ?? "";
  }
  rmSync(uploadDir, { recursive: true, force: true });
});

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function multipart(
  bytes: Uint8Array,
  opts: {
    filename?: string;
    type?: string;
    workspace?: string;
    bundle?: string;
    metadata?: string;
  } = {},
): FormData {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes as BlobPart], opts.filename ?? "artifact.png", {
      type: opts.type ?? "image/png",
    }),
  );
  if (opts.workspace !== undefined) form.append("workspace", opts.workspace);
  if (opts.bundle !== undefined) form.append("bundle", opts.bundle);
  if (opts.metadata !== undefined) form.append("metadata", opts.metadata);
  return form;
}

function post(form: FormData, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== null)
    headers.Authorization = token === undefined ? `Bearer ${TOKEN}` : `Bearer ${token}`;
  return POST(
    new Request("https://orbaagent.dev/api/internal/media/ingest", {
      method: "POST",
      body: form,
      headers,
    }),
  );
}

describe("ingest authorization", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await post(multipart(PNG_BYTES), null);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a wrong token", async () => {
    const res = await post(multipart(PNG_BYTES), "wrong-token-entirely");
    expect(res.status).toBe(403);
  });

  it("rejects a token of the correct length but wrong value", async () => {
    const sameLength = "x".repeat(TOKEN.length);
    const res = await post(multipart(PNG_BYTES), sameLength);
    expect(res.status).toBe(403);
  });

  it("returns 503 and writes nothing when the endpoint is unconfigured", async () => {
    process.env.ORBA_INTERNAL_INGEST_TOKEN = "";
    const res = await post(multipart(PNG_BYTES));
    expect(res.status).toBe(503);
    expect(readdirSync(uploadDir)).toEqual([]);
  });

  it("does not accept the public upload path's authorization model", async () => {
    // No bearer token at all, but a valid-looking body: still refused.
    const res = await post(multipart(PNG_BYTES), null);
    expect(res.status).toBe(401);
    expect(readdirSync(uploadDir)).toEqual([]);
  });

  it("accepts a valid worker token", async () => {
    const res = await post(multipart(PNG_BYTES));
    expect(res.status).toBe(201);
  });
});

describe("ingest validation", () => {
  it("rejects a missing file part", async () => {
    const form = new FormData();
    form.append("workspace", "test-tenant");
    const res = await post(form);
    expect(res.status).toBe(400);
  });

  it("rejects an empty artifact", async () => {
    const res = await post(multipart(new Uint8Array(0)));
    expect(res.status).toBe(400);
  });

  it("rejects oversized artifacts before storing them", async () => {
    // The cap is configurable precisely so this gate is testable without
    // allocating hundreds of megabytes.
    process.env.ORBA_MAX_ARTIFACT_BYTES = "64";
    const res = await post(multipart(new Uint8Array(1024)));
    expect(res.status).toBe(413);
    expect(readdirSync(uploadDir)).toEqual([]);
  });

  it("accepts an artifact exactly at the configured limit", async () => {
    process.env.ORBA_MAX_ARTIFACT_BYTES = String(PNG_BYTES.byteLength);
    const res = await post(multipart(PNG_BYTES));
    expect(res.status).toBe(201);
  });

  it("rejects content that is not a recognized media type", async () => {
    // Plain ASCII text is not an accepted binary artifact type.
    const text = new TextEncoder().encode("this is just text, not a media artifact");
    const res = await post(multipart(text, { filename: "sneaky.png", type: "image/png" }));
    expect(res.status).toBe(415);
    expect(readdirSync(uploadDir)).toEqual([]);
  });

  it("does not trust the declared MIME type over the actual content", async () => {
    // Declared as PNG but the bytes are a GIF: stored as GIF, not PNG.
    const gif = new TextEncoder().encode("GIF89a-and-then-some-bytes");
    const res = await post(multipart(gif, { filename: "lies.png", type: "image/png" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("image/gif");
    expect(body.name.endsWith(".gif")).toBe(true);
  });

  it("rejects a workspace that does not match this deployment", async () => {
    const res = await post(multipart(PNG_BYTES, { workspace: "other-tenant" }));
    expect(res.status).toBe(403);
    expect(readdirSync(uploadDir)).toEqual([]);
  });

  it("ignores a hostile bundle name and substitutes a safe one", async () => {
    const res = await post(multipart(PNG_BYTES, { bundle: "../../etc" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bundle).not.toContain("..");
    expect(body.bundle).not.toContain("/");

    // Everything stayed inside the upload root.
    const tenantDir = join(uploadDir, "test-tenant");
    const buckets = readdirSync(tenantDir);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toBe(body.bundle);
  });

  it("rejects an unsupported multipart body", async () => {
    const res = await POST(
      new Request("https://orbaagent.dev/api/internal/media/ingest", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ file: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("ingest storage", () => {
  it("stores the artifact under workspace/bundle and returns an artifactId", async () => {
    const res = await post(multipart(PNG_BYTES, { bundle: "job_abc" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.workspace).toBe("test-tenant");
    expect(body.bundle).toBe("job_abc");
    expect(body.size).toBe(PNG_BYTES.byteLength);
    expect(body.type).toBe("image/png");
    expect(typeof body.artifactId).toBe("string");
    expect(body.artifactId.length).toBeGreaterThan(0);

    const stored = join(uploadDir, "test-tenant", "job_abc", body.name);
    expect(existsSync(stored)).toBe(true);
    expect(new Uint8Array(readFileSync(stored))).toEqual(PNG_BYTES);

    // artifactId round-trips to the same location.
    const decoded = JSON.parse(Buffer.from(body.artifactId, "base64url").toString("utf-8"));
    expect(decoded).toEqual({ w: "test-tenant", b: "job_abc", p: body.name });
  });

  it("never exposes a filesystem path in the response", async () => {
    const res = await post(multipart(PNG_BYTES));
    const text = await res.text();
    expect(text).not.toContain(uploadDir);
    expect(text).not.toContain("\\");
    expect(text).not.toContain("/data/uploads");
  });

  it("generates a server-side filename rather than trusting the client", async () => {
    const res = await post(multipart(PNG_BYTES, { filename: "../../../evil.png" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).not.toContain("..");
    expect(body.name).not.toContain("/");
    expect(body.name.endsWith(".png")).toBe(true);
  });

  it("accepts and echoes valid metadata", async () => {
    const res = await post(
      multipart(PNG_BYTES, { metadata: JSON.stringify({ kind: "image", model: "flux" }) }),
    );
    const body = await res.json();
    expect(body.metadata).toEqual({ kind: "image", model: "flux" });
  });

  it("does not fail on unparseable metadata", async () => {
    const res = await post(multipart(PNG_BYTES, { metadata: "{not json" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.metadata).toBeUndefined();
  });

  it("accepts an mp4 payload", async () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const res = await post(multipart(mp4, { filename: "clip.mp4", type: "video/mp4" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("video/mp4");
    expect(body.name.endsWith(".mp4")).toBe(true);
  });
});

describe("ingest workspace isolation", () => {
  it("uses the configured workspace from the environment, not the request", async () => {
    process.env.ORBA_TENANT_ID = "tenant-a";
    const res = await post(multipart(PNG_BYTES, { workspace: "tenant-a", bundle: "b1" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workspace).toBe("tenant-a");
    expect(existsSync(join(uploadDir, "tenant-a", "b1"))).toBe(true);
  });

  it("defaults to default-tenant when ORBA_TENANT_ID is unset", async () => {
    process.env.ORBA_TENANT_ID = "";
    const res = await post(multipart(PNG_BYTES, { bundle: "b2" }));
    const body = await res.json();
    expect(body.workspace).toBe("default-tenant");
    expect(existsSync(join(uploadDir, "default-tenant", "b2"))).toBe(true);
  });

  it("refuses a request for a different workspace even when unset locally", async () => {
    process.env.ORBA_TENANT_ID = "";
    const res = await post(multipart(PNG_BYTES, { workspace: "someone-elses-tenant" }));
    expect(res.status).toBe(403);
  });

  it("serves a tenant declared in ORBA_TENANTS and stores the artifact there", async () => {
    process.env.ORBA_TENANT_ID = "default-tenant";
    process.env.ORBA_TENANTS = "acme, globex";
    const res = await post(multipart(PNG_BYTES, { workspace: "acme", bundle: "b3" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workspace).toBe("acme");
    expect(existsSync(join(uploadDir, "acme", "b3"))).toBe(true);
  });

  it("still refuses a tenant that ORBA_TENANTS does not declare", async () => {
    process.env.ORBA_TENANT_ID = "default-tenant";
    process.env.ORBA_TENANTS = "acme";
    const res = await post(multipart(PNG_BYTES, { workspace: "globex" }));
    expect(res.status).toBe(403);
  });

  it("ignores an unsafe workspace in ORBA_TENANTS rather than trusting it", async () => {
    process.env.ORBA_TENANT_ID = "default-tenant";
    process.env.ORBA_TENANTS = "../escape";
    const res = await post(multipart(PNG_BYTES, { workspace: "../escape" }));
    expect(res.status).toBe(403);
  });
});
