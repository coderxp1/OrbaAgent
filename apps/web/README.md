# OrbaAgent Web Application (`apps/web`)

## Responsibility
The primary web interface for OrbaAgent, delivering:
- Organization, workspace, and team management dashboards.
- Real-time agent collaboration, chat, and prompt interfaces.
- Live agent computer observation canvas (VNC/streaming/interactive terminal view).
- Execution run history, step visualization, and audit log inspection.
- API key, billing, and provider configuration settings.

## Technology Stack
- **Framework:** Next.js (App Router, React 19, TypeScript)
- **Styling:** Vanilla CSS / Tailwind CSS tokenized design system
- **State Management:** TanStack Query + Zustand
- **Realtime:** WebSockets / SSE clients connected to `apps/api` and `services/computer-runtime`

## Development
```bash
pnpm --filter @orbaagent/web dev
```
