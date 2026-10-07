#!/usr/bin/env bash
# Trusted bootstrap for OrbaAgent provisioning
# Run as root. Usage:
#   sudo /usr/local/sbin/bootstrap-provision.sh /path/to/orbaagent-provisioning.tar.gz

set -euo pipefail

BOOTSTRAP_NAME="bootstrap-provision.sh"
DEFAULT_EXPECTED_SHA256="2c9d83ca783507daf067339bcdbcdc9a6d8bc6b3f5831b4c18bbf25e01a59866"
# Whitelist: allowed exact paths or allowed subtrees
ALLOWED_TOPLEVEL=("deploy" "orba_gpu" "Dockerfile" "worker.py")
# Exact allowed files
ALLOWED_EXACT=(
  "Dockerfile"
  "worker.py"
  "deploy/provision-gpu-host.sh"
  "deploy/orbaagent-gpu"
  "deploy/compose.yaml"
  "deploy/worker.env.example"
  "deploy/sudoers-orbaagent-gpu"
  "deploy/ROLLBACK.md"
  "deploy/ACCEPTANCE.md"
  "deploy/check_compose_isolation.py"
  "deploy/wireguard/wg-orba.gpu-host.conf.example"
  "deploy/wireguard/wg-orba.production.conf.example"
)
# Allowed subtree prefixes (directories) — any regular files/dirs beneath are allowed, not special files
ALLOWED_PREFIXES=(
  "orba_gpu/"
  "deploy/wireguard/"
)

log(){ printf '\033[1;34m[BOOT]\033[0m %s\n' "$*"; }
die(){ printf '\033[1;31m[BOOT FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  die "bootstrap must be run as root"
fi

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  die "usage: $0 /path/to/provision-archive.tar.gz [expected_sha256]"
fi

ARCHIVE="$1"
EXPECTED_SHA256="${2:-$DEFAULT_EXPECTED_SHA256}"
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"

# Verify SHA-256
log "verifying archive SHA-256"
ACTUAL_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}') || die "sha256sum failed"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  die "archive SHA-256 mismatch\n expected: $EXPECTED_SHA256\n actual:   $ACTUAL_SHA256"
fi
log "archive integrity verified: $ACTUAL_SHA256"

# Create a safe temporary extraction directory owned by root, mode 0700
TMPDIR=$(mktemp -d -p /tmp orba-provision.XXXXXXXX) || die "mktemp failed"
chmod 0700 "$TMPDIR"
chown root:root "$TMPDIR"
log "created extraction dir $TMPDIR"

# Ensure cleanup on exit
cleanup(){
  rc=$?
  if [ -n "${TMPDIR:-}" ] && [ "$TMPDIR" != "/" ] && [[ "$TMPDIR" == /tmp/orba-provision.* ]]; then
    if [ ! -L "$TMPDIR" ]; then
      rm -rf "$TMPDIR" || true
    fi
  fi
  if [ $rc -ne 0 ]; then die "bootstrap aborted (cleanup done)"; fi
}
trap cleanup EXIT

# Preliminary tar listing checks: no absolute paths, no .. components, no symlinks, no devices, no unexpected top-level entries
log "inspecting archive contents"
# Use tar -tvf to read filetype indicator in the long listing
while IFS= read -r line; do
  # sample tar -tvf line: -rw-r--r-- user/group size date name
  # first char indicates type: - regular, d dir, l symlink, c device, b block, p fifo, s socket
  firstchar="${line:0:1}"
  # Extract filename: it's the last whitespace-separated field(s); use awk to get from 6th field onward
  name=$(printf '%s' "$line" | awk '{for(i=6;i<=NF;i++){printf "%s%s", $i, (i<NF?OFS:"")}}')
  # Normalize name: remove leading ./ if present
  name=${name#./}

  # Reject absolute paths
  case "$name" in
    /*) die "archive contains absolute path: $name" ;;
  esac
  # Reject .. traversal
  case "$name" in
    *..*) die "archive contains .. traversal in path: $name" ;;
  esac
  # Reject symlinks, devices, fifos, sockets, hardlink markers (anything not - or d)
  case "$firstchar" in
    '-'| 'd') ;;
    *) die "archive contains forbidden entry type ($firstchar) for $name" ;;
  esac
  # Check top-level allowed
  # Extract top-level component
  toplevel=${name%%/*}
  found=0
  for a in "${ALLOWED_TOPLEVEL[@]}"; do
    if [ "$toplevel" = "$a" ]; then found=1; break; fi
  done
  if [ $found -eq 0 ]; then
    die "archive contains unexpected top-level entry: $toplevel (from $name)"
  fi
done < <(tar -tvf "$ARCHIVE")

log "archive contents passed static checks"

# Extract into TMPDIR safely (we already validated names)
log "extracting archive into $TMPDIR"
tar -xvf "$ARCHIVE" -C "$TMPDIR" || die "tar extract failed"

# Ensure no symlinks or hardlinks exist after extraction (double-check)
if find "$TMPDIR" -type l -print -quit | grep -q . ; then
  die "extracted tree contains symlink(s)"
fi
# Hardlink detection: find files with multiple hardlink count >1
if find "$TMPDIR" -xdev -type f -printf '%h/%f %n\n' 2>/dev/null | awk '{if ($NF>1) print $0}' | grep -q .; then
  die "extracted tree contains hardlink(s)"
fi
# Device nodes/FIFOs/sockets
if find "$TMPDIR" \( -type p -o -type c -o -type b -o -type s \) -print -quit | grep -q . ; then
  die "extracted tree contains device nodes / fifos / sockets"
fi

# Ensure ownership and safe permissions
log "fixing ownership and permissions"
chown -R root:root "$TMPDIR"
# dirs 0755, files 0644, make provisioning scripts executable
find "$TMPDIR" -type d -exec chmod 0755 {} +
find "$TMPDIR" -type f -exec chmod 0644 {} +
# Make known script paths executable if present
if [ -f "$TMPDIR/deploy/provision-gpu-host.sh" ]; then
  chmod 0755 "$TMPDIR/deploy/provision-gpu-host.sh"
fi
if [ -f "$TMPDIR/deploy/orbaagent-gpu" ]; then
  chmod 0755 "$TMPDIR/deploy/orbaagent-gpu"
fi

# Final sanity: ensure the extracted provisioning script exists and is safe
PROV_SCRIPT="$TMPDIR/deploy/provision-gpu-host.sh"
if [ ! -f "$PROV_SCRIPT" ]; then
  die "provisioning script not found in archive"
fi
# ensure it's regular file, owner root, not writable by group/other
if [ ! -f "$PROV_SCRIPT" ] || [ "$(stat -c '%U' "$PROV_SCRIPT")" != "root" ]; then
  die "provisioning script has wrong type/owner"
fi
if [ "$(stat -c '%a' "$PROV_SCRIPT")" -gt 755 ]; then
  die "provisioning script has unsafe permissions"
fi

log "verified provisioning script at $PROV_SCRIPT; executing now"
# Execute provisioning script (it will run as root). Pass verified hash context.
BOOTSTRAP_VERIFIED_SHA256="$ACTUAL_SHA256" "$PROV_SCRIPT"

# If the provisioning script completes, cleanup trap will remove TMPDIR
log "provisioning completed successfully"
exit 0
