"""GPU detection, scoped to an explicit device UUID.

The previous implementation ran ``nvidia-smi`` with no device selector, took the
first line of output, and hardcoded ``"device": "GPU 1"``. On a multi-GPU host
that reports GPU 0's statistics while labelling them as GPU 1 — catastrophic when
GPU 0 is running an unrelated production workload that must never be touched.

This module never infers the device from ordering. It asks ``nvidia-smi`` for one
explicit UUID, and if that UUID is absent it reports unavailable rather than
silently falling back to another GPU.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

#: Query fields requested from nvidia-smi, in order.
QUERY_FIELDS = ("name", "memory.total", "memory.used", "memory.free")

NVIDIA_SMI_TIMEOUT_SECONDS = 5


@dataclass(frozen=True)
class GpuInfo:
    """Statistics for one specific GPU."""

    available: bool
    uuid: str
    name: Optional[str] = None
    memory_total_mib: Optional[int] = None
    memory_used_mib: Optional[int] = None
    memory_free_mib: Optional[int] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        """Serialise for the /health response.

        Field names are kept backwards compatible with the previous response
        shape ("memory_total" as "<n> MiB") so existing consumers keep working.
        """
        payload: dict = {
            "available": self.available,
            "device_uuid": self.uuid,
            "device": f"GPU {self.uuid}",
        }
        if self.available:
            payload.update(
                {
                    "name": self.name,
                    "memory_total": f"{self.memory_total_mib} MiB",
                    "memory_used": f"{self.memory_used_mib} MiB",
                    "memory_free": f"{self.memory_free_mib} MiB",
                }
            )
        else:
            payload["error"] = self.error or "GPU not available"
        return payload


def _default_runner(cmd: Sequence[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(cmd),
        capture_output=True,
        text=True,
        timeout=NVIDIA_SMI_TIMEOUT_SECONDS,
        check=False,
    )


def _build_command(uuid: str, nvidia_smi_path: str) -> list[str]:
    """Build the nvidia-smi invocation.

    ``-i <uuid>`` is what enforces device selection. Without it nvidia-smi prints
    every GPU and the first line wins.
    """
    return [
        nvidia_smi_path,
        "-i",
        uuid,
        f"--query-gpu={','.join(QUERY_FIELDS)}",
        "--format=csv,noheader,nounits",
    ]


def _parse_single_line(stdout: str) -> Optional[list[str]]:
    """Return the field list for exactly one GPU, or None if ambiguous/empty.

    More than one non-empty line means nvidia-smi ignored the selector. That is
    treated as a failure: accepting line 1 would reintroduce the ordering bug this
    module exists to prevent.
    """
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        return None
    return [field.strip() for field in lines[0].split(",")]


def _parse_int(value: str) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def get_gpu_info(
    uuid: str,
    nvidia_smi_path: str = "nvidia-smi",
    runner: Optional[Callable[[Sequence[str]], subprocess.CompletedProcess]] = None,
) -> GpuInfo:
    """Query statistics for exactly ``uuid``.

    Args:
        uuid: The GPU UUID to query, e.g. ``GPU-82e03c6c-...``. Required; an
            empty value is an error, never a wildcard.
        nvidia_smi_path: Path to the nvidia-smi binary.
        runner: Injection point for tests. Receives the argv list.

    Returns:
        GpuInfo. ``available`` is False on any failure, with ``error`` explaining
        why. This function never raises on a missing GPU.
    """
    if not uuid or not str(uuid).strip():
        return GpuInfo(
            available=False,
            uuid="",
            error="No GPU UUID configured; refusing to select a GPU by ordering",
        )

    uuid = str(uuid).strip()
    run = runner or _default_runner

    try:
        result = run(_build_command(uuid, nvidia_smi_path))
    except FileNotFoundError:
        return GpuInfo(available=False, uuid=uuid, error="nvidia-smi not found in the worker image")
    except subprocess.TimeoutExpired:
        return GpuInfo(available=False, uuid=uuid, error="nvidia-smi timed out")
    except Exception as exc:  # pragma: no cover - defensive
        return GpuInfo(available=False, uuid=uuid, error=f"nvidia-smi invocation failed: {exc}")

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        detail = stderr.splitlines()[-1] if stderr else "no stderr"
        return GpuInfo(
            available=False,
            uuid=uuid,
            error=f"nvidia-smi exited {result.returncode} for UUID {uuid}: {detail}",
        )

    fields = _parse_single_line(result.stdout or "")
    if fields is None:
        return GpuInfo(
            available=False,
            uuid=uuid,
            error=(
                "nvidia-smi did not return exactly one GPU for the requested UUID; "
                "refusing to fall back to a different device"
            ),
        )

    if len(fields) < len(QUERY_FIELDS):
        return GpuInfo(
            available=False,
            uuid=uuid,
            error=f"nvidia-smi returned {len(fields)} fields, expected {len(QUERY_FIELDS)}",
        )

    name, total, used, free = fields[0], _parse_int(fields[1]), _parse_int(fields[2]), _parse_int(fields[3])
    if total is None or used is None or free is None:
        return GpuInfo(
            available=False,
            uuid=uuid,
            error="nvidia-smi returned non-numeric memory values",
        )

    return GpuInfo(
        available=True,
        uuid=uuid,
        name=name,
        memory_total_mib=total,
        memory_used_mib=used,
        memory_free_mib=free,
    )
