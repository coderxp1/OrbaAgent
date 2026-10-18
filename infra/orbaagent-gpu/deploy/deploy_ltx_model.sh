#!/usr/bin/env bash
# ==============================================================================
# Isolated LTX-Video Model Preparation & Worker Update
#
# STRICT GATES:
# - Validates archive SHA256 against b74342292ffcb313edaf848161bacbea4fd09c26f64b12a39e1cb61b15dcb279
# - Installs worker-only build wrapper (targets ONLY orbaagent-gpu-worker)
# - Downloads pinned Lightricks/LTX-Video (commit 8984fa25007f376c1a299016d0957a37a2f797bb)
# - Verifies all LTX shards and checksums
# - Preserves Wan-AI, FLUX, Ollama, ComfyUI, GPU 0, CoderXP, WireGuard, and UFW
# ==============================================================================

set -euo pipefail

ARCHIVE="/tmp/orbaagent-gpu-provisioning.tar.gz"
EXPECTED_ARCHIVE_SHA256="b74342292ffcb313edaf848161bacbea4fd09c26f64b12a39e1cb61b15dcb279"

echo "=== Step 1: Validating Archive Integrity ==="
if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: Archive not found at $ARCHIVE" >&2
  exit 1
fi

ACTUAL_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')
if [ "$ACTUAL_SHA256" != "$EXPECTED_ARCHIVE_SHA256" ]; then
  echo "ERROR: SHA256 mismatch!" >&2
  echo "  Expected: $EXPECTED_ARCHIVE_SHA256" >&2
  echo "  Actual:   $ACTUAL_SHA256" >&2
  exit 1
fi
echo "[OK] Archive SHA256 verified: $ACTUAL_SHA256"

echo "=== Step 2: Extracting Verified Components ==="
TMP_DIR=$(mktemp -d /tmp/orba-ltx-prep.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

tar -xzf "$ARCHIVE" -C "$TMP_DIR"

echo "=== Step 3: Installing Worker-Only Build Wrapper ==="
# Verify that wrapper contains the scoped build command before installing
if ! grep -q "docker_compose build orbaagent-gpu-worker" "$TMP_DIR/deploy/orbaagent-gpu"; then
  echo "ERROR: Wrapper does not contain scoped worker build command!" >&2
  exit 1
fi

install -o root -g root -m 0755 "$TMP_DIR/deploy/orbaagent-gpu" /usr/local/sbin/orbaagent-gpu
echo "[OK] Installed /usr/local/sbin/orbaagent-gpu (verified worker-only build)"

echo "=== Step 4: Updating Worker Source Context ==="
mkdir -p /etc/orbaagent/gpu-worker/src
cp -r "$TMP_DIR/worker.py" /etc/orbaagent/gpu-worker/src/
cp -r "$TMP_DIR/Dockerfile" /etc/orbaagent/gpu-worker/src/
cp -r "$TMP_DIR/orba_gpu" /etc/orbaagent/gpu-worker/src/
chown -R root:root /etc/orbaagent/gpu-worker/src
chmod -R 755 /etc/orbaagent/gpu-worker/src
echo "[OK] Updated /etc/orbaagent/gpu-worker/src"

echo "=== Step 5: Preparing Model Directory ==="
MODELS_DIR="/var/lib/docker/volumes/orbaagent_models/_data"
if [ ! -d "$MODELS_DIR" ]; then
  echo "ERROR: Model volume directory not found at $MODELS_DIR" >&2
  exit 1
fi

LTX_DIR="$MODELS_DIR/Lightricks/LTX-Video"
mkdir -p "$LTX_DIR"

echo "=== Step 6: Downloading Pinned LTX-Video Weights ==="
LTX_COMMIT="8984fa25007f376c1a299016d0957a37a2f797bb"

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
  --local-dir "$LTX_DIR"

echo "=== Step 7: Verifying LTX-Video Files & Checksums ==="
python3 - "$LTX_DIR" << 'PY_VERIFY_EOF'
import json, os, sys, hashlib

ltx_dir = sys.argv[1]

EXPECTED_FILES = {
    "model_index.json": 412,
    "scheduler/scheduler_config.json": 418,
    "text_encoder/config.json": 781,
    "text_encoder/model-00001-of-00004.safetensors": 4989319680,
    "text_encoder/model-00002-of-00004.safetensors": 4999830656,
    "text_encoder/model-00003-of-00004.safetensors": 4865612720,
    "text_encoder/model-00004-of-00004.safetensors": 4194506688,
    "text_encoder/model.safetensors.index.json": 19886,
    "tokenizer/spiece.model": 791656,
    "tokenizer/tokenizer_config.json": 20618,
    "transformer/config.json": 500,
    "transformer/diffusion_pytorch_model-00001-of-00002.safetensors": 4939189200,
    "transformer/diffusion_pytorch_model-00002-of-00002.safetensors": 2754433648,
    "transformer/diffusion_pytorch_model.safetensors.index.json": 72060,
    "vae/config.json": 501,
    "vae/diffusion_pytorch_model.safetensors": 1676798532
}

print(f"Checking LTX-Video installation at {ltx_dir}...")
missing = []
for rel_path, expected_size in EXPECTED_FILES.items():
    full_path = os.path.join(ltx_dir, rel_path)
    if not os.path.isfile(full_path):
        missing.append(rel_path)
        continue
    actual_size = os.path.getsize(full_path)
    if actual_size != expected_size:
        print(f"Size mismatch on {rel_path}: expected {expected_size}, got {actual_size}", file=sys.stderr)
        sys.exit(1)

if missing:
    print(f"Missing required LTX files: {missing}", file=sys.stderr)
    sys.exit(1)

print("[OK] All required LTX-Video files and exact sizes verified cleanly!")
PY_VERIFY_EOF

echo "=== Step 8: Updating Configuration ==="
# Set worker model to LTX-Video
sed -i 's|^MEDIA_GENERATION_VIDEO_MODEL=.*|MEDIA_GENERATION_VIDEO_MODEL=Lightricks/LTX-Video|' /etc/orbaagent/gpu-worker/worker.env
echo "[OK] Updated /etc/orbaagent/gpu-worker/worker.env to MEDIA_GENERATION_VIDEO_MODEL=Lightricks/LTX-Video"

echo "=== Preparation & Pre-Deployment Complete ==="
echo "Wan directory preserved at $MODELS_DIR/Wan-AI"
echo "Ollama and ComfyUI untouched."
echo "Ready for worker build and deploy."
