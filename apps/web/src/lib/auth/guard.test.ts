import { createHash } from "node:crypto";
import type { CredentialStore } from "@orbaagent/shared";
import { describe, expect, it } from "vitest";
import { authorize, authorizeTenant, resolveIdentityFromSources } from "./guard";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const API_KEY = "orba_sk_live_abc";
const SESSION = "sess_1";

function storeWithCredentials(): CredentialStore {
  const apiKeys = new Map([[API_KEY, { tenantId: "acme", userId: "u7" }]]);
  const sessions = new Map([[SESSION, { tenantId: "acme", userId: "u1" }]]);
  return {
    async findApiKey(presented) {
      return apiKeys.get(presented) ?? null;
    },
    async findSession(presented) {
      return sessions.get(presented) ?? null;
    },
    hasCredentials() {
      return true;
    },
  };
}

const emptyStore: CredentialStore = {
  async findApiKey() {
    return null;
  },
  async findSession() {
    return null;
  },
  hasCredentials() {
    return false;
  },
};

const headers = (auth?: string) => ({
  get: (name: string) => (name.toLowerCase() === "authorization" ? (auth ?? null) : null),
});

const cookies = (value?: string) => ({
  get: (name: string) => (name === "orba_session" && value ? { value } : undefined),
});

describe("resolveIdentityFromSources", () => {
  it("rejects an unauthenticated caller when credentials are configured", async () => {
    const { identity, mode } = await resolveIdentityFromSources(
      { headers: headers() },
      storeWithCredentials(),
      {},
    );
    expect(mode).toBe("required");
    expect(identity.authenticated).toBe(false);
    const rejection = authorize(identity, mode);
    expect(rejection?.status).toBe(401);
  });

  it("rejects an invalid credential", async () => {
    const { identity, mode } = await resolveIdentityFromSources(
      { headers: headers("Bearer orba_sk_wrong") },
      storeWithCredentials(),
      {},
    );
    expect(identity.authenticated).toBe(false);
    expect(authorize(identity, mode)?.status).toBe(401);
  });

  it("accepts a valid API key and resolves its tenant", async () => {
    const { identity, mode } = await resolveIdentityFromSources(
      { headers: headers(`Bearer ${API_KEY}`) },
      storeWithCredentials(),
      {},
    );
    expect(mode).toBe("required");
    expect(identity.authenticated).toBe(true);
    expect(identity.source).toBe("api-key");
    expect(identity.tenantId).toBe("acme");
    expect(authorize(identity, mode)).toBeNull();
  });

  it("accepts a valid session cookie", async () => {
    const { identity, mode } = await resolveIdentityFromSources(
      { headers: headers(), cookies: cookies(SESSION) },
      storeWithCredentials(),
      {},
    );
    expect(identity.authenticated).toBe(true);
    expect(identity.source).toBe("session");
    expect(identity.tenantId).toBe("acme");
    expect(authorize(identity, mode)).toBeNull();
  });

  it("keeps working in permissive mode when no credentials exist", async () => {
    const { identity, mode } = await resolveIdentityFromSources(
      { headers: headers() },
      emptyStore,
      { ORBA_TENANT_ID: "hartmann-core" },
    );
    expect(mode).toBe("permissive");
    expect(identity.tenantId).toBe("hartmann-core");
    expect(authorize(identity, mode)).toBeNull();
  });
});

describe("authorizeTenant", () => {
  it("denies access to another tenant", async () => {
    const { identity } = await resolveIdentityFromSources(
      { headers: headers(`Bearer ${API_KEY}`) },
      storeWithCredentials(),
      {},
    );
    expect(authorizeTenant(identity, "acme")).toBeNull();
    const rejection = authorizeTenant(identity, "victim");
    expect(rejection?.status).toBe(403);
  });

  it("denies an anonymous caller a non-default tenant", async () => {
    const { identity } = await resolveIdentityFromSources({ headers: headers() }, emptyStore, {});
    expect(authorizeTenant(identity, "default-tenant")).toBeNull();
    expect(authorizeTenant(identity, "victim")?.status).toBe(403);
  });
});
