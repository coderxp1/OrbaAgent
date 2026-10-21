"""Deployed-source fingerprint (gap G4)."""

from __future__ import annotations

import hashlib
from pathlib import Path

from orba_gpu.build_info import source_fingerprint


def _tree(tmp_path: Path) -> Path:
    (tmp_path / "backends").mkdir()
    (tmp_path / "app.py").write_bytes(b"app-v1")
    (tmp_path / "generation.py").write_bytes(b"gen-v1")
    (tmp_path / "backends" / "diffusers_backend.py").write_bytes(b"diff-v1")
    return tmp_path


def test_fingerprint_hashes_present_files_and_marks_missing(tmp_path):
    fp = source_fingerprint(_tree(tmp_path))
    assert fp["app.py"] == hashlib.sha256(b"app-v1").hexdigest()
    assert fp["generation.py"] == hashlib.sha256(b"gen-v1").hexdigest()
    assert fp["backends/diffusers_backend.py"] == hashlib.sha256(b"diff-v1").hexdigest()
    assert fp["config.py"] == "missing"
    assert fp["backends/comfyui_backend.py"] == "missing"


def test_fingerprint_changes_when_source_changes(tmp_path):
    tree = _tree(tmp_path)
    before = source_fingerprint(tree)
    (tree / "generation.py").write_bytes(b"gen-v2")
    after = source_fingerprint(tree)
    assert before["generation.py"] != after["generation.py"]
    assert before["app.py"] == after["app.py"]


def test_real_package_fingerprint_is_complete():
    fp = source_fingerprint()
    assert all(v != "missing" for v in fp.values()), fp
    assert all(len(v) == 64 for v in fp.values())
