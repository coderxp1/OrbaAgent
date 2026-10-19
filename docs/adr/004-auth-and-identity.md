# ADR-004: Authentication & Identity Architecture

**Status:** Accepted  
**Deciders:** Paul Hartmann, OrbaAgent Core Team  
**Date:** 2026-09-06  

---

## Context and Problem Statement

OrbaAgent requires an authentication and identity system that supports multi-tenant organizations, granular role-based access control (RBAC), programmatically accessible API keys, and human sessions across Web (Next.js), Desktop (Tauri), and API clients.

Architecting this foundation before writing business logic in `apps/api`, `services/orchestrator`, or `services/model-gateway` is essential to prevent costly retrofits of user, organization, and tenancy primitives across services.

The solution must satisfy five core requirements:
1. **Multi-Tenancy from Day 1:** First-class support for organizations, users, memberships, invitations, and hierarchical roles (`owner`, `admin`, `member`).
2. **Programmatic Access:** Cryptographically hashed API keys with granular typed scopes and organization-level service key support.
3. **Federation Readiness:** Pluggable OAuth2 / OIDC social login (GitHub, Google, custom enterprise OIDC) without architectural changes.
4. **Universal Session Model:** Seamless operation across Web (HTTP-only, secure, SameSite cookies), Desktop (Tauri using Bearer tokens), and API clients.
5. **No Hand-Rolled Cryptography:** Battle-tested security primitives, standardized token lifecycles, and integrated MFA/TOTP.

---

## Decision Drivers

- **TypeScript-Native Ecosystem:** First-class integration with Fastify 5.x and Drizzle ORM; zero runtime impedance mismatch or duplicate schemas.
- **In-Process vs. Separate Daemon:** Prefer in-process execution to avoid provisioning and operating separate identity daemon containers (JVM, Go) on a lean VPS.
- **Multi-Tenant Ergonomics:** Native organization and team abstraction out of the box.
- **Developer Velocity & Maintenance:** Clean migration path, auditable SQL schemas, and active community maintenance.
- **Security & Compliance Hooks:** Extensible audit logging hooks, rate limiting, and MFA support.

---

## Considered Options

We evaluated four identity solutions against six technical criteria:
1. **Better Auth** (`better-auth@1.7.2`, released 2026-08-26)
2. **Auth.js / NextAuth v5** (`@auth/core`)
3. **Ory Kratos** (v1.3.x)
4. **Keycloak** (v26.x Quarkus)

---

## Detailed Evaluation Matrix

| Evaluation Criteria | Better Auth (`1.7.2`) | Auth.js (`v5`) | Ory Kratos (`v1.3.x`) | Keycloak (`v26.x`) |
| :--- | :--- | :--- | :--- | :--- |
| **1. TypeScript Fit (Fastify + Drizzle)** | **Native:** In-process Fastify plugin handler; first-party Drizzle adapter (`better-auth/adapters/drizzle`). | **Poor:** Primarily tailored for Next.js App Router; Fastify integration is experimental and fragmented. | **Foreign:** Written in Go. Fastify acts as an HTTP client; separate DB schema unmanaged by Drizzle. | **Foreign:** Written in Java (Quarkus). Requires JWT validation layer (`jwks-rsa`); no Drizzle integration. |
| **2. Org / Multi-Tenant Support** | **Built-in:** First-class `organization` plugin (`better-auth/plugins`) supporting orgs, members, roles, invites. | **None:** Must be entirely hand-rolled in user application code and custom database schemas. | **Complex:** Kratos requires Ory Keto for RBAC/relations or custom tenant schemas; high setup overhead. | **Built-in:** Full multi-realm and v25+ organization features, but heavy enterprise configuration. |
| **3. Self-Hosting Cost (RAM / CPU)** | **Zero Extra:** Runs inside Fastify process; shares existing PostgreSQL pool (~0 MB overhead). | **Zero Extra:** Runs in-process; shares pool. | **Moderate:** Separate Go binary container (~50ΓÇô150 MB RAM per instance). | **Heavy:** JVM/Quarkus container requiring 1.0ΓÇô2.0 GB RAM baseline; slow startup times. |
| **4. Operational Complexity** | **Minimal:** Single codebase, unified Drizzle migrations, unified deployment pipeline. | **Moderate:** High maintenance burden due to ecosystem churn and custom org scaffolding. | **High:** Separate container, separate configuration (JSONnet schemas, courier mailers, DB migrations). | **Very High:** Complex realm exports, Java memory tuning, clustering, external database management. |
| **5. Multi-Factor Auth (MFA)** | **Built-in:** First-party `twoFactor` plugin (`better-auth/plugins`) supporting TOTP and backup codes. | **Partial:** Requires third-party plugins or custom WebAuthn integration. | **Comprehensive:** Native WebAuthn, TOTP, backup codes, recovery flows. | **Comprehensive:** Enterprise-grade WebAuthn, TOTP, SMS, RADIUS, Kerberos. |
| **6. Audit & Lifecycle Hooks** | **Native:** `before` and `after` database and endpoint hooks; easy dispatch to audit ledger. | **Limited:** Event callbacks are primarily frontend/session focused. | **Extensive:** Webhooks for identity lifecycle events (JSON payloads). | **Extensive:** Event listeners for admin and user events; SPI plugin architecture. |

