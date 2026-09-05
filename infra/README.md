# Infrastructure Directory (`infra/`)

## Responsibility
Contains deployment scripts, local development orchestration, and production ingress configurations.

## Subdirectories
- **`proxy/`**: Traefik v3 reverse proxy and `docker-socket-proxy` deployment files with Let's Encrypt DNS-01 automation via IONOS.
- **`scripts/`**: Operational scripts:
  - `server-inventory.sh`: Pre-cleanup server audit script for `85.215.156.241`.
  - `server-harden.sh`: Post-cleanup server hardening and user setup (Phase 0).
