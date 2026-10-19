import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEnvCredentialStore, resetCredentialStoreCache } from "./credentials";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

describe("createEnvCredentialStore", () => {
  it("resolves a configured API key to its tenant", async () => {
    const store = createEnvCredentialStore({
      ORBA_API_KEYS: JSON.stringify({
        [digest("orba_sk_live_abc")]: { tenantId: "acme", userId: "u7" },
      }),
    });
    await expect(store.findApiKey("orba_sk_live_abc")).resolves.toEqual({
      tenantId: "acme",
      userId: "u7",
    });
  });

  it("rejects an unknown API key", async () => {
    const store = createEnvCredentialStore({
      ORBA_API_KEYS: JSON.stringify({ [digest("orba_sk_live_abc")]: { tenantId: "acme" } }),
    });
    await expect(store.findApiKey("orba_sk_live_wrong")).resolves.toBeNull();
  });

  it("rejects a revoked API key", async () => {
    const store = createEnvCredentialStore({
      ORBA_API_KEYS: JSON.stringify({
        [digest("orba_sk_live_abc")]: { tenantId: "acme", revoked: true },
      }),
    });
    await expect(store.findApiKey("orba_sk_live_abc")).resolves.toBeNull();
  });

  it("resolves a session and honours its expiry", async () => {
    const expired = createEnvCredentialStore(
      {
        ORBA_SESSIONS: JSON.stringify({
          [digest("sess_1")]: { tenantId: "acme", userId: "u1", expiresAt: "2020-01-01T00:00:00Z" },
        }),
      },
      () => Date.parse("2026-01-01T00:00:00Z"),
    );
    await expect(expired.findSession("sess_1")).resolves.toBeNull();

    const live = createEnvCredentialStore(
      {
        ORBA_SESSIONS: JSON.stringify({
          [digest("sess_1")]: { tenantId: "acme", userId: "u1", expiresAt: "2030-01-01T00:00:00Z" },
        }),
      },
      () => Date.parse("2026-01-01T00:00:00Z"),
    );
    await expect(live.findSession("sess_1")).resolves.toEqual({ tenantId: "acme", userId: "u1" });
  });

  it("does not accept a credential whose digest is not the stored key", async () => {
    const store = createEnvCredentialStore({
      ORBA_API_KEYS: JSON.stringify({ [digest("orba_sk_live_abc")]: { tenantId: "acme" } }),
    });
    // A credential that merely *contains* a valid key must not match.
    await expect(store.findApiKey("prefix-orba_sk_live_abc")).resolves.toBeNull();
  });

  it("reports whether any credentials are configured", () => {
    expect(createEnvCredentialStore({}).hasCredentials()).toBe(false);
    expect(
      createEnvCredentialStore({
        ORBA_API_KEYS: JSON.stringify({ [digest("k")]: { tenantId: "acme" } }),
      }).hasCredentials(),
    ).toBe(true);
  });

  it("ignores malformed credential configuration", () => {
    const store = createEnvCredentialStore({ ORBA_API_KEYS: "not json" });
    expect(store.hasCredentials()).toBe(false);
    resetCredentialStoreCache();
  });
});
