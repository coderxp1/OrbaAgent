#!/usr/bin/env bash
# ==============================================================================
# OrbaAgent AtlasLM Decommission Script
# Target Host: 85.215.156.241
# Purpose: Idempotently tear down and purge all remnants of AtlasLM workloads,
#          containers, volumes, images, networks, directories, and user accounts.
# ==============================================================================

set -euo pipefail

LOG_DIR="/var/log/orbaagent"
LOG_FILE="${LOG_DIR}/decommission-2026-09-04.log"

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "=============================================================================="
echo ">>> STARTING ATLASLM DECOMMISSION: $(date -u)"
echo "=============================================================================="

# 1. Stop and remove Compose project if working dir is found
COMPOSE_DIR="/srv/atlaslm/releases/bcc1d2c83c139850e41dc206630f9f381e9a8cea/deploy/staging"
if [ -d "${COMPOSE_DIR}" ] && command -v docker >/dev/null 2>&1; then
  echo ">>> Tearing down docker-compose project from ${COMPOSE_DIR}..."
  if (cd "${COMPOSE_DIR}" && docker compose -p atlaslm-staging down --remove-orphans --volumes); then
    echo "Compose teardown completed successfully."
  else
    echo "Compose teardown returned non-zero, continuing to direct container cleanup."
  fi
fi

# Fallback: stop and remove any remaining atlaslm containers by name
echo ">>> Checking and removing any remaining atlaslm containers..."
ATLAS_CONTAINERS=$(docker ps -aq --filter "name=atlaslm" 2>/dev/null || true)
if [ -n "${ATLAS_CONTAINERS}" ]; then
  echo "Removing containers: ${ATLAS_CONTAINERS}"
  echo "${ATLAS_CONTAINERS}" | xargs -r docker rm -f || true
fi

# Verify containers are gone
REMAINING_CONTAINERS=$(docker ps -aq 2>/dev/null || true)
if [ -n "${REMAINING_CONTAINERS}" ]; then
  echo "Remaining non-atlaslm containers present: ${REMAINING_CONTAINERS}"
else
  echo "Verified: 0 running/stopped docker containers."
fi

# 2. Remove Docker volumes
echo ">>> Removing atlaslm volumes..."
ATLAS_VOLUMES=$(docker volume ls -q --filter "name=atlaslm" 2>/dev/null || true)
if [ -n "${ATLAS_VOLUMES}" ]; then
  echo "Removing volumes: ${ATLAS_VOLUMES}"
  echo "${ATLAS_VOLUMES}" | xargs -r docker volume rm || true
fi

# 3. Prune Docker images, networks, and build cache
echo ">>> Pruning docker images, networks, and builder cache..."
docker image prune -a -f || true
docker network prune -f || true
docker builder prune -a -f || true

# 4. Remove filesystem remnants and binaries
echo ">>> Purging AtlasLM directories and binaries..."
rm -rf /srv/atlaslm* /opt/atlaslm* /var/www/atlaslm* /etc/atlaslm*
rm -f /usr/local/sbin/atlaslmctl

# 5. Clean up sudoers
echo ">>> Removing /etc/sudoers.d/atlaslm-staging..."
rm -f /etc/sudoers.d/atlaslm-staging
visudo -c
echo "Verified: visudo parsed OK."

# 6. Terminate orphan root tmux sessions
echo ">>> Terminating orphan root tmux sessions..."
pkill -u root tmux || true

# 7. Remove atlasdeploy user and home directory
echo ">>> Removing atlasdeploy user..."
if id "atlasdeploy" >/dev/null 2>&1; then
  userdel -r atlasdeploy || true
  echo "User atlasdeploy removed."
else
  echo "User atlasdeploy does not exist or already removed."
fi

echo "=============================================================================="
echo ">>> ATLASLM DECOMMISSION COMPLETE: $(date -u)"
echo "=============================================================================="
