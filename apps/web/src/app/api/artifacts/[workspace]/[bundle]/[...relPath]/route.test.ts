import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const API_KEY = "orba_sk_live_abc";

let baseDir: string;
const savedEnv = { ...process.env };

function ctx(workspace: string, bundle: string, relPath: string[]) {
  return { params: Promise.resolve({ workspace, bundle, relPath }) };
}

function request(auth?: string): Request {
  return new Request("https://orbaagent.dev/api/artifacts/x/y/z.png", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "orba-artifact-"));
  mkdirSync(join(baseDir, "acme", "bundle"), { recursive: true });
  mkdirSync(join(baseDir, "victim", "bundle"), { recursive: true });
  writeFileSync(join(baseDir, "acme", "bundle", "ok.png"), "acme-bytes");
  writeFileSync(join(baseDir, "victim", "bundle", "secret.png"), "victim-bytes");

  process.env.ORBA_UPLOAD_DIR = baseDir;
  process.env.ORBA_TENANT_ID = "";
  process.env.ORBA_API_KEYS = JSON.stringify({
    [digest(API_KEY)]: { tenantId: "acme", userId: "u7" },
  });
});

afterEach(() => {
  for (const key of ["ORBA_UPLOAD_DIR", "ORBA_TENANT_ID", "ORBA_API_KEYS", "ORBA_SESSIONS"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("GET /api/artifacts/[workspace]/[bundle]/[...relPath]", () => {
  it("serves an artifact to an authenticated caller in its own tenant", async () => {
    const res = await GET(request(`Bearer ${API_KEY}`), ctx("acme", "bundle", ["ok.png"]));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("acme-bytes");
  });

  it("rejects an unauthenticated caller once credentials are configured", async () => {
    const res = await GET(request(), ctx("acme", "bundle", ["ok.png"]));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid credential", async () => {
    const res = await GET(request("Bearer orba_sk_wrong"), ctx("acme", "bundle", ["ok.png"]));
    expect(res.status).toBe(401);
  });

  it("denies cross-tenant artifact access", async () => {
    const res = await GET(request(`Bearer ${API_KEY}`), ctx("victim", "bundle", ["secret.png"]));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("victim-bytes");
  });

  it("denies cross-tenant access even for an anonymous caller in permissive mode", async () => {
    process.env.ORBA_API_KEYS = "";
    const res = await GET(request(), ctx("victim", "bundle", ["secret.png"]));
    expect(res.status).toBe(403);
  });

  it("still serves the deployment tenant when no credentials are configured", async () => {
    process.env.ORBA_API_KEYS = "";
    process.env.ORBA_TENANT_ID = "acme";
    const res = await GET(request(), ctx("acme", "bundle", ["ok.png"]));
    expect(res.status).toBe(200);
  });

  it("rejects a traversal attempt", async () => {
    const res = await GET(
      request(`Bearer ${API_KEY}`),
      ctx("acme", "bundle", ["..", "..", "victim", "bundle", "secret.png"]),
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for a missing file in the caller's own tenant", async () => {
    const res = await GET(request(`Bearer ${API_KEY}`), ctx("acme", "bundle", ["nope.png"]));
    expect(res.status).toBe(404);
  });
});
