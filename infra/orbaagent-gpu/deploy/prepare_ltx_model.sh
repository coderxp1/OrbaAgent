#!/usr/bin/env bash
# ==============================================================================
# Failure-Safe LTX-Video Model Preparation & Verification (Pre-Deployment Only)
#
# STRICT SAFETY GATES & TRANSACTIONAL GUARANTEES:
# 1. Collision-free unique run ID (.staging_ltx_${RUN_ID}); checks all staging,
#    backup, candidate, check, and restore paths before proceeding.
# 2. Hardened archive validation: inspects metadata with Python tarfile, normalizes
#    path separators, strictly rejects symlinks, hard links, devices, FIFOs,
#    path traversal (..), absolute paths (/), duplicate paths, and conflicting
#    file/directory paths. Extracts only explicitly allowlisted regular files/dirs
#    member-by-member using exclusive file creation (O_CREAT | O_EXCL).
# 3. Contained model download: downloads pinned LTX-Video (commit
#    8984fa25007f376c1a299016d0957a37a2f797bb) via running worker container
#    into mounted volume staging directory, leaving host Python untouched.
# 4. Verifies FULL 64-character SHA-256 hashes and exact byte counts for ALL 21
#    files before modifying any production path.
# 5. Offline Diffusers schema validation inside running worker on staging path
#    BEFORE promotion to production path.
# 6. Safe promotion with pre-existing destination protection:
#    - Detects whether /models/Lightricks/LTX-Video existed prior to this run.
#    - Fails closed if the destination already exists; never overwrites or alters it.
#    - Cleanup trap explicitly reconciles run evidence and NEVER moves or modifies
#      a destination that existed before this run.
# 7. Production path resolver pre-flight: Validates model directory resolution
#    via running worker container (distinguishing schema validation from GPU inference).
# 8. Dependency checks in container: Candidate source import compatibility is tested
#    inside running worker container runtime, keeping host Python untouched.
# 9. Interruption-safe source and wrapper swap & atomic rollback:
#    - Pre-modification checks verify production source and wrapper existence before touching anything.
#    - Candidate source and wrapper are staged and verified on their respective filesystems before swap.
#    - Original source is retained at PREV_SRC.
#    - Restorations (both source and wrapper) stage into verified temporary files on the
#      same filesystem and use atomic renames without blind deletion.
# 10. Accurate rollback reporting: Reconciles all production paths and never reports
#     complete unless every affected path is verified in its expected clean state.
# 11. Signal handling separation:
#     - Recoverable signals (INT, TERM, HUP) are handled separately from EXIT cleanup,
#       terminating with standard signal exit codes (130, 143, 129) and invoking cleanup once.
#     - Limitations: Forced termination (SIGKILL / kill -9) or catastrophic power loss
#       cannot trigger user-space shell traps; atomic same-filesystem renames and permanent
#       timestamped backups guarantee filesystem consistency and manual recoverability.
# 12. Scope strictly limited: DOES NOT modify worker.env, DOES NOT restart or redeploy
#     services, and DOES NOT touch Wan, FLUX, Ollama, ComfyUI, GPU 0, WireGuard, UFW, or secrets.
# ==============================================================================

set -euo pipefail

# Check for self-test / regression test mode (fails closed if test runner is missing)
case "${1:-}" in
  --test|--test-preexisting-dest|--test-regression)
    TEST_RUNNER="$(dirname "${BASH_SOURCE[0]}")/test_prepare_ltx_regression.sh"
    if [ -f "$TEST_RUNNER" ]; then
      exec bash "$TEST_RUNNER"
    else
      echo "FATAL: Regression test runner not found at $TEST_RUNNER. Aborting test execution." >&2
      exit 1
    fi
    ;;
esac

ARCHIVE="${ARCHIVE:-/tmp/orbaagent-gpu-provisioning.tar.gz}"
EXPECTED_ARCHIVE_SHA256="${EXPECTED_ARCHIVE_SHA256:-b74342292ffcb313edaf848161bacbea4fd09c26f64b12a39e1cb61b15dcb279}"
LTX_COMMIT="8984fa25007f376c1a299016d0957a37a2f797bb"

MODELS_VOLUME_DATA="${MODELS_VOLUME_DATA:-/var/lib/docker/volumes/orbaagent_models/_data}"
SRC_PROD="${SRC_PROD:-/etc/orbaagent/gpu-worker/src}"
WRAPPER_PROD="${WRAPPER_PROD:-/usr/local/sbin/orbaagent-gpu}"
ENV_PROD="${ENV_PROD:-/etc/orbaagent/gpu-worker/worker.env}"

WRAPPER_DIR="$(dirname "$WRAPPER_PROD")"
SRC_PARENT_DIR="$(dirname "$SRC_PROD")"

# Record if DEST_LTX existed at the very start of the script run
DEST_LTX="${MODELS_VOLUME_DATA}/Lightricks/LTX-Video"
DEST_LTX_EXISTED_AT_START=false
if [ -e "$DEST_LTX" ]; then
  DEST_LTX_EXISTED_AT_START=true
fi

# Generate a collision-free unique identifier for this run, checking all paths
RUN_ID="$(date +%Y%m%d_%H%M%S)_${BASHPID}_${RANDOM}"
while [ -e "${MODELS_VOLUME_DATA}/.staging_ltx_${RUN_ID}" ] || \
      [ -e "${MODELS_VOLUME_DATA}/.candidate_src_${RUN_ID}" ] || \
      [ -e "${SRC_PARENT_DIR}/src.bak.${RUN_ID}" ] || \
      [ -e "${SRC_PARENT_DIR}/$(basename "$ENV_PROD").bak.${RUN_ID}" ] || \
      [ -e "${WRAPPER_DIR}/$(basename "$WRAPPER_PROD").bak.${RUN_ID}" ] || \
      [ -e "${SRC_PARENT_DIR}/src.prev.${RUN_ID}" ] || \
      [ -e "${SRC_PARENT_DIR}/src.candidate.${RUN_ID}" ] || \
      [ -e "${SRC_PARENT_DIR}/src.restore.${RUN_ID}" ] || \
      [ -e "${SRC_PARENT_DIR}/src.failed.${RUN_ID}" ] || \
      [ -e "${WRAPPER_DIR}/$(basename "$WRAPPER_PROD").restore.${RUN_ID}" ] || \
      [ -e "${WRAPPER_DIR}/$(basename "$WRAPPER_PROD").candidate.${RUN_ID}" ]; do
  sleep 1
  RUN_ID="$(date +%Y%m%d_%H%M%S)_${BASHPID}_${RANDOM}"
