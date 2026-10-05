import type { ITool } from "../tools/base.js";
import { EnvironmentInspectTool } from "../tools/environment.js";
import {
  EditFileTool,
  ListFilesTool,
  ReadFileTool,
  WriteFileTool,
} from "../tools/filesystem.js";
import {
  FilesystemCopyTool,
  FilesystemDeleteTool,
  FilesystemMoveTool,
  FilesystemSearchTool,
  FilesystemStatTool,
} from "../tools/filesystemExtended.js";
import { GitTool } from "../tools/git.js";
import { GitHubTool } from "../tools/github.js";
import { ProcessManagerTool } from "../tools/processManager.js";
import { ShellTool } from "../tools/shell.js";
import { TaskCompleteTool } from "../tools/taskComplete.js";
import { WebFetchTool } from "../tools/web.js";
import { BrowserTool } from "../tools/browser.js";
import { PackageManagerTool } from "../tools/packageManager.js";
import { TestRunnerTool } from "../tools/testRunner.js";
import { CodeQualityTool } from "../tools/lintTypecheck.js";
import { ContainerTool } from "../tools/container.js";
import { DatabaseTool } from "../tools/database.js";
import { CITool } from "../tools/ci.js";
import { DeploymentTool } from "../tools/deployment.js";
import { BackgroundJobTool } from "../tools/jobManager.js";
import type { IToolSearchableRegistry } from "../tools/toolsSearch.js";
import { ToolsSearchTool } from "../tools/toolsSearch.js";
import { CapabilitiesInspectTool } from "../capabilities.js";

export class NativeProvider {
  private readonly tools: ITool[] = [];

  constructor(registry?: IToolSearchableRegistry) {
    if (registry) {
      this.tools.push(new ToolsSearchTool(registry));
    }
    this.tools.push(
      new CapabilitiesInspectTool(registry as any),
      new EnvironmentInspectTool(),
      new TaskCompleteTool(),
      new ShellTool(),
      new ListFilesTool(),
      new ReadFileTool(),
      new WriteFileTool(),
      new EditFileTool(),
      new FilesystemSearchTool(),
      new FilesystemStatTool(),
      new FilesystemCopyTool(),
      new FilesystemMoveTool(),
      new FilesystemDeleteTool(),
      new GitTool(),
      new GitHubTool(),
      new ProcessManagerTool(),
      new WebFetchTool(),
      new BrowserTool(),
      new PackageManagerTool(),
      new TestRunnerTool(),
      new CodeQualityTool(),
      new ContainerTool(),
      new DatabaseTool(),
      new CITool(),
      new DeploymentTool(),
      new BackgroundJobTool(),
    );
  }

  public getTools(): ITool[] {
    return [...this.tools];
  }
}
