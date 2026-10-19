import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_USER_ID,
  deploymentIdentityFromEnv,
  readPresentedApiKey,
  resolveCallerIdentity,
} from "./identity.js";

describe("resolveCallerIdentity", () => {
  it("uses a validated session and marks the caller authenticated", () => {
    const identity = resolveCallerIdentity({
      session: { tenantId: "acme", userId: "u1" },
    });
    expect(identity).toEqual({
      tenantId: "acme",
      userId: "u1",
      authenticated: true,
      source: "session",
    });
  });

  it("prefers the session over a presented API key and over deployment config", () => {
    const identity = resolveCallerIdentity({
      session: { tenantId: "acme", userId: "u1" },
      presentedApiKey: "orba_sk_other",
      lookupApiKey: () => ({ tenantId: "other", userId: "u2" }),
      deployment: { tenantId: "deployment-tenant" },
    });
    expect(identity.tenantId).toBe("acme");
    expect(identity.source).toBe("session");
  });

  it("takes the tenant from the API key RECORD, never from the presented token", () => {
    const identity = resolveCallerIdentity({
      presentedApiKey: "orba_sk_tenant_evil",
      lookupApiKey: (presented) =>
        presented === "orba_sk_tenant_evil" ? null : { tenantId: "acme", userId: "u9" },
    });
    // An unrecognised token must not be able to influence the tenant.
    expect(identity.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(identity.authenticated).toBe(false);
    expect(identity.source).toBe("anonymous");
  });

  it("authenticates a recognised API key using the record's tenant", () => {
    const identity = resolveCallerIdentity({
      presentedApiKey: "orba_sk_live_abc123",
      lookupApiKey: (presented) =>
        presented === "orba_sk_live_abc123" ? { tenantId: "acme", userId: "u7" } : null,
    });
    expect(identity).toEqual({
      tenantId: "acme",
      userId: "u7",
      authenticated: true,
      source: "api-key",
    });
  });

  it("falls back to deployment configuration without claiming authentication", () => {
    const identity = resolveCallerIdentity({
      deployment: { tenantId: "hartmann-core", userId: "paul" },
    });
    expect(identity.tenantId).toBe("hartmann-core");
    expect(identity.userId).toBe("paul");
    expect(identity.authenticated).toBe(false);
    expect(identity.source).toBe("deployment");
  });

  it("falls back to the anonymous default tenant when nothing identifies the caller", () => {
    const identity = resolveCallerIdentity();
    expect(identity.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(identity.userId).toBe(DEFAULT_USER_ID);
    expect(identity.authenticated).toBe(false);
    expect(identity.source).toBe("anonymous");
  });

  it("ignores a client-supplied tenant entirely: the resolver has no input for it", () => {
    // A caller that sets a tenant-shaped header or body field must still be
    // resolved by the server. The resolver simply never accepts one.
    const identity = resolveCallerIdentity({
      // @ts-expect-error - deliberately invalid input: proves the API has no
      // channel through which a client could choose its own tenant.
      clientSuppliedTenantId: "victim-tenant",
    });
    expect(identity.tenantId).toBe(DEFAULT_TENANT_ID);
  });
});

describe("readPresentedApiKey", () => {
  const headers = (value: string | null) => ({
    get: (name: string) => (name.toLowerCase() === "authorization" ? value : null),
  });

  it("reads a bearer token", () => {
    expect(readPresentedApiKey(headers("Bearer orba_sk_live_abc"))).toBe("orba_sk_live_abc");
  });

  it("is case-insensitive about the scheme", () => {
    expect(readPresentedApiKey(headers("bearer orba_sk_live_abc"))).toBe("orba_sk_live_abc");
  });

  it("returns null for a non-bearer scheme", () => {
    expect(readPresentedApiKey(headers("Basic dXNlcjpwYXNz"))).toBeNull();
  });

  it("returns null when there is no authorization header", () => {
    expect(readPresentedApiKey(headers(null))).toBeNull();
  });
});

describe("deploymentIdentityFromEnv", () => {
  it("reads the configured tenant and user", () => {
    expect(deploymentIdentityFromEnv({ ORBA_TENANT_ID: "t1", ORBA_USER_ID: "u1" })).toEqual({
      tenantId: "t1",
      userId: "u1",
    });
  });

  it("returns undefineds when the environment is not configured", () => {
    expect(deploymentIdentityFromEnv({})).toEqual({ tenantId: undefined, userId: undefined });
  });
});
