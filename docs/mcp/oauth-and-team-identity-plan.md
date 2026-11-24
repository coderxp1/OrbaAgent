# MCP OAuth and team identity implementation plan

## Status

Planning only. This document does not enable the MCP endpoint, change production configuration, add database migrations, or claim OAuth compatibility.

## Verified repository baseline

The current MCP endpoint is feature-flagged and authenticates through the existing request identity guard. That guard resolves identities from an environment-backed credential store and stateless signed sessions.

The current login page explicitly describes the implementation as interim single-owner sign-in. The user profile route reads and writes one JSON profile file rather than a per-user database record. ADR-004 records Better Auth, Drizzle-backed users/organizations/memberships/sessions/API keys, and role enforcement as accepted architecture but not yet implemented.

Consequently, adding OAuth endpoints directly on top of the current environment-backed identity map would not provide the requested team account lifecycle, membership checks, or revocable per-client grants. OAuth must not be presented as complete until those foundations exist.

## Delivery sequence

### 1. Establish the identity foundation

Implement the accepted ADR-004 direction before MCP OAuth:

- Confirm the actual PostgreSQL/Drizzle infrastructure and migration ownership in the current deployment.
- Add Better Auth using versions verified against the current lockfile and runtime.
- Implement persistent users, organizations, memberships, sessions, and API credentials.
- Implement organization roles and server-side membership/role checks.
- Replace environment-only identity lookup behind the existing `CredentialStore` seam without changing protected route contracts unnecessarily.
- Replace the shared profile JSON file with identity-scoped profile persistence.
- Add migration, rollback, and backup procedures; do not run migrations against production as part of feature-branch work.
- Add tests for tenant isolation, membership changes, revoked credentials, and role enforcement.

Acceptance: two distinct users in one organization resolve to distinct identities; a user cannot access another organization; removing membership or revoking a credential blocks subsequent requests.

### 2. Add an OAuth authorization server for MCP

Implement OAuth 2.1 authorization-code flow with PKCE (S256), exact redirect URI validation, state validation, short-lived single-use authorization codes, audience/resource binding, and least-privilege scopes.

Required protocol surface:

- Authorization-server metadata.
- Protected-resource metadata for the MCP resource.
- Authorization endpoint with an Orba sign-in/consent experience.
- Token endpoint with authorization-code + PKCE exchange.
- Token validation on every MCP request.
- Revocation and short-lived access-token lifecycle.
- Client registration/discovery compatible with the intended clients; do not assume all clients support the same registration mechanism.

Do not build custom cryptographic primitives. Prefer the chosen identity/OAuth framework where it can correctly implement the MCP authorization profile. Any framework gaps must be documented and covered by protocol-level tests.

### 3. Bind OAuth grants to Orba authorization

Each grant must identify the user, organization, client, approved scopes, resource audience, issue/expiry times, and revocation state. Resolve the active organization membership on requests or use a revocation-aware policy that prevents stale membership from retaining access.

MCP tools must be filtered by caller permissions where supported, and every `tools/call` must re-check authorization at execution time. Never trust tenant or user identifiers supplied in MCP arguments. Approval-required and destructive operations remain unavailable unless an explicit, auditable approval round-trip is designed.

### 4. Verify client compatibility

Test independent end-to-end connections for:

- ChatGPT custom MCP connector.
- Gemini Enterprise custom MCP connector.
- Langdock.
- Orba agents.
- A standards-based MCP client.

For each, verify discovery, authorization, tool listing, tool invocation, expired tokens, revoked grants, denied scopes, and cross-tenant isolation. Record client-specific limitations rather than treating one successful client as universal compatibility.

## Security and release gates

- Keep `ORBA_MCP_ENABLED` disabled by default.
- Keep production configuration and deployment untouched until a separate explicit approval.
- No shared team-wide bearer secret; use individual user/client grants.
- No production migration, secret rotation, service restart, or deployment in this feature branch.
- Do not claim ChatGPT or Gemini compatibility until their OAuth flows pass end-to-end tests.
- Do not expose all registered tools indiscriminately: enforce user, organization, scope, and risk policy for both discovery and execution.

## Immediate next engineering task

Inventory the repository's actual database, migration, and deployment configuration, then implement the ADR-004 identity foundation on this feature branch. Once persistent multi-user identity and organization membership are real, implement MCP OAuth against that foundation.


## Repository audit result (2026-11-24)

The baseline audit is recorded in [identity-foundation-audit.md](./identity-foundation-audit.md). PostgreSQL containers and persistent volumes exist in both Compose configurations, but the web application has no PostgreSQL client, Drizzle setup, or identity schema. The API service receives DATABASE_URL but currently only checks TCP reachability in its health endpoint. The web app still uses environment-backed credentials, a signed stateless session cookie, and a shared JSON profile file.

Implementation ownership should remain in the web application for the first increment because its current login, session exchange, credential store, and route guards are already there. Add a web-owned PostgreSQL/Drizzle layer and Better Auth integration, generate migrations from the pinned auth configuration, and commit those artifacts without applying them to any database. Verify package compatibility and update the pnpm lockfile using pnpm itself; do not hand-edit the lockfile. The production web service must not receive a database URL or new secrets until a separately approved deployment plan is reviewed.
