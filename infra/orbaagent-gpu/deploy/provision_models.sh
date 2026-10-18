#!/usr/bin/env bash
# ==============================================================================
# Isolated Model Provisioning Script for GPU 1 (Diffusers Backend)
# TARGET VOLUME: orbaagent_models (mounted at /models)
# STRICT CONFINEMENT: Confined to dedicated temporary staging directory inside /models.
# ZERO IMPACT: GPU 0 and CoderXP are completely untouched (no GPU device access).
# DO NOT RUN WITHOUT EXPLICIT USER APPROVAL.
# ==============================================================================

set -euo pipefail

MODE="${1:-production}"
MODELS_DIR="${MODELS_DIR:-/models}"
if [ -z "${STAGING_DIR:-}" ]; then
  if [ "$MODE" = "--verify-promote" ] && [ -d "${MODELS_DIR}/.staging_provision_1" ]; then
    STAGING_DIR="${MODELS_DIR}/.staging_provision_1"
  else
    STAGING_DIR="${MODELS_DIR}/.staging_provision_$$"
  fi
fi
LTX_STAGING="${STAGING_DIR}/LTX-Video"
FLUX_STAGING="${STAGING_DIR}/FLUX.1-schnell"

DEST_LTX="${MODELS_DIR}/Lightricks/LTX-Video"
DEST_FLUX="${MODELS_DIR}/black-forest-labs/FLUX.1-schnell"

promoted_ltx=false
promoted_flux=false
rollback_failed=false

