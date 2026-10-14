#!/usr/bin/env bash
# OrbaAgent GPU host provisioning — ONE-TIME, ROOT ONLY.
#
# Run as root on 45.84.65.76 via trusted bootstrap:
#     sudo /usr/local/sbin/bootstrap-provision.sh /path/to/archive.tar.gz
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
# Privileged path validation: enforce strict canonical paths and reject any deviations
# ---------------------------------------------------------------------------
[ "$REPO_DIR" = "/srv/projects/orbaagent-gpu" ] || die "Invalid REPO_DIR: must be strictly /srv/projects/orbaagent-gpu"
[ "$DEPLOY_DIR" = "/etc/orbaagent/gpu-worker" ] || die "Invalid DEPLOY_DIR: must be strictly /etc/orbaagent/gpu-worker"
[ "$SRC_DIR" = "/etc/orbaagent/gpu-worker/src" ] || die "Invalid SRC_DIR: must be strictly /etc/orbaagent/gpu-worker/src"
[ "$SECRETS_DIR" = "/etc/orbaagent/gpu-worker/secrets" ] || die "Invalid SECRETS_DIR: must be strictly /etc/orbaagent/gpu-worker/secrets"
[ "$WRAPPER" = "/usr/local/sbin/orbaagent-gpu" ] || die "Invalid WRAPPER: must be strictly /usr/local/sbin/orbaagent-gpu"
[ "$SUDOERS_FILE" = "/etc/sudoers.d/orbaagent-gpu" ] || die "Invalid SUDOERS_FILE: must be strictly /etc/sudoers.d/orbaagent-gpu"

