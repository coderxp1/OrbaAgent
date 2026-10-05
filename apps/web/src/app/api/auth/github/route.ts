import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      {
        error: "GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID in server environment.",
      },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const customRedirect = searchParams.get("redirect_uri");

  const url = new URL(request.url);
  const origin = url.origin;
  const redirectUri = customRedirect || `${origin}/api/auth/github/callback`;
  const state = Math.random().toString(36).substring(2) + Date.now().toString(36);

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", clientId);
  githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
  githubAuthUrl.searchParams.set("scope", "repo read:user user:email");
  githubAuthUrl.searchParams.set("state", state);

  return NextResponse.redirect(githubAuthUrl.toString());
}
