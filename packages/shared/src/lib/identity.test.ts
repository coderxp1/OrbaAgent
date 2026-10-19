import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_USER_ID,
  SESSION_COOKIE_NAME,
  canAccessTenant,
  deploymentIdentityFromEnv,
  readPresentedApiKey,
  readPresentedSession,
  resolveAuthMode,
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

  it("prefers the session over an API key and over deployment config", () => {
    const identity = resolveCallerIdentity({
      session: { tenantId: "acme", userId: "u1" },
      apiKey: { tenantId: "other", userId: "u2" },
      deployment: { tenantId: "deployment-tenant" },
    });
    expect(identity.tenantId).toBe("acme");
    expect(identity.source).toBe("session");
  });

  it("uses the tenant from the API key RECORD, never from the presented token", () => {
    const identity = resolveCallerIdentity({
      // The store resolved this to a record. The presented token itself is
      // never an input to the resolver.
      apiKey: { tenantId: "acme", userId: "u7" },
    });
    expect(identity.tenantId).toBe("acme");
    expect(identity.authenticated).toBe(true);
    expect(identity.source).toBe("api-key");
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

describe("resolveAuthMode", () => {
  it("honours an explicit required mode even without credentials", () => {
    expect(resolveAuthMode({ mode: "required", hasCredentials: false })).toBe("required");
  });

  it("honours an explicit permissive mode even with credentials", () => {
    expect(resolveAuthMode({ mode: "permissive", hasCredentials: true })).toBe("permissive");
  });

  it("fails closed: credentials present without an explicit mode means required", () => {
    expect(resolveAuthMode({ hasCredentials: true })).toBe("required");
  });

  it("stays permissive when no credentials are configured", () => {
    expect(resolveAuthMode({ hasCredentials: false })).toBe("permissive");
  });
});

describe("canAccessTenant", () => {
  const acme = resolveCallerIdentity({ session: { tenantId: "acme", userId: "u1" } });
  const anon = resolveCallerIdentity();

  it("allows a caller into its own tenant", () => {
    expect(canAccessTenant(acme, "acme")).toBe(true);
  });

  it("denies a caller access to another tenant", () => {
    expect(canAccessTenant(acme, "victim")).toBe(false);
  });

  it("denies the anonymous caller every tenant except the default one", () => {
    expect(canAccessTenant(anon, DEFAULT_TENANT_ID)).toBe(true);
    expect(canAccessTenant(anon, "victim")).toBe(false);
  });

  it("denies an empty tenant", () => {
    expect(canAccessTenant(acme, "")).toBe(false);
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

describe("readPresentedSession", () => {
  it("reads the session cookie", () => {
    const cookies = {
      get: (name: string) => (name === SESSION_COOKIE_NAME ? { value: "sess_1" } : undefined),
    };
    expect(readPresentedSession(cookies)).toBe("sess_1");
  });

  it("returns null when the cookie is absent", () => {
    expect(readPresentedSession({ get: () => undefined })).toBeNull();
    expect(readPresentedSession(undefined)).toBeNull();
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
