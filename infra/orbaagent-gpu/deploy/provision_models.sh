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
WAN_STAGING="${STAGING_DIR}/Wan2.1-T2V-1.3B"
FLUX_STAGING="${STAGING_DIR}/FLUX.1-schnell"

DEST_WAN="${MODELS_DIR}/Wan-AI/Wan2.1-T2V-1.3B"
DEST_FLUX="${MODELS_DIR}/black-forest-labs/FLUX.1-schnell"

promoted_wan=false
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
  elif [ "$promoted_wan" = true ] && [ "$promoted_flux" = true ]; then
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
  python3 - "$WAN_STAGING" "$FLUX_STAGING" "$MODE" << 'PY_VERIFIER_EOF'
import json, os, sys, hashlib, datetime, urllib.request, shutil

wan_staging = sys.argv[1]
flux_staging = sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "production"

print(f"=== Embedded Python Verifier Started ===")
print(f"  sys.argv[0]: {sys.argv[0]}")
print(f"  sys.argv[1] (WAN_STAGING):  {wan_staging}")
print(f"  sys.argv[2] (FLUX_STAGING): {flux_staging}")
print(f"  sys.argv[3] (MODE):         {mode}")

if mode == "--test-args":
    print("Harmless test mode: sys.argv arguments successfully received and confirmed.")
    sys.exit(0)

