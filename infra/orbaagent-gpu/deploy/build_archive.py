#!/usr/bin/env python3
"""Build and verify the hardened OrbaAgent GPU provisioning archive."""
from __future__ import annotations

import gzip
import hashlib
import io
import os
import sys
import tarfile
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from deploy import bootstrap_provision as bp

OUTPUT_ARCHIVE = REPO_ROOT / "orbaagent-gpu-provisioning.tar.gz"

# Deterministic timestamp
DETERMINISTIC_MTIME = 1775500000


def compute_payload_hash(files: list[tuple[Path, str]]) -> str:
    """Compute the deterministic SHA-256 over all payload files (excluding provision script)."""
    # Equivalent to: (cd "$SOURCE_DIR" && find . -type f ! -path "./.git/*" ! -name ".git*" ! -name "*.pyc" ! -name "provision-gpu-host.sh" -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')
    payload = [
        (fs_path, f"./{rel_name}")
        for fs_path, rel_name in files
        if not rel_name.endswith("provision-gpu-host.sh")
    ]
    payload.sort(key=lambda x: x[1])
    lines = []
    for fs_path, rel_name in payload:
        with fs_path.open("rb") as f:
            h = hashlib.sha256(f.read()).hexdigest()
        lines.append(f"{h}  {rel_name}\n")
    table = "".join(lines).encode("utf-8")
    return hashlib.sha256(table).hexdigest()



def get_files_to_pack() -> list[tuple[Path, str]]:
    """Return list of (filesystem_path, archive_rel_path)."""
    items: list[tuple[Path, str]] = []

    # Root files
    for name in ("Dockerfile", "worker.py"):
        p = REPO_ROOT / name
        if p.is_file():
            items.append((p, name))

    # Deploy files
    deploy_dir = REPO_ROOT / "deploy"
    for name in (
        "provision-gpu-host.sh",
        "orbaagent-gpu",
        "compose.yaml",
        "worker.env.example",
        "sudoers-orbaagent-gpu",
        "ROLLBACK.md",
        "ACCEPTANCE.md",
        "check_compose_isolation.py",
    ):
        p = deploy_dir / name
        if p.is_file():
            items.append((p, f"deploy/{name}"))

    # WireGuard configs
    wg_dir = deploy_dir / "wireguard"
    if wg_dir.is_dir():
        for f in sorted(wg_dir.iterdir()):
            if f.is_file():
                items.append((f, f"deploy/wireguard/{f.name}"))

    # orba_gpu source package (excluding __pycache__ and .pyc)
    orba_dir = REPO_ROOT / "orba_gpu"
    for root, dirs, files in os.walk(orba_dir):
        # Exclude pycache in-place
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        rel_root = Path(root).relative_to(REPO_ROOT).as_posix()
        for f in sorted(files):
            if f.endswith(".pyc") or f == "__pycache__":
                continue
            p = Path(root) / f
            items.append((p, f"{rel_root}/{f}"))

    return sorted(items, key=lambda x: x[1])


def build_archive(output_path: Path = OUTPUT_ARCHIVE) -> tuple[Path, str, int]:
    files = get_files_to_pack()

    # In-memory tar buffer for deterministic gzip compression
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:") as tf:
        # Add dirs first in sorted order
        dirs_added = set()
        for _, rel_name in files:
            parts = rel_name.split("/")
            for i in range(1, len(parts)):
                dir_path = "/".join(parts[:i])
                if dir_path not in dirs_added:
                    dirs_added.add(dir_path)
                    ti = tarfile.TarInfo(name=dir_path)
                    ti.type = tarfile.DIRTYPE
                    ti.mode = 0o755
                    ti.mtime = DETERMINISTIC_MTIME
                    ti.uid = 0
                    ti.gid = 0
                    ti.uname = "root"
                    ti.gname = "root"
                    tf.addfile(ti)

        # Add files
        for fs_path, rel_name in files:
            ti = tarfile.TarInfo(name=rel_name)
            ti.size = fs_path.stat().st_size
            ti.mtime = DETERMINISTIC_MTIME
            ti.uid = 0
            ti.gid = 0
            ti.uname = "root"
            ti.gname = "root"
            if rel_name.endswith(".sh") or rel_name == "deploy/orbaagent-gpu":
                ti.mode = 0o755
            else:
                ti.mode = 0o644

            with fs_path.open("rb") as f:
                tf.addfile(ti, f)

    tar_bytes = tar_buf.getvalue()

    # Deterministic gzip compression (mtime=0)
    with output_path.open("wb") as out_f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=out_f, mtime=0) as gz:
            gz.write(tar_bytes)

    # Compute SHA256
    sha256 = bp.sha256_file(output_path)
    file_count = len(files)
    payload_hash = compute_payload_hash(files)
    return output_path, sha256, file_count, payload_hash


def verify_extracted_clean(archive_path: Path, expected_payload_hash: str) -> None:
    """Verify internal bundle integrity from a clean temporary extraction."""
    with tempfile.TemporaryDirectory(prefix="orba-verify-clean.") as td:
        tmp_dir = Path(td)
        # Extract verified
        bp.extract_verified(archive_path, tmp_dir)
        # Find all regular files (excluding provision-gpu-host.sh)
        extracted_files = []
        for root, dirs, files in os.walk(tmp_dir):
            for f in sorted(files):
                if f.endswith(".pyc") or f == "provision-gpu-host.sh":
                    continue
                p = Path(root) / f
                rel = "./" + p.relative_to(tmp_dir).as_posix()
                extracted_files.append((p, rel))
        extracted_files.sort(key=lambda x: x[1])

        lines = []
        for p, rel in extracted_files:
            with p.open("rb") as f:
                h = hashlib.sha256(f.read()).hexdigest()
            lines.append(f"{h}  {rel}\n")
        table = "".join(lines).encode("utf-8")
        actual_payload_hash = hashlib.sha256(table).hexdigest()

        if actual_payload_hash != expected_payload_hash:
            raise RuntimeError(
                f"Clean extraction payload hash mismatch!\n"
                f"  Expected: {expected_payload_hash}\n"
                f"  Actual:   {actual_payload_hash}"
            )


def main():
    archive_path, sha256, file_count, payload_hash = build_archive()
    print(f"Archive built: {archive_path}")
    print(f"File count: {file_count}")
    print(f"SHA256 (outer archive): {sha256}")
    print(f"Payload SHA256 (internal bundle): {payload_hash}")

    # Verify against whitelist and integrity
    print("Verifying archive against whitelist and outer SHA256...")
    bp.verify_archive(archive_path, expected_sha256=sha256)
    print("Outer archive verification PASSED!")

    # Verify clean extraction and internal integrity
    print("Verifying internal bundle integrity from clean extraction...")
    verify_extracted_clean(archive_path, payload_hash)
    print("Clean internal integrity test PASSED!")


if __name__ == "__main__":
    main()