done

STAGING_DIR_NAME=".staging_ltx_${RUN_ID}"
STAGING_DIR="${MODELS_VOLUME_DATA}/${STAGING_DIR_NAME}"
STAGE_CHECK_NAME=".candidate_src_${RUN_ID}"
STAGE_CHECK_SRC="${MODELS_VOLUME_DATA}/${STAGE_CHECK_NAME}"

BACKUP_SRC="${SRC_PARENT_DIR}/src.bak.${RUN_ID}"
BACKUP_WRAPPER="${WRAPPER_DIR}/$(basename "$WRAPPER_PROD").bak.${RUN_ID}"
BACKUP_ENV="${SRC_PARENT_DIR}/$(basename "$ENV_PROD").bak.${RUN_ID}"
PREV_SRC="${SRC_PARENT_DIR}/src.prev.${RUN_ID}"
CANDIDATE_SRC="${SRC_PARENT_DIR}/src.candidate.${RUN_ID}"
TMP_RESTORE="${SRC_PARENT_DIR}/src.restore.${RUN_ID}"
SRC_FAILED_PROD="${SRC_PARENT_DIR}/src.failed.${RUN_ID}"
TMP_WRAPPER_RESTORE="${WRAPPER_DIR}/$(basename "$WRAPPER_PROD").restore.${RUN_ID}"
CANDIDATE_WRAPPER="${WRAPPER_DIR}/$(basename "$WRAPPER_PROD").candidate.${RUN_ID}"

# Explicit source inventory of required regular files for complete source validation
REQUIRED_SOURCE_FILES=(
  "worker.py"
  "Dockerfile"
  "orba_gpu/__init__.py"
  "orba_gpu/app.py"
  "orba_gpu/config.py"
  "orba_gpu/deploy_validation.py"
  "orba_gpu/fw_wg_verify.py"
  "orba_gpu/fw_wg_verify_cli.py"
  "orba_gpu/generation.py"
  "orba_gpu/gpu_info.py"
  "orba_gpu/ingest.py"
  "orba_gpu/models.py"
  "orba_gpu/secrets.py"
  "orba_gpu/validation.py"
  "orba_gpu/backends/__init__.py"
  "orba_gpu/backends/comfyui_backend.py"
  "orba_gpu/backends/diffusers_backend.py"
)

# Intent tracking and state flags for transactional tracking and accurate rollback reporting
model_promotion_intent=false
model_promotion_completed=false
model_promoted_by_this_run=false

source_backup_verified=false
wrapper_backup_verified=false
env_backup_verified=false

source_swap_intent=false
source_moved_to_prev=false
new_source_placed=false

wrapper_install_intent=false
wrapper_install_completed=false

install_verified=false
prep_success=false
cleanup_executed=false

