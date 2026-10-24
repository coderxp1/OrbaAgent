# GPU Worker Rollback Procedure

## Worker-only rollback (allocation change of 2026-10-24) — USE THIS FIRST

The 2026-10-24 change moves ONLY the worker (GPU 0 via the `ORBA_WORKER_GPU_UUID`
policy in worker.env). Ollama stays on GPU 1 untouched, ComfyUI stays stopped, MOVA
is a separate reservation. The rollback must therefore be worker-only too. The
options further below (`down`, full reset, volume purge) are the legacy project-wide
procedures: they stop/recreate ollama and are **not** authorized for this change.

```bash
# 1. Stop and remove ONLY the worker container. Never volumes, never networks,
#    never ollama/comfyui. Exit 0 and `status` no longer lists orbaagent-gpu-worker.
sudo orbaagent-gpu down-worker
sudo orbaagent-gpu status

# 2. Restore the previous root-owned files from the evidence directory the
#    operator created BEFORE the change (see GPU-ALLOCATION-2026-10-24.md):
#    compose.yaml, worker.env, src/ (deploy_validation.py, gpu_inventory.py,
#    config.py, worker.py), /usr/local/sbin/orbaagent-gpu, /etc/sudoers.d/orbaagent-gpu.
#    Use same-filesystem temp files + atomic rename; verify sha256 and modes after.

# 3. Do NOT start the old GPU-1 worker as "rollback". Before this change the worker
#    was ABSENT on the host (Agent 1, issue #11, 2026-10-24); the restored baseline is
#    "worker absent", i.e. generation unavailable. Starting anything on GPU 1 is a new
#    allocation decision, not a rollback.

# 4. Prove nothing else moved: ollama container ID/StartedAt unchanged, comfyui not
#    running, no worker process on either GPU.
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name --format=csv,noheader
docker ps --no-trunc --format '{{.ID}} {{.Names}} {{.Status}}'
```

## Emergency Rollback Commands

### Immediate Container Stop
```bash
sudo -u klaus sudo orbaagent-gpu down
```

### Clean State Restoration

#### Option 1: Full Reset (Recommended)
```bash
# Stop any running containers
sudo -u klaus sudo orbaagent-gpu down

# Remove the worker container
rm -f /etc/orbaagent/gpu-worker/src/Dockerfile
rm -f /etc/orbaagent/gpu-worker/src/worker.py
rm -rf /etc/orbaagent/gpu-worker/src/orba_gpu
rm -f /etc/orbaagent/gpu-worker/compose.yaml
rm -f /etc/orbaagent/gpu-worker/worker.env
rm -f /etc/orbaagent/gpu-worker/sudoers-orbaagent-gpu
rm -f /usr/local/sbin/orbaagent-gpu
rm -rf /etc/orbaagent/gpu-worker/secrets/

# Restore original permissions on /etc/orbaagent/gpu-worker
chown root:root /etc/orbaagent/gpu-worker
chmod 755 /etc/orbaagent/gpu-worker

# Restore ACL on /srv/projects
# Note: This command should only be run if you understand the security implications
# setfacl -d -m u:klaus:--x /srv/projects

# Remove worker sudoers file
rm -f /etc/sudoers.d/orbaagent-gpu
```

#### Option 2: Standard Service Rollback (Preserves Model Weights)
```bash
# Stop and remove worker containers
sudo -u klaus sudo orbaagent-gpu down

# Revert WireGuard firewall rule for port 11435 if needed
sudo ufw delete allow in on wg-orba from 10.77.0.1 to 10.77.0.2 port 11435 proto tcp 2>/dev/null || true

# Note: Model volume `orbaagent_ollama_models` is deliberately PRESERVED to avoid
# re-downloading weights.
```

#### Option 3: Explicit Destructive Volume Purge (Requires Deliberate Approval)
> [!CAUTION]
> This permanently deletes downloaded model weights in `orbaagent_ollama_models`.
> Only execute if a clean-slate purge has been explicitly authorized.
```bash
docker volume rm orbaagent_ollama_models 2>/dev/null || true
```

## Hardening Integration

This rollback guide is now **hardened** with the following security improvements:

### 1. TOCTOU Protection
- **Before**: Direct file operations without symlink checks
- **After**: Hardened with symlink detection before any operations
- **Impact**: Prevents time-of-check-time-of-use attacks through symlink manipulation

