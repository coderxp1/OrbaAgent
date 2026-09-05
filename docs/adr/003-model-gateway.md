# ADR-003: Model Gateway Architecture & LLM Provider Abstraction

**Status:** Accepted  
**Deciders:** Paul Hartmann, OrbaAgent Core Team  
**Date:** 2026-09-04  

---

## Context and Problem Statement

OrbaAgent relies heavily on foundation models across different modalities and capabilities:
- Complex planning and tool orchestration (Anthropic Claude 3.5 Sonnet, OpenAI GPT-4o)
- High-context reasoning and multimodal analysis (Google Gemini 1.5 Pro)
- Fast code generation and tool execution (xAI Grok, open-weights via vLLM / Ollama)
- Cost-effective routing and alternative providers (OpenRouter)

Directly coupling agent code to vendor SDKs creates lock-in, inconsistent streaming semantics, disparate tool-calling schemas, fragmented rate-limiting, and blind spots in audit logging.

---

## Decision Drivers

- **Provider-Agnostic Core:** Agent runtimes interact with a single, uniform model protocol.
- **Unified Streaming & Tool Use:** Consistent Server-Sent Events (SSE) streaming and typed JSON tool-call parsing across all providers.
- **Failover & Resiliency:** Automated model fallbacks when encountering rate limits (HTTP 429) or provider outages (HTTP 5xx).
- **Cost & Token Auditing:** Real-time token usage accounting, latency metrics, and prompt/response audit trails stored directly in PostgreSQL.
- **Single Runtime Language:** Avoid introducing Python services into the core backend infrastructure unless strictly justified.

---

## Evaluation: LiteLLM vs. Custom TypeScript Gateway

We evaluated whether to adopt [LiteLLM Proxy](https://github.com/BerriAI/litellm) (a popular Python-based multi-provider proxy) versus building a modular TypeScript gateway in `services/model-gateway`.

### Detailed Comparison

| Evaluation Dimension | LiteLLM Proxy (Python) | Custom TypeScript Gateway (`services/model-gateway`) |
| :--- | :--- | :--- |
| **Language & Runtime** | Requires Python 3.10+ runtime, pip/poetry dependencies, and a standalone Python container. | Native TypeScript / Node.js 22 LTS (matches 100% of the OrbaAgent codebase). |
| **Type Safety & Schemas** | Pydantic / OpenAPI schema sync required. Schema drift between Zod and Pydantic is a recurring risk. | Direct consumption of shared Zod schemas (`@orbaagent/shared`) for tool definitions and structured outputs. |
| **Tool Calling Normalization**| Supported, but translates across provider formats through internal heuristics. | First-class TypeScript type checking and validation directly against tool contracts. |
| **Memory & Cold Start** | Elevated footprint (~200MB–350MB RAM per replica); slower Python container initialization (~3–5s). | Lightweight Fastify service (~40MB–60MB RAM); instantaneous sub-second startup (<200ms). |
| **Audit Ledger Integration**| Bundles its own database schema and UI dashboard; requires webhook sync to central DB. | Native, zero-latency atomic writes into OrbaAgent's central PostgreSQL `audit_log` table. |
| **Streaming Latency** | Additional proxy hop with Python async loop chunk re-serialization. | Direct Node.js stream piping with minimal buffer allocation overhead. |
| **Operational Maintenance**| Two package management ecosystems (pnpm + pip), separate CVE tracking and security patching. | Single unified `pnpm` workspace, single security scanning pipeline (`gitleaks` + `biome`). |

### Why LiteLLM Was Rejected

1. **Ecosystem Fragmentation:** Adopting LiteLLM breaks the "TypeScript end-to-end" architectural principle (ADR-001). Introducing a Python service into core orchestrator infrastructure creates operational friction, dual Docker build pipelines, and separate vulnerability scanning tooling.
2. **Schema Friction for Tool Calling:** In OrbaAgent, agent tools are defined as typed TypeScript classes with Zod schemas. LiteLLM requires either serializing these to JSON Schema and parsing untyped dictionaries on the other side, or maintaining duplicate Pydantic models. A native TypeScript gateway preserves end-to-end type safety from tool declaration to model dispatch.
3. **Auditability & Tenancy Coupling:** OrbaAgent requires strict multi-tenant attribution (organization ID, user ID, agent run ID, and billing project ID) for every model token consumed. LiteLLM's internal database model is designed for generic API proxying, requiring custom database triggers or complex webhook relays to reconcile with OrbaAgent's billing and audit ledgers.
4. **Future Fallback Option:** If self-hosted open-weights model routing (e.g., vLLM cluster pooling) ever requires LiteLLM's specialized routing heuristics in Phase 2, LiteLLM can be deployed as an internal backend adapter behind the `ModelGateway` interface without exposing Python dependencies to the rest of the system.

---

## Decision Outcome

**Decision:** Implement `services/model-gateway` as a high-performance, modular **TypeScript Fastify service** with vendor adapters, exposing a standardized internal REST/WebSocket and RPC contract.

### 1. Unified Internal Contract
The gateway exposes four core primitives:
1. `chat(request: ChatRequest): Promise<ChatResponse>`
2. `streamChat(request: ChatRequest): AsyncIterable<ChatChunk>`
3. `embed(request: EmbedRequest): Promise<EmbedResponse>`
4. `tokenize(text: string, model: string): Promise<number>`

### 2. Provider Adapters
Modular adapters normalize API differences into standardized domain entities:
- `AnthropicAdapter` (Claude 3.5 Sonnet, Claude 3 Haiku)
- `OpenAIAdapter` (GPT-4o, GPT-4o-mini, o1)
- `GoogleAdapter` (Gemini 1.5 Pro, Gemini 1.5 Flash)
- `XAIAdapter` (Grok models via OpenAI-compatible endpoints)
- `OpenRouterAdapter` (Broader routing and fallback pool)
- `OpenAICompatibleAdapter` (Self-hosted vLLM / Ollama for local inference)

### 3. Resiliency & Policy Engine
- **Circuit Breakers & Retries:** Exponential backoff with jitter on transient network failures.
- **Fallback Chains:** Configurable model fallback sequences (e.g., `claude-3-5-sonnet` -> `gpt-4o` -> `gemini-1.5-pro`).
- **Rate Limiting:** Sliding window token and request limits enforced per organization and API key via Redis.
- **Audit Logging:** Every invocation records caller ID, tenant ID, provider, model, input/output tokens, latency in milliseconds, and finish reason into the central audit ledger.
