import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { GITHUB_STATE_COOKIE, statesMatch } from "@/lib/auth/oauth-state";
import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function handleGitHubCallback(request: Request) {
  // This handler exchanges an authorization code and records an integration for
  // the caller, so it is a protected endpoint like the others: in required
  // mode only an authenticated caller may complete a flow.
  const { identity, mode } = await resolveRequestIdentity(request);
  const unauthenticated = authorize(identity, mode, request);
  if (unauthenticated) return unauthenticated;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error || !code) {
    const reason =
      errorDescription || error || "Authorization was cancelled or code was not provided.";
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>GitHub Authorization Failed — OrbaAgent</title>
  <style>
    body { background: #121212; color: #ededed; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; }
    h2 { color: #f87171; margin-top: 0; font-size: 18px; }
    p { color: #a1a1aa; font-size: 13px; line-height: 1.5; }
    button { margin-top: 16px; background: #27272a; color: #fff; border: 1px solid #3f3f46; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h2>GitHub Connection Incomplete</h2>
    <p>${reason}</p>
    <button onclick="window.close()">Close this window</button>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: "ORBA_GITHUB_ERROR", error: "${reason}" }, "*");
    }
  </script>
</body>
</html>`,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_SECRET_ID;

  // The state must match the cookie set when this browser started the flow,
  // otherwise a third party could complete their own flow in this browser.
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GITHUB_STATE_COOKIE)?.value;
  if (!statesMatch(searchParams.get("state"), expectedState)) {
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
  <p>GitHub authorization could not be verified. Please start the connection again from OrbaAgent.</p>
</body>
</html>`,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  if (!clientId || !clientSecret) {
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
  <p>Server error: GitHub OAuth client credentials missing on server.</p>
</body>
</html>`,
      {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  try {
    // 1. Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      const errMsg =
        tokenData.error_description || tokenData.error || "Failed to exchange authorization code";
      return new NextResponse(
        `<!DOCTYPE html>
<html>
<body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
  <p style="color:#f87171;">GitHub OAuth Token Exchange Error: ${errMsg}</p>
</body>
</html>`,
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch authenticated GitHub user information
    let username = "GitHub User";
    let avatarUrl = "";
    try {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "OrbaAgent-App",
        },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        username = userData.login || userData.name || "GitHub User";
        avatarUrl = userData.avatar_url || "";
      }
    } catch (e) {
      console.warn("Failed to fetch GitHub user details:", e);
    }

    // 3. Register connected status with IntegrationsManager
    const { identity } = await resolveRequestIdentity(request);
    const verifiedUserId = identity.userId;
    const manager = IntegrationsManager.getInstance();
    manager.setIntegrationStatus(verifiedUserId, {
      name: "github",
      displayName: "GitHub",
      connected: true,
      accountName: username,
      lastSyncedAt: new Date().toISOString(),
      scopes: ["repo", "read:user", "user:email"],
    });

    // Provide token to runtime environment so tools (git, github API) can use it
    process.env.GITHUB_TOKEN = accessToken;

    // 4. Return success page that notifies window.opener and closes popup
    const response = new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connected to GitHub — OrbaAgent</title>
  <style>
    body {
      background: #111111;
      color: #ededed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #191919;
      border: 1px solid #2d2d2d;
      border-radius: 20px;
      padding: 36px 32px;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .icon-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #10b981;
      margin-bottom: 20px;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
    }
    p {
      color: #a1a1aa;
      font-size: 13px;
      line-height: 1.6;
      margin: 0 0 20px 0;
    }
    .account-tag {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      background: #27272a;
      color: #38bdf8;
      font-family: monospace;
      font-size: 12px;
      margin-bottom: 24px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>
    <h2>GitHub Connected</h2>
    <p>Your workspace is now securely authorized with GitHub.</p>
    <div class="account-tag">@${username}</div>
    <div style="font-size: 12px; color: #71717a;">
      <span class="spinner"></span>Returning to OrbaAgent...
    </div>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({
          type: "ORBA_GITHUB_CONNECTED",
          success: true,
          username: "${username}",
          avatarUrl: "${avatarUrl}"
        }, "*");
        setTimeout(function() {
          window.close();
        }, 1000);
      } else {
        setTimeout(function() {
          window.location.href = "/app?connected=github";
        }, 1200);
      }
    } catch (e) {
      setTimeout(function() {
        window.location.href = "/app?connected=github";
      }, 1200);
    }
  </script>
</body>
</html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );

    // Save token in cookie for persistence across user session
    response.cookies.set("orba_github_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    // The state is single-use: clear it so it cannot be replayed.
    response.cookies.set(GITHUB_STATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
  <p style="color:#f87171;">OAuth exchange failed: ${msg}</p>
</body>
</html>`,
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

export async function GET(request: Request) {
  return handleGitHubCallback(request);
}
