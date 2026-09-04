# Model Gateway Service (`services/model-gateway`)

## Responsibility
The unified provider-agnostic interface for all foundation model interactions:
- Exposes normalized chat, streaming, embedding, and tokenization endpoints (ADR-003).
- Adapters for OpenAI, Anthropic, Google Gemini, xAI, OpenRouter, and self-hosted vLLM/Ollama.
- Automatic provider failover, retry loops with jitter, and circuit breaking.
- Token consumption rate-limiting (sliding window per org/key).
- Central audit logging of token counts, latencies, costs, and finish reasons.

## Technology Stack
- **Language:** TypeScript 5.5+
- **Framework:** Fastify 5.x
- **Validation:** Zod schemas
- **Metrics:** OpenTelemetry + Prometheus exporter
