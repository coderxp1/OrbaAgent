#!/usr/bin/env python3
"""Adversarial security tests for OrbaAgent GPU isolation, network rules, archive gates, and paths."""
from __future__ import annotations

import io
import os
import tarfile
import tempfile
from pathlib import Path

from orba_gpu import deploy_validation
from orba_gpu import fw_wg_verify as v
from orba_gpu import validation
from deploy import bootstrap_provision as bp

EXPECTED_GPU_UUID = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"
FORBIDDEN_GPU_UUID = "GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4"


def test_firewall_adversarial():
    # 1. Valid tunnel rule -> PASS
    valid_ufw = """Status: active
To                         Action      From
--                         ------      ----
51820/udp                  ALLOW       85.215.156.241
8190/tcp (wg-orba)         ROUTE ALLOW IN  10.77.0.1 -> 10.77.0.2
"""
    assert v.verify_ufw_state(valid_ufw) is True

    # 2. Public / Anywhere 8190 -> REJECT
    assert v.verify_tcp_8190_tunnel_only("""Status: active
8190/tcp                   ALLOW       Anywhere
""") is False

    # 3. CIDR wildcard 8190 -> REJECT
    assert v.verify_tcp_8190_tunnel_only("""Status: active
8190/tcp                   ALLOW       0.0.0.0/0
""") is False

    # 4. Wrong interface 8190 -> REJECT
    assert v.verify_tcp_8190_tunnel_only("""Status: active
8190/tcp (eth0)            ROUTE ALLOW IN  10.77.0.1 -> 10.77.0.2
""") is False

    # 5. Wrong peer IP -> REJECT
    assert v.verify_tcp_8190_tunnel_only("""Status: active
8190/tcp (wg-orba)         ROUTE ALLOW IN  10.77.0.99 -> 10.77.0.2
""") is False

    # 6. Combined valid rule + public rule -> REJECT
    assert v.verify_tcp_8190_tunnel_only("""Status: active
8190/tcp (wg-orba)         ROUTE ALLOW IN  10.77.0.1 -> 10.77.0.2
8190/tcp                   ALLOW       Anywhere
""") is False

    # 6b. Port 11435 Public / Anywhere -> REJECT
    assert v.verify_tcp_11435_tunnel_only("""Status: active
11435/tcp                  ALLOW       Anywhere
""") is False

    # 6c. Port 11435 Valid tunnel rule -> PASS
    assert v.verify_tcp_11435_tunnel_only("""Status: active
11435/tcp (wg-orba)        ROUTE ALLOW IN  10.77.0.1 -> 10.77.0.2
""") is True

    # 7. UDP 51820 Anywhere -> REJECT
    assert v.verify_udp_51820_from_production("""Status: active
51820/udp                  ALLOW       Anywhere
""") is False

    # 8. UDP 51820 non-production IP -> REJECT
    assert v.verify_udp_51820_from_production("""Status: active
51820/udp                  ALLOW       1.2.3.4
""") is False

    # 9. Inactive UFW -> REJECT
    assert v.parse_ufw_enabled("Status: inactive") is False


def test_wireguard_adversarial():
    # 1. Valid -> PASS
    assert v.verify_wireguard_active("Active: active (running)") is True
    assert v.verify_wg_interface_present("2: wg-orba: <POINTOPOINT,UP>") is True
    assert v.verify_wg_address("inet 10.77.0.2/32 scope global wg-orba") is True

    # 2. Inactive service -> REJECT
    assert v.verify_wireguard_active("Active: inactive (dead)") is False

    # 3. Missing interface -> REJECT
    assert v.verify_wg_interface_present("1: eth0: <BROADCAST>") is False

    # 4. Wrong IP -> REJECT
    assert v.verify_wg_address("inet 10.77.0.99/32 scope global wg-orba") is False


