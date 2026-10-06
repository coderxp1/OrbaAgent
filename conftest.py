"""Test configuration: make the ``orba_gpu`` package importable.

Lives at the repository root so it applies whether pytest is invoked from the repo
root or from ``infra/orbaagent-gpu``.
"""

import sys
from pathlib import Path

GPU_ROOT = Path(__file__).parent / "infra" / "orbaagent-gpu"

if str(GPU_ROOT) not in sys.path:
    sys.path.insert(0, str(GPU_ROOT))
