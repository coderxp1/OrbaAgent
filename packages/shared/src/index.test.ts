import { describe, expect, it } from "vitest";
import { HealthResponseSchema, OrbaError } from "./index.js";

describe("Shared Package Tests", () => {
  it("validates healthy health response schema", () => {
    const valid = {
      status: "ok",
      version: "0.1.0",
      commitSha: "abc1234",
      uptime: 42.5,
      timestamp: new Date().toISOString(),
      checks: {
        postgres: "up",
        redis: "up",
      },
    };
    const parsed = HealthResponseSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates degraded/error health response schema", () => {
    const errorState = {
      status: "error",
      version: "0.1.0",
      commitSha: "abc1234",
      uptime: 10.2,
      timestamp: new Date().toISOString(),
      checks: {
        postgres: "down",
        redis: "up",
      },
    };
    const parsed = HealthResponseSchema.safeParse(errorState);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid status in health response", () => {
    const invalid = {
      status: "degraded",
      version: "0.1.0",
      commitSha: "abc1234",
      uptime: 5,
      timestamp: new Date().toISOString(),
    };
    const parsed = HealthResponseSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("instantiates OrbaError with status code and code", () => {
    const err = new OrbaError("Unauthorized access", "UNAUTHORIZED", 401);
    expect(err.message).toBe("Unauthorized access");
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.statusCode).toBe(401);
  });
});
