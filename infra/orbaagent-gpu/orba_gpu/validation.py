"""Output validation for generated artifacts.

Nothing is reported as successful until the bytes on disk have been read back and
verified. A generation job that produces a truncated, empty, or wrong-format file
is a failure, and the partial artifact is removed.

Added hardening measures for TOCTOU protection:
- check_symlinks_in_source: Detects symlinks in source directories
- enforce_hash_verification: Ensures bundle integrity before extraction
- validate_filesystem_permissions: Verifies no group/world-writable files
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Sequence

from PIL import Image

FFPROBE_TIMEOUT_SECONDS = 30

#: Allowed deviation between requested and actual video duration.
DURATION_TOLERANCE_SECONDS = 1.5
DURATION_TOLERANCE_RATIO = 0.35


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    error: Optional[str] = None
    details: Optional[dict] = None


def sha256_of(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_symlinks_in_source(path: str) -> bool:
    """Check if a path contains symlinks (TOCTOU protection).
    
    Args:
        path: Path to check for symlinks
        
    Returns:
        True if symlinks are found, False otherwise
    """
    try:
        for root, dirs, files in os.walk(path):
            for item in dirs + files:
                full_path = os.path.join(root, item)
                if os.path.islink(full_path):
                    return True
        return False
    except Exception:
        # If we can't check, assume there might be symlinks for safety
        return True


def enforce_hash_verification(bundle_path: str, expected_sha256: str) -> bool:
    """Verify bundle integrity using SHA-256 hash.
    
    Args:
        bundle_path: Path to the bundle directory
        expected_sha256: Expected SHA-256 hash
        
    Returns:
        True if hash matches, False otherwise
    """
    try:
        actual_sha256 = (
            subprocess.check_output(
                ["sha256sum", bundle_path], text=True, stderr=subprocess.DEVNULL
            )
            .split()[0]
        )
        return actual_sha256 == expected_sha256
    except Exception:
        return False


def validate_filesystem_permissions(path: str) -> bool:
    """Check that no files in the path are group/world-writable.
    
    Args:
        path: Path to check permissions
        
    Returns:
        True if all files are properly secured, False otherwise
    """
    try:
        for root, dirs, files in os.walk(path):
            for item in dirs + files:
                full_path = os.path.join(root, item)
                try:
                    stat_info = os.stat(full_path)
                    if stat_info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
                        return False
                except OSError:
                    continue
        return True
    except Exception:
        return False


def validate_image(
    path: Path,
    expected_format: str = "png",
    expected_width: Optional[int] = None,
    expected_height: Optional[int] = None,
) -> ValidationResult:
    """Verify a generated image file.

    Checks existence, non-zero size, decodability, actual format, and that the
    decoded dimensions are within the requested bounds (exact match is not
    required: diffusion pipelines may round to a multiple of 8).
    """
    if not path.exists():
        return ValidationResult(False, f"image file was not created at {path.name}")
    try:
        size = path.stat().st_size
    except OSError as exc:
        return ValidationResult(False, f"cannot stat image file: {exc}")
    if size <= 0:
        return ValidationResult(False, "image file is empty")

    try:
        with Image.open(path) as img:
            img.verify()
        with Image.open(path) as img:
            actual_format = (img.format or "").lower()
            width, height = img.size
    except Exception as exc:
        return ValidationResult(False, f"image file is not a decodable image: {exc}")

    expected = expected_format.lower()
    # Pillow reports "PNG" for png; normalise "jpeg" vs "jpg" too.
    normalised = "jpeg" if expected in ("jpg", "jpeg") else expected
    if actual_format != normalised:
        return ValidationResult(
            False, f"image format is '{actual_format}', expected '{normalised}'"
        )

    if expected_width is not None and width > expected_width:
        return ValidationResult(False, f"image width {width} exceeds requested {expected_width}")
    if expected_height is not None and height > expected_height:
        return ValidationResult(False, f"image height {height} exceeds requested {expected_height}")

    return ValidationResult(
        True,
        details={
            "format": actual_format,
            "width": width,
            "height": height,
            "size_bytes": size,
        },
    )


def _default_probe_runner(cmd: Sequence[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(cmd), capture_output=True, text=True, timeout=FFPROBE_TIMEOUT_SECONDS, check=False
    )


def probe_video(
    path: Path,
    ffprobe_path: str = "ffprobe",
    runner: Optional[Callable[[Sequence[str]], subprocess.CompletedProcess]] = None,
) -> Optional[dict]:
    """Return {duration_seconds, width, height, fps} or None when unreadable."""
    if not path.exists() or path.stat().st_size <= 0:
        return None
    run = runner or _default_probe_runner
    try:
        result = run(
            [
                ffprobe_path,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,avg_frame_rate,duration",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ]
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return None

    streams = payload.get("streams") or []
    if not streams:
        return None
    stream = streams[0]

    duration_raw = stream.get("duration") or (payload.get("format") or {}).get("duration")
    try:
        duration = float(duration_raw)
    except (TypeError, ValueError):
        duration = None

    fps = None
    rate = stream.get("avg_frame_rate") or ""
    if "/" in rate:
        num, _, den = rate.partition("/")
        try:
            num_f, den_f = float(num), float(den)
            if den_f:
                fps = num_f / den_f
        except ValueError:
            fps = None

    return {
        "duration_seconds": duration,
        "width": stream.get("width"),
        "height": stream.get("height"),
        "fps": fps,
    }


def validate_video(
    path: Path,
    expected_duration_seconds: int,
    expected_width: int,
    expected_height: int,
    expected_fps: Optional[int] = None,
    ffprobe_path: str = "ffprobe",
    runner: Optional[Callable[[Sequence[str]], subprocess.CompletedProcess]] = None,
) -> ValidationResult:
    """Verify a generated video file via ffprobe."""
    if not path.exists():
        return ValidationResult(False, f"video file was not created at {path.name}")
    try:
        size = path.stat().st_size
    except OSError as exc:
        return ValidationResult(False, f"cannot stat video file: {exc}")
    if size <= 0:
        return ValidationResult(False, "video file is empty")

    probed = probe_video(path, ffprobe_path=ffprobe_path, runner=runner)
    if probed is None:
        return ValidationResult(False, "ffprobe could not read the generated video")

    duration = probed.get("duration_seconds")
    if duration is None or duration <= 0:
        return ValidationResult(False, "ffprobe reported no usable duration")

    tolerance = max(
        DURATION_TOLERANCE_SECONDS, expected_duration_seconds * DURATION_TOLERANCE_RATIO
    )
    if abs(duration - expected_duration_seconds) > tolerance:
        return ValidationResult(
            False,
            f"video duration {duration:.2f}s deviates from requested "
            f"{expected_duration_seconds}s by more than {tolerance:.2f}s",
        )

    width, height = probed.get("width"), probed.get("height")
    if width is None or height is None:
        return ValidationResult(False, "ffprobe reported no video dimensions")
    if width > expected_width or height > expected_height:
        return ValidationResult(
            False,
            f"video resolution {width}x{height} exceeds requested {expected_width}x{expected_height}",
        )

    if expected_fps is not None and probed.get("fps"):
        # Frame rate is commonly resampled; allow a generous band but catch gross mismatch.
        if abs(probed["fps"] - expected_fps) > max(2.0, expected_fps * 0.5):
            return ValidationResult(
                False,
                f"video fps {probed['fps']:.2f} deviates from requested {expected_fps}",
            )

    return ValidationResult(
        True,
        details={
            "duration_seconds": duration,
            "width": width,
            "height": height,
            "fps": probed.get("fps"),
            "size_bytes": size,
        },
    )


FORBIDDEN_SYSTEM_ROOTS: tuple[str, ...] = (
    "/",
    "/root",
    "/home",
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/var",
    "/srv",
    "/srv/projects",
    "/srv/projects/coderxp",
)


def _normalize_path_str(p: str | Path) -> str:
    s = str(p).replace("\\", "/")
    # Remove Windows drive letter if present
    if len(s) >= 2 and s[1] == ":" and s[0].isalpha():
        s = s[2:]
    s = os.path.normpath(s).replace("\\", "/")
    if not s.startswith("/"):
        s = "/" + s
    return s


def validate_privileged_path(
    path: str | Path,
    allowed_roots: Sequence[str | Path] = (
        "/srv/projects/orbaagent-gpu",
        "/etc/orbaagent/gpu-worker",
    ),
) -> bool:
    """Validate that a privileged path strictly belongs to allowed application roots.
    
    Rejects:
    - Traversal (..)
    - Root or top-level system directories
    - Protected workload roots (e.g. /srv/projects/coderxp)
    - Paths outside allowed_roots
    """
    try:
        if not path:
            return False
        norm = _normalize_path_str(path)

        # Check against forbidden protected workload root
        if "/coderxp" in norm:
            return False

        # Reject top-level roots directly
        if norm in ("/", "/root", "/home", "/etc", "/usr", "/bin", "/sbin", "/lib", "/var", "/srv", "/srv/projects"):
            return False

        # Must match at least one allowed root prefix
        for allowed in allowed_roots:
            allowed_norm = _normalize_path_str(allowed)
            if norm == allowed_norm or norm.startswith(allowed_norm + "/"):
                return True
        return False
    except Exception:
        return False


def validate_destructive_target(
    path: str | Path,
    allowed_parent: str | Path,
) -> bool:
    """Validate that a target to be deleted is strictly contained within an allowed parent.
    
    Prevents deletion of:
    - Root directory or empty path
    - Traversals
    - Paths equal to the allowed parent itself (must be a child)
    - Protected system paths or CoderXP
    - Anything outside allowed_parent
    """
    try:
        if not path or not allowed_parent:
            return False
        norm_target = _normalize_path_str(path)
        norm_parent = _normalize_path_str(allowed_parent)

        # Forbidden protected workload
        if "/coderxp" in norm_target:
            return False

        # Forbidden system directories
        for forbidden in FORBIDDEN_SYSTEM_ROOTS:
            if norm_target == forbidden:
                return False

        # Target must be strictly inside parent (not parent itself)
        if norm_target == norm_parent:
            return False
        if not norm_target.startswith(norm_parent + "/"):
            return False

        return True
    except Exception:
        return False


def cleanup_artifact(path: Path) -> None:
    """Best-effort removal of a partial or invalid artifact."""
    try:
        if path.exists():
            os.remove(path)
    except OSError:
        pass

# Backwards compatibility: export the original function
__all__ = [
    "ValidationResult",
    "sha256_of",
    "validate_image",
    "probe_video",
    "validate_video",
    "cleanup_artifact",
    "check_symlinks_in_source",
    "enforce_hash_verification",
    "validate_filesystem_permissions",
    "validate_privileged_path",
    "validate_destructive_target",
    "FORBIDDEN_SYSTEM_ROOTS",
]