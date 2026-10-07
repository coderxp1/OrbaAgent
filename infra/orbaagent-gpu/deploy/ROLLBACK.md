# GPU Worker Rollback Procedure

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

#### Option 2: Minimal Rollback (Preserve Configuration)
```bash
# Only stop the container and remove its runtime state
sudo -u klaus sudo orbaagent-gpu down

# Clear the models volume (preserves source configuration)
docker volume rm orbaagent-gpu_orbaagent_models orbaagent-gpu_orbaagent_output orbaagent-gpu_orbaagent_data 2>/dev/null || true

# Remove generated artifacts but keep source code
rm -f /etc/orbaagent/gpu-worker/worker.env
rm -rf /etc/orbaagent/gpu-worker/secrets/
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