# ---------------------------------------------------------------------------
# Validated safe destructive operations helper
# ---------------------------------------------------------------------------
safe_remove_tree() {
    local target="$1"
    local allowed_parent="$2"
    [ -n "$target" ] || die "safe_remove_tree: empty target"
    [ -n "$allowed_parent" ] || die "safe_remove_tree: empty allowed_parent"
    case "$target" in
        "$allowed_parent"/*) ;;
        *) die "safe_remove_tree: target '$target' is outside allowed parent '$allowed_parent'" ;;
    esac
    case "$target" in
        *..*) die "safe_remove_tree: traversal in '$target'" ;;
    esac
    case "$target" in
        /|/etc|/srv|/srv/projects|/srv/projects/coderxp|/usr|/var|/root|/home)
            die "safe_remove_tree: forbidden target '$target'" ;;
    esac
    if [ -L "$target" ]; then
        rm -f "$target"
    elif [ -d "$target" ]; then
        rm -rf "$target"
    elif [ -f "$target" ]; then
        rm -f "$target"
    fi
}

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
# 0.5. PREFLIGHT: Symlink/TOCTOU protection - check for symlinks in source
# ---------------------------------------------------------------------------
log "preflight: checking for symlinks in source bundle (TOCTOU protection)"
if [ -n "$(find "$SOURCE_DIR" -type l -print -quit)" ]; then
    die "SOURCE_DIR contains symlinks; refusing to continue (TOCTOU vulnerability)"
fi

# ---------------------------------------------------------------------------
# 0.6. PREFLIGHT: Hash verification - verify bundle integrity
# ---------------------------------------------------------------------------
log "preflight: verifying bundle integrity"
EXPECTED_SHA256="93c456b0b03fa6186550b5f7acf6cdd84d61c1fa71b6ae5906c7073f41160fbc"
ACTUAL_SHA256=$(cd "$SOURCE_DIR" && find . -type f ! -path "./.git/*" ! -name ".git*" ! -name "*.pyc" ! -name "provision-gpu-host.sh" -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}')
if [ -n "${BOOTSTRAP_VERIFIED_SHA256:-}" ]; then
    log "Bundle hash verification passed via trusted bootstrap: $BOOTSTRAP_VERIFIED_SHA256"
fi
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
    die "Bundle hash mismatch! Expected: $EXPECTED_SHA256, Got: $ACTUAL_SHA256"
else
    log "Bundle hash verification passed: $ACTUAL_SHA256"
fi

# ---------------------------------------------------------------------------
# 1. Data directory: klaus-owned working area. Contains NO configuration and NO
#    build context, so ownership here cannot weaken isolation.
# ---------------------------------------------------------------------------
log "creating $REPO_DIR"
mkdir -p "$REPO_DIR"

# Hardening Requirement 3: setfacl mandatory (fail-closed if missing)
if ! command -v setfacl >/dev/null 2>&1; then
    die "setfacl not found; install acl package for mandatory traverse-only ACL"
fi

# Traverse-only: klaus can cd into a known path but cannot enumerate
# /srv/projects, so CoderXP's presence and contents stay hidden.
setfacl -m "u:${WORKER_USER}:--x" /srv/projects
log "granted traverse-only ACL on /srv/projects to ${WORKER_USER}"

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
safe_remove_tree "$SRC_DIR/orba_gpu" "$DEPLOY_DIR"
cp -r "$SOURCE_DIR/orba_gpu" "$SRC_DIR/orba_gpu"
# cp preserves the staging user's ownership; force root everywhere and strip
# group/other write from every file and directory.
chown -R root:root "$SRC_DIR"
find "$SRC_DIR" -type d -exec chmod 755 {} +
find "$SRC_DIR" -type f -exec chmod 644 {} +
find "$SRC_DIR" -name '*.pyc' -delete
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
[ "$(stat -c '%u:%g' "$WRAPPER")" = "0:0" ] || die "$WRAPPER is not owned by root:root"
[ "$(stat -c '%a' "$WRAPPER")" = "755" ] || die "$WRAPPER mode must be strictly 0755"
[ -z "$(find "$WRAPPER" -perm /022 2>/dev/null)" ] || die "$WRAPPER has unsafe group or world write bits"
if id "$WORKER_USER" >/dev/null 2>&1; then
    if su -s /bin/sh "$WORKER_USER" -c "test -w '$WRAPPER'" 2>/dev/null; then
        die "wrapper is writable by $WORKER_USER — refusing to continue"
    fi
fi
log "wrapper installed and verified root:root 0755, not writable by $WORKER_USER"

# ---------------------------------------------------------------------------
# 5. Sudoers: validate BEFORE installing, so a typo cannot lock anyone out.
# ---------------------------------------------------------------------------
log "validating and installing sudoers policy"
tmp_sudoers="$(mktemp)"
install -o root -g root -m 0440 "$SOURCE_DIR/deploy/sudoers-orbaagent-gpu" "$tmp_sudoers"
visudo -cf "$tmp_sudoers" || die "sudoers policy failed validation; not installed"
install -o root -g root -m 0440 "$tmp_sudoers" "$SUDOERS_FILE"
safe_remove_tree "$tmp_sudoers" "/tmp"
log "installed $SUDOERS_FILE"

# ---------------------------------------------------------------------------
# 6. Firewall: worker reachable ONLY from production, over the tunnel.
# ---------------------------------------------------------------------------
# Hardening Requirement: Firewall fail-closed
if command -v ufw >/dev/null 2>&1; then
    log "applying firewall rules (fail-closed)"
    # WireGuard handshake from production only.
    ufw allow from "$PRODUCTION_IP" to any port 51820 proto udp comment 'OrbaAgent WG'
    # Worker port restricted to the tunnel peer address, on the tunnel interface (INPUT chain).
    ufw route delete allow in on wg-orba from 10.77.0.1 to 10.77.0.2 port 8190 proto tcp 2>/dev/null || true
    ufw delete allow in on wg-orba from 10.77.0.1 to 10.77.0.2 port 11434 proto tcp 2>/dev/null || true
    ufw allow in on wg-orba from 10.77.0.1 to 10.77.0.2 port 8190 proto tcp comment 'OrbaAgent worker'
    ufw allow in on wg-orba from 10.77.0.1 to 10.77.0.2 port 11435 proto tcp comment 'OrbaAgent Ollama'
    ufw --force enable
    ufw status verbose

    # Hardening: Validate firewall status meets security invariants
    log "verifying firewall rules via fw_wg_verify (fail-closed check)"
    PYTHONPATH="$SRC_DIR" python3 -m orba_gpu.fw_wg_verify_cli --ufw-only || die "Firewall verification failed"
    log "Firewall verification passed (strictly tunnel-restricted)"
else
    die "ufw not found; firewall rules are mandatory for fail-closed posture"
fi

# ---------------------------------------------------------------------------
# 6.5. WireGuard verification
# ---------------------------------------------------------------------------
log "verifying WireGuard interface state"
if ip link show wg-orba >/dev/null 2>&1; then
    PYTHONPATH="$SRC_DIR" python3 -m orba_gpu.fw_wg_verify_cli --wg-only || die "WireGuard verification failed"
    log "WireGuard verification passed"
else
    log "WireGuard interface wg-orba not active yet; verify once wg-quick@wg-orba is started"
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