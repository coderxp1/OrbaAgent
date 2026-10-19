import { createHash } from "node:crypto";
import { MediaImageGenerateTool } from "@orbaagent/agent-runtime";
import { MediaVideoGenerateTool } from "@orbaagent/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end journey for an authorised caller, at the HTTP/route level.
 *
 * login -> profile -> image generation -> video generation -> upload ->
 * artifact retrieval -> logout
 *
 * Every protected leg is driven through the real route handler or the real
 * tool, with only the GPU worker and the LLM gateway replaced by a stub. The
 * chat route itself is not imported here: it depends on
 * "@orbaagent/orchestrator", which is not resolvable in the unit-test
 * environment; its authorization gate is the shared `authorize()` that the
 * other protected routes in this journey exercise.
 */

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { value: cookieJar.get(name) as string } : undefined,
  }),
}));

const { POST: sessionPost, DELETE: sessionDelete } = await import(
  "../../app/api/auth/session/route.js"
);
const { GET: profileGet } = await import("../../app/api/user/profile/route.js");
const { POST: uploadPost } = await import("../../app/api/uploads/route.js");
const { GET: artifactGet } = await import(
  "../../app/api/artifacts/[workspace]/[bundle]/[...relPath]/route.js"
);

const API_KEY = "orba_sk_journey_key";
const TENANT = "acme";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

let uploadDir: string;
let workerBodies: Array<Record<string, unknown>> = [];
const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  cookieJar.clear();
  workerBodies = [];
  uploadDir = `${process.env.TEMP ?? "/tmp"}/orba-journey-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.ORBA_UPLOAD_DIR = uploadDir;
  process.env.ORBA_AUTH_MODE = "required";
  process.env.ORBA_SESSION_SECRET = "journey-test-secret-value-32-chars";
  process.env.ORBA_TENANT_ID = "";
  process.env.ORBA_TENANTS = TENANT;
  process.env.ORBA_API_KEYS = JSON.stringify({
    [digest(API_KEY)]: { tenantId: TENANT, userId: "u-journey" },
  });
  process.env.MEDIA_WORKER_ENABLED = "true";
  process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
  process.env.MEDIA_WORKER_TOKEN = "journey-worker-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of [
    "ORBA_UPLOAD_DIR",
    "ORBA_AUTH_MODE",
    "ORBA_SESSION_SECRET",
    "ORBA_TENANT_ID",
    "ORBA_TENANTS",
    "ORBA_API_KEYS",
    "MEDIA_WORKER_ENABLED",
    "MEDIA_WORKER_URL",
    "MEDIA_WORKER_TOKEN",
  ]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  cookieJar.clear();
});

function stubWorker() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(
        JSON.stringify({
          worker: "healthy",
          status: "ok",
          capabilities: { image_generation: true, video_generation: true },
          generation_backend: "diffusers",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (init?.body) {
      try {
        workerBodies.push(JSON.parse(String(init.body)));
      } catch {
        // ignore non-JSON bodies
      }
    }
    return new Response(
      JSON.stringify({
        jobId: "job_journey",
        status: "COMPLETED",
        artifact_url: `/api/artifacts/${TENANT}/job_journey/clip.mp4`,
        delivered: true,
        model: "test-model",
        kind: "video",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("authorised caller journey", () => {
  it("runs login -> profile -> generation -> upload -> artifact -> logout", async () => {
    // 1. login
    const login = await sessionPost(
      new Request("https://orbaagent.dev/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ credential: API_KEY }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") || "";
    const token = /orba_session=([^;]+)/.exec(setCookie)?.[1];
    expect(token).toBeTruthy();
    cookieJar.set("orba_session", token as string);

    // 2. profile
    const profile = await profileGet(
      new Request("https://orbaagent.dev/api/user/profile") as never,
    );
    expect(profile.status).toBe(200);
    expect((await profile.json()).id).toBe("u-journey");

    // 3. image generation carries the caller's tenant to the worker
    stubWorker();
    const imageTool = new MediaImageGenerateTool();
    const imageResult = await imageTool.execute({ prompt: "a red apple" }, {
      workspaceDir: uploadDir,
      tenantId: TENANT,
      userId: "u-journey",
      agentRunId: "run-1",
    } as never);
    expect(imageResult.success).toBe(true);
    const imageJob = workerBodies.at(-1);
    expect(imageJob?.workspace).toBe(TENANT);

    // 4. video generation likewise
    const videoTool = new MediaVideoGenerateTool();
    const videoResult = await videoTool.execute({ prompt: "a red ball rolling" }, {
      workspaceDir: uploadDir,
      tenantId: TENANT,
      userId: "u-journey",
      agentRunId: "run-1",
    } as never);
    expect(videoResult.success).toBe(true);
    expect(workerBodies.at(-1)?.workspace).toBe(TENANT);

    // 5. upload
    // A browser always sends Origin on a same-origin POST; the CSRF check
    // relies on that, so the test sends it too.
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" }));
    const upload = await uploadPost(
      new Request("https://orbaagent.dev/api/uploads", {
        method: "POST",
        body: form,
        headers: { origin: "https://orbaagent.dev" },
      }),
    );
    expect(upload.status).toBe(200);
    const uploaded = await upload.json();
    const artifactUrl = uploaded.artifacts[0].url as string;
    expect(artifactUrl).toContain(`/api/artifacts/${TENANT}/`);

    // 6. artifact retrieval
    const [, bundle, ...rest] = artifactUrl.split("/api/artifacts/")[1].split("/");
    const artifact = await artifactGet(
      new Request("https://orbaagent.dev" + artifactUrl) as never,
      { params: Promise.resolve({ workspace: TENANT, bundle, relPath: rest }) },
    );
    expect(artifact.status).toBe(200);
    expect((await artifact.text()).length).toBeGreaterThan(0);

    // 7. logout
    const logout = await sessionDelete();
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie") || "").toContain("Max-Age=0");
  });

  it("stops the journey at the first protected leg without a session", async () => {
    const profile = await profileGet(
      new Request("https://orbaagent.dev/api/user/profile") as never,
    );
    expect(profile.status).toBe(401);

    const form = new FormData();
    form.append("files", new File([new Uint8Array([1])], "a.txt", { type: "text/plain" }));
    const upload = await uploadPost(
      new Request("https://orbaagent.dev/api/uploads", { method: "POST", body: form }),
    );
    expect(upload.status).toBe(401);
  });

  it("rejects a cross-tenant artifact read by an authorised caller", async () => {
    const login = await sessionPost(
      new Request("https://orbaagent.dev/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ credential: API_KEY }),
        headers: { "content-type": "application/json" },
      }),
    );
    const token = /orba_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")?.[1];
    cookieJar.set("orba_session", token as string);

    const artifact = await artifactGet(
      new Request("https://orbaagent.dev/api/artifacts/victim/b/secret.png") as never,
      { params: Promise.resolve({ workspace: "victim", bundle: "b", relPath: ["secret.png"] }) },
    );
    expect(artifact.status).toBe(403);
  });
});
