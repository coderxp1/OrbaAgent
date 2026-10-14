import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaImageGenerateTool } from "./mediaImageGenerate.js";
import { MediaVideoGenerateTool } from "./mediaVideoGenerate.js";
import {
  MEDIA_GENERATION_UNAVAILABLE,
  getMediaWorkerConfig,
  isLazyLoadAllowed,
  isMediaGenerationConfigured,
  unavailableMediaResult,
} from "./mediaWorkerConfig.js";

/**
 * These tests prove media generation does NOT report false success.
 *
 * A previous revision of the GPU worker drew the prompt onto a flat Pillow
 * rectangle and returned `{"status":"COMPLETED"}` while advertising diffusion
 * models it never ran. The tool layer must surface unavailability instead.
 */
const MEDIA_ENV_KEYS = [
  "MEDIA_WORKER_URL",
  "MEDIA_WORKER_TOKEN",
  "MEDIA_WORKER_ENABLED",
  "MEDIA_GENERATION_BACKEND",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of MEDIA_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MEDIA_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const fakeContext = {} as never;

describe("media worker configuration", () => {
  it("is not configured with no environment set", () => {
    const state = getMediaWorkerConfig();
    expect(state.config).toBeNull();
    expect(state.code).toBe(MEDIA_GENERATION_UNAVAILABLE);
    expect(isMediaGenerationConfigured()).toBe(false);
  });

  it("does not supply a default worker URL or token", () => {
    const state = getMediaWorkerConfig();
    expect(state.config?.url).toBeUndefined();
    expect(state.config?.token).toBeUndefined();
    // Guards against reintroducing a hardcoded shared secret.
    expect(JSON.stringify(state)).not.toContain("orbaagent-gpu-worker-auth");
  });

  it("stays disabled when a URL and token are set but ENABLED is not true", () => {
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";
    const state = getMediaWorkerConfig();
    expect(state.config).toBeNull();
    expect(state.code).toBe(MEDIA_GENERATION_UNAVAILABLE);
  });

  it("reports a missing URL when enabled without one", () => {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_TOKEN = "test-token";
    expect(getMediaWorkerConfig().code).toBe("MEDIA_WORKER_URL_NOT_CONFIGURED");
  });

  it("reports a missing token when enabled without one", () => {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
    expect(getMediaWorkerConfig().code).toBe("MEDIA_WORKER_TOKEN_NOT_CONFIGURED");
  });

  it("is configured only when explicitly enabled with both values", () => {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";
    const state = getMediaWorkerConfig();
    expect(state.config).not.toBeNull();
    expect(state.config?.url).toBe("http://127.0.0.1:8190");
    expect(isMediaGenerationConfigured()).toBe(true);
  });
});

describe("unavailableMediaResult shape", () => {
  it("never reports success", () => {
    const result = unavailableMediaResult("tc_1", "media_image_generate", Date.now());
    expect(result.success).toBe(false);
    expect(result.output).toBe("");
  });

  it("uses a sanitized error and UNAVAILABLE status", () => {
    const result = unavailableMediaResult("tc_1", "media_image_generate", Date.now());
    expect(result.error).toMatch(/unavailable/i);
    expect(result.metadata?.status).toBe("UNAVAILABLE");
  });

  it("explains that the backend is not deployed", () => {
    const result = unavailableMediaResult("tc_1", "media_image_generate", Date.now());
    expect(result.error).toMatch(/not been deployed|unavailable/i);
  });
});

describe("media_image_generate does not fabricate success", () => {
  it("returns an unavailable result with no worker configured", async () => {
    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.output).toBe("");
    expect(result.error).toMatch(/unavailable/i);
  });

  it("does not emit a COMPLETED status", async () => {
    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.output).not.toContain("COMPLETED");
    expect(JSON.stringify(result)).not.toContain("COMPLETED");
  });

  it("does not return an artifact path or URL", async () => {
    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(JSON.stringify(result)).not.toContain("artifactPath");
    expect(JSON.stringify(result)).not.toContain("artifactUrl");
  });

  it("still requires a prompt", async () => {
    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "   " }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/prompt is required/i);
  });
});

