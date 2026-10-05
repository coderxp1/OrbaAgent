import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { NextResponse } from "next/server";

export async function POST() {
  const verifiedUserId = process.env.ORBA_USER_ID || "authenticated-user";
  const manager = IntegrationsManager.getInstance();

  manager.setIntegrationStatus(verifiedUserId, {
    name: "github",
    displayName: "GitHub",
    connected: false,
    accountName: undefined,
    lastSyncedAt: undefined,
  });

  process.env.GITHUB_TOKEN = "";

  const response = NextResponse.json({ success: true, message: "Disconnected GitHub" });
  response.cookies.delete("orba_github_token");
  return response;
}
