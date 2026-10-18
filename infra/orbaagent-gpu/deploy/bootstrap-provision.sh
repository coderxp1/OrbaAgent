#!/usr/bin/env bash
# Trusted bootstrap for OrbaAgent provisioning
# Run as root. Usage:
#   sudo /usr/local/sbin/bootstrap-provision.sh /path/to/orbaagent-provisioning.tar.gz

set -euo pipefail

DEFAULT_EXPECTED_SHA256="232974bafdb5c3f5df13e4bfe79aa3488202469b80bfaec3632fe00c66515ecf"
# Whitelist: allowed exact paths or allowed subtrees
export ALLOWED_EXACT="Dockerfile
Dockerfile.comfyui
worker.py
deploy/provision-gpu-host.sh
deploy/orbaagent-gpu
deploy/compose.yaml
deploy/worker.env.example
deploy/sudoers-orbaagent-gpu
deploy/ROLLBACK.md
deploy/ACCEPTANCE.md
deploy/check_compose_isolation.py
deploy/wireguard/wg-orba.gpu-host.conf.example
deploy/wireguard/wg-orba.production.conf.example"

export ALLOWED_PREFIXES="orba_gpu/
deploy/wireguard/"

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

log "verifying archive SHA-256"
ACTUAL_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}') || die "sha256sum failed"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  die "archive SHA-256 mismatch\n expected: $EXPECTED_SHA256\n actual:   $ACTUAL_SHA256"
fi
log "archive integrity verified: $ACTUAL_SHA256"

TMPDIR=$(mktemp -d -p /tmp orba-provision.XXXXXXXX) || die "mktemp failed"
chmod 0700 "$TMPDIR"
chown root:root "$TMPDIR"
log "created extraction dir $TMPDIR"

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

log "inspecting and securely extracting archive contents via python"
python3 -c '
import tarfile, sys, os

archive = sys.argv[1]
dest_dir = sys.argv[2]
allowed_exact = set(filter(bool, os.environ["ALLOWED_EXACT"].split("\n")))
allowed_prefixes = tuple(filter(bool, os.environ["ALLOWED_PREFIXES"].split("\n")))

try:
    with tarfile.open(archive, "r:gz") as tf:
        members = tf.getmembers()
        paths_map = {}  # Maps canonical_name -> "FILE" | "DIR" | "IMPLICIT_DIR"
        
        # 1. Establish an unambiguous extraction root
        dest_dir_abs = os.path.abspath(dest_dir)
        
        for m in members:
            name = m.name
            
            if not name:
                sys.exit("empty name in archive")
            if "\\" in name:
                sys.exit(f"platform-specific separator in archive: {name!r}")
            if "//" in name:
                sys.exit(f"repeated separator in archive: {name!r}")
            
            parts = name.split("/")
            
            # Reject path traversal and embedded dot components entirely (except an optional leading "./")
            if ".." in parts:
                sys.exit(f"path traversal component in archive: {name!r}")
            if "." in parts and not (len(parts) == 1 and parts[0] == ".") and not (parts[0] == "." and "." not in parts[1:]):
                sys.exit(f"embedded dot component in archive: {name!r}")
            if name.startswith("/"):
                sys.exit(f"absolute path in archive: {name!r}")
            if not (m.isfile() or m.isdir()):
                sys.exit(f"forbidden entry type (symlink/device/etc) for {name!r}")
            
            canonical_parts = [p for p in parts if p and p != "."]
            if not canonical_parts:
                if m.isdir():
                    continue
                else:
                    sys.exit(f"member attempts to overwrite extraction root: {name!r}")
            canonical_name = "/".join(canonical_parts)
            
            member_type = "DIR" if m.isdir() else "FILE"
            
            # 2. Make collision detection complete using explicit map
            current_parts = []
            for part in canonical_parts[:-1]:
                current_parts.append(part)
                parent_path = "/".join(current_parts)
                if parent_path in paths_map:
                    if paths_map[parent_path] == "FILE":
                        sys.exit(f"file used as parent directory: {parent_path!r}")
                else:
                    paths_map[parent_path] = "IMPLICIT_DIR"
                    
            if canonical_name in paths_map:
                existing_type = paths_map[canonical_name]
                if existing_type == "FILE" or member_type == "FILE":
                    sys.exit(f"file-vs-directory collision or duplicate path for: {canonical_name!r}")
                if existing_type == "DIR" and member_type == "DIR":
                    sys.exit(f"duplicate canonical directory: {canonical_name!r}")
            
            paths_map[canonical_name] = member_type

            # Check allowlist using canonical directory trailing slash convention
            match_name = canonical_name if member_type == "FILE" else canonical_name + "/"
            is_allowed = False
            if match_name in allowed_exact:
                is_allowed = True
            elif any(match_name.startswith(p) for p in allowed_prefixes):
                is_allowed = True
            elif match_name.endswith("/") and any(e.startswith(match_name) for e in allowed_exact):
                is_allowed = True

            if not is_allowed:
                sys.exit(f"unexpected path in archive not in allowlist: {canonical_name!r}")
                
            # Construct destination and verify path-aware containment
            target_path = os.path.abspath(os.path.join(dest_dir_abs, canonical_name))
            try:
                common = os.path.commonpath([dest_dir_abs, target_path])
                if common != dest_dir_abs:
                    sys.exit(f"path escaped destination directory: {canonical_name!r}")
            except ValueError:
                sys.exit(f"path containment evaluation failed: {canonical_name!r}")
                
            if target_path == dest_dir_abs:
                sys.exit(f"member attempts to overwrite extraction root: {canonical_name!r}")
        
        # Double check against TOCTOU race on the exact immutable root before extraction
        if not os.path.isdir(dest_dir_abs) or os.path.islink(dest_dir_abs):
            sys.exit("critical error: destination directory was replaced or is a symlink")
        
        # Validation passed. Extract using the SAME parser and file descriptor to prevent TOCTOU.
        # Ensure we only extract the explicitly validated member objects.
        # Use numeric_owner=True to prevent extracting as arbitrary users matching tar UIDs
        tf.extractall(path=dest_dir_abs, members=members, numeric_owner=True)