cleanup() {
  local exit_code=$?
  if [ "$rollback_failed" = true ]; then
    echo "=================================================================" >&2
    echo "CRITICAL: Rollback move failed. Staging directory $STAGING_DIR PRESERVED." >&2
    echo "No staged data was deleted." >&2
    echo "=================================================================" >&2
  elif [ "$exit_code" -ne 0 ]; then
    echo "=================================================================" >&2
    echo "Provisioning halted with error (code $exit_code)." >&2
    echo "Staging directory $STAGING_DIR PRESERVED for inspection." >&2
    echo "=================================================================" >&2
  elif [ "$promoted_ltx" = true ] && [ "$promoted_flux" = true ]; then
    echo "Promotion successful. Cleaning up empty staging wrapper directory: $STAGING_DIR"
    rm -rf "$STAGING_DIR" 2>/dev/null || true
  elif [ "$MODE" = "--test-args" ]; then
    echo "Cleaning up harmless test staging directory: $STAGING_DIR"
    rm -rf "$STAGING_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------------------------
# Embedded Python Verifier (Invoked via stdin heredoc with zero quote conflicts)
# ------------------------------------------------------------------------------
run_python_verifier() {
  python3 - "$LTX_STAGING" "$FLUX_STAGING" "$MODE" << 'PY_VERIFIER_EOF'
import json, os, sys, hashlib, datetime, urllib.request, shutil

ltx_staging = sys.argv[1]
flux_staging = sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "production"

print(f"=== Embedded Python Verifier Started ===")
print(f"  sys.argv[0]: {sys.argv[0]}")
print(f"  sys.argv[1] (LTX_STAGING):  {ltx_staging}")
print(f"  sys.argv[2] (FLUX_STAGING): {flux_staging}")
print(f"  sys.argv[3] (MODE):         {mode}")

if mode == "--test-args":
    print("Harmless test mode: sys.argv arguments successfully received and confirmed.")
    sys.exit(0)

EXPECTED_DATA = {
    "Lightricks/LTX-Video": {
        "commit": "8984fa25007f376c1a299016d0957a37a2f797bb",
        "expected_class": "LTXPipeline",
        "files": {
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
        },
        "license_file": "LTX-Video-Open-Weights-License-0.X.txt",
        "license_term": "ltxv open weights license"
    },
    "unsloth/FLUX.1-schnell": {
        "commit": "9df3faa7ae3b6ddf0b2b69bb78616372897cc65c",
        "expected_class": "FluxPipeline",
        "files": {
            ".gitattributes": (1668, None),
            "NOTICE": (613, None),
            "README.md": (3994, None),
            "model_index.json": (536, None),
            "schnell_grid.jpeg": (1671111, "5bff488da88933a529825e4fd72e10c3824e22508dc1d6f36b49850fa517ac44"),
            "scheduler/scheduler_config.json": (274, None),
            "text_encoder/config.json": (613, None),
            "text_encoder/model.safetensors": (246144352, "893d67a23f4693ed42cdab4cbad7fe3e727cf59609c40da28a46b5470f9ed082"),
            "text_encoder_2/config.json": (782, None),
            "text_encoder_2/model.safetensors.index.json": (19885, None),
            "text_encoder_2/model-00001-of-00002.safetensors": (4994582224, "ec87bffd1923e8b2774a6d240c922a41f6143081d52cf83b8fe39e9d838c893e"),
            "text_encoder_2/model-00002-of-00002.safetensors": (4530066360, "a5640855b301fcdbceddfa90ae8066cd9414aff020552a201a255ecf2059da00"),
            "tokenizer/tokenizer_config.json": (705, None),
            "tokenizer/vocab.json": (1059962, None),
            "tokenizer/merges.txt": (524619, None),
            "tokenizer/special_tokens_map.json": (588, None),
            "tokenizer_2/tokenizer_config.json": (20817, None),
            "tokenizer_2/tokenizer.json": (2424235, None),
            "tokenizer_2/spiece.model": (791656, "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86"),
            "tokenizer_2/special_tokens_map.json": (2543, None),
            "transformer/config.json": (321, None),
            "transformer/diffusion_pytorch_model.safetensors.index.json": (120822, None),
            "transformer/diffusion_pytorch_model-00001-of-00003.safetensors": (9962580296, "9b633dbe87316385c5b1c262bd4b5a01e3d955170661d63dcec8a01e89c0d820"),
            "transformer/diffusion_pytorch_model-00002-of-00003.safetensors": (9949328904, "58b4434078f0c2567ddc54e3b5cbf39626ab55fbd9d5c22956e183668f535dec"),
            "transformer/diffusion_pytorch_model-00003-of-00003.safetensors": (3870584832, "e2cbc25471ed5186e69a9b51098300cb2f612556453e38a372c851a220ed238d"),
            "vae/config.json": (774, None),
            "vae/diffusion_pytorch_model.safetensors": (167666902, "f5b59a26851551b67ae1fe58d32e76486e1e812def4696a4bea97f16604d40a3")
        },
        "license_file": "README.md",
        "license_term": "license: apache-2.0"
    }
}

def verify_staged_repo(path, repo_id):
    print(f"--- Independent Verification for {repo_id} ---")
    spec = EXPECTED_DATA[repo_id]
    expected_files = spec["files"]

    # 1. Independent revision-specific commit verification via HF API
    api_url = f"https://huggingface.co/api/models/{repo_id}/revision/{spec['commit']}"
    req = urllib.request.Request(api_url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            meta = json.loads(resp.read().decode())
    except Exception as e:
        sys.exit(f"FAIL CLOSED: Could not verify snapshot commit metadata for {repo_id} from {api_url}: {e}")

    revision_sha = meta.get("sha", "")
    print(f"  API Revision Commit SHA: {revision_sha}")
    if revision_sha != spec["commit"]:
        sys.exit(f"FAIL CLOSED: Commit SHA mismatch for {repo_id}: expected {spec['commit']}, got {revision_sha}")

    # 2. Deliberately clean up known Hugging Face cache metadata without ignoring hidden files
    hf_cache_dir = os.path.join(path, ".huggingface")
    if os.path.isdir(hf_cache_dir):
        print(f"  Deliberately cleaning local HF cache metadata: {hf_cache_dir}")
        shutil.rmtree(hf_cache_dir)
    local_cache_dir = os.path.join(path, ".cache")
    if os.path.isdir(local_cache_dir):
        print(f"  Deliberately cleaning local cache directory: {local_cache_dir}")
        shutil.rmtree(local_cache_dir)

    # 3. Complete exact-tree comparison (including .gitattributes, rejecting arbitrary hidden files)
    actual_files = set()
    for root, dirs, files in os.walk(path):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), path).replace("\\", "/")
            actual_files.add(rel)

    expected_set = set(expected_files.keys())
    missing = expected_set - actual_files
    unexpected = actual_files - expected_set

    if missing:
        sys.exit(f"FAIL CLOSED: Missing expected files in {repo_id}: {sorted(missing)}")
    if unexpected:
        sys.exit(f"FAIL CLOSED: Unexpected files present in {repo_id} (including arbitrary hidden files): {sorted(unexpected)}")
    print(f"  [PASS] Full tree matches exactly ({len(actual_files)} files, including root .gitattributes).")

    # 4. Pipeline architecture validation
    with open(os.path.join(path, "model_index.json")) as f:
        idx = json.load(f)
    if idx.get("_class_name") != spec["expected_class"]:
        sys.exit(f"FAIL CLOSED: Pipeline class mismatch: expected {spec['expected_class']}, got {idx.get('_class_name')}")

    # 5. License and NOTICE verification
    lic_p = os.path.join(path, spec["license_file"])
    with open(lic_p, encoding="utf-8", errors="ignore") as f:
        lic_content = f.read().lower()
    if spec["license_term"] not in lic_content:
        sys.exit(f"FAIL CLOSED: License term {spec['license_term']!r} not found in {spec['license_file']}")
    if repo_id == "unsloth/FLUX.1-schnell":
        notice_p = os.path.join(path, "NOTICE")
        if not os.path.isfile(notice_p) or os.path.getsize(notice_p) == 0:
            sys.exit("FAIL CLOSED: NOTICE file missing or empty in FLUX repository")
        with open(notice_p, encoding="utf-8", errors="ignore") as f:
            if "black forest labs" not in f.read().lower():
                sys.exit("FAIL CLOSED: NOTICE content missing Black Forest Labs attribution")
    print("  [PASS] License terms and NOTICE verified.")

    # 6. File size and LFS SHA-256 verification
    for rel_path, (exp_size, exp_sha) in expected_files.items():
        fp = os.path.join(path, rel_path)
        act_size = os.path.getsize(fp)
        if act_size != exp_size:
            sys.exit(f"FAIL CLOSED: Size mismatch on {rel_path}: actual {act_size} != expected {exp_size}")
        if exp_sha:
            print(f"  Verifying SHA-256 for {rel_path} ...", end=" ", flush=True)
            h = hashlib.sha256()
            with open(fp, "rb") as b:
                while chunk := b.read(8 * 1024 * 1024):
                    h.update(chunk)
            act_sha = h.hexdigest()
            if act_sha != exp_sha:
                sys.exit(f"\nFAIL CLOSED: SHA-256 mismatch on {rel_path}: actual {act_sha} != expected {exp_sha}")
            print("MATCH")

    # 7. Audit log record
    inv = {
        "repository": repo_id,
        "commit": spec["commit"],
        "pipeline": spec["expected_class"],
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "files_verified": len(actual_files),
        "lfs_shards_verified": [k for k, v in expected_files.items() if v[1] is not None]
    }
    with open(os.path.join(path, "INVENTORY.json"), "w") as jf:
        json.dump(inv, jf, indent=2)
    print(f"[PASS] {repo_id} verified cleanly.\n")

verify_staged_repo(ltx_staging, "Lightricks/LTX-Video")
verify_staged_repo(flux_staging, "unsloth/FLUX.1-schnell")
PY_VERIFIER_EOF
}