describe("media_video_generate does not fabricate success", () => {
  it("returns an unavailable result with no worker configured", async () => {
    const tool = new MediaVideoGenerateTool();
    const result = await tool.execute({ prompt: "a fox running" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.output).toBe("");
    expect(result.error).toMatch(/unavailable/i);
  });

  it("does not emit a COMPLETED status or a video path", async () => {
    const tool = new MediaVideoGenerateTool();
    const result = await tool.execute({ prompt: "a fox running" }, fakeContext);

    expect(JSON.stringify(result)).not.toContain("COMPLETED");
    expect(JSON.stringify(result)).not.toContain("outputVideo");
  });

  it("still requires a prompt", async () => {
    const tool = new MediaVideoGenerateTool();
    const result = await tool.execute({ prompt: "" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/prompt is required/i);
  });
});

describe("worker unreachable is reported honestly", () => {
  it("reports WORKER_UNAVAILABLE rather than success when the worker cannot be reached", async () => {
    process.env.MEDIA_WORKER_ENABLED = "true";
    // Reserved TEST-NET-1 address: connections cannot succeed.
    process.env.MEDIA_WORKER_URL = "http://192.0.2.1:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.metadata?.status).toBe("UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("COMPLETED");
  }, 20000);
});

/**
 * Defence in depth against a reachable worker that runs no real model.
 *
 * The shipped worker reported `image_generation: true` merely because a GPU was
 * visible, and answered generation requests with fabricated output. The tool must
 * refuse to proceed unless the worker reports a real generation backend.
 */
describe("reachable worker with no real backend is refused", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockWorker(healthBody: unknown, generateBody: unknown) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(healthBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // A legacy worker would answer the generate call with a fabricated 200.
      return new Response(JSON.stringify(generateBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  function enableWorker() {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";
  }

  it("refuses a worker that reports no image backend even if generate returns 200", async () => {
    enableWorker();
    mockWorker(
      {
        worker: "healthy",
        status: "ok",
        capabilities: { image_generation: false, video_generation: false },
        generation_backend: null,
      },
      { jobId: "fake", status: "COMPLETED", artifactPath: "/output/fake.png" },
    );

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.output).toBe("");
    expect(result.error).toMatch(/unavailable/i);
    expect(result.metadata?.status).toBe("UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("COMPLETED");
    expect(JSON.stringify(result)).not.toContain("artifactPath");
  });

  it("refuses a worker that reports no video backend even if generate returns 200", async () => {
    enableWorker();
    mockWorker(
      {
        worker: "healthy",
        status: "ok",
        capabilities: { image_generation: false, video_generation: false },
        generation_backend: null,
      },
      { jobId: "fake", status: "COMPLETED", outputVideo: "/output/fake.mp4" },
    );

    const tool = new MediaVideoGenerateTool();
    const result = await tool.execute({ prompt: "a fox running" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unavailable/i);
    expect(JSON.stringify(result)).not.toContain("COMPLETED");
    expect(JSON.stringify(result)).not.toContain("outputVideo");
  });

  it("surfaces the reported backend name when refusing", async () => {
    enableWorker();
    mockWorker(
      {
        worker: "healthy",
        status: "ok",
        capabilities: { image_generation: false },
        generation_backend: null,
      },
      { status: "COMPLETED" },
    );

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.error).toMatch(/unavailable/i);
  });
});

/**
 * isLazyLoadAllowed unit tests.
 */
describe("isLazyLoadAllowed", () => {
  it("returns true for a diffusers worker awaiting first request", () => {
    expect(
      isLazyLoadAllowed({
        generation_backend: "diffusers",
        unavailable_reason:
          "Generation backend is configured but no model is loaded yet. The first request loads the weights.",
      }),
    ).toBe(true);
  });

  it("returns false when generation_backend is null", () => {
    expect(
      isLazyLoadAllowed({
        generation_backend: null,
        unavailable_reason:
          "Generation backend is configured but no model is loaded yet. The first request loads the weights.",
      }),
    ).toBe(false);
  });

  it("returns false when generation_backend is not diffusers", () => {
    expect(
      isLazyLoadAllowed({
        generation_backend: "comfyui",
        unavailable_reason:
          "Generation backend is configured but no model is loaded yet. The first request loads the weights.",
      }),
    ).toBe(false);
  });

  it("returns false when unavailable_reason is a different message", () => {
    expect(
      isLazyLoadAllowed({
        generation_backend: "diffusers",
        unavailable_reason:
          "MEDIA_GENERATION_BACKEND is not set; no generation backend is configured.",
      }),
    ).toBe(false);
  });

  it("returns false for null health", () => {
    expect(isLazyLoadAllowed(null)).toBe(false);
  });

  it("returns false when unavailable_reason is null (models already loaded)", () => {
    expect(
      isLazyLoadAllowed({
        generation_backend: "diffusers",
        unavailable_reason: null,
      }),
    ).toBe(false);
  });
});

/**
 * Lazy-loading acceptance: the tools must proceed when the worker has a
 * diffusers backend but has not loaded models yet.
 */
describe("lazy-loading acceptance", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function enableWorker() {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";
  }

  const lazyHealth = {
    worker: "healthy",
    status: "ok",
    capabilities: { image_generation: false, video_generation: false },
    generation_backend: "diffusers",
    unavailable_reason:
      "Generation backend is configured but no model is loaded yet. The first request loads the weights.",
  };

  function mockLazyWorker(generateBody: unknown) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(lazyHealth), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(generateBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  it("allows image generation when worker is in lazy-load state", async () => {
    enableWorker();
    mockLazyWorker({
      jobId: "job_1",
      status: "COMPLETED",
      artifactPath: "/output/test.png",
      model: "flux1-schnell",
    });

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("COMPLETED");
  });

  it("allows video generation when worker is in lazy-load state", async () => {
    enableWorker();
    mockLazyWorker({
      jobId: "job_2",
      status: "COMPLETED",
      outputVideo: "/output/test.mp4",
      model: "wan2.1-t2v-1.3b",
    });

    const tool = new MediaVideoGenerateTool();
    const result = await tool.execute({ prompt: "a fox running" }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("COMPLETED");
  });
});

/**
 * Workers that report model-loading failures must still be rejected.
 */
describe("model-loading failure rejection", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function enableWorker() {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";
  }

  it("rejects a diffusers worker that has a GPU error", async () => {
    enableWorker();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(
          JSON.stringify({
            worker: "healthy",
            status: "ok",
            capabilities: { image_generation: false, video_generation: false },
            generation_backend: "diffusers",
            unavailable_reason: "GPU GPU-xxxx is not available to this worker.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unavailable/i);
  });

  it("rejects a worker with no generation_backend even if unavailable_reason mentions loading", async () => {
    enableWorker();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(
          JSON.stringify({
            worker: "healthy",
            status: "ok",
            capabilities: { image_generation: false },
            generation_backend: null,
            unavailable_reason:
              "Generation backend is configured but no model is loaded yet. The first request loads the weights.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "a red fox" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unavailable/i);
  });
});

describe("artifact delivery verification and honesty", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function enableWorker() {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";
  }

  const readyHealth = {
    worker: "healthy",
    status: "ok",
    capabilities: { image_generation: true, video_generation: true },
    generation_backend: "diffusers",
  };

  it("includes accessible artifactUrl and markdown embed on successful delivery", async () => {
    enableWorker();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(readyHealth), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          jobId: "job_img_123",
          status: "COMPLETED",
          artifact_id: "art_123",
          artifact_url: "/api/artifacts/default-tenant/job_img_123/image.png",
          delivered: true,
          model: "flux1-schnell",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "cyberpunk skyline" }, fakeContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.status).toBe("COMPLETED");
    expect(parsed.artifactUrl).toBe("/api/artifacts/default-tenant/job_img_123/image.png");
    expect(parsed.markdown).toBe(
      "![Generated Image: cyberpunk skyline](/api/artifacts/default-tenant/job_img_123/image.png)",
    );
    expect(parsed.delivered).toBe(true);
  });

  it("reports failure when worker generated artifact but ingest delivery failed", async () => {
    enableWorker();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(readyHealth), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          jobId: "job_img_456",
          status: "COMPLETED",
          artifact_id: "local_art_456",
          artifact_url: "",
          delivered: false,
          ingest_note: "artifact generated but ingest failed: IngestError: 403 Workspace mismatch",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const tool = new MediaImageGenerateTool();
    const result = await tool.execute({ prompt: "cyberpunk skyline" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("artifact delivery to the web application failed");
    expect(result.error).toContain("Workspace mismatch");
  });

  it("includes view video markdown embed on successful video delivery", async () => {
    enableWorker();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(readyHealth), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          jobId: "job_vid_123",
          status: "COMPLETED",
          artifact_id: "vid_art_123",
          artifact_url: "/api/artifacts/default-tenant/job_vid_123/video.mp4",
          delivered: true,
          model: "wan2.1-t2v-1.3b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const tool = new MediaVideoGenerateTool();
    const result = await tool.execute({ prompt: "drone shot of mountains" }, fakeContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.status).toBe("COMPLETED");
    expect(parsed.artifactUrl).toBe("/api/artifacts/default-tenant/job_vid_123/video.mp4");
    expect(parsed.markdown).toBe(
      "[View Generated Video](/api/artifacts/default-tenant/job_vid_123/video.mp4)",
    );
    expect(parsed.delivered).toBe(true);
  });

  it("reports failure when video generation completed but video delivery failed", async () => {
    enableWorker();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(readyHealth), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          jobId: "job_vid_789",
          status: "COMPLETED",
          artifact_id: "local_vid_789",
          artifact_url: "",
          delivered: false,
          ingest_note: "artifact generated but ingest failed: IngestError: 401 Invalid ingest token",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const tool = new MediaVideoGenerateTool();
    const result = await tool.execute({ prompt: "drone shot of mountains" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("artifact delivery to the web application failed");
    expect(result.error).toContain("Invalid ingest token");
  });
});
