/**
 * Minimal Notion API client for the Notion connector.
 *
 * Design rules (see the blueprint's connector conventions):
 * - Transport only: no tool/result shaping lives here.
 * - The token is supplied by the caller (resolved from the execution
 *   context / environment by the tool, mirroring the GitHub service
 *   tool). This module never reads process.env and never logs.
 * - Errors are honest: a non-2xx response throws NotionApiError with
 *   the HTTP status and Notion's own error code, so callers can map
 *   them (401 = token invalid/revoked, 404 object_not_found = the
 *   object is not shared with the integration, 429 = rate limited).
 *   Nothing here fabricates data.
 */

export const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";

export class NotionApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

type FetchFn = typeof fetch;

export class NotionClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl: string = NOTION_API_BASE,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const resp = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await resp.json().catch(() => null)) as any;
    if (!resp.ok) {
      throw new NotionApiError(
        resp.status,
        String(data?.code || "unknown_error"),
        String(data?.message || `Notion API request failed with HTTP ${resp.status}`),
      );
    }
    return data as T;
  }

  /** Identity of the integration/bot the token belongs to. Used to
   *  prove a token is live before reporting "connected". */
  me(): Promise<any> {
    return this.request("GET", "/users/me");
  }

  search(body: {
    query?: string;
    filter?: { value: "page" | "database"; property: "object" };
    page_size?: number;
  }): Promise<any> {
    return this.request("POST", "/search", body);
  }

  getPage(pageId: string): Promise<any> {
    return this.request("GET", `/pages/${encodeURIComponent(pageId)}`);
  }

  getBlockChildren(blockId: string, pageSize = 100): Promise<any> {
    return this.request(
      "GET",
      `/blocks/${encodeURIComponent(blockId)}/children?page_size=${pageSize}`,
    );
  }

  queryDatabase(databaseId: string, body: Record<string, unknown> = {}): Promise<any> {
    return this.request("POST", `/databases/${encodeURIComponent(databaseId)}/query`, body);
  }

  createPage(body: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/pages", body);
  }

  updatePage(pageId: string, properties: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/pages/${encodeURIComponent(pageId)}`, {
      properties,
    });
  }
}

/** Resolve the Notion token for a tool execution, mirroring the
 *  GitHub service tool's resolution order: per-request env first,
 *  then the server environment, then a token carried on the trace. */
export function resolveNotionToken(context: {
  env?: Record<string, string>;
  trace?: unknown;
}): string | undefined {
  const traceToken = (context.trace as any)?.notionToken;
  return (
    context.env?.NOTION_API_TOKEN ||
    process.env.NOTION_API_TOKEN ||
    (typeof traceToken === "string" ? traceToken : undefined)
  );
}

/** Rich-text segment in Notion's write format. */
export function richTextSegment(content: string): Record<string, unknown> {
  return { type: "text", text: { content } };
}

/** Title write-format for a page property. */
export function titleProperty(content: string): Record<string, unknown> {
  return { title: [richTextSegment(content)] };
}

/** Extract a page's display title from its properties, if any. */
export function pageTitle(page: any): string {
  const props = page?.properties;
  if (props && typeof props === "object") {
    for (const value of Object.values<any>(props)) {
      if (value?.type === "title" && Array.isArray(value.title)) {
        const text = value.title.map((t: any) => t?.plain_text || "").join("");
        if (text) return text;
      }
    }
  }
  if (page?.object === "database") {
    const title = Array.isArray(page.title)
      ? page.title.map((t: any) => t?.plain_text || "").join("")
      : "";
    if (title) return title;
  }
  return "Untitled";
}

/** Plain-text of a rich_text array. */
export function richTextToPlain(rich: any): string {
  if (!Array.isArray(rich)) return "";
  return rich.map((t: any) => t?.plain_text || "").join("");
}

/** Flatten one Notion property value to a JSON-friendly scalar/shape
 *  for tool output. Unknown types are passed through shallowly. */
export function flattenProperty(value: any): unknown {
  if (!value || typeof value !== "object") return value;
  switch (value.type) {
    case "title":
      return richTextToPlain(value.title);
    case "rich_text":
      return richTextToPlain(value.rich_text);
    case "number":
      return value.number;
    case "select":
      return value.select?.name ?? null;
    case "multi_select":
      return (value.multi_select || []).map((s: any) => s.name);
    case "status":
      return value.status?.name ?? null;
    case "checkbox":
      return value.checkbox;
    case "date":
      return value.date;
    case "url":
      return value.url;
    case "email":
      return value.email;
    case "phone_number":
      return value.phone_number;
    case "people":
      return (value.people || []).map((p: any) => p.name || p.id);
    case "relation":
      return (value.relation || []).map((r: any) => r.id);
    case "formula":
      return value.formula
        ? flattenProperty({
            type: value.formula.type,
            ...value.formula,
            [value.formula.type]: value.formula[value.formula.type],
          })
        : null;
    case "created_time":
      return value.created_time;
    case "last_edited_time":
      return value.last_edited_time;
    default:
      return value[value.type] ?? null;
  }
}

export function flattenProperties(page: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = page?.properties;
  if (props && typeof props === "object") {
    for (const [key, value] of Object.entries(props)) {
      out[key] = flattenProperty(value);
    }
  }
  return out;
}

/** Render block children to plain text (one line per block) for
 *  knowledge-base style reads. Unknown block types are noted, not
 *  silently dropped. */
export function blocksToText(blocks: any[]): string {
  const lines: string[] = [];
  for (const block of blocks || []) {
    const type = block?.type;
    const content = type ? block[type] : undefined;
    const text = richTextToPlain(content?.rich_text);
    switch (type) {
      case "heading_1":
        lines.push(`# ${text}`);
        break;
      case "heading_2":
        lines.push(`## ${text}`);
        break;
      case "heading_3":
        lines.push(`### ${text}`);
        break;
      case "bulleted_list_item":
        lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${text}`);
        break;
      case "to_do":
        lines.push(`- [${content?.checked ? "x" : " "}] ${text}`);
        break;
      case "code":
        lines.push(`\`\`\`${content?.language || ""}\n${text}\n\`\`\``);
        break;
      case "quote":
        lines.push(`> ${text}`);
        break;
      case "divider":
        lines.push("---");
        break;
      case "child_page":
        lines.push(`[page: ${content?.title || "Untitled"}]`);
        break;
      case "paragraph":
        lines.push(text);
        break;
      default:
        if (text) lines.push(text);
        else if (type) lines.push(`[${type} block]`);
    }
  }
  return lines.join("\n");
}

/** Split plain content into Notion paragraph blocks (used when
 *  creating a page from text/markdown-ish content). */
export function textToParagraphBlocks(content: string): Record<string, unknown>[] {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [richTextSegment(line)] },
    }));
}