---

## In-Depth Analysis of Options

### Option 1: Better Auth (Recommended)
- **Architecture:** Runs directly inside the Fastify API process. Exposes standard HTTP route handlers via `auth.handler(request, reply)`.
- **Drizzle Integration:** Ships with an official Drizzle adapter (`better-auth/adapters/drizzle`). Table schemas are generated via `npx @better-auth/cli generate` and cleanly referenced in Drizzle queries.
- **Plugins Evaluated:**
  - `organization` imported from `better-auth/plugins`: Provides multi-tenant organization creation, membership management, invite lifecycle, and role checking.
  - `twoFactor` imported from `better-auth/plugins`: Provides RFC 6238 TOTP authentication and recovery codes.
  - `bearer` imported from `better-auth/plugins`: Converts Bearer token headers into authenticated sessions, allowing Tauri desktop and pure API clients to authenticate identically to cookie-based web clients.
  - `apiKey` imported from `@better-auth/api-key`: Provides fast, cryptographically hashed API key verification, prefix matching, and rate limiting.
- **Session Architecture & Security Tradeoff:**
  - *Better Auth Design:* Better Auth creates opaque random session tokens and queries the `session.token` column directly.
  - *Risk:* If a raw session token is stored in the database, a read-only database dump or SQL injection grants immediate session hijacking capability.
  - *Mitigation Strategy:*
    1. Short session lifetimes (7-day maximum TTL with 24-hour rolling inactivity expiration).
    2. Enforced TLS for all client-to-API and service-to-database connections.
    3. Storage-level encryption at rest via PostgreSQL tablespace encryption / encrypted disk volumes.
    4. Adapter hook option: Better Auth supports lifecycle hooks to store SHA-256 hashes (`token_hash`) for token lookup if strict zero-plaintext storage is enforced.

### Option 2: Auth.js (NextAuth v5)
- While popular in Next.js applications, Auth.js v5 remains tightly coupled to frontend React frameworks.
- Lacks native Fastify adapter support (Fastify bridge requires unmaintained community shims).
- Zero multi-tenancy, team, or organization concepts out of the box. All organization, membership, invite, and role schemas must be manually designed, migrated, and maintained.
- Lacks built-in API key support.

### Option 3: Ory Kratos
- An exceptional, security-hardened identity server written in Go.
- However, for OrbaAgent's Phase 1 architecture, self-hosting Kratos adds substantial operational drag:
  - Requires maintaining separate Go containers and independent database schemas.
  - Requires pairing with Ory Keto for relation-based authorization (RBAC/Zanzibar).
  - Fastify cannot query user entities directly via Drizzle without cross-database synchronization or REST/gRPC client hops.

### Option 4: Keycloak
- Keycloak is the enterprise standard for SAML/OIDC identity federation.
- However, its resource footprint (Java Quarkus requiring 1ΓÇô2 GB RAM) and configuration complexity are disproportionate for OrbaAgent's single-VPS architecture.
- Does not integrate with TypeScript or Drizzle; Fastify would be reduced to an OAuth2 resource server validating JWTs.

---

## Decision Outcome

**Chosen Option: Better Auth (`better-auth@1.7.2`)**

Better Auth provides the best balance of security, developer ergonomic speed, and operational simplicity:
1. It delivers organizations, memberships, invitations, roles, API keys, and 2FA natively.
2. It runs in-process with Fastify and integrates with Drizzle ORM.
3. It requires zero extra containers or RAM overhead.
4. It natively unifies web cookies, desktop Bearer tokens, and programmatic API keys.

---

## Pinned Dependencies & Evidence

