# Orchestrator Service (`services/orchestrator`)

## Responsibility
The central workflow coordinator and distributed task dispatcher:
- Multi-agent coordination, subagent spawning, and dependency graphs.
- Distributed task queuing and worker pool autoscaling (backed by Redis / BullMQ).
- State persistence and checkpointing across long-running agent workflows.
- Workflow cancellation, timeouts, and pause/resume capabilities.

## Technology Stack
- **Language:** TypeScript 5.5+
- **Queue Engine:** BullMQ on Redis
- **State Store:** PostgreSQL via Drizzle ORM
