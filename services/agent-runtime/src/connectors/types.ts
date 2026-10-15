import type { ToolCategory } from "@orbaagent/shared";
import type { ITool } from "../tools/base.js";

export interface IConnector {
  readonly id: string;
  readonly name: string;
  readonly category: ToolCategory;
  readonly isConnected: boolean;
  getTools(): ITool[];
}
