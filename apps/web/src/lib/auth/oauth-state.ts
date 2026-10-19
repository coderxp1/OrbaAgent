import { timingSafeEqual } from "node:crypto";

/**
 * OAuth state binding.
 *
 * The GitHub OAuth flow starts in one request and finishes in another, on a
 * redirect from github.com. The `state` parameter is what proves the callback
 * belongs to the flow this browser started. It must be:
 *
 *   * cryptographically random, so it cannot be guessed or pre-computed;
 *   * stored in an HttpOnly cookie, so the browser is bound to the flow;
 *   * compared in constant time in the callback.
 *
 * Without the cookie binding, a third party could start their own OAuth flow
 * and complete it in a victim's browser, attaching their GitHub account to
 * the victim's session.
 */

/** Cookie that carries the OAuth state between the two legs of the flow. */
export const GITHUB_STATE_COOKIE = "orba_github_state";

/**
 * Compare two state values in constant time.
 *
 * @returns `true` only when both values are present and equal.
 */
export function statesMatch(
  presented: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