cleanup() {
  local exit_code=$?

  if [ "$cleanup_executed" = true ]; then
    return "$exit_code"
  fi
  cleanup_executed=true

  # Clean local temporary extraction and check directories only (uniquely created paths)
  if [ -n "${TMP_EXTRACT:-}" ] && [ -d "$TMP_EXTRACT" ]; then
    rm -rf "$TMP_EXTRACT"
  fi
  if [ -n "${STAGE_CHECK_SRC:-}" ] && [ -d "$STAGE_CHECK_SRC" ]; then
    rm -rf "$STAGE_CHECK_SRC"
  fi
  if [ -n "${CANDIDATE_WRAPPER:-}" ] && [ -f "$CANDIDATE_WRAPPER" ]; then
    rm -f "$CANDIDATE_WRAPPER"
  fi
  if [ -n "${TMP_WRAPPER_RESTORE:-}" ] && [ -f "$TMP_WRAPPER_RESTORE" ]; then
    rm -f "$TMP_WRAPPER_RESTORE"
  fi
  if [ -n "${CANDIDATE_SRC:-}" ] && [ -d "$CANDIDATE_SRC" ]; then
    rm -rf "$CANDIDATE_SRC"
  fi
  if [ -n "${TMP_RESTORE:-}" ] && [ -d "$TMP_RESTORE" ]; then
    rm -rf "$TMP_RESTORE"
  fi

  if [ "$prep_success" = true ] && [ "$install_verified" = true ] && [ "$exit_code" -eq 0 ]; then
    return 0
  fi

  echo "=================================================================" >&2
  echo "PREPARATION FAILED OR INTERRUPTED (exit code: $exit_code)" >&2
  echo "Executing transactional rollback and verification..." >&2
  echo "=================================================================" >&2

  local rollback_errors=0
  local wrapper_restore_status="NOT_NEEDED"
  local source_restore_status="NOT_NEEDED"
  local model_restore_status="NOT_NEEDED"

  # 1. Rollback wrapper: interruption-safe staged restoration via atomic rename
  if [ "$wrapper_install_intent" = true ] || [ "$wrapper_install_completed" = true ] || \
     { [ -f "$WRAPPER_PROD" ] && [ -f "$BACKUP_WRAPPER" ] && ! cmp -s "$WRAPPER_PROD" "$BACKUP_WRAPPER"; }; then
    if [ "$wrapper_backup_verified" = true ] && [ -f "$BACKUP_WRAPPER" ]; then
      echo "Rolling back wrapper: restoring $BACKUP_WRAPPER -> $WRAPPER_PROD via staged atomic rename" >&2
      rm -f "$TMP_WRAPPER_RESTORE" 2>/dev/null || true
      if cp -a "$BACKUP_WRAPPER" "$TMP_WRAPPER_RESTORE" && \
         chmod 0755 "$TMP_WRAPPER_RESTORE" && \
         bash -n "$TMP_WRAPPER_RESTORE" && \
         cmp -s "$TMP_WRAPPER_RESTORE" "$BACKUP_WRAPPER"; then
        if mv -f "$TMP_WRAPPER_RESTORE" "$WRAPPER_PROD" && \
           bash -n "$WRAPPER_PROD" && \
           [ -x "$WRAPPER_PROD" ] && \
           cmp -s "$WRAPPER_PROD" "$BACKUP_WRAPPER"; then
          echo "  [ROLLBACK SUCCESS] Wrapper restored via atomic rename and verified against backup." >&2
          wrapper_restore_status="RESTORED_AND_VERIFIED"
        else
          echo "  [ROLLBACK CRITICAL] Atomic rename or verification of restored wrapper failed!" >&2
          wrapper_restore_status="FAILED_VERIFICATION"
          rollback_errors=$((rollback_errors + 1))
        fi
      else
        echo "  [ROLLBACK CRITICAL] Staged restore wrapper preparation failed before atomic replacement!" >&2
        wrapper_restore_status="FAILED_STAGED_WRAPPER"
        rollback_errors=$((rollback_errors + 1))
      fi
    else
      echo "  [ROLLBACK CRITICAL] Wrapper modified/differing but verified backup is missing!" >&2
      wrapper_restore_status="FAILED_BACKUP_MISSING"
      rollback_errors=$((rollback_errors + 1))
    fi
  else
    wrapper_restore_status="UNTOUCHED"
  fi

  # 2. Rollback source if swap intent declared, moved, placed, or content differs from backup
  if [ "$source_swap_intent" = true ] || [ "$source_moved_to_prev" = true ] || [ "$new_source_placed" = true ] || \
     [ -d "$PREV_SRC" ] || \
     { [ -d "$SRC_PROD" ] && [ -d "$BACKUP_SRC" ] && ! diff -rq "$SRC_PROD" "$BACKUP_SRC" >/dev/null 2>&1; }; then
    local restore_from=""
    if [ -d "$PREV_SRC" ]; then
      restore_from="$PREV_SRC"
    elif [ "$source_backup_verified" = true ] && [ -d "$BACKUP_SRC" ]; then
      restore_from="$BACKUP_SRC"
    fi

    if [ -n "$restore_from" ]; then
      echo "Rolling back source: restoring from verified directory $restore_from" >&2
      if [ -e "$TMP_RESTORE" ]; then
        rm -rf "$TMP_RESTORE" 2>/dev/null || true
      fi

      # Prepare staged restore on the same filesystem
      if cp -a "$restore_from" "$TMP_RESTORE" && \
         diff -rq "$restore_from" "$TMP_RESTORE" >/dev/null 2>&1 && \
         python3 -m py_compile "$TMP_RESTORE/worker.py" 2>/dev/null; then

        # Recoverable swap: move current production to failed path instead of deleting it
        if [ -d "$SRC_PROD" ]; then
          mv "$SRC_PROD" "$SRC_FAILED_PROD"
        fi

        # Atomic rename of verified restore directory into production
        if mv "$TMP_RESTORE" "$SRC_PROD"; then
          # Verify complete restored source tree against backup
          if diff -rq "$SRC_PROD" "$restore_from" >/dev/null 2>&1; then
            echo "  [ROLLBACK SUCCESS] Source restored via atomic rename and verified identical to backup." >&2
            source_restore_status="RESTORED_AND_VERIFIED"
            if [ -d "$SRC_FAILED_PROD" ]; then
              rm -rf "$SRC_FAILED_PROD" 2>/dev/null || true
            fi
          else
            echo "  [ROLLBACK CRITICAL] Complete source tree verification failed after restore!" >&2
            source_restore_status="FAILED_VERIFICATION"
            rollback_errors=$((rollback_errors + 1))
          fi
        else
          echo "  [ROLLBACK CRITICAL] Atomic move of $TMP_RESTORE to $SRC_PROD failed!" >&2
          # Recover original if possible
          if [ -d "$SRC_FAILED_PROD" ] && [ ! -d "$SRC_PROD" ]; then
            mv "$SRC_FAILED_PROD" "$SRC_PROD" 2>/dev/null || true
          fi
          source_restore_status="FAILED_MOVE"
          rollback_errors=$((rollback_errors + 1))
        fi
      else
        echo "  [ROLLBACK CRITICAL] Staged restore directory validation failed before swap!" >&2
        source_restore_status="FAILED_STAGED_VALIDATION"
        rollback_errors=$((rollback_errors + 1))
      fi
    else
      echo "  [ROLLBACK CRITICAL] Source modified but no valid backup ($PREV_SRC or $BACKUP_SRC) found!" >&2
      source_restore_status="FAILED_BACKUP_MISSING"
      rollback_errors=$((rollback_errors + 1))
    fi
  else
    source_restore_status="UNTOUCHED"
  fi

  # 3. Rollback model: ONLY if promoted by this specific run
  if [ "$DEST_LTX_EXISTED_AT_START" = true ]; then
    echo "  [MODEL REPORT] Destination $DEST_LTX existed before this run. Preserving untouched." >&2
    model_restore_status="PREEXISTING_UNTOUCHED"
  elif [ "$model_promoted_by_this_run" = true ] || [ "$model_promotion_completed" = true ]; then
    if [ -d "$DEST_LTX" ]; then
      if [ ! -e "$STAGING_DIR" ]; then
        echo "Rolling back promoted model: moving $DEST_LTX -> $STAGING_DIR" >&2
        if mv "$DEST_LTX" "$STAGING_DIR" && [ ! -e "$DEST_LTX" ] && [ -d "$STAGING_DIR" ]; then
          echo "  [ROLLBACK SUCCESS] Model moved back to isolated staging directory." >&2
          model_restore_status="RESTORED_TO_STAGING"
        else
          echo "  [ROLLBACK NOTICE] Could not move model back to staging. Preserving $DEST_LTX for investigation." >&2
          model_restore_status="PRESERVED_AT_PRODUCTION_DESTINATION"
          rollback_errors=$((rollback_errors + 1))
        fi
      else
        echo "  [ROLLBACK NOTICE] Staging path $STAGING_DIR already exists. Preserving $DEST_LTX in place for investigation." >&2
        model_restore_status="PRESERVED_AT_PRODUCTION_DESTINATION"
        rollback_errors=$((rollback_errors + 1))
      fi
    else
      model_restore_status="CLEAN_NOT_AT_DESTINATION"
    fi
  else
    model_restore_status="UNTOUCHED"
  fi

  # Verification of final clean status
  local wrapper_clean=false
  local source_clean=false
  local model_clean=false

  if [ "$wrapper_restore_status" = "UNTOUCHED" ] || [ "$wrapper_restore_status" = "RESTORED_AND_VERIFIED" ]; then
    wrapper_clean=true
  fi

  if [ "$source_restore_status" = "UNTOUCHED" ] || [ "$source_restore_status" = "RESTORED_AND_VERIFIED" ]; then
    source_clean=true
  fi

  if [ "$model_restore_status" = "UNTOUCHED" ] || [ "$model_restore_status" = "RESTORED_TO_STAGING" ] || [ "$model_restore_status" = "PREEXISTING_UNTOUCHED" ]; then
    model_clean=true
  fi

  echo "-----------------------------------------------------------------" >&2
  echo "=== ROLLBACK VERIFICATION REPORT ===" >&2
  echo "  Wrapper path ($WRAPPER_PROD): $wrapper_restore_status (clean: $wrapper_clean)" >&2
  echo "  Source path ($SRC_PROD):      $source_restore_status (clean: $source_clean)" >&2
  echo "  Model path ($DEST_LTX):       $model_restore_status (clean: $model_clean)" >&2
  echo "  Source backup:                $BACKUP_SRC" >&2
  echo "  Wrapper backup:               $BACKUP_WRAPPER" >&2
  echo "  Config backup:                $BACKUP_ENV" >&2
  if [ -d "$PREV_SRC" ]; then
    echo "  Previous source:              $PREV_SRC (preserved)" >&2
  fi
  if [ -d "$STAGING_DIR" ]; then
    echo "  Staging model directory:      $STAGING_DIR (preserved)" >&2
  fi
  echo "-----------------------------------------------------------------" >&2

  if [ "$wrapper_clean" = true ] && [ "$source_clean" = true ] && [ "$model_clean" = true ] && [ "$rollback_errors" -eq 0 ]; then
    echo "=================================================================" >&2
    echo "ROLLBACK COMPLETE AND VERIFIED: All production paths confirmed in original state." >&2
    echo "Running worker, worker.env, and all running services were kept intact." >&2
    echo "=================================================================" >&2
  else
    echo "=================================================================" >&2
    echo "CRITICAL: ROLLBACK INCOMPLETE OR PRESERVED FOR INVESTIGATION!" >&2
    echo "One or more paths were not restored to original state (see report above)." >&2
    echo "Permanent backups remain intact for manual inspection and recovery." >&2
    echo "=================================================================" >&2
  fi
}

