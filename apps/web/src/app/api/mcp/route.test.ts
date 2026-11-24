import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "./route";

const API_KEY = "orba-mcp-test-key-with-sufficient-entropy";

const originalEnv = {
  ORBA_API_KEYS: process.env.ORBA_API_KEYS,
  ORBA_MCP_ENABLED: process.env.ORBA_MCP_ENABLED,
  ORBA_AUTH_MODE: process.env.ORBA_AUTH_MODE,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  ORBA_WORKSPACE_PATH: process.env.ORBA_WORKSPACE_PATH,
};

function authenticatedHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...extra,
  };
}

function post(body: unknown, headers: Record<string, string> = authenticatedHeaders()) {
  return POST(
    new Request("https://orbaagent.dev/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }) as never,
  );
}

beforeEach(() => {
  const digest = createHash("sha256").update(API_KEY).digest("hex");
  process.env.ORBA_MCP_ENABLED = "true";
  process.env.ORBA_API_KEYS = JSON.stringify({
    [digest]: { tenantId: "mcp-test-tenant", userId: "mcp-test-user" },
  });
  process.env.ORBA_AUTH_MODE = "required";
  process.env.ALLOWED_ORIGINS = "https://orbaagent.dev";
  process.env.ORBA_WORKSPACE_PATH = process.cwd();
});

afterEach(() => {
  process.env.ORBA_API_KEYS = originalEnv.ORBA_API_KEYS ?? "";
  process.env.ORBA_MCP_ENABLED = originalEnv.ORBA_MCP_ENABLED ?? "";
  process.env.ORBA_AUTH_MODE = originalEnv.ORBA_AUTH_MODE ?? "";
  process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS ?? "";
  process.env.ORBA_WORKSPACE_PATH = originalEnv.ORBA_WORKSPACE_PATH ?? "";
});

describe("Orba remote MCP endpoint", () => {
  it("requires an authenticated API key even when application auth is permissive", async () => {
    process.env.ORBA_API_KEYS = "";
    process.env.ORBA_AUTH_MODE = "permissive";
    const response = await post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } },
      {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
    );
    expect(response.status).toBe(401);
  });

  it("negotiates a supported Streamable HTTP protocol version", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.capabilities.tools).toBeDefined();
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("rejects an unsupported protocol version", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2099-01-01" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).error.code).toBe(-32602);
  });

  it("lists the real registered Orba runtime tools", async () => {
    const response = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.length).toBeGreaterThan(0);
    expect(body.result.tools.every((tool: { name: string; inputSchema: unknown }) =>
      typeof tool.name === "string" && tool.inputSchema !== undefined
    )).toBe(true);
  });

  it("returns a JSON-RPC error for unknown tools", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "not_an_orba_tool", arguments: {} },
    });
    expect((await response.json()).error.code).toBe(-32602);
  });

  it("rejects untrusted browser origins", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 4, method: "ping" },
      authenticatedHeaders({ Origin: "https://attacker.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("acknowledges MCP notifications with HTTP 202", async () => {
    const response = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response.status).toBe(202);
  });

  it("requires both MCP response media types in Accept", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 5, method: "ping" },
      authenticatedHeaders({ Accept: "application/json" }),
    );
    expect(response.status).toBe(406);
  });

  it("does not expose a standalone GET event stream or stateful session deletion", async () => {
    const getResponse = await GET();
    const deleteResponse = await DELETE();
    expect(getResponse.status).toBe(405);
    expect(deleteResponse.status).toBe(405);
  });
});
