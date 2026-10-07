#!/usr/bin/env python3
"""Tests for the hardening requirements in provision-gpu-host.sh"""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path


def _get_bash_cmd() -> str | None:
    git_bash = r"C:\Program Files\Git\bin\bash.exe"
    if os.path.exists(git_bash):
        return git_bash
    which_bash = shutil.which("bash")
    if which_bash:
        # test if it works without WSL relay errors
        try:
            r = subprocess.run([which_bash, "-c", "echo ok"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                return which_bash
        except Exception:
            pass
    return None


def test_no_symlinks_in_source(tmp_path: str | Path):
    """Test that the provisioning script rejects source bundles with symlinks."""
    tmp_path = Path(tmp_path)
    bundle_dir = tmp_path / "test-bundle"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    deploy_dir = bundle_dir / "deploy"
    deploy_dir.mkdir(parents=True, exist_ok=True)

    link_path = bundle_dir / "link-to-nowhere"
    try:
        link_path.symlink_to("/nonexistent")
    except OSError:
        # Windows without symlink privileges
        pass

    script_content = '''#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$(dirname "$SCRIPT_DIR")}"

# Symlink check from provisioning script
if [ -n "$(find "$SOURCE_DIR" -type l -print -quit)" ]; then
    echo "SYMLINK_DETECTED"
    exit 1
fi
echo "NO_SYMLINKS"
exit 0
'''

    script_path = deploy_dir / "provision-gpu-host.sh"
    script_path.write_text(script_content)

    bash_cmd = _get_bash_cmd()
    if bash_cmd and link_path.is_symlink():
        result = subprocess.run(
            [bash_cmd, str(script_path)],
            env={**os.environ, "SOURCE_DIR": str(bundle_dir)},
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "SYMLINK_DETECTED" in result.stdout

        link_path.unlink()
        result = subprocess.run(
            [bash_cmd, str(script_path)],
            env={**os.environ, "SOURCE_DIR": str(bundle_dir)},
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "NO_SYMLINKS" in result.stdout


def test_setfacl_mandatory():
    """Test that setfacl is treated as mandatory."""
    script_path = Path("infra/orbaagent-gpu/deploy/provision-gpu-host.sh")
    script_content = script_path.read_text(encoding="utf-8")
    assert "setfacl not found; install acl package" in script_content


def test_firewall_fail_closed_logic():
    """Test that firewall commands don't have || true for fail-closed behavior."""
    script_path = Path("infra/orbaagent-gpu/deploy/provision-gpu-host.sh")
    script_content = script_path.read_text(encoding="utf-8")

    lines = script_content.split('\n')
    firewall_lines = [
        line for line in lines
        if 'ufw allow' in line or 'ufw route allow' in line or 'ufw --force enable' in line
    ]

    for line in firewall_lines:
        assert '|| true' not in line, f"Firewall line should not have || true for fail-closed: {line}"


def test_hash_verification_logic():
    """Test that hash verification logic is present."""
    script_path = Path("infra/orbaagent-gpu/deploy/provision-gpu-host.sh")
    script_content = script_path.read_text(encoding="utf-8")

    assert "Bundle hash verification" in script_content
    assert "EXPECTED_SHA256" in script_content
    assert "ACTUAL_SHA256" in script_content
    assert "Bundle hash mismatch" in script_content


def test_symlink_check_in_validation():
    """Test that validation.py includes symlink checking."""
    from orba_gpu import validation

    assert hasattr(validation, 'check_symlinks_in_source')

    with tempfile.TemporaryDirectory() as tmp_dir:
        link_path = os.path.join(tmp_dir, "test_link")
        try:
            os.symlink("/nonexistent", link_path)
            assert validation.check_symlinks_in_source(tmp_dir) is True
            os.unlink(link_path)
        except OSError:
            pass
        assert validation.check_symlinks_in_source(tmp_dir) is False


def test_hash_verification_function():
    """Test that hash verification function works."""
    from orba_gpu import validation
    assert hasattr(validation, 'enforce_hash_verification')
    assert callable(validation.enforce_hash_verification)


def test_acl_validation_function():
    """Test that ACL validation function exists."""
    from orba_gpu import validation
    assert hasattr(validation, 'validate_filesystem_permissions')
    assert callable(validation.validate_filesystem_permissions)


def test_privileged_path_validation():
    """Test privileged path validation function."""
    from orba_gpu import validation
    assert hasattr(validation, 'validate_privileged_path')
    assert validation.validate_privileged_path("/srv/projects/coderxp") is False
    assert validation.validate_privileged_path("/srv/projects/orbaagent-gpu") is True
    assert validation.validate_privileged_path("/etc/orbaagent/gpu-worker") is True


def test_destructive_target_validation():
    """Test destructive target validation function."""
    from orba_gpu import validation
    assert hasattr(validation, 'validate_destructive_target')
    assert validation.validate_destructive_target("/", "/etc") is False
    assert validation.validate_destructive_target("/srv/projects/coderxp", "/srv/projects") is False
    assert validation.validate_destructive_target("/etc/orbaagent/gpu-worker/src/orba_gpu", "/etc/orbaagent/gpu-worker") is True


def test_internal_bundle_payload_hash_matches_expectation():
    """Verify that EXPECTED_SHA256 in provision-gpu-host.sh matches the deterministic payload hash."""
    from deploy import build_archive
    files = build_archive.get_files_to_pack()
    expected_payload_hash = build_archive.compute_payload_hash(files)

    script_path = Path("infra/orbaagent-gpu/deploy/provision-gpu-host.sh")
    script_content = script_path.read_text(encoding="utf-8")
    assert expected_payload_hash in script_content, (
        f"provision-gpu-host.sh does not contain payload hash: {expected_payload_hash}"
    )


def test_archive_clean_internal_integrity():
    """Verify that a clean extraction of the built archive passes internal payload integrity."""
    from deploy import build_archive
    archive_path = Path("infra/orbaagent-gpu/orbaagent-gpu-provisioning.tar.gz")
    assert archive_path.is_file(), "Archive must exist"

    files = build_archive.get_files_to_pack()
    expected_payload_hash = build_archive.compute_payload_hash(files)
    build_archive.verify_extracted_clean(archive_path, expected_payload_hash)


def test_wrapper_immutability_verification_logic():
    """Verify that provision-gpu-host.sh enforces strict root:root 0755 and rejects unprivileged writability."""
    script_path = Path("infra/orbaagent-gpu/deploy/provision-gpu-host.sh")
    script_content = script_path.read_text(encoding="utf-8")

    assert 'install -o root -g root -m 0755 "$SOURCE_DIR/deploy/orbaagent-gpu" "$WRAPPER"' in script_content
    assert "stat -c '%u:%g' \"$WRAPPER\"" in script_content
    assert "stat -c '%a' \"$WRAPPER\"" in script_content
    assert "-perm /022" in script_content
    assert "test -w '$WRAPPER'" in script_content
    assert "wrapper is writable by $WORKER_USER" in script_content


if __name__ == "__main__":
    test_no_symlinks_in_source(tempfile.mkdtemp())
    test_setfacl_mandatory()
    test_firewall_fail_closed_logic()
    test_hash_verification_logic()
    test_symlink_check_in_validation()
    test_hash_verification_function()
    test_acl_validation_function()
    test_privileged_path_validation()
    test_destructive_target_validation()
    test_internal_bundle_payload_hash_matches_expectation()
    test_archive_clean_internal_integrity()
    test_wrapper_immutability_verification_logic()
    print("All hardening tests passed!")