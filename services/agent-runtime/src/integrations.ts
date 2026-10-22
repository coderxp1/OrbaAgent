import type { IntegrationName, IntegrationStatus } from "@orbaagent/shared";

export class IntegrationsManager {
  private static instance: IntegrationsManager;
  private readonly userIntegrations: Map<string, Map<IntegrationName, IntegrationStatus>> =
    new Map();

  private constructor() {}

  public static getInstance(): IntegrationsManager {
    if (!IntegrationsManager.instance) {
      IntegrationsManager.instance = new IntegrationsManager();
    }
    return IntegrationsManager.instance;
  }

  getIntegrations(userId: string): IntegrationStatus[] {
    const userMap = this.userIntegrations.get(userId);

    // Default connection status baseline for all supported integrations
    const defaultIntegrations: Record<IntegrationName, IntegrationStatus> = {
      github: {
        name: "github",
        displayName: "GitHub",
        connected: Boolean(process.env.GITHUB_TOKEN), // Auto-detected from server environment or user OAuth
        accountName: process.env.GITHUB_TOKEN ? "OrbaAgent Server Bot" : undefined,
        scopes: ["repo", "read:user"],
      },
      slack: {
        name: "slack",
        displayName: "Slack",
        connected: false,
      },
      notion: {
        name: "notion",
        displayName: "Notion",
        // A configured server token means a connection exists; the web
        // connections route additionally verifies it against the Notion
        // API before reporting connected for OAuth/token-cookie users.
        connected: Boolean(process.env.NOTION_API_TOKEN),
        accountName: process.env.NOTION_API_TOKEN ? "Notion Workspace" : undefined,
        scopes: ["read_content", "insert_content", "update_content"],
      },
      email: {
        name: "email",
        displayName: "Email",
        connected: false,
      },
      gmail: {
        name: "gmail",
        displayName: "Gmail",
        connected: false,
      },
      jira: {
        name: "jira",
        displayName: "Jira",
        connected: false,
      },
      atlassian: {
        name: "atlassian",
        displayName: "Atlassian",
        connected: false,
      },
      linear: {
        name: "linear",
        displayName: "Linear",
        connected: false,
      },
      google_calendar: {
        name: "google_calendar",
        displayName: "Google Calendar",
        connected: false,
      },
      teams: {
        name: "teams",
        displayName: "Microsoft Teams",
        connected: false,
      },
      outlook: {
        name: "outlook",
        displayName: "Outlook",
        connected: false,
      },
      salesforce: {
        name: "salesforce",
        displayName: "Salesforce",
        connected: false,
      },
      asana: {
        name: "asana",
        displayName: "Asana",
        connected: false,
      },
      box: {
        name: "box",
        displayName: "Box",
        connected: false,
      },
      google_drive: {
        name: "google_drive",
        displayName: "Google Drive",
        connected: false,
      },
      sharepoint: {
        name: "sharepoint",
        displayName: "SharePoint & OneDrive",
        connected: false,
      },
      google_workspace: {
        name: "google_workspace",
        displayName: "Google Workspace",
        connected: false,
      },
      microsoft_365: {
        name: "microsoft_365",
        displayName: "Microsoft 365",
        connected: false,
      },
      vercel: {
        name: "vercel",
        displayName: "Vercel",
        connected: false,
      },
      cloudflare: {
        name: "cloudflare",
        displayName: "Cloudflare",
        connected: false,
      },
      supabase: {
        name: "supabase",
        displayName: "Supabase",
        connected: false,
      },
    };

    if (!userMap) {
      return Object.values(defaultIntegrations);
    }

    return Object.keys(defaultIntegrations).map((key) => {
      const name = key as IntegrationName;
      return userMap.get(name) || defaultIntegrations[name];
    });
  }

  setIntegrationStatus(userId: string, status: IntegrationStatus): void {
    let userMap = this.userIntegrations.get(userId);
    if (!userMap) {
      userMap = new Map();
      this.userIntegrations.set(userId, userMap);
    }
    userMap.set(status.name, status);
  }
}
