import { randomUUID } from "node:crypto";
import { ToolRegistry, ToolRouter } from "@orbaagent/agent-runtime";
import { authorize, resolveRequestIdentity } from "@/lib/auth/guard";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-11-25",
  "2025-03-26",
]);

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const registry = new ToolRegistry();
const router = new ToolRouter({ registry });

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 200,
) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function originIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser MCP clients commonly omit Origin.

  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured.includes(origin);
  try {
    return new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}

function getProtocolVersion(request: Request): string | null {
  const version = request.headers.get("mcp-protocol-version");
  if (!version) return "2025-03-26"; // Streamable HTTP backwards-compatibility default.
  return SUPPORTED_PROTOCOL_VERSIONS.has(version) ? version : null;
}

function getMcpTools() {
  return registry.getAllToolDefinitions().map((definition) => {
    const metadata = registry.getToolMetadata(definition.name);
    const riskTier = metadata?.riskTier ?? "TIER_0_READ";
    return {
      name: definition.name,
      description: metadata?.requiresApproval || riskTier === "TIER_4_DESTRUCTIVE"
        ? `${definition.description} This action requires approval in the Orba workspace and cannot be pre-approved through MCP.`
        : definition.description,
      inputSchema: definition.parameters,
      annotations: {
        readOnlyHint: riskTier === "TIER_0_READ",
        destructiveHint: riskTier === "TIER_4_DESTRUCTIVE",
        openWorldHint: ["http", "browser", "cloud", "communication"].includes(
          metadata?.category ?? "",
        ),
      },
    };
  });
}

async function authenticate(request: Request) {
  const resolved = await resolveRequestIdentity(request);
  const rejected = authorize(resolved.identity, resolved.mode, request);
  if (rejected) return { response: rejected } as const;

  // MCP is an externally reachable tool surface. It must never inherit the
  // application's permissive single-tenant fallback when no credentials exist.
  if (!resolved.identity.authenticated) {
    return {
      response: NextResponse.json(
        { error: "MCP authentication required", code: "UNAUTHENTICATED" },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="orba-mcp"' } },
      ),
    } as const;
  }

  if (!originIsAllowed(request)) {
    return {
      response: NextResponse.json({ error: "Untrusted Origin", code: "FORBIDDEN" }, { status: 403 }),
    } as const;
  }

  return { identity: resolved.identity } as const;
}

export async function GET() {
  // The stateless Streamable HTTP endpoint does not open server-initiated
  // streams. MCP clients should use POST for JSON-RPC requests.
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}

export async function DELETE() {
  // This endpoint is stateless and does not issue MCP session IDs.
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  // Feature-flagged off by default. Enabling the route is a separate operator
  // action after OAuth, team authorization, and deployment review are complete.
  if (process.env.ORBA_MCP_ENABLED !== "true") {
    return NextResponse.json({ error: "Orba MCP server is disabled" }, { status: 503 });
  }

  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return NextResponse.json(
      { error: "Accept must include application/json and text/event-stream" },
      { status: 406 },
    );
  }

  const protocolVersion = getProtocolVersion(request);
  if (!protocolVersion) {
    return NextResponse.json(
      { error: "Unsupported MCP-Protocol-Version" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400);
  }

  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError(isRecord(body) ? (body.id as JsonRpcRequest["id"]) : null, -32600, "Invalid Request", 400);
  }

  const rpc = body as unknown as JsonRpcRequest;
  const id = rpc.id ?? null;
  const hasId = Object.prototype.hasOwnProperty.call(body, "id");

  // JSON-RPC notifications have no id and must be acknowledged with 202.
  if (!hasId) {
    if (rpc.method.startsWith("notifications/")) {
      return new NextResponse(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return jsonRpcError(null, -32600, "Requests must include an id", 400);
  }

  if (rpc.method === "initialize") {
    const requestedVersion = isRecord(rpc.params) ? rpc.params.protocolVersion : undefined;
    if (typeof requestedVersion !== "string" || !SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)) {
      return jsonRpcError(id, -32602, "Unsupported protocol version");
    }
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: requestedVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "Orba", version: "1.0.0" },
          instructions:
            "Orba remote MCP server. Exposes the authenticated caller's Orba tool capabilities. Tool execution is subject to Orba permissions, workspace boundaries, and approval policies.",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (rpc.method === "ping") {
    return NextResponse.json({ jsonrpc: "2.0", id, result: {} });
  }

  if (rpc.method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: { tools: getMcpTools() },
      }, { headers: { "Cache-Control": "no-store" } });
  }

  if (rpc.method === "tools/call") {
    const params = isRecord(rpc.params) ? rpc.params : {};
    const toolName = params.name;
    const args = params.arguments === undefined ? {} : params.arguments;

    if (typeof toolName !== "string" || !isRecord(args)) {
      return jsonRpcError(id, -32602, "tools/call requires a tool name and object arguments");
    }

    const tool = registry.getTool(toolName);
    if (!tool) return jsonRpcError(id, -32602, `Unknown Orba tool: ${toolName}`);

    const metadata = registry.getToolMetadata(toolName);
    if (metadata?.requiresApproval || metadata?.riskTier === "TIER_4_DESTRUCTIVE") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{
            type: "text",
            text: "This action requires explicit approval in the Orba workspace and cannot be approved through this MCP connection.",
          }],
          isError: true,
        },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const identity = auth.identity;
    const workspaceDir = process.env.ORBA_WORKSPACE_PATH || process.cwd();
    const traceId = randomUUID();
    const toolCallId = randomUUID();

    const { result } = await router.routeAndExecute(toolCallId, toolName, args, {
      workspaceDir,
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentRunId: randomUUID(),
      traceId,
      isPreApproved: false,
    });

    const text = result.success ? result.output : result.error || "Tool execution failed";
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: text || "(Orba tool returned no text output)" }],
        isError: !result.success,
        structuredContent: {
          success: result.success,
          toolCallId: result.toolCallId,
          name: result.name,
          executionTimeMs: result.executionTimeMs,
          ...(result.metadata ? { metadata: result.metadata } : {}),
        },
      },
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return jsonRpcError(id, -32601, `Method not found: ${rpc.method}`);
}
