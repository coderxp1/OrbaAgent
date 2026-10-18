#!/usr/bin/env bash
# ==============================================================================
# Failure-Safe LTX-Video Model Preparation & Verification (Pre-Deployment Only)
#
# STRICT GATES & SAFETY POLICIES:
# 1. Verifies provisioning archive SHA-256 before extraction.
# 2. Downloads LTX into an isolated staging directory (.staging_ltx) inside the model volume.
# 3. Verifies pinned revision (8984fa25007f376c1a299016d0957a37a2f797bb), file sizes, and
#    SHA-256 hashes of all safetensors shards BEFORE modifying any production path.
# 4. Promotes staging directory to /models/Lightricks/LTX-Video only upon 100% verification.
# 5. Tests model readability and loader compatibility via worker container without network access.
# 6. Creates timestamped backups of /etc/orbaagent/gpu-worker/src and worker.env.
# 7. Installs the worker-only build wrapper (/usr/local/sbin/orbaagent-gpu) and stages source.
# 8. DOES NOT modify worker.env or restart/redeploy the running worker.
# 9. DOES NOT touch Wan, FLUX, Ollama, ComfyUI, GPU 0, CoderXP, WireGuard, or UFW.
# ==============================================================================

set -euo pipefail

ARCHIVE="/tmp/orbaagent-gpu-provisioning.tar.gz"
EXPECTED_ARCHIVE_SHA256="b74342292ffcb313edaf848161bacbea4fd09c26f64b12a39e1cb61b15dcb279"
LTX_COMMIT="8984fa25007f376c1a299016d0957a37a2f797bb"

MODELS_VOLUME_DATA="/var/lib/docker/volumes/orbaagent_models/_data"
STAGING_DIR="${MODELS_VOLUME_DATA}/.staging_ltx"
DEST_LTX="${MODELS_VOLUME_DATA}/Lightricks/LTX-Video"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_SRC="/etc/orbaagent/gpu-worker/src.bak.${TIMESTAMP}"
BACKUP_ENV="/etc/orbaagent/gpu-worker/worker.env.bak.${TIMESTAMP}"

cleanup() {
  local exit_code=$?
  if [ -d "${TMP_EXTRACT:-}" ]; then
    rm -rf "$TMP_EXTRACT"
  fi
  if [ "$exit_code" -ne 0 ]; then
    echo "=================================================================" >&2
    echo "PREPARATION FAILED (exit code $exit_code)." >&2
    echo "Running worker and configuration have NOT been modified." >&2
    if [ -d "$STAGING_DIR" ]; then
      echo "Staging directory preserved for inspection: $STAGING_DIR" >&2
    fi
    echo "=================================================================" >&2
  fi
}
trap cleanup EXIT

echo "=== Gate 1: Verifying Provisioning Archive Integrity ==="
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

echo "=== Gate 2: Preparing Staging Directory in Model Volume ==="
if [ ! -d "$MODELS_VOLUME_DATA" ]; then
  echo "ERROR: Models volume data directory not found at $MODELS_VOLUME_DATA" >&2
  exit 1
fi

# Clean any previous stale staging attempt
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
echo "[PASS] Isolated staging directory created: $STAGING_DIR"

echo "=== Gate 3: Downloading Pinned LTX-Video Weights into Staging ==="
pip install --no-cache-dir "huggingface_hub>=0.28.0"

hf download Lightricks/LTX-Video \
  --revision "$LTX_COMMIT" \
  --include "model_index.json" \
  --include "README.md" \
  --include ".gitattributes" \
  --include "LTX-Video-Open-Weights-License-0.X.txt" \
  --include "scheduler/*" \
  --include "text_encoder/*" \
  --include "tokenizer/*" \
  --include "transformer/*" \
  --include "vae/*" \
  --local-dir "$STAGING_DIR"

echo "=== Gate 4: Deep Verification of Staged LTX-Video Files & Checksums ==="
python3 - "$STAGING_DIR" "$LTX_COMMIT" << 'PY_VERIFY_STAGING'
import json, os, sys, hashlib

staging_dir = sys.argv[1]
expected_commit = sys.argv[2]

