import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_BASE_NAME,
  SESSION_TTL_SECONDS,
  isTrustedOrigin,
  sessionCookieName,
  sessionCookieNames,
} from "./session-cookie";

const request = (method: string, origin?: string, url = "https://orbaagent.dev/api/chat") =>
  new Request(url, {
    method,
    headers: origin ? { origin } : undefined,
  });

describe("session cookie naming", () => {
  it("uses the __Host- prefix in production", () => {
    expect(sessionCookieName({ NODE_ENV: "production" })).toBe(
      `__Host-${SESSION_COOKIE_BASE_NAME}`,
    );
  });

  it("uses the plain name outside production, where the prefix is not allowed", () => {
    expect(sessionCookieName({ NODE_ENV: "development" })).toBe(SESSION_COOKIE_BASE_NAME);
    expect(sessionCookieName({})).toBe(SESSION_COOKIE_BASE_NAME);
  });

  it("accepts both names so a session survives a configuration change", () => {
    expect(sessionCookieNames({ NODE_ENV: "production" })).toEqual([
      `__Host-${SESSION_COOKIE_BASE_NAME}`,
      SESSION_COOKIE_BASE_NAME,
    ]);
  });
});

describe("session lifetime", () => {
  it("is short, because a stateless cookie cannot be revoked", () => {
    expect(SESSION_TTL_SECONDS).toBeLessThanOrEqual(60 * 60);
  });
});

describe("isTrustedOrigin", () => {
  it("accepts any origin for safe methods", () => {
    expect(isTrustedOrigin(request("GET"), {})).toBe(true);
    expect(isTrustedOrigin(request("HEAD", "https://evil.example"), {})).toBe(true);
  });

  it("rejects a state-changing request with no Origin header", () => {
    expect(isTrustedOrigin(request("POST"), {})).toBe(false);
  });

  it("rejects a state-changing request from an unlisted origin", () => {
    expect(
      isTrustedOrigin(request("POST", "https://evil.example"), {
        ALLOWED_ORIGINS: "https://orbaagent.dev",
      }),
    ).toBe(false);
  });

  it("accepts a state-changing request from a listed origin", () => {
    expect(
      isTrustedOrigin(request("POST", "https://orbaagent.dev"), {
        ALLOWED_ORIGINS: "https://orbaagent.dev,https://www.orbaagent.dev",
      }),
    ).toBe(true);
  });

  it("falls back to the request's own origin when no allowlist is configured", () => {
    expect(isTrustedOrigin(request("POST", "https://orbaagent.dev"), {})).toBe(true);
    expect(isTrustedOrigin(request("POST", "https://other.example"), {})).toBe(false);
  });
});
