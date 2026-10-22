import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { IntegrationsManager } from "@orbaagent/agent-runtime";
import type { IntegrationStatus } from "@orbaagent/shared";
import { cookies } from "next/headers";

export async function GET(req: Request) {
  const { identity, mode } = await resolveRequestIdentity(req);
  const unauthenticated = authorize(identity, mode, req);
  if (unauthenticated) return unauthenticated;
  const verifiedUserId = identity.userId;
  const manager = IntegrationsManager.getInstance();

  // Check if session has GitHub OAuth token cookie
  try {
    const cookieStore = await cookies();
    const ghToken = cookieStore.get("orba_github_token")?.value;
    if (ghToken) {
      process.env.GITHUB_TOKEN = ghToken;
      const current = manager.getIntegrations(verifiedUserId).find((i) => i.name === "github");
      if (!current || !current.connected) {
        manager.setIntegrationStatus(verifiedUserId, {
          name: "github",
          displayName: "GitHub",
          connected: true,
          accountName: current?.accountName || "GitHub User",
          lastSyncedAt: new Date().toISOString(),
          scopes: ["repo", "read:user", "user:email"],
        });
      }
    }
  } catch (e) {
    // Ignore cookie read issues
  }

  // Notion: a token cookie alone is NOT treated as proof of connection.
  // Verify it against the Notion API (GET /users/me) and only then mark
  // the integration connected, with the workspace/bot identity the API
  // returns. A rejected token leaves the status disconnected.
  try {
    const cookieStore = await cookies();
    const notionToken = cookieStore.get("orba_notion_token")?.value;
    if (notionToken) {
      const meResp = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
        },
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      if (meResp?.ok) {
        const me = (await meResp.json().catch(() => null)) as any;
        const current = manager.getIntegrations(verifiedUserId).find((i) => i.name === "notion");
        if (!current || !current.connected) {
          manager.setIntegrationStatus(verifiedUserId, {
            name: "notion",
            displayName: "Notion",
            connected: true,
            accountName: me?.name || current?.accountName || "Notion Workspace",
            lastSyncedAt: new Date().toISOString(),
            scopes: ["read_content", "insert_content", "update_content"],
          });
        }
      }
    }
  } catch (e) {
    // Ignore cookie read / verification issues; status stays as-is.
  }

  const integrations = manager.getIntegrations(verifiedUserId);
  return Response.json({
    integrations,
    oauthConfigured: {
      github: Boolean(process.env.GITHUB_CLIENT_ID),
      notion: Boolean(process.env.NOTION_CLIENT_ID),
    },
  });
}

export async function POST(request: Request) {
  try {
    const { identity, mode } = await resolveRequestIdentity(request);
    const unauthenticated = authorize(identity, mode, request);
    if (unauthenticated) return unauthenticated;
    const verifiedUserId = identity.userId;
    const body = (await request.json()) as {
      status: IntegrationStatus;
      token?: string;
    };
    if (!body || !body.status) {
      return Response.json({ error: "Missing status payload" }, { status: 400 });
    }

    const manager = IntegrationsManager.getInstance();

    if (body.status.name === "github") {
      if (body.status.connected && body.token) {
        // Verify GitHub token validity
        let username = body.status.accountName || "GitHub User";
        try {
          const userRes = await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${body.token.trim()}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "OrbaAgent-App",
            },
          });
          if (userRes.ok) {
            const userData = await userRes.json();
            username = userData.login || userData.name || username;
          } else {
            return Response.json(
              { error: "Invalid GitHub token: GitHub API returned unauthorized" },
              { status: 401 },
            );
          }
        } catch (fetchErr) {
          console.warn("Could not verify GitHub token online:", fetchErr);
        }

        body.status.accountName = username;
        process.env.GITHUB_TOKEN = body.token.trim();

        const cookieStore = await cookies();
        cookieStore.set("orba_github_token", body.token.trim(), {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 30, // 30 days
          path: "/",
        });
      } else if (!body.status.connected) {
        process.env.GITHUB_TOKEN = "";
        const cookieStore = await cookies();
        cookieStore.delete("orba_github_token");
      }
    }

    manager.setIntegrationStatus(verifiedUserId, body.status);

    return Response.json({ success: true, updated: body.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
