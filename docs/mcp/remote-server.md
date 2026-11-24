# Orba remote MCP server

Orba exposes its registered Agent Runtime tools through a stateless MCP Streamable HTTP endpoint:

`POST https://orbaagent.dev/api/mcp`

The endpoint is implemented in `apps/web/src/app/api/mcp/route.ts`. It exposes the live `ToolRegistry` definitions and routes `tools/call` through the existing `ToolRouter` and `PermissionEngine`; it does not return placeholder success messages. It is feature-flagged off unless `ORBA_MCP_ENABLED=true` is explicitly configured.

## Supported protocol

- Streamable HTTP over JSON-RPC 2.0.
- Protocol versions: `2025-11-25` and `2025-03-26`.
- `initialize`, `ping`, `tools/list`, and `tools/call`.
- Notifications are acknowledged with HTTP 202.
- Stateless: no `MCP-Session-Id` is issued. GET and DELETE return HTTP 405; server-initiated event streams are not provided.
- POST requests must use `Content-Type: application/json` and an `Accept` header containing both `application/json` and `text/event-stream`.

## Authentication

Every request requires an authenticated Orba identity, even when the general application auth mode is permissive. External clients authenticate with an Orba API key:

`Authorization: Bearer <ORBA_API_KEY>`

The API key must be registered in `ORBA_API_KEYS`. The map is keyed by the SHA-256 hex digest of the raw API key; raw keys must never be stored in environment configuration:

```json
{
  "<sha256-hex-digest>": {
    "tenantId": "team-tenant-id",
    "userId": "individual-team-member-id"
  }
}
```

Issue separate high-entropy API keys for each team member/client identity, mapping them to the appropriate tenant and individual user ID. Do not share one employee's credential across the team. Keep raw keys in the approved secret manager or deliver them directly to the intended MCP client. Never commit keys to Git or paste them into chat.

The production Compose service already passes `ORBA_API_KEYS` into the web container. `ORBA_MCP_ENABLED` must be set to the exact string `true` before the route will accept MCP traffic; it is intentionally not enabled in the production Compose configuration. Updating production secrets, enabling this flag, or restarting production is an operator-controlled deployment action and is not part of this feature-branch change.

## Tool exposure and execution

- `tools/list` returns all tools currently registered in Orba's `ToolRegistry`.
- `tools/call` executes through `ToolRouter.routeAndExecute`, so the existing permission engine, workspace boundary checks, and audit decision path remain in use.
- The MCP execution context uses the authenticated identity's tenant and user IDs.
- The workspace root is `ORBA_WORKSPACE_PATH`, falling back to the web process working directory, matching the Orchestrator's current default.
- Tools marked `requiresApproval` or `TIER_4_DESTRUCTIVE` are listed with an approval warning and denied through MCP because this transport does not implement an interactive approval round-trip. They must be approved in the Orba workspace.
- No user-supplied tenant or user ID is trusted.

The endpoint checks a supplied `Origin` against `ALLOWED_ORIGINS` (or the request's own origin when no allowlist is configured). Non-browser MCP clients may omit `Origin`.

## Client configuration

For clients that support static bearer-token authentication, configure:

- Transport: Streamable HTTP
- URL: `https://orbaagent.dev/api/mcp`
- Authentication: Bearer token (an Orba API key)

The client must send the standard MCP initialization request and then discover tools with `tools/list`.

## Compatibility limitations

This implementation provides bearer API-key authentication, not an OAuth 2.1 authorization server. Some hosted MCP clients (including client configurations that require OAuth discovery and an interactive authorization-code/PKCE flow) cannot connect using a static bearer token alone. OAuth authorization-server metadata, registration, consent, token issuance, and revocation must be implemented before claiming compatibility with those OAuth-only configurations.

This endpoint currently exposes the Agent Runtime tool surface through `tools`; it does not expose MCP resources, prompts, server-initiated notifications, or standalone GET event streams.

## Next implementation stage

See [OAuth and team identity implementation plan](./oauth-and-team-identity-plan.md). The repository's current interim single-owner identity model must be replaced with persistent multi-user identity and organization membership before MCP OAuth can safely provide team-wide access.

## Validation

The route tests cover authentication enforcement, protocol negotiation, live tool discovery, unknown tool handling, Origin validation, notification acknowledgement, Accept headers, and stateless GET/DELETE behavior. Run the web workspace test suite and typecheck in CI before deployment. Production remains unchanged until a separately approved deployment.
