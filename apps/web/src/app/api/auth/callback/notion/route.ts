import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { NOTION_STATE_COOKIE, statesMatch } from "@/lib/auth/oauth-state";
import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const NOTION_VERSION = "2022-06-28";

function resultPage(ok: boolean, title: string, message: string): NextResponse {
  const type = ok ? "ORBA_NOTION_CONNECTED" : "ORBA_NOTION_ERROR";
  const safeMessage = message.replace(/[<>"\\]/g, "");
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} — OrbaAgent</title>
  <style>
    body { background: #121212; color: #ededed; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; }
    h2 { color: ${ok ? "#4ade80" : "#f87171"}; margin-top: 0; font-size: 18px; }
    p { color: #a1a1aa; font-size: 13px; line-height: 1.5; }
    button { margin-top: 16px; background: #27272a; color: #fff; border: 1px solid #3f3f46; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>${safeMessage}</p>
    <button onclick="window.close()">Close this window</button>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: "${type}", message: "${safeMessage}" }, "*");
    }
  </script>
</body>
</html>`,
    {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

/**
 * Complete the Notion OAuth flow: verify the state binding, exchange the
 * code for an access token, and store the token in an HttpOnly cookie
 * (the same storage pattern as the GitHub connection). The token is
 * never rendered, logged, or returned in a response body.
 */
export async function GET(request: Request) {
  const { identity, mode } = await resolveRequestIdentity(request);
  const unauthenticated = authorize(identity, mode, request);
  if (unauthenticated) return unauthenticated;
  const verifiedUserId = identity.userId;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  if (error || !code) {
    return resultPage(
      false,
      "Notion Connection Incomplete",
      error || "Authorization was cancelled or the code was not provided.",
    );
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(NOTION_STATE_COOKIE)?.value;
  if (!statesMatch(searchParams.get("state"), expectedState)) {
    return resultPage(
      false,
      "Notion Connection Incomplete",
      "OAuth state mismatch. Please start the connection again.",
    );
  }

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_REDIRECT_URI;
  if (!clientId || !clientSecret) {
    return resultPage(
      false,
      "Notion Connection Incomplete",
      "Notion OAuth is not configured on the server.",
    );
  }

  const tokenResp = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    }),
  }).catch(() => null);

  const tokenData = (await tokenResp?.json().catch(() => null)) as any;
  if (!tokenResp || !tokenResp.ok || !tokenData?.access_token) {
    return resultPage(
      false,
      "Notion Connection Incomplete",
      "Notion rejected the authorization code exchange. Please try connecting again.",
    );
  }

  const workspaceName: string = tokenData.workspace_name || "Notion Workspace";
  IntegrationsManager.getInstance().setIntegrationStatus(verifiedUserId, {
    name: "notion",
    displayName: "Notion",
    connected: true,
    accountName: workspaceName,
    lastSyncedAt: new Date().toISOString(),
    scopes: ["read_content", "insert_content", "update_content"],
  });

  const response = resultPage(
    true,
    "Notion Connected",
    `Connected to ${workspaceName}. You can close this window.`,
  );
  response.cookies.set("orba_notion_token", tokenData.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  response.cookies.delete(NOTION_STATE_COOKIE);
  return response;
}
