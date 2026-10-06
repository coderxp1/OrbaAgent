#!/usr/bin/env bash
# OrbaAgent GPU host provisioning — ONE-TIME, ROOT ONLY.
#
# Run as root on 45.84.65.76:
#     sudo bash provision-gpu-host.sh
#
# This script is intentionally NOT delegated to klaus. The sudoers policy grants
# klaus only the orbaagent-gpu wrapper, so host provisioning stays a root action
# that is run deliberately and audited.
#
# It is idempotent and every step is guarded. It DOES NOT:
#   * touch /srv/projects/coderxp
#   * stop, restart, or reconfigure the CoderXP/ComfyUI workload
#   * add klaus to the docker group
#   * expose Docker's socket or API to klaus
#   * open port 8190 to the public internet
#   * install model weights (a separate, explicit step)

set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/projects/orbaagent-gpu}"
DEPLOY_DIR="/etc/orbaagent/gpu-worker"
WRAPPER="/usr/local/sbin/orbaagent-gpu"
SUDOERS_FILE="/etc/sudoers.d/orbaagent-gpu"
WORKER_USER="${WORKER_USER:-klaus}"
EXPECTED_GPU_UUID="GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"
FORBIDDEN_GPU_UUID="GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4"
PRODUCTION_IP="85.215.156.241"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"

# ---------------------------------------------------------------------------
# 0. Preflight: confirm we are on the right host and GPU 0 is as expected.
# ---------------------------------------------------------------------------
log "preflight: verifying GPU inventory"
command -v nvidia-smi >/dev/null || die "nvidia-smi not found"

if ! nvidia-smi -i "$EXPECTED_GPU_UUID" --query-gpu=uuid --format=csv,noheader >/dev/null 2>&1; then
    die "expected GPU $EXPECTED_GPU_UUID not present on this host"
fi

# Record GPU 0 state so the acceptance step can prove it did not move.
GPU0_BEFORE="$(nvidia-smi -i "$FORBIDDEN_GPU_UUID" --query-gpu=memory.used --format=csv,noheader 2>/dev/null || echo 'unknown')"
GPU0_PROCS_BEFORE="$(nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader 2>/dev/null | grep "$FORBIDDEN_GPU_UUID" || true)"
log "GPU 0 memory in use before provisioning: ${GPU0_BEFORE}"
log "GPU 0 processes before provisioning:"
printf '%s\n' "${GPU0_PROCS_BEFORE:-  (none)}"

# ---------------------------------------------------------------------------
# 1. Directory: dedicated to OrbaAgent, owned by the worker user.
#    /srv/projects stays 0710 root:coderxp-media; we add a traverse-only ACL so
#    klaus can reach this one child without being able to list its siblings.
# ---------------------------------------------------------------------------
log "creating $REPO_DIR"
mkdir -p "$REPO_DIR" "$REPO_DIR/models" "$REPO_DIR/output" "$REPO_DIR/data" "$REPO_DIR/secrets"

if command -v setfacl >/dev/null 2>&1; then
    # Traverse-only: klaus can cd into a known path but cannot enumerate
    # /srv/projects, so CoderXP's presence and contents stay hidden.
    setfacl -m "u:${WORKER_USER}:--x" /srv/projects
    log "granted traverse-only ACL on /srv/projects to ${WORKER_USER}"
else
    warn "setfacl not found; install acl or /srv/projects traversal will fail for ${WORKER_USER}"
fi

chown -R "${WORKER_USER}:${WORKER_USER}" "$REPO_DIR"
chmod 750 "$REPO_DIR"
chmod 700 "$REPO_DIR/secrets"
log "ownership set to ${WORKER_USER}:${WORKER_USER}"

# ---------------------------------------------------------------------------
# 2. Root-owned configuration. klaus can read nothing here that lets it widen
#    GPU access, and can write nothing at all.
# ---------------------------------------------------------------------------
log "installing root-owned configuration into $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
chown root:root "$DEPLOY_DIR"
chmod 755 "$DEPLOY_DIR"

[ -f "$REPO_DIR/deploy/compose.yaml" ] || die "missing $REPO_DIR/deploy/compose.yaml"
install -o root -g root -m 0644 "$REPO_DIR/deploy/compose.yaml" "$DEPLOY_DIR/compose.yaml"

