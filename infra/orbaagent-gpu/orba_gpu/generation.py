"""Generation domain: concurrency control, image and video inference, validation.

Every success path here ends by reading the artifact back off disk and validating
it. If validation fails the partial file is removed and the call raises. There is
no code path that reports COMPLETED without a verified artifact.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid

logger = logging.getLogger(__name__)
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


@dataclass
class JobProgress:
    job_id: str
    kind: str
    stage: str
    started_at: float
    last_heartbeat: float
    step: int = 0
    total_steps: int = 0
    cancelled: bool = False
    details: str = ""


class GenerationLimiter:
    """Caps concurrent generations with real progress tracking, stage timeouts, and stale lock recovery.

    Default limit is 1: image and video inference share a single permit, so a
    request cannot start while another is holding VRAM. Callers receive a busy
    signal instead of the process being OOM-killed.
    """

    def __init__(self, max_concurrent: int = 1, stale_timeout_seconds: float = 120.0) -> None:
        self._semaphore = threading.BoundedSemaphore(max(1, max_concurrent))
        self._max = max(1, max_concurrent)
        self._active = 0
        self._lock = threading.Lock()
        self._stale_timeout_seconds = stale_timeout_seconds
        self._active_jobs: dict[str, JobProgress] = {}
        self._current_job_id: Optional[str] = None

    @property
    def max_concurrent(self) -> int:
        return self._max

    @property
    def active(self) -> int:
        with self._lock:
            self._cleanup_stale_locked()
            return self._active

    def get_active_job(self) -> Optional[dict[str, Any]]:
        with self._lock:
            self._cleanup_stale_locked()
            if self._current_job_id and self._current_job_id in self._active_jobs:
                job = self._active_jobs[self._current_job_id]
                now = time.time()
                return {
                    "job_id": job.job_id,
                    "kind": job.kind,
                    "stage": job.stage,
                    "elapsed_seconds": round(now - job.started_at, 1),
                    "last_heartbeat_ago": round(now - job.last_heartbeat, 1),
                    "step": job.step,
                    "total_steps": job.total_steps,
                    "details": job.details,
                    "cancelled": job.cancelled,
                }
            return None

    def record_progress(
        self,
        job_id: str,
        stage: Optional[str] = None,
        step: Optional[int] = None,
        total_steps: Optional[int] = None,
        details: Optional[str] = None,
    ) -> None:
        with self._lock:
            job = self._active_jobs.get(job_id)
            if job:
                job.last_heartbeat = time.time()
                if stage is not None:
                    job.stage = stage
                if step is not None:
                    job.step = step
                if total_steps is not None:
                    job.total_steps = total_steps
                if details is not None:
                    job.details = details

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            job = self._active_jobs.get(job_id)
            return bool(job and job.cancelled)

    def cancel_job(self, job_id: Optional[str] = None) -> bool:
        with self._lock:
            target_id = job_id or self._current_job_id
            if target_id and target_id in self._active_jobs:
                self._active_jobs[target_id].cancelled = True
                logger.info("Marked job %s as cancelled", target_id)
                return True
            return False

    def force_reset(self) -> None:
        with self._lock:
            for job in self._active_jobs.values():
                job.cancelled = True
            self._active_jobs.clear()
            self._current_job_id = None
            self._active = 0
            self._semaphore = threading.BoundedSemaphore(self._max)
            logger.warning("GenerationLimiter force_reset executed")

    def _cleanup_stale_locked(self) -> None:
        if not self._current_job_id:
            return
        job = self._active_jobs.get(self._current_job_id)
        if not job:
            return
        now = time.time()
        silent_duration = now - job.last_heartbeat
        total_duration = now - job.started_at
        if silent_duration > self._stale_timeout_seconds or total_duration > 300.0:
            logger.error(
                "Stale job detected: %s (kind=%s, stage=%s, silent=%0.1fs, total=%0.1fs). Evicting.",
                job.job_id,
                job.kind,
                job.stage,
                silent_duration,
                total_duration,
            )
            job.cancelled = True
            self._active_jobs.pop(self._current_job_id, None)
            self._current_job_id = None
            self._active = max(0, self._active - 1)
            try:
                self._semaphore.release()
            except ValueError:
                self._semaphore = threading.BoundedSemaphore(self._max)

    @contextmanager
    def slot(self, job_id: str = "", kind: str = "media"):
        now = time.time()
        actual_job_id = job_id or f"job_{uuid.uuid4().hex[:8]}"
        job = JobProgress(
            job_id=actual_job_id,
            kind=kind,
            stage="queued",
            started_at=now,
            last_heartbeat=now,
        )

        with self._lock:
            self._cleanup_stale_locked()
            acquired = self._semaphore.acquire(blocking=False)
            if not acquired or self._active >= self._max:
                active_info = None
                if self._current_job_id and self._current_job_id in self._active_jobs:
                    j = self._active_jobs[self._current_job_id]
                    active_info = {
                        "job_id": j.job_id,
                        "stage": j.stage,
                        "elapsed_seconds": round(now - j.started_at, 1),
                    }
                detail_msg = f"a media generation job is already running (limit {self._max}); retry shortly"
                if active_info:
                    detail_msg += (
                        f" [Current job: {active_info['job_id']}, stage={active_info['stage']}, "
                        f"elapsed={active_info['elapsed_seconds']}s]"
                    )
                raise GenerationBusyError(detail_msg)

            self._active += 1
            self._active_jobs[actual_job_id] = job
            self._current_job_id = actual_job_id

        try:
            yield job
        finally:
            with self._lock:
                self._active = max(0, self._active - 1)
                self._active_jobs.pop(actual_job_id, None)
                if self._current_job_id == actual_job_id:
                    self._current_job_id = next(iter(self._active_jobs), None)
                try:
                    self._semaphore.release()
                except ValueError:
                    self._semaphore = threading.BoundedSemaphore(self._max)


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

    if hasattr(pipeline, "generate_image"):
        success = pipeline.generate_image(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
            output_format="png",
            output_path=str(target),
        )
        if not success:
            from .generation import GenerationFailedError
            raise GenerationFailedError("ComfyUI image generation failed")
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
    image_data: Optional[str] = None,
    negative_prompt: Optional[str] = None,
    duration_seconds: int = 4,
    fps: int = 16,
    width: int = 768,
    height: int = 768,
    model: str = "",
    infer: Optional[Callable[..., Any]] = None,
    ffprobe_path: str = "ffprobe",
) -> GenerationOutcome:
    """Generate and validate a video (supporting Text-to-Video and Image-to-Video)."""
    started = time.time()
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValidationError("prompt is required for video generation")

    eff_duration, eff_fps, eff_width, eff_height = validate_video_request(
        duration_seconds, fps, width, height
    )

    pil_image = None
    source_image_sha256 = None
    if image_data:
        import base64
        import hashlib
        import io
        from PIL import Image
        try:
            raw_b64 = image_data.split(",", 1)[-1] if "," in image_data else image_data
            img_bytes = base64.b64decode(raw_b64)
            # Hash the exact bytes received, so the conditioning image can
            # be traced back to the uploaded photograph across every hop.
            source_image_sha256 = hashlib.sha256(img_bytes).hexdigest()
            pil_image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        except Exception as exc:
            raise ValidationError(f"Invalid image_data provided for video conditioning: {exc}") from exc

    effective_model = model or "Lightricks/LTX-Video"
    model_type = "image-to-video" if pil_image is not None else "text-to-video"

    job_id = _new_job_id("vid")
    with limiter.slot(job_id=job_id, kind="video"):
        limiter.record_progress(job_id, stage="loading_model")
        pipeline = manager.load_video(effective_model, model_type=model_type)
        limiter.record_progress(job_id, stage="inference")
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
                image=pil_image,
                target=target,
                limiter=limiter,
                job_id=job_id,
            )

            limiter.record_progress(job_id, stage="validating_output")
            result = validate_video(
                target,
                expected_duration_seconds=eff_duration,
                expected_width=eff_width,
                expected_height=eff_height,
                expected_fps=eff_fps,
                ffprobe_path=ffprobe_path,
            )
            if not result.ok:
                file_size = target.stat().st_size if target.exists() else 0
                sig = ""
                if target.exists() and file_size >= 12:
                    try:
                        sig = target.read_bytes()[:12].hex()
                    except Exception:
                        sig = ""
                logger.warning(
                    "Video validation failed for %s (size=%d, sig=%s): %s",
                    target.name,
                    file_size,
                    sig,
                    result.error,
                )
                cleanup_artifact(target)
                raise GenerationFailedError(
                    f"video output validation failed: {result.error} (size={file_size}B, sig={sig})"
                )

            return GenerationOutcome(
                artifact_id=f"artifact_{uuid.uuid4().hex}",
                job_id=job_id,
                kind="video",
                path=target,
                content_type="video/mp4",
                size_bytes=target.stat().st_size,
                sha256=sha256_of(target),
                duration_ms=int((time.time() - started) * 1000),
                model=effective_model,
                parameters={
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "duration_seconds": eff_duration,
                    "fps": eff_fps,
                    "width": eff_width,
                    "height": eff_height,
                    **(
                        {"source_image_sha256": source_image_sha256}
                        if source_image_sha256
                        else {}
                    ),
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
    image: Any = None,
    limiter: Optional[GenerationLimiter] = None,
    job_id: str = "",
) -> None:
    def progress_callback(step: int, total_steps: int):
        if limiter and job_id:
            if limiter.is_cancelled(job_id):
                raise InterruptedError(f"Job {job_id} cancelled by client or supervisor")
            limiter.record_progress(job_id, stage="inference", step=step, total_steps=total_steps)

    if infer is not None:
        import inspect
        sig = inspect.signature(infer)
        infer_kwargs: dict[str, Any] = {
            "pipeline": pipeline,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "duration_seconds": duration_seconds,
            "fps": fps,
            "width": width,
            "height": height,
            "output_path": target,
        }
        if "image" in sig.parameters:
            infer_kwargs["image"] = image
        infer(**infer_kwargs)
        return

    if hasattr(pipeline, "generate_video"):
        # Pass duration, fps and the conditioning image through explicitly.
        # The previous call dropped all three: image-to-video requests were
        # silently turned into unrelated text-to-video scenes, and every
        # video came out at the workflow's hard-coded frame count/fps
        # (16 frames at 8 fps), regardless of the requested duration.
        import inspect

        gen_kwargs: dict[str, Any] = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "width": width,
            "height": height,
            "steps": 0,  # not explicitly used for video length in signature
            "seed": 1,
            "output_format": "mp4",
            "output_path": str(target),
        }
        try:
            gen_params = inspect.signature(pipeline.generate_video).parameters
        except (TypeError, ValueError):
            gen_params = None
        if gen_params is None:
            # Introspection failed: pass the values through unconditionally
            # rather than silently dropping them (dropping them was the
            # original bug — the backend fell back to its own defaults and
            # an image-to-video request became an unrelated T2V scene).
            logger.warning(
                "Could not introspect generate_video signature; passing duration_seconds/fps/image through unconditionally"
            )
            gen_kwargs["duration_seconds"] = duration_seconds
            gen_kwargs["fps"] = fps
            gen_kwargs["image"] = image
        else:
            accepts_any = any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in gen_params.values()
            )
            if accepts_any or "duration_seconds" in gen_params:
                gen_kwargs["duration_seconds"] = duration_seconds
            if accepts_any or "fps" in gen_params:
                gen_kwargs["fps"] = fps
            if accepts_any or "image" in gen_params:
                gen_kwargs["image"] = image
        success = pipeline.generate_video(**gen_kwargs)
        if not success:
            from .generation import GenerationFailedError
            raise GenerationFailedError("ComfyUI video generation failed")
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
        image=image,
        output_path=target,
        progress_callback=progress_callback,
    )