except Exception as e:
    sys.exit(f"tarfile parse or extraction error: {e}")
' "$ARCHIVE" "$TMPDIR" || die "archive content validation and extraction failed"

log "archive safely extracted into $TMPDIR"

# Double check extracted tree
if find "$TMPDIR" -type l -print -quit | grep -q . ; then
  die "extracted tree contains symlink(s)"
fi
if find "$TMPDIR" -xdev -type f -printf '%h/%f %n\n' 2>/dev/null | awk '{if ($NF>1) print $0}' | grep -q .; then
  die "extracted tree contains hardlink(s)"
fi
if find "$TMPDIR" \( -type p -o -type c -o -type b -o -type s \) -print -quit | grep -q . ; then
  die "extracted tree contains device nodes / fifos / sockets"
fi

log "fixing ownership and permissions"
chown -R root:root "$TMPDIR"
find "$TMPDIR" -type d -exec chmod 0755 {} +
find "$TMPDIR" -type f -exec chmod 0644 {} +

PROV_SCRIPT="$TMPDIR/deploy/provision-gpu-host.sh"
if [ ! -f "$PROV_SCRIPT" ]; then
  die "provisioning script not found in archive"
fi
if [ "$(stat -c '%U' "$PROV_SCRIPT")" != "root" ]; then
  die "provisioning script has wrong owner"
fi
if [ "$(stat -c '%a' "$PROV_SCRIPT")" -gt 755 ]; then
  die "provisioning script has unsafe permissions"
fi
chmod 0755 "$PROV_SCRIPT"
if [ -f "$TMPDIR/deploy/orbaagent-gpu" ]; then
  chmod 0755 "$TMPDIR/deploy/orbaagent-gpu"
fi

EXPECTED_PROV_SCRIPT_HASH="e6eaac41a263cfd348b0a4663ee456a90266428a4d2b0128a51183cc314e47b5"
PROV_SCRIPT_HASH=$(sha256sum "$PROV_SCRIPT" | awk '{print $1}')
if [ "$PROV_SCRIPT_HASH" != "$EXPECTED_PROV_SCRIPT_HASH" ]; then
  die "provisioning script hash mismatch! Expected: $EXPECTED_PROV_SCRIPT_HASH, Actual: $PROV_SCRIPT_HASH"
fi
log "verified provisioning script at $PROV_SCRIPT with hash $PROV_SCRIPT_HASH; executing now"

# Only execute the provision script if it is successfully verified
BOOTSTRAP_VERIFIED_SHA256="$ACTUAL_SHA256" "$PROV_SCRIPT"

log "provisioning completed successfully"
exit 0
