# Computer Runtime Service (`services/computer-runtime`)

## Responsibility
The container sandbox management and live execution gateway:
- Lifecycle management of isolated, single-tenant Docker agent computers.
- Enforcement of isolation boundaries (ADR-002: no host mounts, dropped caps, resource quotas).
- WebSocket bridge for interactive terminal sessions (PTY) and screen frame streaming (VNC/noVNC).
- Egress proxy coordination and domain allowlist enforcement.
- Artifact capture and upload to MinIO S3 object storage.

## Technology Stack
- **Language:** TypeScript 5.5+
- **Container Engine:** Docker Engine API (via read-only socket proxy or TLS daemon)
- **Streaming:** WebSockets + binary PTY multiplexing
