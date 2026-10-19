/**
 * Caller identity and tenant resolution.
 *
 * OrbaAgent stores every artifact under a tenant-scoped workspace, so the
 * tenant id is a *security boundary*, not a cosmetic label: it decides which
 * files a caller can read and write.
 *
 * This module is the single place where a tenant id may be chosen. The rules
 * are deliberately strict:
 *
 * 1. A tenant id is NEVER taken from client-supplied input. Not from a
 *    header, not from the request body, not from a path segment. The resolver
 *    accepts only records the *server* has already validated (a session
 *    lookup, an API-key lookup, or deployment configuration).
 * 2. A presented credential that the server does not recognise yields an
 *    UNAUTHENTICATED identity; it never yields a guessed tenant.
 * 3. `authenticated` is a fact about the request, not a naming convention.
 *    Today several call sites named a local variable `verifiedTenantId` while
 *    it was really "an env var, or a hardcoded fallback". That is exactly the
 *    ambiguity this module removes.
 *
 * See docs/adr/004-auth-and-identity.md for the full identity design.
 */

/** Workspace used when nothing else identifies a caller. */
export const DEFAULT_TENANT_ID = "default-tenant";

/** User id used when nothing else identifies a caller. */
export const DEFAULT_USER_ID = "authenticated-user";

/** How the caller's identity was established. */
export type IdentitySource = "session" | "api-key" | "deployment" | "anonymous";

/** A server-validated session. */
export interface SessionIdentity {
  tenantId: string;
  userId: string;
}

/** A server-validated API key record. */
export interface ApiKeyIdentity {
  tenantId: string;
  userId: string;
}

/** The resolved identity of a caller. */
export interface CallerIdentity {
  /** Tenant whose workspace the caller operates in. */
  tenantId: string;
  /** User within that tenant. */
  userId: string;
  /** True only when the server validated a credential for this request. */
  authenticated: boolean;
  /** Which rule established the identity. */
  source: IdentitySource;
}

/** Deployment-level identity, taken from server configuration. */
export interface DeploymentIdentity {
  tenantId?: string | undefined;
  userId?: string | undefined;
}

/** Inputs available to the resolver. */
export interface IdentityResolutionInput {
  /** Server-validated session for the request, if any. */
  session?: SessionIdentity | null;
  /** The bearer token the caller presented, if any. */
  presentedApiKey?: string | null;
  /**
   * Server-side lookup for a presented API key. MUST return `null` for
   * unknown keys. The tenant always comes from the returned record, never
   * from the presented token.
   */
  lookupApiKey?: ((presented: string) => ApiKeyIdentity | null) | undefined;
  /** Deployment-level identity from server configuration. */
  deployment?: DeploymentIdentity | undefined;
}

/**
 * Resolve the identity of the caller.
 *
 * Precedence, highest first:
 *   1. a server-validated session
 *   2. a server-validated API key
 *   3. deployment configuration (single-tenant deployment)
 *   4. the anonymous default tenant
 *
 * Only rules 1 and 2 produce an `authenticated` identity.
 */
export function resolveCallerIdentity(input: IdentityResolutionInput = {}): CallerIdentity {
  const session = input.session;
  if (session?.tenantId) {
    return {
      tenantId: session.tenantId,
      userId: session.userId || session.tenantId,
      authenticated: true,
      source: "session",
    };
  }

  const presented = input.presentedApiKey;
  if (presented && input.lookupApiKey) {
    const record = input.lookupApiKey(presented);
    if (record?.tenantId) {
      return {
        tenantId: record.tenantId,
        userId: record.userId || record.tenantId,
        authenticated: true,
        source: "api-key",
      };
    }
  }

  const deployment = input.deployment;
  if (deployment?.tenantId) {
    return {
      tenantId: deployment.tenantId,
      userId: deployment.userId || DEFAULT_USER_ID,
      authenticated: false,
      source: "deployment",
    };
  }

  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: DEFAULT_USER_ID,
    authenticated: false,
    source: "anonymous",
  };
}

/** Minimal read-only view of a headers collection. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Read the bearer token the caller presented.
 *
 * The returned value is only an opaque lookup key. It never determines the
 * tenant on its own: {@link resolveCallerIdentity} uses the server-side
 * record that the key resolves to.
 *
 * @returns The presented token, or `null` when there is no bearer token.
 */
export function readPresentedApiKey(headers: HeaderReader): string | null {
  const raw = headers.get("authorization");
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Deployment identity read from the server environment.
 *
 * Kept separate from {@link resolveCallerIdentity} so that call sites cannot
 * accidentally treat deployment configuration as a validated credential.
 */
export function deploymentIdentityFromEnv(
  env: Record<string, string | undefined> = process.env,
): DeploymentIdentity {
  return {
    tenantId: env.ORBA_TENANT_ID || undefined,
    userId: env.ORBA_USER_ID || undefined,
  };
}