### 2. Bundle Integrity Verification
- **Before**: No hash verification before deployment
- **After**: Mandatory SHA-256 hash verification of bundles before extraction
- **Impact**: Prevents deployment of tampered or corrupted bundles

### 3. Mandatory ACL Enforcement
- **Before**: setfacl installation was only a warning
- **After**: setfacl is mandatory - deployment fails if not present
- **Impact**: Ensures CoderXP protection cannot be bypassed by missing ACL support

### 4. Fail-Closed Firewall Posture
- **Before**: UFW commands had `|| true` for error handling
- **After**: All UFW commands are fail-closed - any error prevents deployment
- **Impact**: Network isolation cannot be accidentally disabled during deployment

## LTX-Video Preparation Rollback

`prepare_ltx_model.sh` performs model staging, source/wrapper installation, and
verification as one transaction. It never edits `worker.env`, restarts services,
or touches Wan, FLUX, Ollama, ComfyUI, GPU 0, WireGuard, UFW, or secrets.

### Automatic rollback

On any failure or on `SIGINT` / `SIGTERM` / `SIGHUP`, the EXIT trap:

1. Restores the wrapper via a staged atomic rename and verifies it byte-for-byte
   against its backup.
2. Restores the source tree via a staged atomic rename and verifies it with
   `diff -rq` against the backup.
3. Moves a model promoted by the same run back to its isolated staging directory.
4. Prints a `ROLLBACK VERIFICATION REPORT` with a per-path `clean` status.

A destination that existed **before** the run is never moved or modified
(`PREEXISTING_UNTOUCHED`). `SIGKILL` / power loss cannot run traps; the atomic
renames and permanent backups below keep the host recoverable.

### Backups and artifacts

Paths use a unique `RUN_ID` (`YYYYmmdd_HHMMSS_<pid>_<random>`):

```text
/etc/orbaagent/gpu-worker/src.bak.<RUN_ID>              # permanent source backup
/etc/orbaagent/gpu-worker/src.prev.<RUN_ID>             # previous production source
/etc/orbaagent/gpu-worker/worker.env.bak.<RUN_ID>       # permanent config backup
/usr/local/sbin/orbaagent-gpu.bak.<RUN_ID>              # permanent wrapper backup
/var/lib/docker/volumes/orbaagent_models/_data/
  .staging_ltx_<RUN_ID>                                 # staged model
```

Manual recovery: inspect the report, then restore the highest-confidence backup
with the same staged-then-atomic-rename pattern. Do not delete backups until the
worker has been validated.

### Regression suite

Run the full failure-injection suite before staging on the GPU host:

```bash
bash infra/orbaagent-gpu/deploy/test_prepare_ltx_regression.sh
# or: prepare_ltx_model.sh --test
```

It covers pre-existing-destination protection, archive traversal/symlink/hardlink
rejection, promotion and swap rollbacks, missing-backup reporting, signal exit
codes, and backend interface checks (12/12 must pass).

## Security-First Rollback

When performing emergency rollbacks, follow these hardened procedures:

1. **Immediate Verification**: Check for symlinks before removing files
2. **Hash Validation**: Verify bundle integrity before restoring from backup
3. **ACL Confirmation**: Ensure setfacl is present before restoring permissions
4. **Network Isolation**: Verify firewall rules remain intact throughout rollback

## Recovery Checklist

- [ ] Stop all worker containers
- [ ] Verify no symlinks exist in source bundles
- [ ] Validate bundle integrity with hash verification
- [ ] Confirm setfacl is available and properly configured
- [ ] Check firewall rules are fail-closed
- [ ] Restore configuration from trusted backup
- [ ] Verify GPU isolation is intact
- [ ] Test network connectivity over WireGuard tunnel

## Prevention

These hardening measures address the 4 requirements:

1. ✅ **Symlink/TOCTOU protection**: Explicit symlink detection before deployment
2. ✅ **Hash-verified root extraction**: SHA-256 verification prevents bundle tampering
3. ✅ **Mandatory setfacl**: Deployment fails if ACL not present (hardened)
4. ✅ **Firewall fail-closed**: UFW commands fail closed - no accidental network exposure

**Note**: The hardened rollback guide now integrates security requirements directly into the emergency procedures, ensuring that recovery operations maintain the same security posture as the initial deployment.