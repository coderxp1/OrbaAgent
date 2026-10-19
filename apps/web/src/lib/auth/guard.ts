import {
  type AuthMode,
  type CallerIdentity,
  type CookieReader,
  type CredentialStore,
  type HeaderReader,
  canAccessTenant,
  deploymentIdentityFromEnv,
  readAuthMode,
  readPresentedApiKey,
  readPresentedSession,
  resolveAuthMode,
  resolveCallerIdentity,
} from "@orbaagent/shared";
import { cookies } from "next/headers";
import { getCredentialStore } from "./credentials";

/**
 * Request-scoped identity resolution and route authorization.
 *
 * Every protected route resolves the caller through {@link resolveRequestIdentity}
 * and then passes the result through {@link authorize}. The tenant a request
 * may act in is always the tenant that the caller's identity resolved to, so
 * a caller cannot reach another tenant's artifacts by guessing a path.
 */

/** Where a request's credentials are read from. */
export interface IdentitySources {
  headers: HeaderReader;
  cookies?: CookieReader | undefined;
}

/** The resolved identity plus the policy that applies to the deployment. */
export interface ResolvedRequest {
  identity: CallerIdentity;
  mode: AuthMode;
}

/**
 * Resolve the caller's identity from a request's headers and cookies.
 *
 * Kept free of Next.js request context so it can be unit tested directly.
 */
export async function resolveIdentityFromSources(
  sources: IdentitySources,
  store: CredentialStore,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedRequest> {
  const presentedApiKey = readPresentedApiKey(sources.headers);
  const apiKey = presentedApiKey ? await store.findApiKey(presentedApiKey) : null;

  const presentedSession = readPresentedSession(sources.cookies);
  const session = presentedSession ? await store.findSession(presentedSession) : null;

  const identity = resolveCallerIdentity({
    session,
    apiKey,
    deployment: deploymentIdentityFromEnv(env),
  });

  return {
    identity,
    mode: resolveAuthMode({
      // An explicit ORBA_AUTH_MODE wins; otherwise the mode is derived, and
      // the presence of any credential makes authentication mandatory.
      mode: readAuthMode(env.ORBA_AUTH_MODE),
      hasCredentials: store.hasCredentials(),
    }),
  };
}

/**
 * Resolve the caller's identity for a Next.js route handler.
 */
export async function resolveRequestIdentity(
  request: Request,
  options: {
    store?: CredentialStore | undefined;
    env?: Record<string, string | undefined> | undefined;
  } = {},
): Promise<ResolvedRequest> {
  const env = options.env ?? process.env;
  const store = options.store ?? getCredentialStore(env);

  let cookieStore: CookieReader | undefined;
  try {
    cookieStore = await cookies();
  } catch {
    // Outside a request scope (for example a background invocation) there are
    // no cookies; the request then simply carries no session.
    cookieStore = undefined;
  }

  return resolveIdentityFromSources({ headers: request.headers, cookies: cookieStore }, store, env);
}

/** 401 for a request that must be authenticated but carries no valid credential. */
export function unauthorizedResponse(): Response {
  return Response.json(
    { error: "Authentication required", code: "UNAUTHENTICATED" },
    { status: 401 },
  );
}

/** 403 for a request that is authenticated but not allowed to act here. */
export function forbiddenResponse(): Response {
  return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
}

/**
 * Apply the deployment's authentication policy.
 *
 * @returns `null` when the request may proceed, otherwise the rejection.
 */
export function authorize(identity: CallerIdentity, mode: AuthMode): Response | null {
  if (mode === "required" && !identity.authenticated) {
    return unauthorizedResponse();
  }
  return null;
}

/**
 * Check that a request may act inside the requested tenant.
 *
 * @returns `null` when access is allowed, otherwise the rejection.
 */
export function authorizeTenant(identity: CallerIdentity, tenantId: string): Response | null {
  if (!canAccessTenant(identity, tenantId)) {
    return forbiddenResponse();
  }
  return null;
}
