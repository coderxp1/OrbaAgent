/**
 * Session cookie configuration and the CSRF origin check.
 *
 * The session is a stateless signed assertion. That has one consequence the
 * operator must know: the cookie cannot be revoked before it expires, because
 * the server holds no session state. The TTL is therefore kept short (one
 * hour) so the exposure window of a copied cookie is small, and the client
 * re-authenticates by exchanging the credential again. Real revocation arrives
 * with the stateful session store (ADR-004, Better Auth).
 */

/** Base name of the session cookie. */
export const SESSION_COOKIE_BASE_NAME = "orba_session";

/**
 * How long a session is valid.
 *
 * Short by design: a stateless cookie cannot be revoked, so the TTL *is* the
 * revocation window.
 */
export const SESSION_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Cookie names the server accepts, most specific first.
 *
 * In production the cookie uses the `__Host-` prefix, which browsers only
 * accept when the cookie is Secure, Path=/ and carries no Domain attribute -
 * so a sibling subdomain cannot shadow or overwrite it. Development runs over
 * plain HTTP, where the prefix is not allowed, so the plain name is used there.
 */
export function sessionCookieNames(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const production = (env.NODE_ENV || "").trim() === "production";
  return production
    ? [`__Host-${SESSION_COOKIE_BASE_NAME}`, SESSION_COOKIE_BASE_NAME]
    : [SESSION_COOKIE_BASE_NAME];
}

/** The cookie name to set. */
export function sessionCookieName(env: Record<string, string | undefined> = process.env): string {
  return sessionCookieNames(env)[0];
}

/** Methods that do not change state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request originates from a trusted origin.
 *
 * Only meaningful for state-changing requests. `ALLOWED_ORIGINS` lists the
 * origins the deployment accepts (the web app's own origins); when it is not
 * configured the request's own origin is accepted, which covers a
 * single-origin deployment.
 */
export function isTrustedOrigin(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const origin = request.headers.get("origin");
  if (!origin) {
    // A browser always sends Origin on a state-changing request. A request
    // without one is not a browser request, and browser sessions are the
    // only ones this check is meant to protect.
    return false;
  }

  const configured = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length > 0) {
    return configured.includes(origin);
  }

  try {
    return new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}