| Package | Evaluated Version | Changelog / Tag Date | Verified Import Path | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `better-auth` | `1.7.2` | 2026-08-26T19:06:23Z | `import { betterAuth } from "better-auth"` | Core auth framework & Drizzle adapter |
| `better-auth/plugins` | `1.7.2` | 2026-08-26T19:06:23Z | `import { organization, twoFactor, bearer } from "better-auth/plugins"` | Multi-tenancy, TOTP MFA, and Bearer token handling |
| `@better-auth/api-key` | `1.7.2` | 2026-08-26T19:06:23Z | `import { apiKey } from "@better-auth/api-key"` | Programmatic API key generation & verification |

---

## Positive Consequences

- All core entities (`users`, `organizations`, `members`, `sessions`, `api_keys`) exist as type-safe Drizzle tables from Day 1.
- No separate service or container to monitor, update, or connect across networks.
- Next.js web application and Tauri desktop application use the same authentication endpoints and session validation rules.
- Prepares OrbaAgent for seamless Phase 1 development without breaking database schemas later.

## Negative Consequences & Mitigations

- **Database-Stored Session Tokens:** Better Auth's default session table indexes the session token.
  - *Mitigation:* We enforce strict short TTLs (7-day max, 24-hour idle), require TLS everywhere, and configure PostgreSQL encryption at rest. In Phase 1, we will implement an adapter pre-hook to store `SHA-256(token)` in `token_hash` if strict zero-plaintext token storage is mandated.
- **Ecosystem Maturity:** Better Auth is younger than Keycloak or Ory.
  - *Mitigation:* Better Auth's schema is standard PostgreSQL managed via Drizzle. If a migration is ever required in a future phase, user data and credentials can be migrated without vendor lock-in.

---

## Implementation Status

**Increment 1 (landed): the identity seam.** `@orbaagent/shared` now exposes
`resolveCallerIdentity()` and `readPresentedApiKey()` (`packages/shared/src/lib/identity.ts`).
A tenant id is chosen in exactly one place and is never taken from client
input: a server-validated session wins, then a server-validated API key
record, then deployment configuration, then the anonymous default tenant.
`authenticated` is a fact about the request rather than a naming convention,
which replaces the previous pattern of locals named `verifiedTenantId` that
were really "an env var, or a hardcoded fallback". The `/api/chat` and
`/api/uploads` routes now resolve their tenant through this seam. Runtime
behaviour is unchanged for the current single-tenant deployment.

**Still to come (this ADR, not yet implemented):** Better Auth as the in-process
Fastify identity provider, the Drizzle schema for `users` / `organizations` /
`members` / `sessions` / `api_keys`, the `organization` / `twoFactor` /
`bearer` / `apiKey` plugins, OAuth2 social login, and enforcement of
authenticated callers (currently any unauthenticated request is served in the
`default-tenant` workspace).

**Increment 2 (landed): credential validation and route enforcement.** The
identity seam is now backed by real credentials and enforced on the protected
routes:

- `apps/web/src/lib/auth/credentials.ts` is an environment-backed credential
  store. `ORBA_SESSIONS` and `ORBA_API_KEYS` are JSON maps keyed by the
  SHA-256 hex digest of the credential, so the raw secret is never written to
  the process configuration. A presented credential is hashed once and compared
  against the stored digests in constant time. Records may carry `expiresAt`
  and `revoked`.
- `apps/web/src/lib/auth/guard.ts` resolves the caller from the request
  (session cookie `orba_session`, or an `Authorization: Bearer` API key) and
  applies the deployment policy: `ORBA_AUTH_MODE` may be `required` or
  `permissive`, and when it is unset the mode is derived - the presence of any
  credential makes authentication mandatory, so a half-configured deployment
  cannot silently keep serving anonymous traffic.
- `/api/chat`, `/api/uploads` and `/api/artifacts/...` now reject an
  unauthenticated caller with 401 when the policy requires it, and refuse any
  tenant that is not the caller's own with 403.
- The artifact route resolves containment against the **tenant** directory
  rather than the upload root. Resolving against the root alone let
  `../../other-tenant/...` read another tenant's artifacts even though the URL
  named the caller's own tenant; the traversal test in the artifact route test
  now covers that.
- The media ingest route still writes into the deployment workspace. Routing
  ingested artifacts to the caller's tenant is the next step, together with
  Better Auth.

**Enforcement is implemented and tested but not yet activated in production.**
The deployed environment holds no credentials, so the derived mode is
`permissive` and the current single-tenant behaviour is preserved. Activating
the boundary requires provisioning `ORBA_API_KEYS` (or sessions) in the
deployment, which is an operational change that has not been made.