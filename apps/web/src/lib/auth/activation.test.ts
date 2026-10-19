import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSessionToken } from "./session";

/**
 * Activation acceptance test for the protected API surface.
 *
 * Drives the real route handlers with three caller shapes - anonymous, an
 * invalid credential, and a valid one - and checks the four boundaries the
 * activation depends on:
 *
 *   1. anonymous callers are rejected on protected endpoints;
 *   2. invalid credentials are rejected;
 *   3. valid credentials work, and the caller acts in its own tenant;
 *   4. cross-tenant artifact access is denied.
 */

// The route handlers read cookies through next/headers. Outside a request
// scope that throws, so the test provides a controllable cookie jar.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { value: cookieJar.get(name) as string } : undefined,
  }),
}));

const { GET: artifactGet } = await import(
  "../../app/api/artifacts/[workspace]/[bundle]/[...relPath]/route.js"
);
const { POST: uploadPost } = await import("../../app/api/uploads/route.js");
const { GET: mcpGet } = await import("../../app/api/mcp/route.js");
const { GET: profileGet } = await import("../../app/api/user/profile/route.js");
const { POST: sessionPost } = await import("../../app/api/auth/session/route.js");

const API_KEY = "orba_sk_live_activation_test_key";
const TENANT = "acme";
const SECRET = "activation-test-secret-value-32-chars";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

let uploadDir: string;
const savedEnv = { ...process.env };

function authRequest(path: string, apiKey?: string): Request {
  return new Request(`https://orbaagent.dev${path}`, {
    method: "GET",
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
}

function uploadRequest(apiKey?: string): Request {
  const form = new FormData();
  form.append("files", new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" }));
  return new Request("https://orbaagent.dev/api/uploads", {
    method: "POST",
    body: form,
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
}

function artifactCtx(workspace: string, bundle: string, relPath: string[]) {
  return { params: Promise.resolve({ workspace, bundle, relPath }) };
}

beforeEach(() => {
  cookieJar.clear();
  uploadDir = `${process.env.TEMP ?? "/tmp"}/orba-activation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.ORBA_UPLOAD_DIR = uploadDir;
  process.env.ORBA_AUTH_MODE = "required";
  process.env.ORBA_SESSION_SECRET = SECRET;
  process.env.ORBA_TENANT_ID = "";
  process.env.ORBA_TENANTS = "";
  process.env.ORBA_API_KEYS = JSON.stringify({
    [digest(API_KEY)]: { tenantId: TENANT, userId: "u-activation" },
  });
});

afterEach(() => {
  for (const key of [
    "ORBA_UPLOAD_DIR",
    "ORBA_AUTH_MODE",
    "ORBA_SESSION_SECRET",
    "ORBA_TENANT_ID",
    "ORBA_TENANTS",
    "ORBA_API_KEYS",
  ]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  cookieJar.clear();
});

describe("activation acceptance", () => {
  it("rejects an anonymous caller on the upload endpoint", async () => {
    const res = await uploadPost(uploadRequest());
    expect(res.status).toBe(401);
  });

  it("rejects an anonymous caller on the artifact endpoint", async () => {
    const res = await artifactGet(
      authRequest("/api/artifacts/x/y/z.png"),
      artifactCtx(TENANT, "b", ["z.png"]),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an anonymous caller on MCP and on the profile endpoint", async () => {
    expect((await mcpGet(authRequest("/api/mcp") as never)).status).toBe(401);
    expect((await profileGet(authRequest("/api/user/profile") as never)).status).toBe(401);
  });

  it("rejects an invalid credential", async () => {
    const res = await uploadPost(uploadRequest("orba_sk_wrong"));
    expect(res.status).toBe(401);
  });

  it("accepts a valid API key and acts in the caller's own tenant", async () => {
    const res = await uploadPost(uploadRequest(API_KEY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifacts[0].url).toContain(`/api/artifacts/${TENANT}/`);
  });

  it("denies a cross-tenant artifact read", async () => {
    const res = await artifactGet(
      authRequest("/api/artifacts/victim/b/secret.png", API_KEY),
      artifactCtx("victim", "b", ["secret.png"]),
    );
    expect(res.status).toBe(403);
  });

  it("exchanges a credential for a signed session and then serves the caller", async () => {
    const exchange = await sessionPost(
      new Request("https://orbaagent.dev/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ credential: API_KEY }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(exchange.status).toBe(200);
    const setCookie = exchange.headers.get("set-cookie") || "";
    expect(setCookie).toContain("orba_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");

    const token = /orba_session=([^;]+)/.exec(setCookie)?.[1];
    expect(token).toBeTruthy();
    cookieJar.set("orba_session", token as string);

    const res = await profileGet(authRequest("/api/user/profile") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("u-activation");
  });

  it("rejects a session cookie whose payload was tampered with", async () => {
    const token = signSessionToken(SECRET, {
      tenantId: TENANT,
      userId: "u-activation",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    // Swap the tenant in the payload but keep the original signature: the
    // HMAC no longer matches, so the cookie must be refused.
    const [prefix, , signature] = (token as string).split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ t: "victim", u: "u-victim", e: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
    cookieJar.set("orba_session", `${prefix}.${tamperedPayload}.${signature}`);

    const res = await uploadPost(uploadRequest());
    expect(res.status).toBe(401);
  });

  it("rejects a session signed with the wrong secret", async () => {
    const token = signSessionToken("a-completely-different-secret-value", {
      tenantId: TENANT,
      userId: "u-activation",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    cookieJar.set("orba_session", token as string);
    const res = await uploadPost(uploadRequest());
    expect(res.status).toBe(401);
  });

  it("refuses the session exchange for an invalid credential", async () => {
    const exchange = await sessionPost(
      new Request("https://orbaagent.dev/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ credential: "orba_sk_wrong" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(exchange.status).toBe(401);
    expect(exchange.headers.get("set-cookie")).toBeNull();
  });
});
