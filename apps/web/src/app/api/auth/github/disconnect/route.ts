import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const verifiedUserId = process.env.ORBA_USER_ID || "authenticated-user";
    const manager = IntegrationsManager.getInstance();

    manager.setIntegrationStatus(verifiedUserId, {
      name: "github",
      displayName: "GitHub",
      connected: false,
    });

    process.env.GITHUB_TOKEN = "";

    const cookieStore = await cookies();
    cookieStore.delete("orba_github_token");

    return NextResponse.json({ success: true, connected: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // Support GET redirect disconnect for convenience
  await POST();
  const url = new URL(request.url);
  const redirect = url.searchParams.get("redirect") || "/app";
  return NextResponse.redirect(new URL(redirect, url.origin));
}

