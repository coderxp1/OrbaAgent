"""Generation domain: concurrency control, image and video inference, validation.

Every success path here ends by reading the artifact back off disk and validating
it. If validation fails the partial file is removed and the call raises. There is
no code path that reports COMPLETED without a verified artifact.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from .config import (
    ValidationError,
    validate_image_request,
    validate_video_request,
)
from .models import BackendNotImplementedError, ModelManager, ModelUnavailableError
from .validation import cleanup_artifact, sha256_of, validate_image, validate_video


class GenerationBusyError(RuntimeError):
    """Raised when a generation slot is already occupied."""


class GenerationFailedError(RuntimeError):
    """Raised when generation or output validation failed."""


@dataclass
class GenerationOutcome:
    """A verified generation result."""

    artifact_id: str
    job_id: str
    kind: str
    path: Path
    content_type: str
    size_bytes: int
    sha256: str
    duration_ms: int
    model: str
    parameters: dict = field(default_factory=dict)


class GenerationLimiter:
    """Caps concurrent generations.

    Default limit is 1: image and video inference share a single permit, so a
    request cannot start while another is holding VRAM. Callers receive a busy
    signal instead of the process being OOM-killed.
    """

    def __init__(self, max_concurrent: int = 1) -> None:
        self._semaphore = threading.BoundedSemaphore(max(1, max_concurrent))
        self._max = max(1, max_concurrent)
        self._active = 0
        self._lock = threading.Lock()

    @property
    def max_concurrent(self) -> int:
        return self._max

    @property
    def active(self) -> int:
        with self._lock:
            return self._active

    @contextmanager
    def slot(self):
        acquired = self._semaphore.acquire(blocking=False)
        if not acquired:
            raise GenerationBusyError(
                f"a media generation job is already running (limit {self._max}); retry shortly"
            )
        with self._lock:
            self._active += 1
        try:
            yield
        finally:
            with self._lock:
                self._active -= 1
            self._semaphore.release()


def _new_job_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def generate_image(
    prompt: str,
    manager: ModelManager,
    limiter: GenerationLimiter,
    *,
    negative_prompt: Optional[str] = None,
    width: int = 1024,
    height: int = 1024,
    steps: int = 20,
    seed: Optional[int] = None,
    model: str = "",
    output_format: str = "png",
    infer: Optional[Callable[..., Any]] = None,
    ffprobe_path: str = "ffprobe",
) -> GenerationOutcome:
    """Generate and validate an image.

    ``infer`` is the injection point for tests; when omitted the real diffusers
    pipeline is driven. It is called as
    ``infer(pipeline=..., prompt=..., negative_prompt=..., width=..., height=...,
    steps=..., seed=..., output_path=...)`` and must write the image to
    ``output_path``.
    """
    started = time.time()
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValidationError("prompt is required for image generation")

    eff_width, eff_height, eff_steps, eff_format = validate_image_request(
        width, height, steps, output_format
    )

    with limiter.slot():
        pipeline = manager.load_image()
        job_id = _new_job_id("img")
        output_dir = Path(manager.output_dir)
        os.makedirs(output_dir, exist_ok=True)
        target = output_dir / f"{job_id}.{eff_format}"

        try:
            _run_image_inference(
                infer=infer,
                pipeline=pipeline,
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=eff_width,
                height=eff_height,
                steps=eff_steps,
                seed=seed,
                target=target,
            )

            result = validate_image(
                target,
                expected_format=eff_format,
                expected_width=eff_width,
                expected_height=eff_height,
            )
            if not result.ok:
                cleanup_artifact(target)
                raise GenerationFailedError(f"image output validation failed: {result.error}")

            return GenerationOutcome(
                artifact_id=f"artifact_{uuid.uuid4().hex}",
                job_id=job_id,
                kind="image",
                path=target,
                content_type="image/png",
                size_bytes=target.stat().st_size,
                sha256=sha256_of(target),
                duration_ms=int((time.time() - started) * 1000),
                model=model or manager.image_model_id,
                parameters={
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "width": eff_width,
                    "height": eff_height,
                    "steps": eff_steps,
                    "seed": seed,
                    "output_format": eff_format,
                },
            )
        except (GenerationFailedError, ValidationError, ModelUnavailableError, BackendNotImplementedError):
            cleanup_artifact(target)
            raise
        except Exception as exc:
            cleanup_artifact(target)
            raise GenerationFailedError(f"image generation failed: {exc}") from exc


def _run_image_inference(
    *,
    infer: Optional[Callable[..., Any]],
    pipeline: Any,
    prompt: str,
    negative_prompt: Optional[str],
    width: int,
    height: int,
    steps: int,
    seed: Optional[int],
    target: Path,
) -> None:
    if infer is not None:
        infer(
            pipeline=pipeline,
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
            output_path=target,
        )
        return

    from .backends.diffusers_backend import run_image_inference

    run_image_inference(
        pipeline=pipeline,
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        steps=steps,
        seed=seed,
        output_path=target,
    )


def generate_video(
    prompt: str,
    manager: ModelManager,
    limiter: GenerationLimiter,
    *,
    negative_prompt: Optional[str] = None,
    duration_seconds: int = 4,
    fps: int = 16,
    width: int = 768,
    height: int = 768,
    model: str = "",
    infer: Optional[Callable[..., Any]] = None,
    ffprobe_path: str = "ffprobe",
) -> GenerationOutcome:
    """Generate and validate a video."""
    started = time.time()
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValidationError("prompt is required for video generation")

    eff_duration, eff_fps, eff_width, eff_height = validate_video_request(
        duration_seconds, fps, width, height
    )

    with limiter.slot():
        pipeline = manager.load_video()
        job_id = _new_job_id("vid")
        output_dir = Path(manager.output_dir)
        os.makedirs(output_dir, exist_ok=True)
        target = output_dir / f"{job_id}.mp4"

        try:
            _run_video_inference(
                infer=infer,
                pipeline=pipeline,
                prompt=prompt,
                negative_prompt=negative_prompt,
                duration_seconds=eff_duration,
                fps=eff_fps,
                width=eff_width,
                height=eff_height,
                target=target,
            )

            result = validate_video(
                target,
                expected_duration_seconds=eff_duration,
                expected_width=eff_width,
                expected_height=eff_height,
                expected_fps=eff_fps,
                ffprobe_path=ffprobe_path,
            )
            if not result.ok:
                cleanup_artifact(target)
                raise GenerationFailedError(f"video output validation failed: {result.error}")

            return GenerationOutcome(
                artifact_id=f"artifact_{uuid.uuid4().hex}",
                job_id=job_id,
                kind="video",
                path=target,
                content_type="video/mp4",
                size_bytes=target.stat().st_size,
                sha256=sha256_of(target),
                duration_ms=int((time.time() - started) * 1000),
                model=model or manager.video_model_id,
                parameters={
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "duration_seconds": eff_duration,
                    "fps": eff_fps,
                    "width": eff_width,
                    "height": eff_height,
                },
            )
        except (GenerationFailedError, ValidationError, ModelUnavailableError, BackendNotImplementedError):
            cleanup_artifact(target)
            raise
        except Exception as exc:
            cleanup_artifact(target)
            raise GenerationFailedError(f"video generation failed: {exc}") from exc


def _run_video_inference(
    *,
    infer: Optional[Callable[..., Any]],
    pipeline: Any,
    prompt: str,
    negative_prompt: Optional[str],
    duration_seconds: int,
    fps: int,
    width: int,
    height: int,
    target: Path,
) -> None:
    if infer is not None:
        infer(
            pipeline=pipeline,
            prompt=prompt,
            negative_prompt=negative_prompt,
            duration_seconds=duration_seconds,
            fps=fps,
            width=width,
            height=height,
            output_path=target,
        )
        return

    from .backends.diffusers_backend import run_video_inference

    run_video_inference(
        pipeline=pipeline,
        prompt=prompt,
        negative_prompt=negative_prompt,
        duration_seconds=duration_seconds,
        fps=fps,
        width=width,
        height=height,
        output_path=target,
    )
