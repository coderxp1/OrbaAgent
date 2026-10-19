/**
 * Caller identity, tenant authorization and credential resolution.
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

/** Cookie carrying the session token for browser clients. */
export const SESSION_COOKIE_NAME = "orba_session";

/** How the caller's identity was established. */
export type IdentitySource = "session" | "api-key" | "deployment" | "anonymous";

/** Whether protected routes must reject unauthenticated callers. */
export type AuthMode = "required" | "permissive";

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
  /** Server-validated API key record, if any. */
  apiKey?: ApiKeyIdentity | null;
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
 * Only rules 1 and 2 produce an `authenticated` identity. The resolver has no
 * parameter through which a caller could nominate its own tenant.
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

  const apiKey = input.apiKey;
  if (apiKey?.tenantId) {
    return {
      tenantId: apiKey.tenantId,
      userId: apiKey.userId || apiKey.tenantId,
      authenticated: true,
      source: "api-key",
    };
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

/**
 * Decide whether protected routes must reject unauthenticated callers.
 *
 * An explicit mode always wins. Otherwise the mode is derived: as soon as the
 * deployment holds any credential, authentication becomes mandatory. A
 * half-configured deployment (credentials present but enforcement switched off)
 * is not representable, so it cannot silently accept anonymous traffic.
 */
export function resolveAuthMode(input: {
  mode?: AuthMode | undefined;
  hasCredentials: boolean;
}): AuthMode {
  if (input.mode === "required" || input.mode === "permissive") return input.mode;
  return input.hasCredentials ? "required" : "permissive";
}

/**
 * Whether a caller may act inside a tenant.
 *
 * The rule is the same for every mode: a request may only touch the tenant
 * that the caller's identity resolved to. In permissive mode that tenant is
 * the deployment workspace, so single-tenant deployments keep working
 * unchanged while cross-tenant reads are still refused.
 */
export function canAccessTenant(identity: CallerIdentity, tenantId: string): boolean {
  if (!tenantId) return false;
  return identity.tenantId === tenantId;
}

/** Minimal read-only view of a headers collection. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Read the bearer token the caller presented.
 *
 * The returned value is only an opaque lookup key. It never determines the
 * tenant on its own: the server resolves it to a record, and the tenant comes
 * from that record.
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

/** Minimal read-only view of a cookie collection. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * Read the session token the caller presented.
 *
 * @returns The presented session token, or `null` when there is none.
 */
export function readPresentedSession(
  cookies: CookieReader | undefined,
  name: string = SESSION_COOKIE_NAME,
): string | null {
  const value = cookies?.get(name)?.value;
  return value ? value : null;
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

/**
 * Read the authentication mode from configuration.
 *
 * @returns `"required"`, `"permissive"`, or `undefined` when unset, in which
 *          case the mode is derived (credentials present means required).
 */
export function readAuthMode(value: string | undefined): AuthMode | undefined {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "required" || normalized === "permissive") return normalized;
  return undefined;
}

/**
 * Server-side store of credentials.
 *
 * The interface is intentionally narrow so that the environment-backed
 * implementation can later be replaced by the Better Auth / Drizzle store
 * described in ADR-004 without touching the routes.
 */
export interface CredentialStore {
  /** Resolve a presented session token to its identity, or `null`. */
  findSession(presented: string): Promise<SessionIdentity | null>;
  /** Resolve a presented API key to its identity, or `null`. */
  findApiKey(presented: string): Promise<ApiKeyIdentity | null>;
  /** Whether the store holds any credentials at all. */
  hasCredentials(): boolean;
}