EXPECTED_DATA = {
    "Wan-AI/Wan2.1-T2V-1.3B-Diffusers": {
        "commit": "0fad780a534b6463e45facd96134c9f345acfa5b",
        "expected_class": "WanPipeline",
        "files": {
            ".gitattributes": (2174, None),
            "README.md": (18116, None),
            "model_index.json": (400, None),
            "scheduler/scheduler_config.json": (751, None),
            "text_encoder/config.json": (854, None),
            "text_encoder/model.safetensors.index.json": (22476, None),
            "text_encoder/model-00001-of-00005.safetensors": (4972389712, "c0ef3a140898e228a3520c9adec60743d2e8e5b3d229651bb37f1a3921919f99"),
            "text_encoder/model-00002-of-00005.safetensors": (4899225672, "481c7b2b39771c44df6dd8d13ee12ed072d731b4a650bd092885d4d52db229ad"),
            "text_encoder/model-00003-of-00005.safetensors": (4966309504, "f93148bcc04052a169e1e49bfcf6125df6cf9bf243cb9c627da75266cf8e35c3"),
            "text_encoder/model-00004-of-00005.safetensors": (4999880704, "a451792c739c05bca4606190cc2dd16731411bac03b4cf6aacc5767321f857c9"),
            "text_encoder/model-00005-of-00005.safetensors": (2885866152, "7e76e18d224531b8197a46231cb53daf7f2f6ca707130252becf933026ac4eea"),
            "tokenizer/tokenizer_config.json": (61758, None),
            "tokenizer/tokenizer.json": (16837459, None),
            "tokenizer/spiece.model": (4548313, "e3909a67b780650b35cf529ac782ad2b6b26e6d1f849d3fbb6a872905f452458"),
            "tokenizer/special_tokens_map.json": (7079, None),
            "transformer/config.json": (465, None),
            "transformer/diffusion_pytorch_model.safetensors.index.json": (73296, None),
            "transformer/diffusion_pytorch_model-00001-of-00002.safetensors": (4998781576, "6d011927dbd2cc8afe53d57abab04a8fd86f615d83324770d985fb058ece3a24"),
            "transformer/diffusion_pytorch_model-00002-of-00002.safetensors": (677289072, "b92ec2309b1f239af6f746431815a881afcc938abb26a4f08d9a2fd6c892f872"),
            "vae/config.json": (724, None),
            "vae/diffusion_pytorch_model.safetensors": (507591892, "d6e524b3fffede1787a74e81b30976dce5400c4439ba64222168e607ed19e793"),
            "assets/comp_effic.png": (1793594, "b0e225caffb4b31295ad150f95ee852e4c3dde4a00ac8f79a2ff500f2ce26b8d"),
            "assets/data_for_diff_stage.jpg": (528268, "59aec08409f2d46b0e640e4e120dc7cca52c08c3de56d026602dbcff1ebf241a"),
            "assets/i2v_res.png": (891681, "6823b3206d8d0cb18d3b5b949dec1217f1178109ba11f14e977b67e1f7b8a248"),
            "assets/logo.png": (56322, "96cddc0f667293436d0b9f92a299b6346b65b231d38ee49719a33d46c91fe1e3"),
            "assets/t2v_res.jpg": (301030, "91db579092446be2a834bc67721a8e4346936f38c4edb912f459ca3e10f8f439"),
            "assets/vben_1.3b_vs_sota.png": (515765, "b7705db79f2e1428ec7a1e6fff8c4fbde062fb95bb233516ddbd04b20007c845"),
            "assets/vben_vs_sota.png": (1552119, "9a0e86ca85046d2675f97984b88b6e74df07bba8a62a31ab8a1aef50d4eda44e"),
            "assets/video_dit_arch.jpg": (643369, "195dceec6570289d8b01cc51d2e28a7786216f19de55b23978a52610d1646a66"),
            "assets/video_vae_res.jpg": (212586, "d8f9e7f7353848056a615c8ef35ab86ec22976bb46cb27405008b4089701945c"),
            "examples/i2v_input.JPG": (250628, "077e3d965090c9028c69c00931675f42e1acc815c6eb450ab291b3b72d211a8e")
        },
        "license_file": "README.md",
        "license_term": "license: apache-2.0"
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

verify_staged_repo(wan_staging, "Wan-AI/Wan2.1-T2V-1.3B-Diffusers")
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

  if [ "$promoted_wan" = true ] && [ -d "$DEST_WAN" ]; then
    echo "Rolling back promoted $DEST_WAN -> $WAN_STAGING..." >&2
    if ! mv "$DEST_WAN" "$WAN_STAGING"; then
      echo "CRITICAL: Rollback move failed for $DEST_WAN!" >&2
      rollback_failed=true
    else
      promoted_wan=false
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
    echo "  - Wan path:     $([ -d "$DEST_WAN" ] && echo "$DEST_WAN" || echo "$WAN_STAGING")" >&2
    echo "  - FLUX path:    $([ -d "$DEST_FLUX" ] && echo "$DEST_FLUX" || echo "$FLUX_STAGING")" >&2
    echo "=================================================================" >&2
  else
    echo "Rollback completed cleanly. Staged data preserved in $STAGING_DIR for inspection." >&2
  fi
  exit 1
}

promote_models() {
  echo "=== Applying Scoped Permissions (0755 Dirs / 0644 Files) ==="
  find "$WAN_STAGING" -type d -exec chmod 755 {} +
  find "$WAN_STAGING" -type f -exec chmod 644 {} +
  find "$FLUX_STAGING" -type d -exec chmod 755 {} +
  find "$FLUX_STAGING" -type f -exec chmod 644 {} +

  echo "=== Transactional Promotion with Staging Preservation Rollback ==="
  mkdir -p "$(dirname "$DEST_WAN")"
  mkdir -p "$(dirname "$DEST_FLUX")"

  # Fail-safe collision check: Neither destination may exist
  if [ -e "$DEST_WAN" ]; then
    echo "FAIL-SAFE ERROR: Destination $DEST_WAN already exists. Aborting without modifying existing data." >&2
    exit 1
  fi
  if [ -e "$DEST_FLUX" ]; then
    echo "FAIL-SAFE ERROR: Destination $DEST_FLUX already exists. Aborting without modifying existing data." >&2
    exit 1
  fi

  # Attach rollback handler across moves AND descriptor verification
  trap rollback_promotion ERR INT TERM

  mv "$WAN_STAGING" "$DEST_WAN"
  promoted_wan=true

  if [ "$MODE" = "--test-fail-move2" ]; then
    echo "Simulating failure between Move 1 and Move 2..." >&2
    false
  fi

  mv "$FLUX_STAGING" "$DEST_FLUX"
  promoted_flux=true

  if [ "$MODE" = "--test-fail-postcheck" ]; then
    echo "Simulating post-move descriptor validation failure..." >&2
    test -f "$DEST_WAN/nonexistent_file"
  fi

  echo "=== Validating Promoted Descriptors (Covered by Rollback Handler) ==="
  test -f "$DEST_WAN/model_index.json"
  test -f "$DEST_WAN/INVENTORY.json"
  test -f "$DEST_WAN/README.md"
  test -f "$DEST_FLUX/model_index.json"
  test -f "$DEST_FLUX/INVENTORY.json"
  test -f "$DEST_FLUX/NOTICE"
  test -f "$DEST_FLUX/README.md"

  # Disarm rollback handler ONLY upon 100% success of moves and descriptor verification
  trap - ERR INT TERM

  echo "SUCCESS: Transactional promotion and descriptor validation complete."
}

populate_synthetic_descriptors() {
  touch "$WAN_STAGING/model_index.json" "$WAN_STAGING/INVENTORY.json" "$WAN_STAGING/README.md" "$WAN_STAGING/.gitattributes"
  touch "$FLUX_STAGING/model_index.json" "$FLUX_STAGING/INVENTORY.json" "$FLUX_STAGING/NOTICE" "$FLUX_STAGING/README.md" "$FLUX_STAGING/.gitattributes"
}

# ------------------------------------------------------------------------------
# Main Flow
# ------------------------------------------------------------------------------
mkdir -p "$WAN_STAGING" "$FLUX_STAGING"

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
  echo "Testing hf download dry-run argument construction for Wan 2.1..."
  WAN_COMMIT="0fad780a534b6463e45facd96134c9f345acfa5b"
  hf download Wan-AI/Wan2.1-T2V-1.3B-Diffusers --revision "$WAN_COMMIT" --local-dir "$WAN_STAGING" --dry-run
  echo "Testing hf download dry-run argument construction for FLUX.1..."
  FLUX_COMMIT="9df3faa7ae3b6ddf0b2b69bb78616372897cc65c"
  hf download unsloth/FLUX.1-schnell --revision "$FLUX_COMMIT" --exclude "flux1-schnell.safetensors" --exclude "ae.safetensors" --local-dir "$FLUX_STAGING" --dry-run
  echo "HARMLESS TEST PASSED: hf CLI detected and dry-run argument construction verified for both models without downloading weights."
  exit 0
fi

if [ "$MODE" = "--verify-promote" ]; then
  echo "=== Verify-Promote Mode: Skipping downloads, verifying existing staged files ==="
  if [ ! -d "$WAN_STAGING" ]; then
    echo "FAIL CLOSED: Wan staging directory not found: $WAN_STAGING" >&2
    exit 1
  fi
  if [ ! -d "$FLUX_STAGING" ]; then
    echo "FAIL CLOSED: FLUX staging directory not found: $FLUX_STAGING" >&2
    exit 1
  fi
  echo "Found existing staging directories:"
  echo "  Staging Root: $STAGING_DIR"
  echo "  Wan:          $WAN_STAGING ($(find "$WAN_STAGING" -type f | wc -l) files)"
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

echo "=== Staging Wan2.1-T2V-1.3B-Diffusers ==="
WAN_COMMIT="0fad780a534b6463e45facd96134c9f345acfa5b"
hf download Wan-AI/Wan2.1-T2V-1.3B-Diffusers \
  --revision "$WAN_COMMIT" \
  --local-dir "$WAN_STAGING"

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