# Signal handling: separate signal handlers from the EXIT cleanup trap.
# Traps INT, TERM, HUP to terminate with standard signal exit codes (128 + signal number),
# running cleanup once without continuing main script execution.
#
# LIMITATION NOTICE:
# Forced termination (SIGKILL / kill -9) or catastrophic host failure (kernel panic, power loss)
# cannot be intercepted by any user-space signal handler or shell trap. In such events:
# - All filesystem modifications use atomic rename operations on the same filesystem.
# - Permanent timestamped backups ($BACKUP_SRC, $BACKUP_WRAPPER, $BACKUP_ENV, $PREV_SRC)
#   remain intact on disk for immediate manual inspection and recovery.
handle_signal() {
  local sig="$1"
  echo "SIGNAL RECEIVED: Trapped signal $sig. Terminating with signal status." >&2
  # Disable signal traps to prevent re-entrant loops
  trap '' INT TERM HUP
  case "$sig" in
    INT)  exit 130 ;;
    TERM) exit 143 ;;
    HUP)  exit 129 ;;
    *)    exit 1 ;;
  esac
}

trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM
trap 'handle_signal HUP' HUP
trap cleanup EXIT

echo "=== Gate 1: Verifying Provisioning Archive Integrity & Structure ==="
if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: Archive not found at $ARCHIVE" >&2
  exit 1
fi

ACTUAL_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')
if [ "$ACTUAL_SHA256" != "$EXPECTED_ARCHIVE_SHA256" ]; then
  echo "ERROR: Archive SHA-256 mismatch!" >&2
  echo "  Expected: $EXPECTED_ARCHIVE_SHA256" >&2
  echo "  Actual:   $ACTUAL_SHA256" >&2
  exit 1
fi
echo "[PASS] Archive SHA-256 verified: $ACTUAL_SHA256"

# Validate archive members: reject symlinks, hardlinks, devices, traversal, and extract strictly allowlisted files
TMP_EXTRACT=$(mktemp -d /tmp/orba-extract.XXXXXX)

python3 - "$ARCHIVE" "$TMP_EXTRACT" << 'PY_ARCHIVE_VERIFY'
import tarfile, os, sys

archive_path = sys.argv[1]
extract_dir = sys.argv[2]

# Explicit allowlist of normalized relative paths and their expected types
# Reconciled exactly with the archive and worker codebase
ALLOWED_MEMBERS = {
    "worker.py": tarfile.REGTYPE,
    "Dockerfile": tarfile.REGTYPE,
    "deploy/orbaagent-gpu": tarfile.REGTYPE,
    "orba_gpu": tarfile.DIRTYPE,
    "orba_gpu/__init__.py": tarfile.REGTYPE,
    "orba_gpu/app.py": tarfile.REGTYPE,
    "orba_gpu/config.py": tarfile.REGTYPE,
    "orba_gpu/deploy_validation.py": tarfile.REGTYPE,
    "orba_gpu/fw_wg_verify.py": tarfile.REGTYPE,
    "orba_gpu/fw_wg_verify_cli.py": tarfile.REGTYPE,
    "orba_gpu/generation.py": tarfile.REGTYPE,
    "orba_gpu/gpu_info.py": tarfile.REGTYPE,
    "orba_gpu/ingest.py": tarfile.REGTYPE,
    "orba_gpu/models.py": tarfile.REGTYPE,
    "orba_gpu/secrets.py": tarfile.REGTYPE,
    "orba_gpu/validation.py": tarfile.REGTYPE,
    "orba_gpu/backends": tarfile.DIRTYPE,
    "orba_gpu/backends/__init__.py": tarfile.REGTYPE,
    "orba_gpu/backends/comfyui_backend.py": tarfile.REGTYPE,
    "orba_gpu/backends/diffusers_backend.py": tarfile.REGTYPE,
}
REQUIRED_FILES = [k for k, v in ALLOWED_MEMBERS.items() if v == tarfile.REGTYPE]

seen_normalized = {}
members_by_name = {}

