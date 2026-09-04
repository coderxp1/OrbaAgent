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
- **Chosen: pnpm workspaces.** pnpm provides content-addressable storage, strict non-flat `node_modules` preventing phantom dependencies, and first-class workspace support without external daemon overhead.
- *Rejected: npm/yarn workspaces, Nx, Turborepo.* npm/yarn allow phantom dependency leaks; Nx and Turborepo add native binary dependencies that complicate multi-platform builds.

### 2. Code Quality & Formatting
- **Chosen: Biome.** Single Rust binary providing sub-second linting, formatting, and import sorting.
- *Rejected: ESLint + Prettier.* Heavy plugin sprawl, version conflicts, high CI execution latency.

### 3. Web & Desktop Applications
- **Web App: Next.js 15.5+ (App Router, React 19, TypeScript).** Modern web foundation, server and client component flexibility, rich ecosystem. Next.js 15 is the active production major release (Next.js 16 is not yet stable/released).
- **Desktop App: Tauri.** Compiles to native binary utilizing the host OS webview; drastically lower RAM/disk footprint (~30MB vs ~150MB+).
- *Rejected: Electron.* High memory consumption and bundled Chromium overhead. Will only be revisited if webview rendering parity becomes a proven blocker across Linux distributions.

### 4. Core Backend API
- **Chosen: Fastify 5.x + Zod Type Provider.** Extremely fast HTTP throughput, built-in schema-based serialization, native async/await, thin HTTP layer where validation is derived directly from shared Zod schemas.
- *Rejected: NestJS.* NestJS introduces an enterprise OOP dependency-injection architecture and decorator-heavy boilerplate that obscures domain logic. Business logic belongs in decoupled packages, not DI controller trees.

### 5. Database & ORM
- **Database: PostgreSQL 16+.** Industry-standard ACID compliance, relational integrity, JSONB support, robust indexing.
- **ORM: Drizzle ORM.** TypeScript-native, thin SQL wrapper, compiles directly to standard SQL queries with zero engine binary overhead. Migrations are plain, auditable SQL files.
- *Rejected: Prisma.* Prisma bundles a closed-source Rust query engine binary per target platform, introducing cross-compilation headaches, elevated Docker image sizes, slower cold starts, and connection pooling hurdles.

### 6. Cache & Pub/Sub
- **Chosen: Redis 7+.** Sub-millisecond in-memory cache, task queue backing (BullMQ), pub/sub messaging between orchestrator and agent runtimes.

### 7. Object Storage
- **Chosen: MinIO.** High-performance S3-compatible object storage. Completely identical API in local development and production. Allows frictionless artifact storage and retrieval.

### 8. Reverse Proxy & Ingress
- **Chosen: Traefik v3.3.4.** Native Docker provider integration, automatic TLS certificate lifecycle management via ACME DNS-01, zero-downtime routing updates.
- *Security Guarantee:* Traefik reaches the Docker API only via `docker-socket-proxy` with `CONTAINERS=1`; all other endpoints (POST, EXEC, VOLUMES, NETWORKS, SECRETS, BUILD, IMAGES, INFO) are denied. Port 2375 is never published to the host.

### 9. Transactional Email
- **Chosen: Resend.** EU region availability (`eu-central-1` / Frankfurt), modern REST API, first-class React Email support, high deliverability.
- *Rejected: AWS SES.* Significant operational friction (IAM policies, domain sandboxes, clunky templating).
- *Rejected: Postmark.* Higher pricing tier and less integrated developer ergonomics compared to modern TypeScript workflows.

### 10. Testing Framework
- **Chosen: Vitest.** Native ESM support, rapid execution via Vite's transform pipeline, Jest-compatible API.

---

## Pinned Core Dependencies & Versions

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `22.x LTS` / `24.x` | Base JavaScript/TypeScript runtime |
| **Package Manager**| `pnpm` | `10.34.5` | Strict workspace dependency management |
| **Type Checker** | TypeScript | `5.9.3` | Strict type validation |
| **Linter / Formatter**| Biome | `1.9.4` | Unified code formatting and linting |
| **Unit Testing** | Vitest | `3.2.7` | Fast ESM unit testing |
| **Web Frontend** | Next.js | `15.5.25` | Production web application (React 19) |
| **Backend API** | Fastify | `5.12.3` | High-throughput core backend API |
| **Reverse Proxy** | Traefik | `v3.3.4` | Edge ingress and TLS certificate lifecycle |
| **Socket Proxy** | docker-socket-proxy | `0.1.3` | Least-privilege Docker socket filter (`CONTAINERS=1`) |
| **Agent Sandbox** | Docker Engine | `27.x` / `28.x` | Isolated agent computer containers |
| **Database** | PostgreSQL | `16.x` | Relational data persistence and audit log |
| **ORM** | Drizzle ORM | `0.38.x` | SQL-transparent type-safe data access |
| **Cache / Queue** | Redis | `7.x` | In-memory cache, pub/sub, task queues |
| **Object Store** | MinIO | `RELEASE.2024+` | S3-compatible artifact storage |
| **Transactional Mail**| Resend | `v4.x` | Transactional email delivery |
