# ADR-001: Core Technology Stack & Architecture Decision

**Status:** Accepted  
**Deciders:** Paul Hartmann, OrbaAgent Core Team  
**Date:** 2026-09-04  

---

## Context and Problem Statement

OrbaAgent requires a robust, modular, and high-performance foundation capable of scaling across web, desktop, and containerized agent execution environments. We need a unified language and toolchain that maximizes developer velocity, enforces type safety, minimizes cold-start latency, and avoids heavyweight or proprietary runtime dependencies.

---

## Decision Drivers

- **End-to-End Type Safety:** Eliminate boundary mismatches between client, API, database, and background services.
- **Minimal Container Footprint:** Zero heavy proprietary binaries or engine daemons inside service containers.
- **High Performance & Low Latency:** Fast HTTP routing, lightweight ORM overhead, fast test and build cycles.
- **Operational Simplicity:** Automated TLS, self-hosted S3-compatible storage, clean separation of concerns.

---

## Considered Options

### 1. Monorepo & Build Tooling
- **Chosen: Native pnpm workspaces (`pnpm -r`).** pnpm provides content-addressable storage, strict non-flat `node_modules` preventing phantom dependencies, and first-class workspace support without external daemon overhead. Monorepo build, test, and lint across all workspace packages execute cleanly in ~2.7s.
- *Turborepo Evaluation:* While Turborepo was evaluated for task caching, Phase 0 builds are fast and lightweight with native pnpm commands. To keep toolchain moving parts minimal, we rely on native pnpm workspaces. Turborepo can be introduced in a future phase if remote caching across distributed CI runners becomes necessary.
- *Rejected: npm/yarn workspaces, Nx.* npm/yarn allow phantom dependency leaks; Nx introduces significant configuration overhead and background daemons.

### 2. Code Quality & Formatting
- **Chosen: Biome.** Single Rust binary providing sub-second linting, formatting, and import sorting.
- *Rejected: ESLint + Prettier.* Heavy plugin sprawl, version conflicts, high CI execution latency.

### 3. Web & Desktop Applications
- **Web App: Next.js 16.3.x (App Router, React 19, TypeScript).** Pinned to Next.js `16.3.4` (incorporating the August 2026 security release). Stable since Oct 2025, modern React 19 server/client components, Turbopack builds.
- **Desktop App: Tauri.** Compiles to native binary utilizing the host OS webview; drastically lower RAM/disk footprint (~30MB vs ~150MB+).
- *Rejected: Electron.* High memory consumption and bundled Chromium overhead. Will only be revisited if webview rendering parity becomes a proven blocker across Linux distributions.

### 4. Core Backend API
- **Chosen: Fastify 5.x + Zod Type Provider.** Extremely fast HTTP throughput, built-in schema-based serialization, native async/await, thin HTTP layer where validation is derived directly from shared Zod schemas. Pinned to `fastify@5.12.3`.
- *Rejected: NestJS.* NestJS introduces an enterprise OOP dependency-injection architecture and decorator-heavy boilerplate that obscures domain logic. Business logic belongs in decoupled packages, not DI controller trees.

### 5. Database & ORM
### 5. Database & ORM
- **Database: PostgreSQL 17.x LTS (`postgres:17.4-alpine`).** PostgreSQL 18 is not yet GA (expected Q4 2026); 17.4-alpine provides mature ACID compliance, JSONB support, and robust indexing.
- **ORM: Drizzle ORM.** TypeScript-native, thin SQL wrapper, compiles directly to standard SQL queries with zero engine binary overhead. Migrations are plain, auditable SQL files. Pinned to `drizzle-orm@0.45.x`.
- *Rejected: Prisma.* Prisma bundles a closed-source Rust query engine binary per target platform, introducing cross-compilation headaches, elevated Docker image sizes, slower cold starts, and connection pooling hurdles.

### 6. Cache & Pub/Sub
- **Chosen: Redis 7.4+ (`redis:7.4-alpine`) / Valkey 8 (`valkey/valkey:8.0-alpine`).** Sub-millisecond in-memory cache, task queue backing (BullMQ), pub/sub messaging between orchestrator and agent runtimes.
- *License & Fork Note:* Redis Ltd transitioned licenses from BSD to dual RSALv2 / SSPLv1 starting in version 7.4. For strict OSI-compliant open-source environments, Valkey 8.0 (Linux Foundation BSD-3-Clause fork) is fully wire-compatible and serves as an immediate drop-in replacement.

### 7. Object Storage
- **Chosen: MinIO (`minio/minio:RELEASE.2025-09-07T16-13-09Z`).** High-performance S3-compatible object storage. Completely identical API in local development and production. Allows frictionless artifact storage and retrieval.
- *Distribution Note:* MinIO transitioned to a source-only distribution model in October 2025; `RELEASE.2025-09-07T16-13-09Z` is the last verified stable multi-arch community release on Docker Hub prior to the distribution shift.

