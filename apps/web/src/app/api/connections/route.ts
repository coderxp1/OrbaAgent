import { IntegrationsManager } from "@orbaagent/agent-runtime";
import type { IntegrationStatus } from "@orbaagent/shared";
import { cookies } from "next/headers";

export async function GET() {
  const verifiedUserId = process.env.ORBA_USER_ID || "authenticated-user";
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

  const integrations = manager.getIntegrations(verifiedUserId);
  return Response.json({
    integrations,
    oauthConfigured: {
      github: Boolean(process.env.GITHUB_CLIENT_ID),
    },
  });
}

export async function POST(request: Request) {
  try {
    const verifiedUserId = process.env.ORBA_USER_ID || "authenticated-user";
    const body = (await request.json()) as { status: IntegrationStatus };
    if (!body || !body.status) {
      return Response.json({ error: "Missing status payload" }, { status: 400 });
    }

    const manager = IntegrationsManager.getInstance();
    manager.setIntegrationStatus(verifiedUserId, body.status);

    if (body.status.name === "github" && !body.status.connected) {
      process.env.GITHUB_TOKEN = "";
      const cookieStore = await cookies();
      cookieStore.delete("orba_github_token");
    }

    return Response.json({ success: true, updated: body.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
