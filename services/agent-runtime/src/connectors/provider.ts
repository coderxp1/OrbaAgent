import type { ToolCategory } from "@orbaagent/shared";
import type { ITool } from "../tools/base.js";
import {
  GitHubServiceTool,
  GoogleWorkspaceServiceTool,
  Microsoft365ServiceTool,
  NotionServiceTool,
  SlackServiceTool,
} from "./services.js";
import type { IConnector } from "./types.js";

export class GenericConnector implements IConnector {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly category: ToolCategory,
    private readonly tools: ITool[],
    private connected = true,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  public setConnected(value: boolean): void {
    this.connected = value;
  }

  public getTools(): ITool[] {
    return this.connected ? this.tools : [];
  }
}

export class GitHubConnector extends GenericConnector {
  constructor(connected = true) {
    super("github", "GitHub", "github", [new GitHubServiceTool()], connected);
  }
}

export class SlackConnector extends GenericConnector {
  constructor(connected = true) {
    super("slack", "Slack", "communication", [new SlackServiceTool()], connected);
  }
}

export class NotionConnector extends GenericConnector {
  constructor(connected = true) {
    super("notion", "Notion", "documents", [new NotionServiceTool()], connected);
  }
}

export class GoogleWorkspaceConnector extends GenericConnector {
  constructor(connected = true) {
    super(
      "google_workspace",
      "Google Workspace",
      "documents",
      [new GoogleWorkspaceServiceTool()],
      connected,
    );
  }
}

export class Microsoft365Connector extends GenericConnector {
  constructor(connected = true) {
    super(
      "microsoft_365",
      "Microsoft 365",
      "communication",
      [new Microsoft365ServiceTool()],
      connected,
    );
  }
}

export class ConnectorProvider {
  private readonly connectors: Map<string, IConnector> = new Map();

  constructor(autoRegisterDefaults = true) {
    if (autoRegisterDefaults) {
      this.registerDefaultConnectors();
    }
  }

  public registerDefaultConnectors(): void {
    this.registerConnector(new GitHubConnector());
    this.registerConnector(new SlackConnector());
    this.registerConnector(new NotionConnector());
    this.registerConnector(new GoogleWorkspaceConnector());
    this.registerConnector(new Microsoft365Connector());
  }

  public registerConnector(connector: IConnector): ITool[] {
    this.connectors.set(connector.id, connector);
    return connector.getTools();
  }

  public getConnector(id: string): IConnector | undefined {
    return this.connectors.get(id);
  }

  public listConnectors(): IConnector[] {
    return Array.from(this.connectors.values());
  }

  public getTools(): ITool[] {
    const allTools: ITool[] = [];
    for (const connector of this.connectors.values()) {
      allTools.push(...connector.getTools());
    }
    return allTools;
  }
}
