# Agent Runtime Service (`services/agent-runtime`)

## Responsibility
The execution engine responsible for hosting individual agent thought-action loops:
- Reasoning and decision loop execution (ReAct, plan-and-solve workflows).
- Context window management, message compaction, and semantic memory retrieval.
- Tool invocation dispatch to `services/computer-runtime` and external APIs.
- Model invocation dispatch through `services/model-gateway`.
- Real-time event streaming to client subscribers via Redis pub/sub.

## Technology Stack
- **Language:** TypeScript 5.5+
- **Protocol:** gRPC / internal HTTP & Redis Streams
- **Validation:** Zod schemas shared via `packages/shared`
