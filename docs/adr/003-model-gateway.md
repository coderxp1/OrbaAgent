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
- **Cost & Token Auditing:** Real-time token usage accounting, latency metrics, and prompt/response audit trails stored directly in PostgreSQL/ClickHouse.
- **Single Runtime Language:** Avoid introducing Python services into the core orchestrator infrastructure unless strictly justified.

---

## Evaluation: LiteLLM vs. Custom TypeScript Gateway

| Criteria | LiteLLM Proxy (Python) | Custom TypeScript Gateway (`services/model-gateway`) |
| :--- | :--- | :--- |
| **Language & Runtime** | Python 3.10+ container required | Native TypeScript / Node.js (matches entire stack) |
| **Type Safety & Schemas** | Pydantic / OpenAPI schema sync required | Direct shared Zod schemas with API and Agent Runtime |
| **Tool Calling Normalization**| Supported, but translates across provider formats | First-class TypeScript type checking and validation |
| **Memory & Cold Start** | Elevated memory footprint (~200MB+ per replica) | Lightweight Fastify service (~40-60MB) |
| **Audit & Database Integration**| Built-in UI, but requires its own database/tables | Direct integration with OrbaAgent `audit_log` schema |
| **Streaming Latency** | Additional proxy hop | Zero extra inter-service translation hop |

---

## Decision Outcome

**Decision:** Implement `services/model-gateway` as a high-performance, modular **TypeScript service** with vendor adapters, exposing a standardized internal REST/WebSocket and RPC contract.

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
- **Audit Logging:** Every invocation records caller ID, provider, model, input/output tokens, latency in milliseconds, and finish reason into the central audit ledger.