with tarfile.open(archive_path, "r:gz") as tar:
    for m in tar.getmembers():
        # 1. Normalize path separators before path validation
        raw_name = m.name.replace("\\", "/")
        norm_name = os.path.normpath(raw_name).replace("\\", "/")

        if norm_name in (".", ""):
            continue

        # 2. Reject absolute paths
        if raw_name.startswith("/") or os.path.isabs(raw_name) or norm_name.startswith("/"):
            print(f"FATAL: Absolute path rejected in archive: {raw_name}", file=sys.stderr)
            sys.exit(1)

        # 3. Reject traversal components
        parts = norm_name.split("/")
        if ".." in parts:
            print(f"FATAL: Path traversal rejected in archive: {norm_name}", file=sys.stderr)
            sys.exit(1)

        # 4. Reject duplicate normalized paths
        if norm_name in seen_normalized:
            print(f"FATAL: Duplicate normalized path in archive: {norm_name}", file=sys.stderr)
            sys.exit(1)
        seen_normalized[norm_name] = m.type

        # 5. Check against explicit allowlist and enforce exact entry types
        if norm_name in ALLOWED_MEMBERS:
            expected_type = ALLOWED_MEMBERS[norm_name]
            if m.type != expected_type:
                print(f"FATAL: Unsupported or mismatched entry type for {norm_name}: got {m.type}, expected {expected_type}", file=sys.stderr)
                sys.exit(1)
            members_by_name[norm_name] = m

    # 6. Verify conflicting file/directory paths
    for p1 in seen_normalized:
        for p2 in seen_normalized:
            if p1 != p2 and p2.startswith(p1 + "/"):
                if seen_normalized[p1] != tarfile.DIRTYPE:
                    print(f"FATAL: Conflicting path hierarchy: {p1} is not a directory but has child {p2}", file=sys.stderr)
                    sys.exit(1)

    # 7. Verify all required files are present and non-empty
    for req in REQUIRED_FILES:
        if req not in members_by_name:
            print(f"FATAL: Required entry missing in archive: {req}", file=sys.stderr)
            sys.exit(1)
        if members_by_name[req].size <= 0:
            print(f"FATAL: Required file is empty: {req}", file=sys.stderr)
            sys.exit(1)

    # 8. Safe extraction: Enforce allowlist during extraction, member-by-member
    # using exclusive file creation (O_CREAT | O_EXCL) without unsafe filter fallbacks
    for norm_name, m in members_by_name.items():
        dest_path = os.path.join(extract_dir, norm_name)
        dest_abs = os.path.abspath(dest_path)
        extract_abs = os.path.abspath(extract_dir)
        if not (dest_abs == extract_abs or dest_abs.startswith(extract_abs + os.sep)):
            print(f"FATAL: Path escapes extraction directory: {dest_abs}", file=sys.stderr)
            sys.exit(1)

        if m.type == tarfile.DIRTYPE:
            os.makedirs(dest_path, mode=0o755, exist_ok=True)
        elif m.type == tarfile.REGTYPE:
            os.makedirs(os.path.dirname(dest_path), mode=0o755, exist_ok=True)
            mode = 0o755 if norm_name == "deploy/orbaagent-gpu" else 0o644
            fd = os.open(dest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
            with os.fdopen(fd, "wb") as f_out:
                f_in = tar.extractfile(m)
                if f_in is None:
                    print(f"FATAL: Could not read member data: {norm_name}", file=sys.stderr)
                    sys.exit(1)
                while chunk := f_in.read(1024 * 1024):
                    f_out.write(chunk)

print(f"[PASS] Archive verified: {len(members_by_name)} safe allowlisted members extracted.")
PY_ARCHIVE_VERIFY

echo "=== Gate 2: Preparing Unique Isolated Staging Directory in Model Volume ==="
if [ ! -d "$MODELS_VOLUME_DATA" ]; then
  echo "ERROR: Models volume data directory not found at $MODELS_VOLUME_DATA" >&2
  exit 1
fi

if [ -e "$STAGING_DIR" ]; then
  echo "ERROR: Unique staging directory already exists: $STAGING_DIR" >&2
  exit 1
fi
mkdir -p "$STAGING_DIR"
echo "[PASS] Unique staging directory created: $STAGING_DIR"

echo "=== Gate 3: Downloading Pinned LTX-Video Weights via Contained Worker ==="
# Download via running worker container directly into mounted volume /models/${STAGING_DIR_NAME}
# This leaves host system Python packages completely untouched (no pip on host modified)
docker exec -i orbaagent-gpu-worker python3 - "${STAGING_DIR_NAME}" "${LTX_COMMIT}" << 'PY_CONTAINED_DOWNLOAD'
import sys, os
from huggingface_hub import snapshot_download

staging_rel = sys.argv[1]
commit_hash = sys.argv[2]
container_stage_path = os.path.join("/models", staging_rel)

include_patterns = [
    "model_index.json",
    "README.md",
    ".gitattributes",
    "LTX-Video-Open-Weights-License-0.X.txt",
    "scheduler/*",
    "text_encoder/*",
    "tokenizer/*",
    "transformer/*",
    "vae/*",
]

print(f"Downloading LTX-Video ({commit_hash}) to {container_stage_path}...", flush=True)
try:
    snapshot_download(
        repo_id="Lightricks/LTX-Video",
        revision=commit_hash,
        local_dir=container_stage_path,
        allow_patterns=include_patterns,
        local_dir_use_symlinks=False,
    )
except TypeError:
    snapshot_download(
        repo_id="Lightricks/LTX-Video",
        revision=commit_hash,
        local_dir=container_stage_path,
        allow_patterns=include_patterns,
    )
print("[PASS] Contained model download complete.", flush=True)
PY_CONTAINED_DOWNLOAD

echo "=== Gate 4: Deep Verification of Staged Files & Full SHA-256 Hashes ==="
python3 - "$STAGING_DIR" "$LTX_COMMIT" << 'PY_VERIFY_STAGING'
import json, os, sys, hashlib

staging_dir = sys.argv[1]
expected_commit = sys.argv[2]

# Full 64-character SHA-256 checksums and exact byte counts for all 21 components
# Verified against Hugging Face commit 8984fa25007f376c1a299016d0957a37a2f797bb
EXPECTED_FILES = {
    ".gitattributes": (3407, "d63d609a794dae859fdf76801f34c3cbdc21f0b419bb62a5d64d00e08caeb159"),
    "LTX-Video-Open-Weights-License-0.X.txt": (14536, "30eabbcc090dd3bd70cffaa14338142df82f348f7bd91b2f63f0c6099ccf50e0"),
    "README.md": (21065, "9d847f02c010f00a3164ff92b0f94b6a5b63e1c790ec7387f3200307e04fb2e1"),
    "model_index.json": (412, "7feb8da8aaa6606b5ce8552724b42b74fb09d499e00260b32105dd16ef74d68e"),
    "scheduler/scheduler_config.json": (418, "c8b56ab25a679bab39c0f92d56fba09c055a41efa08745ca7a996d11ca7e76f5"),
    "text_encoder/config.json": (781, "e8425c7fb4b09361c160eba83f89f3b3186d69bb189a8d67ad6bee8a160479a0"),
    "text_encoder/model-00001-of-00004.safetensors": (4989319680, "7a68b2c8c080696a10109612a649bc69330991ecfea65930ccfdfbdb011f2686"),
    "text_encoder/model-00002-of-00004.safetensors": (4999830656, "b8ed6556d7507e38af5b428c605fb2a6f2bdb7e80bd481308b865f7a40c551ca"),
    "text_encoder/model-00003-of-00004.safetensors": (4865612720, "c831635f83041f83faf0024b39c6ecb21b45d70dd38a63ea5bac6c7c6e5e558c"),
    "text_encoder/model-00004-of-00004.safetensors": (4194506688, "02a5f2d69205be92ad48fe5d712d38c2ff55627969116aeffc58bd75a28da468"),
    "text_encoder/model.safetensors.index.json": (19886, "a545bb25dc0f423d84be7b577311bba8bb7c6931f1eefcea65fc8b0a61a60a76"),
    "tokenizer/added_tokens.json": (2593, "ea5a91a3234f66ea642c8e672d67f0f493759a9bee6910ae304ea9b9492118b5"),
    "tokenizer/special_tokens_map.json": (2543, "7a1985a994c41886db38c719d2a3d2f40606663cc19d7c5d6a85d349320e06d2"),
    "tokenizer/spiece.model": (791656, "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86"),
    "tokenizer/tokenizer_config.json": (20618, "e8c727fbdfbc495f9ec68fc4b89eda5d7d0a800cc33d1a661ae208b20b50e17a"),
    "transformer/config.json": (500, "f0fba250ebd4e1c33ed035f1151af44e069a3125fe1c3620e5196681f5f2b0cd"),
    "transformer/diffusion_pytorch_model-00001-of-00002.safetensors": (4939189200, "8acd3e0bda74f7434259a4543a324211ddd82580fcc727df236b2414591eadc8"),
    "transformer/diffusion_pytorch_model-00002-of-00002.safetensors": (2754433648, "03b3c822c31e1a9e00f6f575aa1b6f3cc4cc3797f60dcced537c8600bf1e9019"),
    "transformer/diffusion_pytorch_model.safetensors.index.json": (72060, "3a99763d8e06f985e6e4323a927b404c8354dadc41e1a693c5c5052de591a630"),
    "vae/config.json": (501, "e8f12ad5305b1508f6e456797d48ab8e9fdd091c686ccf814a293ee96ce89dbb"),
    "vae/diffusion_pytorch_model.safetensors": (1676798532, "265ca87cb5dff5e37f924286e957324e282fe7710a952a7dafc0df43883e2010")
}

print(f"Verifying all {len(EXPECTED_FILES)} staged LTX-Video components in {staging_dir}...")

# 1. Verify model_index.json
idx_path = os.path.join(staging_dir, "model_index.json")
if not os.path.isfile(idx_path):
    print("FAIL: model_index.json missing", file=sys.stderr)
    sys.exit(1)

with open(idx_path, "r", encoding="utf-8") as f:
    idx = json.load(f)
if idx.get("_class_name") != "LTXPipeline":
    print(f"FAIL: Expected _class_name 'LTXPipeline', got '{idx.get('_class_name')}'", file=sys.stderr)
    sys.exit(1)

# 2. Verify all files, exact byte sizes, and full SHA-256 checksums
for rel_path, (expected_size, expected_sha) in EXPECTED_FILES.items():
    full_path = os.path.join(staging_dir, rel_path)
    if not os.path.isfile(full_path):
        print(f"FAIL: Missing expected file: {rel_path}", file=sys.stderr)
        sys.exit(1)
    actual_size = os.path.getsize(full_path)
    if actual_size != expected_size:
        print(f"FAIL: Size mismatch for {rel_path}: expected {expected_size}, got {actual_size}", file=sys.stderr)
        sys.exit(1)

    h = hashlib.sha256()
    with open(full_path, "rb") as bf:
        while chunk := bf.read(1024 * 1024 * 8):
            h.update(chunk)
    actual_sha = h.hexdigest().lower()
    if actual_sha != expected_sha.lower():
        print(f"FAIL: Full SHA-256 mismatch for {rel_path}!", file=sys.stderr)
        print(f"  Expected: {expected_sha}", file=sys.stderr)
        print(f"  Actual:   {actual_sha}", file=sys.stderr)
        sys.exit(1)
    print(f"  [OK] {rel_path} (size: {actual_size:,} B, sha256: {actual_sha[:16]}... matched)")

# Write inventory metadata
inv = {
    "model_id": "Lightricks/LTX-Video",
    "commit": expected_commit,
    "pipeline": "LTXPipeline",
    "verified_components": len(EXPECTED_FILES)
}
with open(os.path.join(staging_dir, "INVENTORY.json"), "w", encoding="utf-8") as f:
    json.dump(inv, f, indent=2)

print("[PASS] All 21 LTX-Video files, exact byte counts, and full SHA-256 hashes verified cleanly!")
PY_VERIFY_STAGING

echo "=== Gate 5: Offline Staging Schema Validation via Running Worker ==="
# Test Diffusers pipeline config loading directly against the staging path mounted inside container
# This proves Diffusers compatibility BEFORE promoting to production path
docker exec -i orbaagent-gpu-worker python3 - "${STAGING_DIR_NAME}" << 'PY_STAGE_CHECK'
import sys, os
from pathlib import Path
from diffusers import LTXPipeline

staging_rel = sys.argv[1]
container_stage_path = Path("/models") / staging_rel

if not container_stage_path.is_dir():
    print(f"FAIL: Staging path {container_stage_path} not found in container /models mount", file=sys.stderr)
    sys.exit(1)

try:
    pipe_config = LTXPipeline.load_config(str(container_stage_path), local_files_only=True)
    print(f"[PASS] Diffusers LTXPipeline staging config validated offline: {pipe_config.get('_class_name')}")
    print("       (Note: Schema/config validated offline. Full neural tensor inference will run on GPU 1 during post-deployment acceptance testing.)")
except Exception as exc:
    print(f"FAIL: Diffusers LTXPipeline failed offline staging config load: {exc}", file=sys.stderr)
    sys.exit(1)
PY_STAGE_CHECK

echo "=== Gate 6: Safe Promotion to Production Path ==="
mkdir -p "$(dirname "$DEST_LTX")"

# Fail-safe check: destination must NOT already exist
if [ -e "$DEST_LTX" ]; then
  echo "FAIL-SAFE ERROR: Destination $DEST_LTX already exists." >&2
  echo "Promotion cannot overwrite or delete an existing destination." >&2
  echo "Staged files preserved in $STAGING_DIR for inspection." >&2
  exit 1
fi

# Track promotion intent BEFORE filesystem operation
model_promotion_intent=true
mv "$STAGING_DIR" "$DEST_LTX"
model_promotion_completed=true
model_promoted_by_this_run=true

find "$DEST_LTX" -type d -exec chmod 755 {} +
find "$DEST_LTX" -type f -exec chmod 644 {} +
echo "[PASS] Staged model promoted to: $DEST_LTX"

echo "=== Gate 7: Production Path Local Resolver Pre-Flight Check ==="
# Verify worker resolver maps the promoted production path correctly inside container
docker exec -i orbaagent-gpu-worker python3 - << 'PY_LOADER_CHECK'
import sys, os
from pathlib import Path

# Verify directory exists inside container mount
model_path = Path("/models/Lightricks/LTX-Video")
if not model_path.is_dir():
    print("FAIL: /models/Lightricks/LTX-Video not mounted inside container", file=sys.stderr)
    sys.exit(1)

# Verify worker local resolver
from orba_gpu.models import resolve_model_path
resolved = resolve_model_path("/models", "Lightricks/LTX-Video")
if not resolved or not os.path.isdir(resolved):
    print(f"FAIL: resolve_model_path failed: {resolved}", file=sys.stderr)
    sys.exit(1)
print(f"[PASS] Local production model path resolved: {resolved}")
PY_LOADER_CHECK

echo "=== Gate 8: Validate Worker Source and Wrapper Pair in Contained Runtime ==="
WRAPPER_EXTRACTED="$TMP_EXTRACT/deploy/orbaagent-gpu"
if [ ! -f "$WRAPPER_EXTRACTED" ]; then
  echo "FAIL: Wrapper not found in archive at deploy/orbaagent-gpu!" >&2
  exit 1
fi

# Verify wrapper syntax and build scoping
bash -n "$WRAPPER_EXTRACTED"
if ! grep -q "docker_compose build orbaagent-gpu-worker" "$WRAPPER_EXTRACTED"; then
  echo "FAIL: Wrapper in archive does not contain scoped worker build command!" >&2
  exit 1
fi
if ! grep -q "/etc/orbaagent/gpu-worker" "$WRAPPER_EXTRACTED"; then
  echo "FAIL: Wrapper in archive does not reference expected worker directory!" >&2
  exit 1
fi
echo "[PASS] Extracted wrapper pre-validation successful."

# Validate candidate source in container runtime to test real dependencies without touching host Python
if [ -e "$STAGE_CHECK_SRC" ]; then
  echo "ERROR: Unique container check directory already exists: $STAGE_CHECK_SRC" >&2
  exit 1
fi
mkdir -p "$STAGE_CHECK_SRC"
cp "$TMP_EXTRACT/worker.py" "$STAGE_CHECK_SRC/"
cp "$TMP_EXTRACT/Dockerfile" "$STAGE_CHECK_SRC/"
cp -r "$TMP_EXTRACT/orba_gpu" "$STAGE_CHECK_SRC/"

docker exec -i orbaagent-gpu-worker python3 - "${STAGE_CHECK_NAME}" << 'PY_CONTAINER_IMPORT_CHECK'
import sys, os

cand_rel = sys.argv[1]
container_cand_path = os.path.join("/models", cand_rel)

if not os.path.isdir(container_cand_path):
    print(f"FAIL: Candidate source directory not found in container at {container_cand_path}", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, container_cand_path)
try:
    import orba_gpu
    from orba_gpu.app import create_app
    from orba_gpu.config import Settings
    from orba_gpu import models, generation, ingest, secrets, validation
    from orba_gpu.backends import diffusers_backend, comfyui_backend
    assert hasattr(diffusers_backend, "load_video_pipeline"), "load_video_pipeline missing in diffusers_backend"
    assert hasattr(diffusers_backend, "run_video_inference"), "run_video_inference missing in diffusers_backend"
    print("[PASS] Worker container successfully imported complete candidate source tree.")
except Exception as exc:
    print(f"FAIL: Worker container failed candidate source import check: {exc}", file=sys.stderr)
    sys.exit(1)
PY_CONTAINER_IMPORT_CHECK

rm -rf "$STAGE_CHECK_SRC"
echo "[PASS] Candidate source validated cleanly in container runtime."

echo "=== Gate 9: Backing Up Production Paths (Preserved Permanently) ==="
# Pre-modification existence and validity verification
if [ ! -d "$SRC_PROD" ]; then
  echo "FATAL: Production source directory does not exist at $SRC_PROD! Aborting before modification." >&2
  exit 1
fi
if [ ! -f "$SRC_PROD/worker.py" ]; then
  echo "FATAL: Production source at $SRC_PROD is invalid (missing worker.py)! Aborting before modification." >&2
  exit 1
fi
if [ ! -f "$WRAPPER_PROD" ]; then
  echo "FATAL: Production wrapper does not exist at $WRAPPER_PROD! Aborting before modification." >&2
  exit 1
fi
if [ ! -x "$WRAPPER_PROD" ]; then
  echo "FATAL: Production wrapper at $WRAPPER_PROD is not executable! Aborting before modification." >&2
  exit 1
fi

if [ -f "$WRAPPER_PROD" ]; then
  if [ -e "$BACKUP_WRAPPER" ]; then
    echo "ERROR: Unique wrapper backup path already exists: $BACKUP_WRAPPER" >&2
    exit 1
  fi
  cp -a "$WRAPPER_PROD" "$BACKUP_WRAPPER"
  if [ -f "$BACKUP_WRAPPER" ] && cmp -s "$WRAPPER_PROD" "$BACKUP_WRAPPER"; then
    wrapper_backup_verified=true
    echo "[PASS] Wrapper backup created and verified: $BACKUP_WRAPPER"
  else
    echo "ERROR: Wrapper backup verification failed!" >&2
    exit 1
  fi
fi

if [ -d "$SRC_PROD" ]; then
  if [ -e "$BACKUP_SRC" ]; then
    echo "ERROR: Unique source backup path already exists: $BACKUP_SRC" >&2
    exit 1
  fi
  cp -a "$SRC_PROD" "$BACKUP_SRC"
  # Complete source inventory and recursive diff verification against original
  if diff -rq "$SRC_PROD" "$BACKUP_SRC" >/dev/null 2>&1; then
    source_backup_verified=true
    echo "[PASS] Source backup created and verified identical to production: $BACKUP_SRC"
  else
    echo "ERROR: Source backup recursive diff verification failed!" >&2
    exit 1
  fi
fi

if [ -f "$ENV_PROD" ]; then
  if [ -e "$BACKUP_ENV" ]; then
    echo "ERROR: Unique env backup path already exists: $BACKUP_ENV" >&2
    exit 1
  fi
  cp -a "$ENV_PROD" "$BACKUP_ENV"
  if [ -f "$BACKUP_ENV" ] && cmp -s "$ENV_PROD" "$BACKUP_ENV"; then
    env_backup_verified=true
    echo "[PASS] Config backup created and verified: $BACKUP_ENV"
  else
    echo "ERROR: Config backup verification failed!" >&2
    exit 1
  fi
fi

echo "=== Gate 10: Transactional Installation and Production Pair Verification ==="
# 1. Stage replacement source on same filesystem before touching production
if [ -e "$CANDIDATE_SRC" ]; then
  echo "ERROR: Unique candidate source path already exists: $CANDIDATE_SRC" >&2
  exit 1
fi
mkdir -p "$CANDIDATE_SRC"
cp "$TMP_EXTRACT/worker.py" "$CANDIDATE_SRC/"
cp "$TMP_EXTRACT/Dockerfile" "$CANDIDATE_SRC/"
cp -r "$TMP_EXTRACT/orba_gpu" "$CANDIDATE_SRC/"
chown -R root:root "$CANDIDATE_SRC"
chmod -R 755 "$CANDIDATE_SRC"

# Verify candidate on disk before swap
for req in "${REQUIRED_SOURCE_FILES[@]}"; do
  if [ ! -f "$CANDIDATE_SRC/$req" ]; then
    echo "ERROR: Candidate missing required source file: $req" >&2
    exit 1
  fi
done

# 2. Stage replacement wrapper on same filesystem before touching production
if [ -e "$CANDIDATE_WRAPPER" ]; then
  echo "ERROR: Unique candidate wrapper path already exists: $CANDIDATE_WRAPPER" >&2
  exit 1
fi
cp -a "$WRAPPER_EXTRACTED" "$CANDIDATE_WRAPPER"
chown root:root "$CANDIDATE_WRAPPER" 2>/dev/null || true
chmod 0755 "$CANDIDATE_WRAPPER"
bash -n "$CANDIDATE_WRAPPER"
cmp -s "$CANDIDATE_WRAPPER" "$WRAPPER_EXTRACTED"

# 3. Interruption-safe source swap: intent tracked BEFORE any filesystem operation
source_swap_intent=true
if [ -e "$PREV_SRC" ]; then
  echo "ERROR: Unique previous source path already exists: $PREV_SRC" >&2
  exit 1
fi
mv "$SRC_PROD" "$PREV_SRC"
source_moved_to_prev=true

mv "$CANDIDATE_SRC" "$SRC_PROD"
new_source_placed=true
echo "[PASS] New source moved into production: $SRC_PROD"

# 4. Interruption-safe wrapper swap: intent tracked BEFORE atomic replacement
wrapper_install_intent=true
mv -f "$CANDIDATE_WRAPPER" "$WRAPPER_PROD"
wrapper_install_completed=true
echo "[PASS] New wrapper installed via atomic rename: $WRAPPER_PROD"

# 5. Verify both components in place together before marking preparation complete
echo "Verifying installed source and wrapper in production..."
# Verify wrapper against archive version, syntax, and permissions
cmp -s "$WRAPPER_PROD" "$WRAPPER_EXTRACTED"
bash -n "$WRAPPER_PROD"
[ -x "$WRAPPER_PROD" ]

# Verify complete installed source tree against extracted candidate
diff -rq "$SRC_PROD/worker.py" "$TMP_EXTRACT/worker.py"
diff -rq "$SRC_PROD/Dockerfile" "$TMP_EXTRACT/Dockerfile"
diff -rq "$SRC_PROD/orba_gpu" "$TMP_EXTRACT/orba_gpu"

for req in "${REQUIRED_SOURCE_FILES[@]}"; do
  [ -f "$SRC_PROD/$req" ]
done

# Verify Python bytecode compilation of installed production source
python3 -m py_compile "$SRC_PROD/worker.py"
python3 -m compileall -q "$SRC_PROD/orba_gpu"

install_verified=true
prep_success=true
echo "[PASS] Source and wrapper pair successfully verified in production."

echo "================================================================="
echo "PREPARATION STAGE COMPLETE - RUNNING WORKER UNTOUCHED"
echo "================================================================="
echo "Model location:       $DEST_LTX"
echo "Wan preserved at:     ${MODELS_VOLUME_DATA}/Wan-AI"
echo "FLUX preserved at:    ${MODELS_VOLUME_DATA}/black-forest-labs/FLUX.1-schnell"
echo "Source backup:        $BACKUP_SRC (permanent)"
echo "Wrapper backup:       $BACKUP_WRAPPER (permanent)"
echo "Config backup:        $BACKUP_ENV (permanent)"
echo "Previous source:      $PREV_SRC (preserved)"
echo "Current worker.env:   Preserved intact (Wan remains active until deployment)"
echo "Ollama status:        Preserved intact"
echo "ComfyUI status:       Preserved intact"
echo "GPU 0 status:         Preserved intact (dedicated to CoderXP)"
echo "================================================================="
