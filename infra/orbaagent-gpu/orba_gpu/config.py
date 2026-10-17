"""Runtime configuration and request-bound validation for the GPU media worker."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

from .secrets import load_optional_secret

#: GPU 1 on migrol-ag-gpu-worker01 — the only device this worker may use.
#: GPU 0 (GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4) runs the CoderXP/ComfyUI
#: workload and must never be selected.
DEFAULT_TARGET_GPU_UUID = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"

#: Backend identifier that selects the in-process HuggingFace diffusers runtime.
BACKEND_DIFFUSERS = "diffusers"

#: Generation bounds. Requests are clamped, not rejected, so a caller asking for
#: an absurd size gets a usable result at the ceiling instead of a hard failure.
MIN_DIMENSION = 64
MAX_IMAGE_DIMENSION = 2048
MIN_STEPS = 1
MAX_STEPS = 50
DEFAULT_STEPS = 20

MIN_VIDEO_DURATION_SECONDS = 1
MAX_VIDEO_DURATION_SECONDS = 10
DEFAULT_VIDEO_DURATION_SECONDS = 4
MIN_FPS = 8
MAX_FPS = 30
DEFAULT_FPS = 16
MAX_VIDEO_DIMENSION = 1280

#: Concurrency: one generation at a time until VRAM behaviour is measured on
#: real hardware. Image and video share the single permit.
MAX_CONCURRENT_GENERATIONS = 1

#: Maximum generated artifact size accepted for ingest, in bytes (256 MiB).
MAX_ARTIFACT_BYTES = 256 * 1024 * 1024

ALLOWED_IMAGE_FORMATS = ("png",)
ALLOWED_VIDEO_FORMATS = ("mp4",)


def _env_int(source: dict, name: str, default: int) -> int:
    """Parse an int from the given mapping, falling back on missing/garbage.

    Takes the mapping explicitly so ``Settings.from_env(env)`` is fully
    deterministic and does not depend on the ambient process environment.
    """
    raw = str(source.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    """Worker settings resolved from the environment."""

    target_gpu_uuid: str = DEFAULT_TARGET_GPU_UUID
    backend: str = ""
    image_model_id: str = "black-forest-labs/FLUX.1-schnell"
    video_model_id: str = "Wan-AI/Wan2.1-T2V-1.3B"
    models_dir: str = "/models"
    output_dir: str = "/output"
    port: int = 8190
    token: str = field(default="", repr=False)
    ingest_url: str = ""
    ingest_token: str = field(default="", repr=False)
    max_concurrent_generations: int = MAX_CONCURRENT_GENERATIONS

    @staticmethod
    def from_env(env: Optional[dict] = None) -> "Settings":
        source = os.environ if env is None else env

        def get(key: str, default: str = "") -> str:
            return (source.get(key) or default).strip()

        token = load_optional_secret(
            env_var="MEDIA_WORKER_TOKEN",
            file_var="MEDIA_WORKER_TOKEN_FILE",
            env=source,
        )
        ingest_token = load_optional_secret(
            env_var="MEDIA_INGEST_TOKEN",
            file_var="MEDIA_INGEST_TOKEN_FILE",
            env=source,
        )

        return Settings(
            target_gpu_uuid=get("MEDIA_WORKER_GPU_UUID", DEFAULT_TARGET_GPU_UUID),
            backend=get("MEDIA_GENERATION_BACKEND"),
            image_model_id=get("MEDIA_GENERATION_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell"),
            video_model_id=get("MEDIA_GENERATION_VIDEO_MODEL", "kandinskylab/Kandinsky-6.0-Pro-distill-5s-Diffusers"),
            models_dir=get("MEDIA_MODELS_DIR", "/models"),
            output_dir=get("MEDIA_OUTPUT_DIR", "/output"),
            port=_env_int(source, "MEDIA_WORKER_PORT", 8190),
            token=token,
            ingest_url=get("MEDIA_INGEST_URL"),
            ingest_token=ingest_token,
            max_concurrent_generations=max(
                1, _env_int(source, "MEDIA_MAX_CONCURRENT_GENERATIONS", MAX_CONCURRENT_GENERATIONS)
            ),
        )

    @property
    def image_backend_requested(self) -> bool:
        """Whether the image backend was *requested*.

        This is intent only. Actual readiness is decided by loading the model —
        see ``models.ModelManager.image_ready``.
        """
        return self.backend in (BACKEND_DIFFUSERS, "comfyui")

    @property
    def video_backend_requested(self) -> bool:
        return self.backend in (BACKEND_DIFFUSERS, "comfyui")

    @property
    def image_backend_implemented(self) -> bool:
        """Whether an image backend is actually implemented for the configured value."""
        return self.backend in (BACKEND_DIFFUSERS, "comfyui")

    @property
    def video_backend_implemented(self) -> bool:
        return self.backend in (BACKEND_DIFFUSERS, "comfyui")


class ValidationError(ValueError):
    """Raised when a generation request cannot be satisfied at all."""


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def validate_image_request(
    width: int,
    height: int,
    steps: int,
    output_format: str,
) -> tuple[int, int, int, str]:
    """Bound an image request.

    Returns the effective (width, height, steps, output_format).

    Raises:
        ValidationError: for values that cannot be coerced into a sane request
            (non-positive dimensions, unsupported format).
    """
    if width <= 0 or height <= 0:
        raise ValidationError("width and height must be positive integers")

    fmt = (output_format or "png").lower().strip()
    if fmt not in ALLOWED_IMAGE_FORMATS:
        raise ValidationError(
            f"unsupported output_format '{output_format}'; allowed: {', '.join(ALLOWED_IMAGE_FORMATS)}"
        )

    eff_w = clamp(width, MIN_DIMENSION, MAX_IMAGE_DIMENSION)
    eff_h = clamp(height, MIN_DIMENSION, MAX_IMAGE_DIMENSION)
    # Snap to multiple of 16
    eff_w = max(MIN_DIMENSION, round(eff_w / 16) * 16)
    eff_h = max(MIN_DIMENSION, round(eff_h / 16) * 16)

    return (
        eff_w,
        eff_h,
        clamp(steps, MIN_STEPS, MAX_STEPS),
        fmt,
    )


def validate_video_request(
    duration_seconds: int,
    fps: int,
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    """Bound a video request, returning effective (duration, fps, width, height).

    Automatically bounds and normalizes dimensions to multiples of 16 so that
    DiT pipelines (Kandinsky 6.0, Prism, etc.) never reject valid requests.
    """
    if width <= 0 or height <= 0:
        raise ValidationError("width and height must be positive integers")
    if duration_seconds <= 0:
        raise ValidationError("duration_seconds must be a positive integer")
    if fps <= 0:
        raise ValidationError("fps must be a positive integer")

    eff_w = clamp(width, MIN_DIMENSION, MAX_VIDEO_DIMENSION)
    eff_h = clamp(height, MIN_DIMENSION, MAX_VIDEO_DIMENSION)
    # Strict divisibility by 16: prevents diffusers ValueError
    eff_w = max(MIN_DIMENSION, round(eff_w / 16) * 16)
    eff_h = max(MIN_DIMENSION, round(eff_h / 16) * 16)

    return (
        clamp(duration_seconds, MIN_VIDEO_DURATION_SECONDS, MAX_VIDEO_DURATION_SECONDS),
        clamp(fps, MIN_FPS, MAX_FPS),
        eff_w,
        eff_h,
    )