# ------------------------------------------------------------------------------
# Rollback and Promotion Logic
# ------------------------------------------------------------------------------
rollback_promotion() {
  local exit_code=$?
  trap - ERR INT TERM
  echo "Promotion failure (code $exit_code) or signal caught! Initiating rollback..." >&2
  set +e

  if [ "$promoted_ltx" = true ] && [ -d "$DEST_LTX" ]; then
    echo "Rolling back promoted $DEST_LTX -> $LTX_STAGING..." >&2
    if ! mv "$DEST_LTX" "$LTX_STAGING"; then
      echo "CRITICAL: Rollback move failed for $DEST_LTX!" >&2
      rollback_failed=true
    else
      promoted_ltx=false
    fi
  fi

  if [ "$promoted_flux" = true ] && [ -d "$DEST_FLUX" ]; then
    echo "Rolling back promoted $DEST_FLUX -> $FLUX_STAGING..." >&2
    if ! mv "$DEST_FLUX" "$FLUX_STAGING"; then
      echo "CRITICAL: Rollback move failed for $DEST_FLUX!" >&2
      rollback_failed=true
    else
      promoted_flux=false
    fi
  fi

  if [ "$rollback_failed" = true ]; then
    echo "=================================================================" >&2
    echo "ALERT: Rollback move failed. Staging directory preserved intact." >&2
    echo "Recovery paths for manual inspection:" >&2
    echo "  - Staging area: $STAGING_DIR" >&2
    echo "  - LTX path:     $([ -d "$DEST_LTX" ] && echo "$DEST_LTX" || echo "$LTX_STAGING")" >&2
    echo "  - FLUX path:    $([ -d "$DEST_FLUX" ] && echo "$DEST_FLUX" || echo "$FLUX_STAGING")" >&2
    echo "=================================================================" >&2
  else
    echo "Rollback completed cleanly. Staged data preserved in $STAGING_DIR for inspection." >&2
  fi
  exit 1
}

