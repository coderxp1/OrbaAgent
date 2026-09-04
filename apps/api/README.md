# OrbaAgent Core API (`apps/api`)

## Responsibility
The central HTTP and WebSocket backend API service:
- Authentication & session validation (JWT, API Keys, OAuth callbacks).
- Multi-tenant organization and membership RBAC enforcement.
- Agent run lifecycle initiation, tracking, and cancellation.
- Audit ledger writes for all security-sensitive operations.
- Health endpoints (`/health` returning version and commit SHA).

## Technology Stack
- **Framework:** Fastify 5.x with `@fastify/type-provider-zod`
- **Language:** TypeScript 5.5+
- **Data Access:** Drizzle ORM connecting to PostgreSQL
- **Caching & Locks:** Redis 7+
- **Telemetry:** OpenTelemetry instrumentation

## Development
```bash
pnpm --filter @orbaagent/api dev
```
