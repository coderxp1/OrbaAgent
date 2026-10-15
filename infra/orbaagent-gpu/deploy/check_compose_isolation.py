#!/usr/bin/env python3
"""CLI wrapper around orba_gpu.deploy_validation.

Installed alongside the worker so the root-owned lifecycle wrapper can re-assert
GPU isolation against the RENDERED compose config at runtime:

    docker compose config | python3 -m orba_gpu.deploy_validation -
    python3 deploy/check_compose_isolation.py /etc/orbaagent/gpu-worker/compose.yaml
    PYTHONPATH=/etc/orbaagent/gpu-worker/src python3 -m orba_gpu.deploy_validation -

Exit codes: 0 ok · 2 usage · 3 unreadable input · 4 isolation violation
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running directly from a checkout as well as from the install directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orba_gpu.deploy_validation import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
