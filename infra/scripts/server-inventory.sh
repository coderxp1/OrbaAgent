#!/usr/bin/env bash
# ==============================================================================
# OrbaAgent Pre-Cleanup Server Inventory Script
# Target Host: 85.215.156.241
# Purpose: Inventory existing workloads, containers, networks, storage,
#          services, and users prior to any Phase 0 cleanup.
# ==============================================================================

set -euo pipefail

log_section() {
  echo ""
  echo "=============================================================================="
  echo ">>> $1"
  echo "=============================================================================="
}

log_section "OS RELEASE & KERNEL"
if [ -f /etc/os-release ]; then
  cat /etc/os-release
fi
uname -r

log_section "LOCAL NON-SYSTEM USERS (UID >= 1000)"
getent passwd | awk -F: '$3>=1000 {print $1 " (UID: "$3", GID: "$4", Home: "$6", Shell: "$7")"}'

log_section "DOCKER CONTAINERS (ALL)"
if command -v docker >/dev/null 2>&1; then
  docker ps -a --no-trunc || true
else
  echo "docker binary not found in PATH"
fi

log_section "DOCKER IMAGES"
if command -v docker >/dev/null 2>&1; then
  docker images || true
fi

log_section "DOCKER VOLUMES"
if command -v docker >/dev/null 2>&1; then
  docker volume ls || true
fi

log_section "DOCKER NETWORKS"
if command -v docker >/dev/null 2>&1; then
  docker network ls || true
fi

log_section "DISCOVERED COMPOSE FILES"
find / -name "docker-compose*.yml" -o -name "compose*.yml" 2>/dev/null | grep -v "/proc" | grep -v "/sys" || true

log_section "REVERSE PROXY & SSL CERTS (/etc/nginx, /etc/letsencrypt)"
ls -la /etc/nginx/conf.d /etc/nginx/sites-enabled /etc/letsencrypt/live 2>/dev/null || true

log_section "RUNNING SYSTEMD SERVICES (TOP 30)"
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -n 30 || true

log_section "ACTIVE SYSTEMD TIMERS"
systemctl list-timers --no-pager 2>/dev/null || true

log_section "CRON JOBS"
echo "--- Root Crontab ---"
crontab -l 2>/dev/null || echo "No crontab for current user"
echo "--- System Cron Directories ---"
ls -la /etc/cron* 2>/dev/null || true

log_section "DATABASE DATA DIRECTORIES"
ls -la /var/lib/mysql /var/lib/postgresql 2>/dev/null || echo "No mysql or postgresql data dirs in /var/lib"

log_section "LISTENING PORTS & SERVICES"
ss -tulpn || true

log_section "FIREWALL STATUS (UFW)"
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
else
  echo "ufw binary not found"
fi

log_section "DISK USAGE (df -h)"
df -h

log_section "LARGEST DIRECTORIES (du top 30 depth 2)"
du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -n 30 || true

log_section "APPLICATION ROOTS (/var/www, /opt, /home)"
ls -la /var/www /opt /home 2>/dev/null || true

log_section "INVENTORY COMPLETE"