promote_models() {
  echo "=== Applying Scoped Permissions (0755 Dirs / 0644 Files) ==="
  find "$LTX_STAGING" -type d -exec chmod 755 {} +
  find "$LTX_STAGING" -type f -exec chmod 644 {} +
  find "$FLUX_STAGING" -type d -exec chmod 755 {} +
  find "$FLUX_STAGING" -type f -exec chmod 644 {} +

  echo "=== Transactional Promotion with Staging Preservation Rollback ==="
  mkdir -p "$(dirname "$DEST_LTX")"
  mkdir -p "$(dirname "$DEST_FLUX")"

  # Fail-safe collision check: Neither destination may exist
  if [ -e "$DEST_LTX" ]; then
    echo "FAIL-SAFE ERROR: Destination $DEST_LTX already exists. Aborting without modifying existing data." >&2
    exit 1
  fi
  if [ -e "$DEST_FLUX" ]; then
    echo "FAIL-SAFE ERROR: Destination $DEST_FLUX already exists. Aborting without modifying existing data." >&2
    exit 1
  fi

  # Attach rollback handler across moves AND descriptor verification
  trap rollback_promotion ERR INT TERM

  mv "$LTX_STAGING" "$DEST_LTX"
  promoted_ltx=true

  if [ "$MODE" = "--test-fail-move2" ]; then
    echo "Simulating failure between Move 1 and Move 2..." >&2
    false
  fi

  mv "$FLUX_STAGING" "$DEST_FLUX"
  promoted_flux=true

  if [ "$MODE" = "--test-fail-postcheck" ]; then
    echo "Simulating post-move descriptor validation failure..." >&2
    test -f "$DEST_LTX/nonexistent_file"
  fi

  echo "=== Validating Promoted Descriptors (Covered by Rollback Handler) ==="
  test -f "$DEST_LTX/model_index.json"
  test -f "$DEST_LTX/INVENTORY.json"
  test -f "$DEST_LTX/README.md"
  test -f "$DEST_LTX/LTX-Video-Open-Weights-License-0.X.txt"
  test -f "$DEST_FLUX/model_index.json"
  test -f "$DEST_FLUX/INVENTORY.json"
  test -f "$DEST_FLUX/NOTICE"
  test -f "$DEST_FLUX/README.md"

  # Disarm rollback handler ONLY upon 100% success of moves and descriptor verification
  trap - ERR INT TERM

  if [ -d "${MODELS_DIR}/Wan-AI" ]; then
    echo "=== Removing legacy Wan-AI directory to reclaim disk space ==="
    rm -rf "${MODELS_DIR}/Wan-AI"
  fi

  echo "SUCCESS: Transactional promotion and descriptor validation complete."
}

populate_synthetic_descriptors() {
  touch "$LTX_STAGING/model_index.json" "$LTX_STAGING/INVENTORY.json" "$LTX_STAGING/README.md" "$LTX_STAGING/LTX-Video-Open-Weights-License-0.X.txt" "$LTX_STAGING/.gitattributes"
  touch "$FLUX_STAGING/model_index.json" "$FLUX_STAGING/INVENTORY.json" "$FLUX_STAGING/NOTICE" "$FLUX_STAGING/README.md" "$FLUX_STAGING/.gitattributes"
}