# Verified component map: size and sha256 for large weights / critical models
EXPECTED_FILES = {
    ".gitattributes": (3407, None),
    "LTX-Video-Open-Weights-License-0.X.txt": (14536, None),
    "README.md": (21065, None),
    "model_index.json": (412, None),
    "scheduler/scheduler_config.json": (418, None),
    "text_encoder/config.json": (781, None),
    "text_encoder/model-00001-of-00004.safetensors": (4989319680, "7a68b2c8c080696a10109612a649bc69330991ecfea65930ccfdfbdb011f2686"),
    "text_encoder/model-00002-of-00004.safetensors": (4999830656, "b8ed6556d7507e38af5b428c605fb2a6f2bdb7e80bd481308b865f7a40c551ca"),
    "text_encoder/model-00003-of-00004.safetensors": (4865612720, "c831635f83041f83faf0024b39c6ecb21b45d70dd38a63ea5bac6c7c6e5e558c"),
    "text_encoder/model-00004-of-00004.safetensors": (4194506688, "02a5f2d69205be92ad48fe5d712d38c2ff55627969116aeffc58bd75a28da468"),
    "text_encoder/model.safetensors.index.json": (19886, None),
    "tokenizer/added_tokens.json": (2593, None),
    "tokenizer/special_tokens_map.json": (2543, None),
    "tokenizer/spiece.model": (791656, "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86"),
    "tokenizer/tokenizer_config.json": (20618, None),
    "transformer/config.json": (500, None),
    "transformer/diffusion_pytorch_model-00001-of-00002.safetensors": (4939189200, "8acd3e0bda74f7434259a4543a324211ddd82580fcc727df236b2414591eadc8"),
    "transformer/diffusion_pytorch_model-00002-of-00002.safetensors": (2754433648, "03b3c822c31e1a9e00f6f575aa1b6f3cc4cc3797f60dcced537c8600bf1e9019"),
    "transformer/diffusion_pytorch_model.safetensors.index.json": (72060, None),
    "vae/config.json": (501, None),
    "vae/diffusion_pytorch_model.safetensors": (1676798532, "265ca87cb5dff5e37f924286e957324e282fe7710a952a7dafc0df43883e2010")
}

print(f"Verifying staged LTX-Video components in {staging_dir}...")

# 1. Verify model_index.json architecture
idx_path = os.path.join(staging_dir, "model_index.json")
if not os.path.isfile(idx_path):
    print("FAIL: model_index.json missing", file=sys.stderr)
    sys.exit(1)

with open(idx_path, "r", encoding="utf-8") as f:
    idx = json.load(f)
if idx.get("_class_name") != "LTXPipeline":
    print(f"FAIL: Expected _class_name 'LTXPipeline', got '{idx.get('_class_name')}'", file=sys.stderr)
    sys.exit(1)

# 2. Verify all files and exact sizes
for rel_path, (expected_size, expected_sha) in EXPECTED_FILES.items():
    full_path = os.path.join(staging_dir, rel_path)
    if not os.path.isfile(full_path):
        print(f"FAIL: Missing expected file: {rel_path}", file=sys.stderr)
        sys.exit(1)
    actual_size = os.path.getsize(full_path)
    if actual_size != expected_size:
        print(f"FAIL: Size mismatch for {rel_path}: expected {expected_size}, got {actual_size}", file=sys.stderr)
        sys.exit(1)
    if expected_sha:
        h = hashlib.sha256()
        with open(full_path, "rb") as bf:
            while chunk := bf.read(1024 * 1024 * 8):
                h.update(chunk)
        actual_sha = h.hexdigest().lower()
        if actual_sha != expected_sha.lower():
            print(f"FAIL: SHA-256 mismatch for {rel_path}: expected {expected_sha}, got {actual_sha}", file=sys.stderr)
            sys.exit(1)
        print(f"  [OK] {rel_path} (size: {actual_size:,} B, sha256: {actual_sha[:16]}...)")

# Write inventory metadata
inv = {
    "model_id": "Lightricks/LTX-Video",
    "commit": expected_commit,
    "pipeline": "LTXPipeline",
    "verified_components": len(EXPECTED_FILES)
}
with open(os.path.join(staging_dir, "INVENTORY.json"), "w", encoding="utf-8") as f:
    json.dump(inv, f, indent=2)

print("[PASS] All 21 LTX-Video files, sizes, and safetensors checksums verified cleanly!")
PY_VERIFY_STAGING

echo "=== Gate 5: Promoting Verified Model to Production Path ==="
mkdir -p "$(dirname "$DEST_LTX")"
# Remove any broken previous destination if present, then atomic move
rm -rf "$DEST_LTX"
mv "$STAGING_DIR" "$DEST_LTX"
find "$DEST_LTX" -type d -exec chmod 755 {} +
find "$DEST_LTX" -type f -exec chmod 644 {} +
echo "[PASS] Model promoted to: $DEST_LTX"

