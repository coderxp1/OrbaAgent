import { createHash, timingSafeEqual } from "node:crypto";
import type { ApiKeyIdentity, CredentialStore, SessionIdentity } from "@orbaagent/shared";
import { verifySessionToken } from "./session";

/**
 * Environment-backed credential store.
 *
 * Credentials are configured as JSON maps whose KEYS are the SHA-256 hex
 * digest of the credential itself, so the raw secret is never written to the
 * process configuration:
 *
 *   ORBA_SESSIONS='{"<sha256hex>":{"tenantId":"acme","userId":"u1","expiresAt":"..."}}'
 *   ORBA_API_KEYS='{"<sha256hex>":{"tenantId":"acme","userId":"u1"}}'
 *
 * A presented credential is hashed and compared in constant time against the
 * stored digests. The tenant always comes from the stored record.
 *
 * This is the transitional store described in ADR-004; it is replaced by the
 * Better Auth / Drizzle store without changing the route call sites, because
 * the routes only depend on the `CredentialStore` interface.
 */

/** A configured credential. */
export interface CredentialRecord {
  tenantId: string;
  userId?: string;
  /** ISO timestamp after which the credential is rejected. */
  expiresAt?: string;
  /** When true the credential is rejected even if it is otherwise valid. */
  revoked?: boolean;
}

type CredentialMap = Record<string, CredentialRecord>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function parseMap(raw: string | undefined): CredentialMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CredentialMap;
  } catch {
    return {};
  }
}

/**
 * Find the record whose stored digest matches the presented credential.
 *
 * The configured map is keyed by the SHA-256 hex digest of the credential, so
 * the presented credential is hashed once and compared against the stored
 * digest bytes. The comparison is constant time so that a caller cannot learn
 * a digest byte-by-byte from response timing.
 */
function findByDigest(map: CredentialMap, presented: string): CredentialRecord | null {
  const target = digest(presented);
  let found: CredentialRecord | null = null;
  for (const [key, record] of Object.entries(map)) {
    if (!/^[0-9a-f]{64}$/i.test(key)) continue;
    const candidate = Buffer.from(key, "hex");
    if (candidate.length !== target.length) continue;
    if (timingSafeEqual(candidate, target)) {
      found = record;
    }
  }
  return found;
}

function isUsable(record: CredentialRecord | null, now: number): record is CredentialRecord {
  if (!record || record.revoked) return false;
  if (!record.tenantId) return false;
  if (record.expiresAt) {
    const expiry = Date.parse(record.expiresAt);
    if (Number.isFinite(expiry) && expiry <= now) return false;
  }
  return true;
}

/** Build a credential store from the server environment. */
export function createEnvCredentialStore(
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): CredentialStore {
  const sessions = parseMap(env.ORBA_SESSIONS);
  const apiKeys = parseMap(env.ORBA_API_KEYS);
  // When configured, the deployment also accepts stateless signed session
  // cookies, so a browser can hold a signed assertion instead of a reusable
  // API key. The signing secret never leaves the server.
  const sessionSecret = (env.ORBA_SESSION_SECRET || "").trim();

  const lookup = async (map: CredentialMap, presented: string) => {
    const record = findByDigest(map, presented);
    if (!isUsable(record, now())) return null;
    return { tenantId: record.tenantId, userId: record.userId || record.tenantId };
  };

  return {
    async findSession(presented: string): Promise<SessionIdentity | null> {
      const record = await lookup(sessions, presented);
      if (record) return record;
      if (!sessionSecret) return null;
      const signed = verifySessionToken(sessionSecret, presented, now());
      if (!signed) return null;
      return { tenantId: signed.tenantId, userId: signed.userId };
    },
    async findApiKey(presented: string): Promise<ApiKeyIdentity | null> {
      return lookup(apiKeys, presented);
    },
    hasCredentials(): boolean {
      return (
        Object.keys(sessions).length > 0 ||
        Object.keys(apiKeys).length > 0 ||
        sessionSecret.length > 0
      );
    },
  };
}

let cachedStore: { key: string; store: CredentialStore } | null = null;

/**
 * The process-wide credential store, rebuilt only when the configured
 * credential material changes.
 */
export function getCredentialStore(
  env: Record<string, string | undefined> = process.env,
): CredentialStore {
  const key = `${env.ORBA_SESSIONS || ""}::${env.ORBA_API_KEYS || ""}::${env.ORBA_SESSION_SECRET || ""}`;
  if (cachedStore && cachedStore.key === key) return cachedStore.store;
  const store = createEnvCredentialStore(env);
  cachedStore = { key, store };
  return store;
}

/** Test hook: drop the memoised store. */
export function resetCredentialStoreCache(): void {
  cachedStore = null;
}
