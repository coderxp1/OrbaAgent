import { IntegrationsManager } from "@orbaagent/agent-runtime";
import type { IntegrationStatus } from "@orbaagent/shared";

export async function GET() {
  const verifiedUserId = process.env.ORBA_USER_ID || "authenticated-user";
  const manager = IntegrationsManager.getInstance();
  const integrations = manager.getIntegrations(verifiedUserId);
  return Response.json({ integrations });
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
    return Response.json({ success: true, updated: body.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
