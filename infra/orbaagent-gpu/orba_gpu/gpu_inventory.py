"""Live GPU inventory check: does the allocation policy describe *this* host?

``deploy_validation`` proves the rendered compose config pins the policy UUID.
It cannot prove that the UUID exists on the machine, that it sits at the host
index the operator believes it does, or that the "forbidden" UUIDs are real
devices rather than stale copy-paste. This module closes that gap by reading
``nvidia-smi --query-gpu=index,uuid,name --format=csv,noheader`` and comparing
it with the policy. It never selects a GPU by ordering: the index is only ever
*checked* against the UUID, never used to derive it.

Usage (the wrapper pipes nvidia-smi output in; operators may also run it directly):

    nvidia-smi --query-gpu=index,uuid,name --format=csv,noheader \\
        | python3 -m orba_gpu.gpu_inventory --policy-file /etc/orbaagent/gpu-worker/worker.env --check -

    python3 -m orba_gpu.gpu_inventory --policy-file worker.env --check        # runs nvidia-smi itself
    python3 -m orba_gpu.gpu_inventory --list                                   # table only, no policy

Exit codes: 0 ok · 2 usage · 3 nvidia-smi unavailable/unparseable · 4 policy mismatch
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Optional, Sequence

from .deploy_validation import (
    POLICY_INDEX_ENV,
    POLICY_UUID_ENV,
    GPU_UUID_RE,
    GpuAllocationPolicy,
    IsolationError,
    policy_from_env,
    policy_from_env_file,
)

QUERY_ARGS = ("--query-gpu=index,uuid,name", "--format=csv,noheader")
NVIDIA_SMI_TIMEOUT_SECONDS = 10


class InventoryError(Exception):
    """nvidia-smi could not be run or its output could not be parsed."""


@dataclass(frozen=True)
class GpuDevice:
    index: int
    uuid: str
    name: str


def parse_nvidia_smi_csv(text: str) -> list[GpuDevice]:
    """Parse ``index, uuid, name`` CSV rows (header tolerated, blank lines ignored)."""
    devices: list[GpuDevice] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 3:
            raise InventoryError(f"unexpected nvidia-smi row (need index,uuid,name): {line!r}")
        if parts[0].lower() == "index":
            continue  # header row
        if not parts[0].isdigit():
            raise InventoryError(f"nvidia-smi row has a non-numeric index: {line!r}")
        uuid = parts[1]
        if not GPU_UUID_RE.match(uuid):
            raise InventoryError(f"nvidia-smi row has a malformed UUID: {line!r}")
        devices.append(GpuDevice(index=int(parts[0]), uuid=uuid, name=",".join(parts[2:])))
    if not devices:
        raise InventoryError("nvidia-smi reported no GPUs")
    seen: set[str] = set()
    for device in devices:
        if device.uuid.lower() in seen:
            raise InventoryError(f"nvidia-smi reported UUID {device.uuid} twice")
        seen.add(device.uuid.lower())
    return devices


def check_inventory(devices: Sequence[GpuDevice], policy: GpuAllocationPolicy) -> list[str]:
    """Return every way the live inventory disagrees with the policy (empty = ok)."""
    policy.validate()
    problems: list[str] = []
    by_uuid = {device.uuid.lower(): device for device in devices}

    worker = by_uuid.get(policy.worker_uuid.lower())
    if worker is None:
        problems.append(
            f"{POLICY_UUID_ENV}={policy.worker_uuid} is not present on this host "
            f"(live UUIDs: {', '.join(d.uuid for d in devices)})"
        )
    elif policy.worker_index is not None and worker.index != policy.worker_index:
        problems.append(
            f"{POLICY_UUID_ENV}={policy.worker_uuid} is host index {worker.index}, "
            f"but {POLICY_INDEX_ENV}={policy.worker_index}; the index->UUID map in the policy is wrong"
        )

    for uuid in policy.forbidden_uuids:
        if uuid.lower() not in by_uuid:
            problems.append(
                f"forbidden GPU {uuid} is not present on this host; the policy is stale and must be re-verified"
            )
    return problems


def run_nvidia_smi(nvidia_smi_path: str = "nvidia-smi") -> str:
    try:
        completed = subprocess.run(
            [nvidia_smi_path, *QUERY_ARGS],
            capture_output=True,
            text=True,
            timeout=NVIDIA_SMI_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise InventoryError(f"cannot run {nvidia_smi_path}: {exc}") from exc
    if completed.returncode != 0:
        raise InventoryError(
            f"{nvidia_smi_path} exited {completed.returncode}: {(completed.stderr or completed.stdout).strip()}"
        )
    return completed.stdout


def format_table(devices: Sequence[GpuDevice], policy: Optional[GpuAllocationPolicy]) -> str:
    rows = ["index  role        uuid                                      name"]
    for device in sorted(devices, key=lambda d: d.index):
        role = "-"
        if policy is not None:
            if device.uuid.lower() == policy.worker_uuid.lower():
                role = "WORKER"
            elif policy.is_forbidden(device.uuid):
                role = "FORBIDDEN"
            else:
                role = "unassigned"
        rows.append(f"{device.index:<6} {role:<11} {device.uuid:<41} {device.name}")
    return "\n".join(rows)


def main(argv: Optional[list[str]] = None) -> int:
    import sys

    args = list(sys.argv if argv is None else argv)[1:]
    policy_file: Optional[str] = None
    nvidia_smi = "nvidia-smi"
    check = False
    list_only = False
    source: Optional[str] = None
    while args:
        arg = args.pop(0)
        if arg == "--policy-file":
            if not args:
                print("usage: --policy-file requires a path", file=sys.stderr)
                return 2
            policy_file = args.pop(0)
        elif arg.startswith("--policy-file="):
            policy_file = arg.split("=", 1)[1]
        elif arg == "--nvidia-smi":
            if not args:
                print("usage: --nvidia-smi requires a path", file=sys.stderr)
                return 2
            nvidia_smi = args.pop(0)
        elif arg == "--check":
            check = True
        elif arg == "--list":
            list_only = True
        elif arg.startswith("-") and arg != "-":
            print(f"unknown option {arg}", file=sys.stderr)
            return 2
        else:
            source = arg

    if not check and not list_only:
        print(
            "usage: python3 -m orba_gpu.gpu_inventory (--check [--policy-file worker.env] | --list) [--nvidia-smi PATH] [csv-file|-]",
            file=sys.stderr,
        )
        return 2

    try:
        if source == "-":
            text = sys.stdin.read()
        elif source:
            with open(source, "r", encoding="utf-8") as handle:
                text = handle.read()
        else:
            text = run_nvidia_smi(nvidia_smi)
        devices = parse_nvidia_smi_csv(text)
    except (OSError, InventoryError) as exc:
        print(f"INVENTORY FAILURE: {exc}", file=sys.stderr)
        return 3

    policy: Optional[GpuAllocationPolicy] = None
    if check:
        try:
            policy = policy_from_env_file(policy_file) if policy_file else policy_from_env()
        except IsolationError as exc:
            print(f"POLICY FAILURE: {exc}", file=sys.stderr)
            return 4

    print(format_table(devices, policy))
    if policy is None:
        return 0

    problems = check_inventory(devices, policy)
    if problems:
        for problem in problems:
            print(f"INVENTORY MISMATCH: {problem}", file=sys.stderr)
        return 4
    worker = next(d for d in devices if d.uuid.lower() == policy.worker_uuid.lower())
    print(f"inventory OK: worker GPU {worker.uuid} is host index {worker.index} ({worker.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
