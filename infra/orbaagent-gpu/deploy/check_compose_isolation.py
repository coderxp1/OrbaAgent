#!/usr/bin/env python3
"""CLI wrapper around orba_gpu.deploy_validation.

Installed alongside the worker so the root-owned lifecycle wrapper can re-assert
GPU isolation against the RENDERED compose config at runtime:

    docker compose config | python3 check_compose_isolation.py -
    python3 check_compose_isolation.py /etc/orbaagent/gpu-worker/compose.yaml

Exit codes: 0 ok · 2 usage · 3 unreadable input · 4 isolation violation
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running from the repository checkout as well as from the install dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orba_gpu.deploy_validation import EXPECTED_GPU_UUID, violations  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_compose_isolation.py <config-file|->", file=sys.stderr)
        return 2

    if argv[1] == "-":
        text = sys.stdin.read()
    else:
        try:
            text = Path(argv[1]).read_text(encoding="utf-8")
        except OSError as exc:
            print(f"cannot read {argv[1]}: {exc}", file=sys.stderr)
            return 3

    found = violations(text)
    if found:
        for item in found:
            print(f"ISOLATION FAILURE: {item}", file=sys.stderr)
        return 4

    print(f"isolation OK: pinned to {EXPECTED_GPU_UUID}, GPU 0 absent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
