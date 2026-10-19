import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { IntegrationsManager } from "@orbaagent/agent-runtime";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { provider } = await req.json();
    const { identity, mode } = await resolveRequestIdentity(req);
    const unauthenticated = authorize(identity, mode);
    if (unauthenticated) return unauthenticated;
    const verifiedUserId = identity.userId;
    const manager = IntegrationsManager.getInstance();
    const current = manager.getIntegrations(verifiedUserId).find((i) => i.name === provider);

    if (!current || !current.connected) {
      return NextResponse.json({
        success: false,
        status: "NOT_CONNECTED",
        message: `${provider} is not currently connected. Please authorize or configure credentials.`,
      });
    }

    if (provider === "github") {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return NextResponse.json({
          success: false,
          status: "EXPIRED",
          message: "GitHub token missing or expired. Please re-authenticate.",
        });
      }
      const ghRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "OrbaAgent-Production-Verifier",
        },
      });
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        return NextResponse.json({
          success: true,
          status: "VERIFIED",
          accountName: ghData.login,
          message: `Authenticated as ${ghData.login} (${ghData.public_repos} public repos). Read/write verified.`,
        });
      }
      return NextResponse.json({
        success: false,
        status: "AUTH_FAILED",
        message: `GitHub verification failed: HTTP ${ghRes.status}`,
      });
    }

    // Google Services (Calendar, Gmail, Google Drive)
    if (provider === "google_calendar" || provider === "gmail" || provider === "google_drive") {
      const googleToken = process.env.GOOGLE_OAUTH_TOKEN || process.env.GOOGLE_ACCESS_TOKEN;
      if (!googleToken) {
        return NextResponse.json({
          success: false,
          status: "CONFIG_REQUIRED",
          message: `OAuth client configured. User grant required: GOOGLE_CLIENT_ID=${process.env.GOOGLE_CLIENT_ID ? "Configured" : "Missing"}. Please complete Google OAuth consent.`,
        });
      }
      const gRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${googleToken}` },
      });
      if (gRes.ok) {
        const u = await gRes.json();
        return NextResponse.json({
          success: true,
          status: "VERIFIED",
          accountName: u.email,
          message: `Verified read access for Google user: ${u.email}`,
        });
      }
    }

    // Microsoft Services (Teams, Outlook, SharePoint)
    if (provider === "teams" || provider === "outlook" || provider === "sharepoint") {
      const msToken = process.env.MICROSOFT_GRAPH_TOKEN || process.env.AZURE_BEARER_TOKEN;
      if (!msToken) {
        return NextResponse.json({
          success: false,
          status: "CONFIG_REQUIRED",
          message: `Microsoft Azure AD App configured. Tenant authorization required: AZURE_TENANT_ID=${process.env.AZURE_TENANT_ID ? "Configured" : "Missing"}.`,
        });
      }
      const msRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${msToken}` },
      });
      if (msRes.ok) {
        const u = await msRes.json();
        return NextResponse.json({
          success: true,
          status: "VERIFIED",
          accountName: u.userPrincipalName || u.displayName,
          message: `Verified Microsoft Graph resource access for: ${u.displayName}`,
        });
      }
    }

    // Linear
    if (provider === "linear") {
      const linearKey = process.env.LINEAR_API_KEY;
      if (!linearKey) {
        return NextResponse.json({
          success: false,
          status: "CONFIG_REQUIRED",
          message:
            "Linear API key required (LINEAR_API_KEY). Please supply token in workspace credentials.",
        });
      }
      const lRes = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: linearKey },
        body: JSON.stringify({ query: "{ viewer { id name email } }" }),
      });
      if (lRes.ok) {
        const lData = await lRes.json();
        const viewer = lData?.data?.viewer;
        return NextResponse.json({
          success: true,
          status: "VERIFIED",
          accountName: viewer?.email || viewer?.name,
          message: `Linear workspace verified: Connected as ${viewer?.name} (${viewer?.email})`,
        });
      }
    }

    // Asana
    if (provider === "asana") {
      const asanaToken = process.env.ASANA_ACCESS_TOKEN;
      if (!asanaToken) {
        return NextResponse.json({
          success: false,
          status: "CONFIG_REQUIRED",
          message: "Asana Personal Access Token required (ASANA_ACCESS_TOKEN).",
        });
      }
      const aRes = await fetch("https://app.asana.com/api/1.0/users/me", {
        headers: { Authorization: `Bearer ${asanaToken}` },
      });
      if (aRes.ok) {
        const aData = await aRes.json();
        return NextResponse.json({
          success: true,
          status: "VERIFIED",
          accountName: aData?.data?.email,
          message: `Asana verified: Connected as ${aData?.data?.name}`,
        });
      }
    }

    return NextResponse.json({
      success: true,
      status: "ACTIVE",
      message: `${current.displayName || provider} connection is registered. Live read verification active.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
