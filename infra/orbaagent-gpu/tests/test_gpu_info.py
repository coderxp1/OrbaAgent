"""Tests for UUID-scoped GPU detection.

The bug these tests exist for: the original implementation ran nvidia-smi with no
device selector, took the first line, and hardcoded "GPU 1". On this host GPU 0 is
listed first and is running an unrelated production workload, so that code reported
GPU 0's 10 GB of usage as if it were GPU 1's.
"""

from __future__ import annotations

import subprocess

import pytest

from orba_gpu.gpu_info import QUERY_FIELDS, GpuInfo, get_gpu_info

GPU0_UUID = "GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4"
GPU1_UUID = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"


def fake_runner(stdout: str = "", stderr: str = "", returncode: int = 0, raises=None):
    """Build a runner and capture the argv it was called with."""

    calls: list[list[str]] = []

    def runner(cmd):
        calls.append(list(cmd))
        if raises is not None:
            raise raises
        return subprocess.CompletedProcess(args=list(cmd), returncode=returncode, stdout=stdout, stderr=stderr)

    runner.calls = calls  # type: ignore[attr-defined]
    return runner


def test_correct_uuid_reports_correct_values():
    runner = fake_runner("NVIDIA RTX PRO 6000 Blackwell Server Edition, 97887, 0, 97887\n")
    info = get_gpu_info(GPU1_UUID, runner=runner)

    assert info.available is True
    assert info.uuid == GPU1_UUID
    assert info.name == "NVIDIA RTX PRO 6000 Blackwell Server Edition"
    assert info.memory_total_mib == 97887
    assert info.memory_used_mib == 0
    assert info.memory_free_mib == 97887
    assert info.error is None


def test_query_uses_explicit_uuid_selection():
    """The nvidia-smi invocation must select by UUID, not by ordering."""
    runner = fake_runner("Card, 100, 0, 100\n")
    get_gpu_info(GPU1_UUID, runner=runner)

    argv = runner.calls[0]  # type: ignore[attr-defined]
    assert "-i" in argv
    assert argv[argv.index("-i") + 1] == GPU1_UUID
    assert f"--query-gpu={','.join(QUERY_FIELDS)}" in argv
    assert "--format=csv,noheader,nounits" in argv


def test_multi_gpu_output_where_gpu0_appears_first_is_rejected():
    """If nvidia-smi ignores the selector and prints both GPUs, refuse.

    Accepting line 1 here is exactly the original bug: GPU 0's numbers would be
    reported as GPU 1's.
    """
    multi = (
        "NVIDIA RTX PRO 6000 Blackwell Server Edition, 97887, 10233, 87654\n"
        "NVIDIA RTX PRO 6000 Blackwell Server Edition, 97887, 0, 97887\n"
    )
    info = get_gpu_info(GPU1_UUID, runner=fake_runner(multi))

    assert info.available is False
    assert info.error is not None
    assert "exactly one GPU" in info.error
    # Crucially it must not have picked either line.
    assert info.memory_used_mib is None


def test_missing_uuid_produces_safe_failure_not_a_fallback():
    """A UUID that nvidia-smi cannot find must fail, never fall back."""
    runner = fake_runner(
        stdout="",
        stderr="Error: Invalid GPU identifier\n",
        returncode=1,
    )
    info = get_gpu_info(GPU1_UUID, runner=runner)

    assert info.available is False
    assert info.uuid == GPU1_UUID
    assert "exited 1" in (info.error or "")
    assert info.memory_used_mib is None


def test_empty_uuid_is_rejected_before_any_subprocess_call():
    runner = fake_runner("whatever, 1, 2, 3\n")
    info = get_gpu_info("", runner=runner)

    assert info.available is False
    assert "refusing to select a GPU by ordering" in (info.error or "")
    assert runner.calls == []  # type: ignore[attr-defined]


def test_whitespace_uuid_is_rejected():
    runner = fake_runner("whatever, 1, 2, 3\n")
    info = get_gpu_info("   ", runner=runner)
    assert info.available is False
    assert runner.calls == []  # type: ignore[attr-defined]


def test_nvidia_smi_missing_is_reported_clearly():
    info = get_gpu_info(GPU1_UUID, runner=fake_runner(raises=FileNotFoundError()))
    assert info.available is False
    assert "nvidia-smi not found" in (info.error or "")


def test_nvidia_smi_timeout_is_reported_clearly():
    info = get_gpu_info(
        GPU1_UUID, runner=fake_runner(raises=subprocess.TimeoutExpired(cmd="nvidia-smi", timeout=5))
    )
    assert info.available is False
    assert "timed out" in (info.error or "")


def test_garbage_memory_values_are_rejected():
    info = get_gpu_info(GPU1_UUID, runner=fake_runner("Card, N/A, N/A, N/A\n"))
    assert info.available is False
    assert "non-numeric" in (info.error or "")


def test_too_few_fields_is_rejected():
    info = get_gpu_info(GPU1_UUID, runner=fake_runner("Card, 100\n"))
    assert info.available is False
    assert "expected" in (info.error or "")


def test_to_dict_never_claims_a_device_name_it_did_not_query():
    """The serialised form must carry the UUID, not a hardcoded 'GPU 1'."""
    ok = get_gpu_info(GPU1_UUID, runner=fake_runner("Card, 10, 1, 9\n")).to_dict()
    assert ok["device_uuid"] == GPU1_UUID
    assert "GPU 1" not in ok["device"].replace(GPU1_UUID, "")

    bad = get_gpu_info(GPU1_UUID, runner=fake_runner("", returncode=1)).to_dict()
    assert bad["available"] is False
    assert bad["device_uuid"] == GPU1_UUID
    assert "memory_used" not in bad


def test_gpu0_uuid_is_never_substituted_for_gpu1():
    """A query for GPU 1 must never return GPU 0's identity."""
    runner = fake_runner("Card, 97887, 10233, 87654\n")
    info = get_gpu_info(GPU1_UUID, runner=runner)
    assert info.uuid == GPU1_UUID
    assert info.uuid != GPU0_UUID
    # The argv proves we asked for GPU 1 specifically.
    assert GPU0_UUID not in runner.calls[0]  # type: ignore[attr-defined]
