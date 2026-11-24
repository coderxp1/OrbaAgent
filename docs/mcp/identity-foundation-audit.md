# Identity foundation: repository baseline audit

**Branch:** `feat/heygen-team-mcp-video-only`  
**Scope:** read-only repository inspection; no production changes and no database operations.

## Findings verified on this branch

### Database infrastructure exists

- `docker-compose.yml` defines PostgreSQL 17.4 and a persistent named volume.
- `docker-compose.prod.yml` defines PostgreSQL 17 and a persistent named volume.
- Both compose files pass `DATABASE_URL` to the API service.
- The production web service does not receive `DATABASE_URL`.

### The existing API does not implement identity persistence

- `apps/api/src/index.ts` creates a Fastify server.
- Its PostgreSQL use is currently a TCP reachability check in `/health`.
- The API package has no Drizzle, Better Auth, PostgreSQL client, or identity schema dependency.
- No Drizzle configuration, migration directory, or database schema file was found at the inspected conventional paths.

### The web application currently owns authentication

- `apps/web/src/lib/auth/guard.ts` resolves sessions and API keys through `getCredentialStore`.
- `apps/web/src/lib/auth/credentials.ts` reads `ORBA_SESSIONS` and `ORBA_API_KEYS` environment JSON maps and verifies SHA-256 digests.
- `apps/web/src/lib/auth/session.ts` implements the existing signed session cookie.
- `apps/web/src/app/api/auth/session/route.ts` exchanges an API key for the signed session cookie.
- `apps/web/src/app/login/page.tsx` explicitly labels the sign-in experience as interim single-owner authentication.
- `apps/web/src/app/api/user/profile/route.ts` stores a single profile JSON file at the configured upload directory, rather than persisting per-user records.

### Architecture decision already exists

`docs/adr/004-auth-and-identity.md` selects Better Auth with PostgreSQL/Drizzle and calls for organizations, memberships, invitations, roles, sessions, API keys, and MFA. Its implementation status explicitly says the Better Auth/Drizzle identity store and multi-user account lifecycle remain unimplemented.

## Consequence

Do not bolt an OAuth authorization server onto the environment-backed credential map and describe that as team identity. That would provide a protocol entry point without the required persistent account, organization membership, role, revocation, and lifecycle guarantees.

## Recommended implementation boundary

Keep identity ownership in the web application initially, where the current login and route guards already live. Add a PostgreSQL client and Drizzle schema/migration workflow to `apps/web`, then integrate Better Auth and its organization plugin. Do not move the identity provider into the API service merely because that service currently has a PostgreSQL health check; doing so would require a separate authenticated identity API contract and would expand the change unnecessarily.

Before selecting dependency versions, verify the exact Better Auth and Drizzle package compatibility and generate the schema with the pinned Better Auth CLI. Commit generated migration artifacts, but do not apply them to any database in this feature-branch task.

## Production safety

- No production secrets or compose configuration changed.
- No migration was generated against or applied to a live database.
- No service was restarted and no deployment was triggered.
- `ORBA_MCP_ENABLED` remains disabled by default.
