#!/usr/bin/env bash
# ==============================================================================
# OrbaAgent Pre-Cleanup Server Inventory Script
# Target Host: 85.215.156.241
# Purpose: Inventory existing workloads, containers, networks, storage,
#          services, users, sudoers, and cron prior to Phase 0 cleanup.
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

log_section "SUDOERS CONFIGURATION & /etc/sudoers.d"
ls -la /etc/sudoers.d/ 2>/dev/null || true
for f in /etc/sudoers.d/*; do
  if [ -f "$f" ]; then
    echo "--- Sudoers file: $f ---"
    cat "$f"
  fi
done

log_section "RECENT LOGINS (last -a -n 30)"
last -a -n 30 2>/dev/null || true

log_section "HOME DIRECTORIES (/home/*)"
ls -la /home 2>/dev/null || true
for user_home in /home/*; do
  if [ -d "$user_home" ]; then
    echo "--- Contents of $user_home ---"
    ls -la "$user_home" 2>/dev/null || true
    if [ -d "$user_home/.ssh" ]; then
      echo "--- .ssh in $user_home ---"
      ls -la "$user_home/.ssh" 2>/dev/null || true
    fi
  fi
done

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

log_section "ALL SYSTEMD TIMERS (systemctl list-timers --all)"
systemctl list-timers --all --no-pager 2>/dev/null || true

log_section "CRON AUDIT & SCHEDULED TASKS"
echo "--- User Crontabs in /var/spool/cron/crontabs ---"
ls -la /var/spool/cron/crontabs 2>/dev/null || true
for crf in /var/spool/cron/crontabs/*; do
  if [ -f "$crf" ]; then
    echo "--- Crontab: $crf ---"
    cat "$crf" 2>/dev/null || true
  fi
done

echo "--- Root Crontab ---"
crontab -l 2>/dev/null || echo "No crontab for current user"

echo "--- /etc/crontab & /etc/cron.* ---"
cat /etc/crontab 2>/dev/null || true
ls -la /etc/cron* 2>/dev/null || true

echo "--- Grep for ssh / rsa / hourly tasks in cron ---"
grep -rnE "ssh|rsa|curl|wget|bash|python" /etc/cron* /var/spool/cron/crontabs 2>/dev/null || echo "No matches in cron"

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

log_section "APPLICATION ROOTS (/var/www, /opt)"
ls -la /var/www /opt 2>/dev/null || true

log_section "INVENTORY COMPLETE"
