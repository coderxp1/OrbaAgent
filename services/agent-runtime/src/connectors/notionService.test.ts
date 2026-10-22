import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../tools/base.js";
import { NotionClient } from "./notionClient.js";
import type { NotionApiError } from "./notionClient.js";
import { NotionServiceTool } from "./services.js";

const TOKEN = "ntn_test_secret_token_value";

function createContext(env?: Record<string, string>): ToolExecutionContext {
  return {
    workspaceDir: "/tmp",
    tenantId: "tenant-a",
    userId: "user-test",
    agentRunId: "run-test",
    env,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Empty string is falsy in the tool's token resolution, so stubbing
  // an empty value is equivalent to the variable being unset.
  vi.stubEnv("NOTION_API_TOKEN", "");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("NotionClient", () => {
  it("sends bearer auth and the pinned Notion-Version header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ object: "user", id: "bot-1" }));
    const client = new NotionClient(TOKEN, fetchFn as any);
    await client.me();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/users/me");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers["Notion-Version"]).toBe("2022-06-28");
  });

  it("maps API errors to NotionApiError with status and code", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { object: "error", code: "object_not_found", message: "Could not find page" },
          404,
        ),
      );
    const client = new NotionClient(TOKEN, fetchFn as any);
    await expect(client.getPage("missing")).rejects.toMatchObject({
      name: "NotionApiError",
      status: 404,
      code: "object_not_found",
    } satisfies Partial<NotionApiError>);
  });
});

describe("NotionServiceTool", () => {
  const tool = new NotionServiceTool();

  it("fails honestly when no token is configured (never fabricates data)", async () => {
    const result = await tool.execute({ action: "search", query: "roadmap" }, createContext());
    expect(result.success).toBe(false);
    expect(result.metadata?.status).toBe("NOT_CONNECTED");
    expect(result.output).not.toContain("Engineering Roadmap");
    expect(result.output).not.toContain("page_1");
  });

  it("search returns the API's real results, mapped", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        object: "list",
        results: [
          {
            object: "page",
            id: "abc-123",
            url: "https://www.notion.so/abc-123",
            last_edited_time: "2026-10-01T00:00:00.000Z",
            properties: {
              Name: { type: "title", title: [{ plain_text: "Real Page From API" }] },
            },
          },
        ],
      }),
    ) as any;
    const result = await tool.execute(
      { action: "search", query: "real" },
      createContext({ NOTION_API_TOKEN: TOKEN }),
    );
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "abc-123", title: "Real Page From API" });
    // The request carried the query and the version header.
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ query: "real" });
    expect(init.headers["Notion-Version"]).toBe("2022-06-28");
  });

  it("create_page as a database item posts the database parent and title property", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        object: "page",
        id: "new-1",
        url: "https://www.notion.so/new-1",
        properties: { Name: { type: "title", title: [{ plain_text: "Task A" }] } },
      }),
    ) as any;
    const result = await tool.execute(
      { action: "create_page", database_id: "db-9", title: "Task A" },
      createContext({ NOTION_API_TOKEN: TOKEN }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("new-1");
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.parent).toEqual({ database_id: "db-9" });
    expect(body.properties.Name.title[0].text.content).toBe("Task A");
  });

  it("create_page without any parent is refused with the real reason", async () => {
    globalThis.fetch = vi.fn() as any;
    const result = await tool.execute(
      { action: "create_page", title: "Orphan" },
      createContext({ NOTION_API_TOKEN: TOKEN }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires a parent");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("object_not_found surfaces the not-shared hint", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { object: "error", code: "object_not_found", message: "Could not find page" },
          404,
        ),
      ) as any;
    const result = await tool.execute(
      { action: "get_page", page_id: "nope" },
      createContext({ NOTION_API_TOKEN: TOKEN }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not shared with the Notion integration");
  });

  it("never leaks the token into tool output or errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error(`network blew up while using ${TOKEN}`)) as any;
    const result = await tool.execute(
      { action: "search" },
      createContext({ NOTION_API_TOKEN: TOKEN }),
    );
    expect(result.success).toBe(false);
    expect(result.error || "").not.toContain(TOKEN);
    expect(result.output).not.toContain(TOKEN);
  });
});
