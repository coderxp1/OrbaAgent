import { getCredentialStore } from "@/lib/auth/credentials";
import { signSessionToken } from "@/lib/auth/session";
import { SESSION_TTL_SECONDS, sessionCookieName } from "@/lib/auth/session-cookie";
import { servedWorkspaces } from "@/lib/auth/workspaces";
import { NextResponse } from "next/server";

/**
 * Session exchange and logout.
 *
 * The browser must not hold a reusable secret, so it never keeps an API key.
 * It presents the credential exactly once, over TLS, and receives an HttpOnly
 * cookie holding a *signed assertion* that the server can verify and the
 * browser cannot forge. The credential is discarded immediately and is never
 * written to storage.
 *
 * This endpoint is the only place a raw credential is accepted, and it is
 * deliberately NOT protected: it is the way in.
 */

export async function POST(request: Request) {
  const secret = (process.env.ORBA_SESSION_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Sessions are not configured on this deployment", code: "SESSIONS_DISABLED" },
      { status: 503 },
    );
  }

  let credential = "";
  try {
    const body = (await request.json()) as { credential?: unknown };
    credential = typeof body.credential === "string" ? body.credential.trim() : "";
  } catch {
    credential = "";
  }
  if (!credential) {
    return NextResponse.json({ error: "Missing credential" }, { status: 400 });
  }

  const store = getCredentialStore(process.env);
  const identity = await store.findApiKey(credential);
  if (!identity) {
    // Do not distinguish "unknown credential" from "no such tenant".
    return NextResponse.json(
      { error: "Invalid credential", code: "INVALID_CREDENTIAL" },
      {
        status: 401,
      },
    );
  }

  // A credential may only mint a session for a tenant this deployment
  // actually serves. Without this check a key registered for an unknown
  // workspace would still produce a usable session.
  if (!servedWorkspaces(process.env).has(identity.tenantId)) {
    return NextResponse.json({ error: "Tenant is not served by this deployment" }, { status: 403 });
  }

  const token = signSessionToken(secret, {
    tenantId: identity.tenantId,
    userId: identity.userId,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  if (!token) {
    return NextResponse.json(
      { error: "Session signing is not configured on this deployment", code: "SESSIONS_DISABLED" },
      { status: 503 },
    );
  }

  const response = NextResponse.json({
    success: true,
    tenantId: identity.tenantId,
    userId: identity.userId,
  });
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    // The __Host- prefix is only valid on a Secure cookie, and only in
    // production is the site served over HTTPS.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