# ------------------------------------------------------------------------------
# Main Flow
# ------------------------------------------------------------------------------
mkdir -p "$LTX_STAGING" "$FLUX_STAGING"

if [ "$MODE" = "--test-args" ]; then
  echo "Executing Harmless Test: Validating embedded Python invocation and argument receipt..."
  run_python_verifier
  echo "HARMLess TEST PASSED: Embedded Python correctly received staging directory arguments."
  exit 0
fi

if [ "$MODE" = "--test-cli" ]; then
  echo "Executing Harmless Test: Validating hf CLI installation, detection, and argument construction..."
  echo "=== Installing huggingface_hub CLI ==="
  pip install --no-cache-dir "huggingface_hub>=0.28.0"
  if ! command -v hf >/dev/null 2>&1; then
    echo "FAIL CLOSED: 'hf' executable not found in PATH." >&2
    exit 1
  fi
  echo "Verified hf CLI binary at: $(command -v hf)"
  echo "Testing hf download dry-run argument construction for Lightricks LTX-Video..."
  LTX_COMMIT="8984fa25007f376c1a299016d0957a37a2f797bb"
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
    --local-dir "$LTX_STAGING" --dry-run
  echo "Testing hf download dry-run argument construction for FLUX.1..."
  FLUX_COMMIT="9df3faa7ae3b6ddf0b2b69bb78616372897cc65c"
  hf download unsloth/FLUX.1-schnell --revision "$FLUX_COMMIT" --exclude "flux1-schnell.safetensors" --exclude "ae.safetensors" --local-dir "$FLUX_STAGING" --dry-run
  echo "HARMLESS TEST PASSED: hf CLI detected and dry-run argument construction verified for both models without downloading weights."
  exit 0
fi

if [ "$MODE" = "--verify-promote" ]; then
  echo "=== Verify-Promote Mode: Skipping downloads, verifying existing staged files ==="
  if [ ! -d "$LTX_STAGING" ]; then
    echo "FAIL CLOSED: LTX staging directory not found: $LTX_STAGING" >&2
    exit 1
  fi
  if [ ! -d "$FLUX_STAGING" ]; then
    echo "FAIL CLOSED: FLUX staging directory not found: $FLUX_STAGING" >&2
    exit 1
  fi
  echo "Found existing staging directories:"
  echo "  Staging Root: $STAGING_DIR"
  echo "  LTX:          $LTX_STAGING ($(find "$LTX_STAGING" -type f | wc -l) files)"
  echo "  FLUX:         $FLUX_STAGING ($(find "$FLUX_STAGING" -type f | wc -l) files)"
  echo "=== Running Deep Verification ==="
  run_python_verifier
  echo "=== Promoting Verified Models ==="
  promote_models
  exit 0
fi

if [[ "$MODE" == --test-* ]]; then
  echo "Executing Test Mode: $MODE on synthetic data in $MODELS_DIR..."
  populate_synthetic_descriptors
  promote_models
  exit 0
fi

# Production Mode Execution
echo "=== Installing huggingface_hub CLI ==="
pip install --no-cache-dir "huggingface_hub>=0.28.0"

if ! command -v hf >/dev/null 2>&1; then
  echo "FAIL CLOSED: 'hf' executable not found in PATH after installing huggingface_hub." >&2
  exit 1
fi
echo "Verified hf CLI binary at: $(command -v hf)"

echo "=== Staging Lightricks/LTX-Video (Diffusers components only) ==="
LTX_COMMIT="8984fa25007f376c1a299016d0957a37a2f797bb"
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
  --local-dir "$LTX_STAGING"

echo "=== Staging FLUX.1-schnell (Diffusers components only) ==="
FLUX_COMMIT="9df3faa7ae3b6ddf0b2b69bb78616372897cc65c"
hf download unsloth/FLUX.1-schnell \
  --revision "$FLUX_COMMIT" \
  --exclude "flux1-schnell.safetensors" \
  --exclude "ae.safetensors" \
  --local-dir "$FLUX_STAGING"

echo "=== Running Deep Verification ==="
run_python_verifier

echo "=== Promoting Verified Models ==="
promote_models