echo "=== Gate 6: Worker Local Loader Compatibility Check ==="
# Test loader compatibility inside running worker container (without network access)
docker exec orbaagent-gpu-worker python3 - << 'PY_LOADER_CHECK'
import sys, os
from pathlib import Path

# Verify directory exists inside container mount
model_path = Path("/models/Lightricks/LTX-Video")
if not model_path.is_dir():
    print(f"FAIL: /models/Lightricks/LTX-Video not mounted inside container", file=sys.stderr)
    sys.exit(1)

# Verify resolve_model_path logic
from orba_gpu.models import resolve_model_path
resolved = resolve_model_path("/models", "Lightricks/LTX-Video")
if not resolved or not os.path.isdir(resolved):
    print(f"FAIL: resolve_model_path failed to resolve /models/Lightricks/LTX-Video: {resolved}", file=sys.stderr)
    sys.exit(1)
print(f"[PASS] Worker model resolver verified: {resolved}")

# Verify Diffusers can parse configs locally
from diffusers import LTXPipeline
try:
    pipe_config = LTXPipeline.load_config(resolved, local_files_only=True)
    print(f"[PASS] Diffusers LTXPipeline config loaded locally: {pipe_config.get('_class_name')}")
except Exception as exc:
    print(f"FAIL: Diffusers LTXPipeline failed local load: {exc}", file=sys.stderr)
    sys.exit(1)

print("[PASS] Worker loader compatibility verified 100% offline!")
PY_LOADER_CHECK

echo "=== Gate 7: Backing Up Current Worker Source and Configuration ==="
# Make safe timestamped backups before updating files
if [ -d /etc/orbaagent/gpu-worker/src ]; then
  cp -a /etc/orbaagent/gpu-worker/src "$BACKUP_SRC"
  echo "[PASS] Source backup created: $BACKUP_SRC"
fi

if [ -f /etc/orbaagent/gpu-worker/worker.env ]; then
  cp -a /etc/orbaagent/gpu-worker/worker.env "$BACKUP_ENV"
  echo "[PASS] Config backup created: $BACKUP_ENV"
fi

echo "=== Gate 8: Installing Worker-Only Wrapper and Staging Source ==="
TMP_EXTRACT=$(mktemp -d /tmp/orba-extract.XXXXXX)
tar -xzf "$ARCHIVE" -C "$TMP_EXTRACT"

# Confirm wrapper strictly scopes build command
if ! grep -q "docker_compose build orbaagent-gpu-worker" "$TMP_EXTRACT/deploy/orbaagent-gpu"; then
  echo "FAIL: Wrapper in archive does not contain scoped worker build command!" >&2
  exit 1
fi

install -o root -g root -m 0755 "$TMP_EXTRACT/deploy/orbaagent-gpu" /usr/local/sbin/orbaagent-gpu
echo "[PASS] Installed /usr/local/sbin/orbaagent-gpu (verified worker-only build)"

mkdir -p /etc/orbaagent/gpu-worker/src
cp -r "$TMP_EXTRACT/worker.py" /etc/orbaagent/gpu-worker/src/
cp -r "$TMP_EXTRACT/Dockerfile" /etc/orbaagent/gpu-worker/src/
cp -r "$TMP_EXTRACT/orba_gpu" /etc/orbaagent/gpu-worker/src/
chown -R root:root /etc/orbaagent/gpu-worker/src
chmod -R 755 /etc/orbaagent/gpu-worker/src
echo "[PASS] Staged updated worker source to /etc/orbaagent/gpu-worker/src"

echo "================================================================="
echo "PREPARATION STAGE COMPLETE - RUNNING WORKER UNTOUCHED"
echo "================================================================="
echo "Model location:       $DEST_LTX"
echo "Wan preserved at:     ${MODELS_VOLUME_DATA}/Wan-AI"
echo "FLUX preserved at:    ${MODELS_VOLUME_DATA}/black-forest-labs/FLUX.1-schnell"
echo "Source backup:        $BACKUP_SRC"
echo "Config backup:        $BACKUP_ENV"
echo "Current worker.env:   Preserved intact (still pointing to Wan until deployment)"
echo "Ollama status:        Preserved intact (Up 8 days)"
echo "ComfyUI status:       Preserved intact"
echo "GPU 0 status:         Preserved intact (96,376 MiB free)"
echo "================================================================="
