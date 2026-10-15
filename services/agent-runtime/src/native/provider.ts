import { CapabilitiesInspectTool } from "../capabilities.js";
import { ArtifactListTool, ArtifactReadTool } from "../tools/artifacts.js";
import type { ITool } from "../tools/base.js";
import { BrowserTool } from "../tools/browser.js";
import { CITool } from "../tools/ci.js";
import { ContainerTool } from "../tools/container.js";
import { DatabaseTool } from "../tools/database.js";
import { DeploymentTool } from "../tools/deployment.js";
import { EnvironmentInspectTool } from "../tools/environment.js";
import { EditFileTool, ListFilesTool, ReadFileTool, WriteFileTool } from "../tools/filesystem.js";
import {
  FilesystemCopyTool,
  FilesystemDeleteTool,
  FilesystemMoveTool,
  FilesystemSearchTool,
  FilesystemStatTool,
} from "../tools/filesystemExtended.js";
import { GitTool } from "../tools/git.js";
import { GitHubTool } from "../tools/github.js";
import { BackgroundJobTool } from "../tools/jobManager.js";
import { CodeQualityTool } from "../tools/lintTypecheck.js";
import { MediaImageGenerateTool } from "../tools/mediaImageGenerate.js";
import { MediaVideoGenerateTool } from "../tools/mediaVideoGenerate.js";
import { PackageManagerTool } from "../tools/packageManager.js";
import { ProcessManagerTool } from "../tools/processManager.js";
import { ShellTool } from "../tools/shell.js";
import { TaskCompleteTool } from "../tools/taskComplete.js";
import { TaskPlanTool } from "../tools/taskPlanTool.js";
import { TaskStepTool } from "../tools/taskStepTool.js";
import { TestRunnerTool } from "../tools/testRunner.js";
import type { IToolSearchableRegistry } from "../tools/toolsSearch.js";
import { ToolsSearchTool } from "../tools/toolsSearch.js";
import { WebFetchTool } from "../tools/web.js";

export class NativeProvider {
  private readonly tools: ITool[] = [];

  constructor(registry?: IToolSearchableRegistry) {
    if (registry) {
      this.tools.push(new ToolsSearchTool(registry));
    }
    this.tools.push(
      new CapabilitiesInspectTool(registry as any),
      new EnvironmentInspectTool(),
      new TaskPlanTool(),
      new TaskStepTool(),
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
      new ArtifactListTool(),
      new ArtifactReadTool(),
      new MediaImageGenerateTool(),
      new MediaVideoGenerateTool(),
    );
  }

  public getTools(): ITool[] {
    return [...this.tools];
  }
}