### 8. Reverse Proxy & Ingress
- **Chosen: Traefik v3.7.12.** Current stable release (2026-08-26). Native Docker provider integration, automatic TLS certificate lifecycle management via ACME DNS-01, zero-downtime routing updates.
- *Security Guarantee:* Traefik reaches the Docker API only via `docker-socket-proxy:v0.5.0` with `CONTAINERS=1`; all other endpoints (POST, EXEC, VOLUMES, NETWORKS, SECRETS, BUILD, IMAGES, INFO) are denied. Port 2375 is never published to the host. `/var/run/docker.sock` is mounted `:ro`.
- *Default 404 & Hardening:* Unknown hosts and non-SNI handshakes are strictly rejected (`sniStrict: true`). Unknown matching hosts route to a dedicated read-only `catchall-404` container, returning HTTP 404 with full security headers (HSTS, CSP `frame-ancestors 'self'`, Permissions-Policy, nosniff, Referrer-Policy).

### 9. Transactional Email
- **Chosen: Resend.** EU region availability (`eu-central-1` / Frankfurt), modern REST API, first-class React Email support, high deliverability.
- *Rejected: AWS SES.* Significant operational friction (IAM policies, domain sandboxes, clunky templating).
- *Rejected: Postmark.* Higher pricing tier and less integrated developer ergonomics compared to modern TypeScript workflows.

### 10. Testing Framework
- **Chosen: Vitest.** Native ESM support, rapid execution via Vite's transform pipeline, Jest-compatible API.

---

## Pinned Core Dependencies & Versions

Every pinned dependency version has been verified with live registry inspections on 2026-09-04 and 2026-09-06:

| Component | Technology | Pinned Version | Verified On & Command Output | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `22.x LTS` / `24.x` | `node -v` -> `v22.20.0` (Active LTS) | Base JavaScript/TypeScript runtime |
| **Package Manager**| `pnpm` | `10.34.5` | `pnpm -v` -> `10.34.5` | Strict workspace dependency management |
| **Type Checker** | TypeScript | `5.9.3` | `npm view typescript time['5.9.3']` -> `2026-07-08` | Strict type validation |
| **Linter / Formatter**| Biome | `1.9.4` | `npm view @biomejs/biome time['1.9.4']` -> `2025-10-18` | Unified code formatting and linting |
| **Unit Testing** | Vitest | `3.2.7` | `npm view vitest time['3.2.7']` -> `2026-07-06` | Fast ESM unit testing |
| **Web Frontend** | Next.js | `16.3.4` | `npm view next time['16.3.4']` -> `2026-08-31T20:00:51Z` (Security release) | Production web application (React 19) |
| **Backend API** | Fastify | `5.12.3` | `npm view fastify time['5.12.3']` -> `2026-09-04T08:21:57Z` | High-throughput core backend API |
| **Reverse Proxy** | Traefik | `v3.7.12` | `Docker Hub API /library/traefik/tags/v3.7.12` -> `2026-08-26T20:10:14Z` | Edge ingress and TLS certificate lifecycle |
| **Catch-All 404** | nginx | `1.30.4-alpine` | `Docker Hub API /library/nginx:1.30.4-alpine` -> `2026-09-03T22:50:53Z` | Minimal static 404 responder container |
| **Socket Proxy** | docker-socket-proxy | `v0.5.0` | `Docker Hub API /tecnativa/docker-socket-proxy/tags/v0.5.0` -> `2026-07-27T09:32:14Z` | Least-privilege Docker socket filter (`CONTAINERS=1`, `:ro`) |
| **Agent Sandbox** | Docker Engine | `27.x` / `28.x` / `29.x` | `docker version` -> Server Engine `29.5.3` | Isolated agent computer containers |
| **Database** | PostgreSQL | `17.4-alpine` | `docker manifest inspect postgres:17.4-alpine` (2026-09-06, `sha256:0ae695e...`) | Relational data persistence and audit log |
| **ORM** | Drizzle ORM | `0.45.2` | `npm view drizzle-orm time['0.45.2']` -> `2026-03-27T17:06:27Z` | SQL-transparent type-safe data access |
| **Cache / Queue** | Redis / Valkey | `7.4-alpine` / `8.0-alpine` | `docker manifest inspect redis:7.4-alpine` (`sha256:1db42cc...`); Valkey `sha256:b6275ba...` | In-memory cache, pub/sub, task queues |
| **Object Store** | MinIO | `RELEASE.2025-09-07T16-13-09Z` | `docker manifest inspect minio/minio:RELEASE.2025-09-07T16-13-09Z` (`sha256:a1a8bd4...`) | S3-compatible artifact storage |
| **Transactional Mail**| Resend | `v4.x` | `npm view resend version` | Transactional email delivery |

