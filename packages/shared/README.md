# Shared Package (`packages/shared`)

## Responsibility
The shared core module across all apps and services:
- **Types:** Shared domain types (User, Organization, Agent, Run, AuditLog, ToolCall).
- **Schemas:** Runtime validation schemas using Zod for API payloads and internal events.
- **Auth Helpers:** JWT verification, role-based permission checks (RBAC), API key hashing utilities.
- **Errors:** Standardized application error hierarchy and HTTP error codes.

## Exports
- `@orbaagent/shared/types`
- `@orbaagent/shared/schemas`
- `@orbaagent/shared/auth`
- `@orbaagent/shared/errors`
