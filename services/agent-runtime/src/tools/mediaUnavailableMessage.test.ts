import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEDIA_GENERATION_UNAVAILABLE,
  publicMediaUnavailableMessage,
  unavailableMediaResult,
} from "./mediaWorkerConfig.js";

const KEYS = ["MEDIA_WORKER_ENABLED", "MEDIA_WORKER_URL", "MEDIA_WORKER_TOKEN"] as const;

describe("media kill-switch: user-facing unavailable result", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = saved[key];
    }
  });

  it("fails immediately with a clear message when MEDIA_WORKER_ENABLED=false", () => {
    process.env.MEDIA_WORKER_ENABLED = "false";
    process.env.MEDIA_WORKER_URL = "http://10.77.0.2:8190";
    process.env.MEDIA_WORKER_TOKEN = "test-token";

    const result = unavailableMediaResult("tc_1", "media_video_generate", Date.now());

    expect(result.success).toBe(false);
    expect(result.output).toBe("");
    expect(result.error).toBe(publicMediaUnavailableMessage("media_video_generate"));
    expect(result.error).toMatch(/^Video generation is temporarily unavailable\./);
    expect(result.error).toMatch(/Existing images and videos are not affected/);
    expect(result.metadata).toEqual({ status: "UNAVAILABLE", code: MEDIA_GENERATION_UNAVAILABLE });
  });

  it("never exposes operator details, hosts or secrets to the user", () => {
    process.env.MEDIA_WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_URL = "http://10.77.0.2:8190";

    const result = unavailableMediaResult(
      "tc_2",
      "media_image_generate",
      Date.now(),
      "health check to http://10.77.0.2:8190 failed",
    );

    expect(result.error).toMatch(/^Image generation is temporarily unavailable\./);
    for (const leak of ["MEDIA_WORKER", "10.77.0.2", "8190", "token", "GPU"]) {
      expect(result.error).not.toContain(leak);
    }
  });
});