if [ ! -f "$DEPLOY_DIR/worker.env" ]; then
    install -o root -g root -m 0600 "$REPO_DIR/deploy/worker.env.example" "$DEPLOY_DIR/worker.env"
    log "created $DEPLOY_DIR/worker.env (root:root 0600) — review it before starting"
else
    log "$DEPLOY_DIR/worker.env already exists; left untouched"
fi

# ---------------------------------------------------------------------------
# 3. Secrets: generated here, never echoed, never committed.
# ---------------------------------------------------------------------------
for name in media_worker_token media_ingest_token; do
    target="$REPO_DIR/secrets/$name"
    if [ ! -s "$target" ]; then
        umask 077
        openssl rand -hex 32 > "$target"
        chown root:root "$target"
        chmod 600 "$target"
        log "generated $target (64 hex chars, not displayed)"
    else
        log "$target already exists; left untouched"
    fi
done

# ---------------------------------------------------------------------------
# 4. Wrapper: root-owned, not writable by the worker user.
# ---------------------------------------------------------------------------
log "installing wrapper $WRAPPER"
install -o root -g root -m 0755 "$REPO_DIR/deploy/orbaagent-gpu" "$WRAPPER"
[ -w "$WRAPPER" ] && die "wrapper is writable — refusing to continue"

# ---------------------------------------------------------------------------
# 5. Sudoers: validate BEFORE installing, so a typo cannot lock anyone out.
# ---------------------------------------------------------------------------
log "validating and installing sudoers policy"
tmp_sudoers="$(mktemp)"
install -o root -g root -m 0440 "$REPO_DIR/deploy/sudoers-orbaagent-gpu" "$tmp_sudoers"
visudo -cf "$tmp_sudoers" || die "sudoers policy failed validation; not installed"
install -o root -g root -m 0440 "$tmp_sudoers" "$SUDOERS_FILE"
rm -f "$tmp_sudoers"
log "installed $SUDOERS_FILE"

# ---------------------------------------------------------------------------
# 6. Firewall: worker reachable ONLY from production, over the tunnel.
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
    log "applying firewall rules"
    # WireGuard handshake from production only.
    ufw allow from "$PRODUCTION_IP" to any port 51820 proto udp comment 'OrbaAgent WG' || true
    # Worker port restricted to the tunnel peer address, on the tunnel interface.
    ufw route allow in on wg-orba from 10.77.0.1 to 10.77.0.2 port 8190 proto tcp comment 'OrbaAgent worker' || true
    ufw --force enable >/dev/null 2>&1 || true
    ufw status verbose || true
else
    warn "ufw not found; apply the equivalent rules with your firewall tool"
fi

# ---------------------------------------------------------------------------
# 7. Explicitly assert we never touched CoderXP.
# ---------------------------------------------------------------------------
if [ -d /srv/projects/coderxp ]; then
    log "CoderXP directory present and untouched (no writes performed)"
else
    warn "/srv/projects/coderxp not visible to root check — verify manually"
fi

GPU0_AFTER="$(nvidia-smi -i "$FORBIDDEN_GPU_UUID" --query-gpu=memory.used --format=csv,noheader 2>/dev/null || echo 'unknown')"
log "GPU 0 memory in use after provisioning: ${GPU0_AFTER}"
if [ "$GPU0_BEFORE" != "$GPU0_AFTER" ]; then
    warn "GPU 0 memory changed during provisioning (${GPU0_BEFORE} -> ${GPU0_AFTER}); investigate before continuing"
fi

cat <<EOF

Provisioning complete. Nothing has been started or downloaded.

Next (still requires approval):
  1. Copy the repository worker sources into $REPO_DIR
     (orba_gpu/, worker.py, Dockerfile, compose.yaml, deploy/)
  2. sudo -u $WORKER_USER sudo orbaagent-gpu validate
  3. sudo -u $WORKER_USER sudo orbaagent-gpu build
  4. Download models into $REPO_DIR/models (see the acceptance procedure)
  5. sudo -u $WORKER_USER sudo orbaagent-gpu up
  6. Run the acceptance test procedure

Rollback: see deploy/ROLLBACK.md
EOF
