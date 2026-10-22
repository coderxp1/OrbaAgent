import { randomUUID } from "node:crypto";
import { NOTION_STATE_COOKIE } from "@/lib/auth/oauth-state";
import { NextResponse } from "next/server";

/**
 * Start the Notion OAuth flow (public integration). Mirrors the GitHub
 * authorize route: a random state bound to this browser via an HttpOnly
 * cookie, verified in constant time by the callback.
 */
export async function GET(request: Request) {
  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Notion OAuth client ID is not configured on server" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const redirectUri = process.env.NOTION_REDIRECT_URI || searchParams.get("redirect_uri");
  const state = randomUUID();

  const authUrl = new URL("https://api.notion.com/v1/oauth/authorize");
  authUrl.searchParams.set("owner", "user");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  if (
    redirectUri &&
    redirectUri !== "omit" &&
    redirectUri !== "none" &&
    redirectUri !== "default"
  ) {
    authUrl.searchParams.set("redirect_uri", redirectUri);
  }
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(NOTION_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
