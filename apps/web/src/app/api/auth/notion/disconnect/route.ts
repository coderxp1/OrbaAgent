import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { identity, mode } = await resolveRequestIdentity(req);
    const unauthenticated = authorize(identity, mode, req);
    if (unauthenticated) return unauthenticated;
    const verifiedUserId = identity.userId;

    IntegrationsManager.getInstance().setIntegrationStatus(verifiedUserId, {
      name: "notion",
      displayName: "Notion",
      connected: false,
    });

    const cookieStore = await cookies();
    cookieStore.delete("orba_notion_token");

    return NextResponse.json({ success: true, connected: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  await POST(request);
  const url = new URL(request.url);
  const redirect = url.searchParams.get("redirect") || "/app";
  return NextResponse.redirect(new URL(redirect, url.origin));
}