def test_privileged_paths_adversarial():
    # 1. CoderXP access attempts -> MUST REJECT
    assert validation.validate_privileged_path("/srv/projects/coderxp") is False
    assert validation.validate_privileged_path("/srv/projects/coderxp/data") is False

    # 2. Root and system paths -> MUST REJECT
    assert validation.validate_privileged_path("/") is False
    assert validation.validate_privileged_path("/etc") is False
    assert validation.validate_privileged_path("/etc/shadow") is False
    assert validation.validate_privileged_path("/root") is False
    assert validation.validate_privileged_path("/srv/projects") is False

    # 3. Traversal attacks -> MUST REJECT
    assert validation.validate_privileged_path("/srv/projects/orbaagent-gpu/../../etc/shadow") is False

    # 4. Authorized application paths -> MUST PASS
    assert validation.validate_privileged_path("/srv/projects/orbaagent-gpu") is True
    assert validation.validate_privileged_path("/srv/projects/orbaagent-gpu/scratch") is True
    assert validation.validate_privileged_path("/etc/orbaagent/gpu-worker") is True
    assert validation.validate_privileged_path("/etc/orbaagent/gpu-worker/src") is True


def test_destructive_operations_adversarial():
    # 1. Attempts to delete root or system dirs -> MUST REJECT
    assert validation.validate_destructive_target("/", "/etc") is False
    assert validation.validate_destructive_target("/etc", "/etc") is False
    assert validation.validate_destructive_target("/srv/projects/coderxp", "/srv/projects") is False

    # 2. Attempts to delete parent itself -> MUST REJECT
    assert validation.validate_destructive_target(
        "/etc/orbaagent/gpu-worker", "/etc/orbaagent/gpu-worker"
    ) is False

    # 3. Traversal out of parent -> MUST REJECT
    assert validation.validate_destructive_target(
        "/etc/orbaagent/gpu-worker/../../etc/shadow", "/etc/orbaagent/gpu-worker"
    ) is False

    # 4. Valid target inside parent -> MUST PASS
    assert validation.validate_destructive_target(
        "/etc/orbaagent/gpu-worker/src/orba_gpu", "/etc/orbaagent/gpu-worker"
    ) is True
    assert validation.validate_destructive_target(
        "/srv/projects/orbaagent-gpu/scratch", "/srv/projects/orbaagent-gpu"
    ) is True


def test_archive_whitelist_adversarial(tmp_path: Path | None = None):
    # Test archive validation against malformed and malicious tar archives
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        # 1. Path traversal in archive member
        bad_tar = tmp / "traversal.tar.gz"
        with tarfile.open(bad_tar, "w:gz") as tf:
            ti = tarfile.TarInfo(name="deploy/../../etc/passwd")
            ti.size = 0
            tf.addfile(ti, io.BytesIO())
        try:
            bp.verify_archive(bad_tar, expected_sha256=bp.sha256_file(bad_tar))
            assert False, "Should have rejected archive with traversal"
        except bp.BootstrapError:
            pass

        # 2. Absolute path in archive member
        abs_tar = tmp / "abs.tar.gz"
        with tarfile.open(abs_tar, "w:gz") as tf:
            ti = tarfile.TarInfo(name="/etc/passwd")
            ti.size = 0
            tf.addfile(ti, io.BytesIO())
        try:
            bp.verify_archive(abs_tar, expected_sha256=bp.sha256_file(abs_tar))
            assert False, "Should have rejected archive with absolute path"
        except bp.BootstrapError:
            pass

        # 3. Symlink in archive member
        sym_tar = tmp / "symlink.tar.gz"
        with tarfile.open(sym_tar, "w:gz") as tf:
            ti = tarfile.TarInfo(name="deploy/evil_link")
            ti.type = tarfile.SYMTYPE
            ti.linkname = "/etc/shadow"
            tf.addfile(ti)
        try:
            bp.verify_archive(sym_tar, expected_sha256=bp.sha256_file(sym_tar))
            assert False, "Should have rejected archive with symlink"
        except bp.BootstrapError:
            pass

        # 4. Unapproved / non-whitelisted file
        unapproved_tar = tmp / "unapproved.tar.gz"
        with tarfile.open(unapproved_tar, "w:gz") as tf:
            ti = tarfile.TarInfo(name="deploy/malicious_backdoor.sh")
            ti.size = 0
            tf.addfile(ti, io.BytesIO())
        try:
            bp.verify_archive(unapproved_tar, expected_sha256=bp.sha256_file(unapproved_tar))
            assert False, "Should have rejected non-whitelisted file"
        except bp.BootstrapError:
            pass

        # 5. Mismatched SHA256
        dummy_tar = tmp / "dummy.tar.gz"
        with tarfile.open(dummy_tar, "w:gz") as tf:
            ti = tarfile.TarInfo(name="Dockerfile")
            ti.size = 0
            tf.addfile(ti, io.BytesIO())
        try:
            bp.verify_archive(dummy_tar, expected_sha256="0000000000000000000000000000000000000000000000000000000000000000")
            assert False, "Should have rejected mismatched SHA256"
        except bp.BootstrapError:
            pass


