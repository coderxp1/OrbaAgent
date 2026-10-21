"""Deployed-source identification (gap G4).

The 2026-10-21 incident persisted because new source was deployed to
disk while the running process kept executing the previous code, and
nothing in the worker's surface could prove which code it was
running. This module computes a SHA-256 fingerprint of the worker's
own key source files, relative to the installed package directory.
Inside the deployment image those files are immutable and identical
to the imported code, so the fingerprint reported by /health and the
startup log identifies the code the process is executing. An
operator can compare it against the expected release hashes without
any shell access to the container.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

_FINGERPRINT_FILES = (
    "app.py",
    "generation.py",
    "config.py",
    "models.py",
    "validation.py",
    "backends/diffusers_backend.py",
    "backends/comfyui_backend.py",
)

_cache: Optional[dict] = None


def source_fingerprint(base_dir: Optional[Path] = None) -> dict:
    """Return {relative path: sha256 hex or "missing"} for key files."""
    root = Path(base_dir) if base_dir is not None else Path(__file__).resolve().parent
    result = {}
    for rel in _FINGERPRINT_FILES:
        target = root / rel
        if not target.is_file():
            result[rel] = "missing"
            continue
        digest = hashlib.sha256()
        with open(target, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        result[rel] = digest.hexdigest()
    return result


def cached_source_fingerprint() -> dict:
    """Process-lifetime fingerprint (files are immutable in the image)."""
    global _cache
    if _cache is None:
        _cache = source_fingerprint()
    return _cache
