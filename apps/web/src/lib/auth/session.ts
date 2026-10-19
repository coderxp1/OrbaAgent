import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless, signed session tokens.
 *
 * A browser must never hold a long-lived reusable secret. A raw API key in a
 * cookie is exactly that: a bearer credential the browser can replay. Instead
 * the browser holds a *signed assertion* that the server can verify and that
 * the browser cannot forge:
 *
 *   v1.<base64url(payload)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
 *
 * with `payload = {"t": tenantId, "u": userId, "e": expiryEpochSeconds}`.
 *
 * The raw credential is presented exactly once, to exchange it for this
 * cookie, and is then discarded. The signing secret never leaves the server.
 *
 * The HMAC is compared in constant time.
 */

const TOKEN_PREFIX = "v1";

export interface SessionPayload {
  /** Tenant the session acts in. */
  tenantId: string;
  /** User within the tenant. */
  userId: string;
  /** Expiry, seconds since the epoch. */
  expiresAt: number;
}

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(secret: string, signingInput: string): string {
  return createHmac("sha256", secret).update(signingInput, "utf8").digest("base64url");
}

/**
 * Mint a signed session token.
 *
 * @returns The token, or `null` when the secret is too short to be safe.
 */
export function signSessionToken(
  secret: string,
  payload: SessionPayload,
  now: number = Date.now(),
): string | null {
  if (!secret || secret.length < 16) return null;
  const body = { t: payload.tenantId, u: payload.userId, e: payload.expiresAt };
  const encoded = base64urlEncode(JSON.stringify(body));
  const signingInput = `${TOKEN_PREFIX}.${encoded}`;
  return `${signingInput}.${sign(secret, signingInput)}`;
}

/**
 * Verify a signed session token.
 *
 * @returns The payload, or `null` when the token is malformed, forged or
 *          expired.
 */
export function verifySessionToken(
  secret: string,
  token: string,
  now: number = Date.now(),
): SessionPayload | null {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [prefix, encoded, signature] = parts;
  if (prefix !== TOKEN_PREFIX) return null;

  const expected = Buffer.from(sign(secret, `${prefix}.${encoded}`), "base64url");
  const presented = Buffer.from(signature, "base64url");
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return null;
  }

  let payload: { t?: unknown; u?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (typeof payload.t !== "string" || !payload.t) return null;
  if (typeof payload.e !== "number" || !Number.isFinite(payload.e)) return null;
  if (payload.e * 1000 <= now) return null;

  return {
    tenantId: payload.t,
    userId: typeof payload.u === "string" && payload.u ? payload.u : payload.t,
    expiresAt: payload.e,
  };
}
