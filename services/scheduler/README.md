# Scheduler Service (`services/scheduler`)

## Responsibility
The time-based recurring job and cron orchestration service:
- Triggers recurring agent tasks, scheduled health audits, and cleanup routines.
- Guarantees exactly-once execution semantics across multi-replica deployments using distributed Redis locks.
- Dispatches scheduled tasks into `services/orchestrator` queues.
- Observes execution deadlines and triggers alerting on missed intervals.

## Technology Stack
- **Language:** TypeScript 5.5+
- **Scheduling:** BullMQ repeatable jobs / Redis redlock
