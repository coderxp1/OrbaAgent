#!/usr/bin/env bash
# OrbaAgent GPU host provisioning — ONE-TIME, ROOT ONLY.
#
# Run as root on 45.84.65.76:
#     sudo bash /tmp/orbaagent-provisioning-<id>/deploy/provision-gpu-host.sh
#
# The script locates its source bundle from its own path, so it works when run
# from the staging directory as well as from a checkout. Override with:
#     SOURCE_DIR=/path/to/bundle sudo -E bash .../provision-gpu-host.sh
#
# This script is intentionally NOT delegated to klaus. The sudoers policy grants
# klaus only the orbaagent-gpu wrapper, so host provisioning stays a root action
# that is run deliberately and audited.
#
# IMMUTABILITY MODEL
#   /etc/orbaagent/gpu-worker/     root:root, klaus CANNOT write
#     compose.yaml                 the GPU allowlist lives here
#     worker.env                   backend and ingest configuration
#     secrets/                     worker tokens, root:root 0600
#     src/                         build context: Dockerfile + worker code
#   /srv/projects/orbaagent-gpu/   klaus-owned working directory (no code, no
#                                  config) — rendered artifacts and scratch only
#
#   Editing anything under /etc/orbaagent/gpu-worker/ requires root, so klaus
#   cannot alter the GPU allowlist, the privileged settings, the host mounts, or
#   the networking. This is what makes the delegation safe.
#
# It is idempotent and every step is guarded. It DOES NOT:
#   * touch /srv/projects/coderxp
#   * stop, restart, or reconfigure the CoderXP/ComfyUI workload
#   * add klaus to the docker group
#   * expose Docker's socket or API to klaus
#   * open port 8190 to the public internet
#   * install model weights (a separate, explicit step)

set -euo pipefail

# Locate the bundle this script came from (…/deploy/ → bundle root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$(dirname "$SCRIPT_DIR")}"

REPO_DIR="${REPO_DIR:-/srv/projects/orbaagent-gpu}"
DEPLOY_DIR="/etc/orbaagent/gpu-worker"
SRC_DIR="$DEPLOY_DIR/src"
SECRETS_DIR="$DEPLOY_DIR/secrets"
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
# 1. Data directory: klaus-owned working area. Contains NO configuration and NO
#    build context, so ownership here cannot weaken isolation.
# ---------------------------------------------------------------------------
log "creating $REPO_DIR"
mkdir -p "$REPO_DIR"

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
log "working directory owned by ${WORKER_USER}:${WORKER_USER} (no code, no config)"

# ---------------------------------------------------------------------------
# 2. Root-owned configuration and build context. klaus can read nothing here
#    that lets it widen GPU access, and can write nothing at all.
# ---------------------------------------------------------------------------
log "installing root-owned configuration into $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR" "$SRC_DIR" "$SECRETS_DIR"
chown root:root /etc/orbaagent "$DEPLOY_DIR"
chmod 755 /etc/orbaagent "$DEPLOY_DIR"

[ -f "$SOURCE_DIR/deploy/compose.yaml" ] || die "missing $SOURCE_DIR/deploy/compose.yaml"
install -o root -g root -m 0644 "$SOURCE_DIR/deploy/compose.yaml" "$DEPLOY_DIR/compose.yaml"

# Build context: Dockerfile + worker package. Root-owned so klaus cannot modify
# worker code or Dockerfile flags.
log "installing build context into $SRC_DIR (root:root)"
install -o root -g root -m 0644 "$SOURCE_DIR/Dockerfile" "$SRC_DIR/Dockerfile"
install -o root -g root -m 0644 "$SOURCE_DIR/worker.py" "$SRC_DIR/worker.py"
rm -rf "$SRC_DIR/orba_gpu"
cp -r "$SOURCE_DIR/orba_gpu" "$SRC_DIR/orba_gpu"
# cp preserves the staging user's ownership; force root everywhere and strip
# group/other write from every file and directory.
chown -R root:root "$SRC_DIR"
find "$SRC_DIR" -type d -exec chmod 755 {} +
find "$SRC_DIR" -type f -exec chmod 644 {} +
find "$SRC_DIR" -name '*.pyc' -delete
rm -rf "$SRC_DIR"/**/__pycache__ 2>/dev/null || true
find "$SRC_DIR" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Fail closed if anything in the build context is writable by a non-root user.
if [ -n "$(find "$SRC_DIR" -perm /022 -print -quit)" ]; then
    die "build context contains group/world-writable paths; refusing to continue"
fi

if [ ! -f "$DEPLOY_DIR/worker.env" ]; then
    install -o root -g root -m 0600 "$SOURCE_DIR/deploy/worker.env.example" "$DEPLOY_DIR/worker.env"
    log "created $DEPLOY_DIR/worker.env (root:root 0600) — review it before starting"
else
    log "$DEPLOY_DIR/worker.env already exists; left untouched"
fi

# ---------------------------------------------------------------------------
# 3. Secrets: generated here, never echoed, never committed. They live under the
#    root-owned configuration directory and are mounted as Docker secrets, so
#    their values never appear in the environment or in `docker inspect`.
# ---------------------------------------------------------------------------
chmod 700 "$SECRETS_DIR"
for name in media_worker_token media_ingest_token; do
    target="$SECRETS_DIR/$name"
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
install -o root -g root -m 0755 "$SOURCE_DIR/deploy/orbaagent-gpu" "$WRAPPER"
[ -w "$WRAPPER" ] && die "wrapper is writable — refusing to continue"

# ---------------------------------------------------------------------------
# 5. Sudoers: validate BEFORE installing, so a typo cannot lock anyone out.
# ---------------------------------------------------------------------------
log "validating and installing sudoers policy"
tmp_sudoers="$(mktemp)"
install -o root -g root -m 0440 "$SOURCE_DIR/deploy/sudoers-orbaagent-gpu" "$tmp_sudoers"
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

Layout
  $DEPLOY_DIR/compose.yaml        root:root 0644   (GPU allowlist lives here)
  $DEPLOY_DIR/worker.env          root:root 0600
  $DEPLOY_DIR/secrets/            root:root 0700   (tokens, 0600)
  $DEPLOY_DIR/src/                root:root        (build context: Dockerfile + orba_gpu)
  $REPO_DIR                       ${WORKER_USER}:${WORKER_USER} 0750 (no code, no config)

Docker named volumes hold models, generated artifacts, and scratch:
  orbaagent-gpu_orbaagent_models / _output / _data

Next (still requires approval):
  1. sudo -u $WORKER_USER sudo orbaagent-gpu validate
  2. sudo -u $WORKER_USER sudo orbaagent-gpu build
  3. Download models into the models volume (see the acceptance procedure)
  4. sudo -u $WORKER_USER sudo orbaagent-gpu up
  5. Run the acceptance test procedure

Rollback: see deploy/ROLLBACK.md
EOF
