import { randomUUID } from "node:crypto";
import { GITHUB_STATE_COOKIE } from "@/lib/auth/oauth-state";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub OAuth client ID is not configured on server" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const customRedirect = searchParams.get("redirect_uri");
  const configuredRedirect = process.env.GITHUB_REDIRECT_URI;
  // Cryptographically random, and bound to this browser through an HttpOnly
  // cookie so the callback can prove the flow was started here. A predictable
  // or unbound state would let a third party complete an OAuth flow and bind
  // their account to the victim.
  const state = randomUUID();

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", clientId);

  // When redirect_uri is omitted, GitHub defaults to the callback URL configured in the OAuth App settings.
  // Both canonical (/api/auth/callback/github) and legacy (/api/auth/github/callback) routes are handled.
  const redirectUriToUse = configuredRedirect || customRedirect;
  if (
    redirectUriToUse &&
    redirectUriToUse !== "omit" &&
    redirectUriToUse !== "none" &&
    redirectUriToUse !== "default"
  ) {
    githubAuthUrl.searchParams.set("redirect_uri", redirectUriToUse);
  }

  githubAuthUrl.searchParams.set("scope", "repo read:user user:email");
  githubAuthUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(githubAuthUrl.toString());
  response.cookies.set(GITHUB_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });
  return response;
}
