import type { ToolDefinition, ToolExecutionResult } from "@orbaagent/shared";
import type { ITool, ToolExecutionContext } from "./base.js";

export class GitHubTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "github_inspect",
    description:
      "Inspect a GitHub repository, branches, commits, or files directly via GitHub REST API.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["inspect_repo", "list_branches", "list_commits", "read_file_content"],
          description: "GitHub API inspection action.",
        },
        ownerRepo: {
          type: "string",
          description: "Repository owner/name (e.g. 'coderxp1/the-infected' or GitHub URL).",
        },
        filePath: {
          type: "string",
          description: "File path in repository (for read_file_content).",
        },
        ref: {
          type: "string",
          description: "Branch or commit ref (default 'main' or 'master').",
        },
      },
      required: ["action", "ownerRepo"],
    },
  };

  private parseOwnerRepo(input: string): { owner: string; repo: string } {
    let clean = input.trim();
    clean = clean.replace(/^https?:\/\/github\.com\//i, "");
    clean = clean.replace(/\.git$/i, "");
    clean = clean.replace(/\/$/, "");
    const parts = clean.split("/");
    if (parts.length < 2) {
      throw new Error(
        `Invalid GitHub repository identifier: '${input}'. Format must be 'owner/repo'.`,
      );
    }
    return { owner: parts[0], repo: parts[1] };
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = (args._toolCallId as string) || `tc_gh_${Date.now()}`;
    const action = String(args.action || "inspect_repo");
    const ownerRepoStr = String(args.ownerRepo || "");

    try {
      const { owner, repo } = this.parseOwnerRepo(ownerRepoStr);
      const token = context.githubToken || process.env.GITHUB_TOKEN;

      const headers: Record<string, string> = {
        "User-Agent": "OrbaAgent-Runtime/0.1.0",
        Accept: "application/vnd.github.v3+json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      let apiUrl = "";
      switch (action) {
        case "inspect_repo":
          apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
          break;
        case "list_branches":
          apiUrl = `https://api.github.com/repos/${owner}/${repo}/branches`;
          break;
        case "list_commits":
          apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=10`;
          break;
        case "read_file_content": {
          const pathStr = String(args.filePath || "");
          const ref = args.ref ? `?ref=${args.ref}` : "";
          apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathStr}${ref}`;
          break;
        }
        default:
          throw new Error(`Unsupported GitHub action: '${action}'`);
      }

      const response = await fetch(apiUrl, { headers });
      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown GitHub API error");
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `GitHub API error (${response.status}) for ${owner}/${repo}: ${errText}`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      const data = await response.json();

      let summary = "";
      if (action === "inspect_repo") {
        summary = `Repository: ${data.full_name}\nDescription: ${data.description || "N/A"}\nDefault Branch: ${data.default_branch}\nStars: ${data.stargazers_count}\nOpen Issues: ${data.open_issues_count}\nURL: ${data.html_url}`;
      } else if (action === "list_branches") {
        summary = `Branches for ${owner}/${repo}:\n${data.map((b: { name: string }) => `- ${b.name}`).join("\n")}`;
      } else if (action === "list_commits") {
        summary = `Recent Commits for ${owner}/${repo}:\n${data
          .map(
            (c: { sha: string; commit: { message: string; author: { name: string } } }) =>
              `- ${c.sha.slice(0, 7)}: ${c.commit.message.split("\n")[0]} (${c.commit.author.name})`,
          )
          .join("\n")}`;
      } else if (action === "read_file_content") {
        if (data.encoding === "base64" && data.content) {
          const decoded = Buffer.from(data.content, "base64").toString("utf-8");
          summary = `File: ${data.path}\nSize: ${data.size} bytes\n\nContent:\n${decoded}`;
        } else {
          summary = JSON.stringify(data, null, 2);
        }
      }

      return {
        toolCallId,
        name: this.definition.name,
        success: true,
        output: summary,
        executionTimeMs: Date.now() - startTime,
        metadata: { owner, repo, action },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: msg,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