def test_gpu_and_docker_isolation_adversarial():
    base_compose = f"""services:
  worker:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['{EXPECTED_GPU_UUID}']
              capabilities: [gpu]
    environment:
      - NVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}
      - CUDA_VISIBLE_DEVICES=0
    ports:
      - "10.77.0.2:8190:8190"
"""
    # 1. Valid compose -> PASS
    deploy_validation.validate_isolation(base_compose)

    # 2. Forbidden GPU 0 UUID -> REJECT
    gpu0_compose = base_compose.replace(EXPECTED_GPU_UUID, FORBIDDEN_GPU_UUID)
    try:
        deploy_validation.validate_isolation(gpu0_compose)
        assert False, "Should reject GPU 0"
    except deploy_validation.IsolationError:
        pass

    # 3. Privileged: true -> REJECT
    priv_compose = base_compose + "    privileged: true\n"
    try:
        deploy_validation.validate_isolation(priv_compose)
        assert False, "Should reject privileged: true"
    except deploy_validation.IsolationError:
        pass

    # 4. Host network mode -> REJECT
    net_compose = base_compose + "    network_mode: host\n"
    try:
        deploy_validation.validate_isolation(net_compose)
        assert False, "Should reject network_mode: host"
    except deploy_validation.IsolationError:
        pass

    # 5. Host NVIDIA mount -> REJECT
    mount_compose = base_compose + "    volumes:\n      - /dev/nvidia0:/dev/nvidia0\n"
    try:
        deploy_validation.validate_isolation(mount_compose)
        assert False, "Should reject host nvidia mount"
    except deploy_validation.IsolationError:
        pass

    # 6. Broad GPU access (--gpus all / count: all) -> REJECT
    broad_compose = base_compose.replace(f"device_ids: ['{EXPECTED_GPU_UUID}']", "count: all")
    try:
        deploy_validation.validate_isolation(broad_compose)
        assert False, "Should reject count: all"
    except deploy_validation.IsolationError:
        pass

    # 7. Public / non-private port publication -> REJECT
    for bad_port in (
        '"0.0.0.0:8190:8190"',
        '"45.84.65.76:8190:8190"',
        '"127.0.0.1:8190:8190"',
        '"0.0.0.0:11435:11434"',
        '"45.84.65.76:11435:11434"',
    ):
        bad_compose = base_compose.replace('"10.77.0.2:8190:8190"', bad_port)
        try:
            deploy_validation.validate_isolation(bad_compose)
            assert False, f"Should reject port {bad_port}"
        except deploy_validation.IsolationError:
            pass


def run_all():
    print("Running test_firewall_adversarial...")
    test_firewall_adversarial()
    print("Running test_wireguard_adversarial...")
    test_wireguard_adversarial()
    print("Running test_privileged_paths_adversarial...")
    test_privileged_paths_adversarial()
    print("Running test_destructive_operations_adversarial...")
    test_destructive_operations_adversarial()
    print("Running test_archive_whitelist_adversarial...")
    test_archive_whitelist_adversarial()
    print("Running test_gpu_and_docker_isolation_adversarial...")
    test_gpu_and_docker_isolation_adversarial()
    print("ALL ADVERSARIAL SECURITY TESTS PASSED")


if __name__ == "__main__":
    run_all()
