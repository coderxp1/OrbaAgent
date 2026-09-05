# OrbaAgent Desktop Application (`apps/desktop`)

## Responsibility
The cross-platform native desktop client for macOS, Windows, and Linux:
- Direct local filesystem access for agent workspaces with granular user permission gates.
- System-level notifications, global hotkeys, and menu bar tray status.
- Low-latency local proxy connection to local development environments and hardware.
- Native multi-window support for side-by-side agent computer previews and terminal consoles.

## Technology Stack
- **Framework:** Tauri v2 (Rust backend + Web frontend)
- **Frontend Core:** Shared TypeScript components with `apps/web`
- **Security:** Strict Tauri capability definitions and scope restrictions

## Development
```bash
pnpm --filter @orbaagent/desktop dev
```
