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
  const state = Math.random().toString(36).substring(2) + Date.now().toString(36);

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

  return NextResponse.redirect(githubAuthUrl.toString());
}

