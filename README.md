# OrbaAgent

Autonomous, auditable, and modular AI agent platform.

## Architecture & Monorepo Structure

```text
orbaagent/
├── apps/
│   ├── api/                  # Fastify 5 + Zod core backend API
│   ├── desktop/              # Tauri cross-platform desktop application
│   └── web/                  # Next.js 15 web application
├── services/
│   ├── agent-runtime/        # Agent execution and thought-action engine
│   ├── computer-runtime/     # Docker sandbox container management & streaming
│   ├── model-gateway/        # Multi-provider LLM interface (ADR-003)
│   ├── orchestrator/         # Workflow queue and task coordinator
│   └── scheduler/            # Recurring cron and scheduled task engine
├── packages/
│   └── shared/               # Core TypeScript types, schemas, and auth helpers
├── infra/
│   ├── proxy/                # Traefik v3 reverse proxy & socket proxy
│   └── scripts/              # Operational & server hardening scripts
└── docs/
    ├── adr/                  # Architecture Decision Records (001–003)
    ├── infra/                # DNS and Server Access policies
    └── repo/                 # Branch protection and CI policies
```

## Foundation Decisions
- [ADR-001: Core Technology Stack](docs/adr/001-stack-decision.md)
- [ADR-002: Agent Computer Isolation](docs/adr/002-agent-computer-isolation.md)
- [ADR-003: Model Gateway](docs/adr/003-model-gateway.md)
- [DNS & TLS Layout](docs/infra/dns.md)
- [Server Access Policy](docs/infra/server-access.md)

## Development Setup

Requirements:
- Node.js 20+ / 24+
- `pnpm` 9+ / 10+
- Docker & Docker Compose

```bash
# Install dependencies
pnpm install

# Run code checks
pnpm run lint
pnpm run typecheck
pnpm run test
```

## License
Copyright © 2026 Paul Hartmann. All rights reserved. Proprietary software.
