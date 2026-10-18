"""Tests for the generation pipeline.

The injected ``infer`` callable writes a *real* file to disk, and every assertion
then runs the real validator (Pillow / ffprobe) over it. Mocking the final HTTP
response would prove nothing; these tests prove the artifact on disk was read back
and verified before success was reported.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image

from orba_gpu.config import ValidationError
from orba_gpu.generation import (
    GenerationBusyError,
    GenerationFailedError,
    GenerationLimiter,
    generate_image,
    generate_video,
)
from orba_gpu.models import ModelManager, ModelUnavailableError

FFMPEG = "ffmpeg"


def make_manager(tmp_path, *, image_loader=None, video_loader=None):
    models_dir = tmp_path / "models"
    img_dir = models_dir / "black-forest-labs" / "FLUX.1-schnell"
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / "config.json").write_text("{}")
    vid_dir = models_dir / "Wan-AI" / "Wan2.1-T2V-1.3B"
    vid_dir.mkdir(parents=True, exist_ok=True)
    (vid_dir / "config.json").write_text("{}")
    ltx_dir = models_dir / "Lightricks" / "LTX-Video"
    ltx_dir.mkdir(parents=True, exist_ok=True)
    (ltx_dir / "config.json").write_text("{}")

    return ModelManager(
        models_dir=str(models_dir),
        output_dir=str(tmp_path / "output"),
        backend="diffusers",
        image_model_id="black-forest-labs/FLUX.1-schnell",
        video_model_id="Wan-AI/Wan2.1-T2V-1.3B",
        image_loader=image_loader or (lambda _: "image-pipeline"),
        video_loader=video_loader or (lambda _: "video-pipeline"),
    )


def write_png(output_path: Path, width: int, height: int, color=(10, 20, 30)):
    Image.new("RGB", (width, height), color).save(output_path, format="PNG")


def write_mp4(output_path: Path, width: int, height: int, fps: int, duration: int):
    """Synthesise a real mp4 with ffmpeg, matching the requested parameters."""
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size={width}x{height}:rate={fps}",
            "-t",
            str(duration),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(output_path),
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )


# --------------------------------------------------------------------------
# Image
# --------------------------------------------------------------------------


class TestImageSuccessPath:
    def test_valid_image_is_generated_validated_and_reported(self, tmp_path):
        manager = make_manager(tmp_path)

        def infer(*, pipeline, prompt, width, height, steps, seed, output_path, **kw):
            assert pipeline == "image-pipeline"
            assert prompt == "a red fox"
            assert (width, height, steps) == (512, 512, 8)
            write_png(output_path, width, height)

        outcome = generate_image(
            "a red fox",
            manager,
            GenerationLimiter(1),
            width=512,
            height=512,
            steps=8,
            seed=42,
            infer=infer,
        )

        assert outcome.kind == "image"
        assert outcome.path.exists()
        assert outcome.size_bytes > 0
        assert outcome.content_type == "image/png"
        assert len(outcome.sha256) == 64
        assert outcome.parameters["seed"] == 42
        # The generated file really is a decodable PNG of the requested size.
        with Image.open(outcome.path) as img:
            assert img.format == "PNG"
            assert img.size == (512, 512)

    def test_seed_is_forwarded_for_determinism(self, tmp_path):
        seen = {}

        def infer(*, seed, output_path, width, height, **kw):
            seen["seed"] = seed
            write_png(output_path, width, height)

        generate_image("x", make_manager(tmp_path), GenerationLimiter(1), seed=1234, infer=infer)
        assert seen["seed"] == 1234

    def test_parameters_are_clamped_to_bounds(self, tmp_path):
        captured = {}

        def infer(*, width, height, steps, output_path, **kw):
            captured.update(width=width, height=height, steps=steps)
            write_png(output_path, width, height)

        generate_image(
            "x",
            make_manager(tmp_path),
            GenerationLimiter(1),
            width=99999,
            height=99999,
            steps=9999,
            infer=infer,
        )
        assert captured["width"] == 2048
        assert captured["height"] == 2048
        assert captured["steps"] == 50


class TestImageFailurePaths:
    def test_inference_writes_nothing_so_no_success_is_reported(self, tmp_path):
        def infer(*, output_path, **kw):
            pass  # produces no file

        with pytest.raises(GenerationFailedError, match="validation failed"):
            generate_image("x", make_manager(tmp_path), GenerationLimiter(1), infer=infer)

    def test_corrupt_output_is_rejected_and_removed(self, tmp_path):
        def infer(*, output_path, **kw):
            Path(output_path).write_bytes(b"this is not a png")

        with pytest.raises(GenerationFailedError):
            generate_image("x", make_manager(tmp_path), GenerationLimiter(1), infer=infer)

        leftovers = list((tmp_path / "output").glob("*"))
        assert leftovers == [], "partial artifact must be cleaned up"

    def test_empty_file_is_rejected_and_removed(self, tmp_path):
        def infer(*, output_path, **kw):
            Path(output_path).write_bytes(b"")

        with pytest.raises(GenerationFailedError):
            generate_image("x", make_manager(tmp_path), GenerationLimiter(1), infer=infer)
        assert list((tmp_path / "output").glob("*")) == []

    def test_oversized_dimensions_are_rejected_by_validator(self, tmp_path):
        """A pipeline returning bigger-than-requested output is a failure."""

        def infer(*, width, height, output_path, **kw):
            write_png(output_path, width + 64, height + 64)

        with pytest.raises(GenerationFailedError, match="exceeds requested"):
            generate_image(
                "x", make_manager(tmp_path), GenerationLimiter(1), width=256, height=256, infer=infer
            )
        assert list((tmp_path / "output").glob("*")) == []

    def test_inference_exception_is_wrapped_and_cleaned(self, tmp_path):
        def infer(*, output_path, **kw):
            Path(output_path).write_bytes(b"partial")
            raise RuntimeError("CUDA out of memory")

        with pytest.raises(GenerationFailedError, match="CUDA out of memory"):
            generate_image("x", make_manager(tmp_path), GenerationLimiter(1), infer=infer)
        assert list((tmp_path / "output").glob("*")) == []

    def test_empty_prompt_rejected(self, tmp_path):
        with pytest.raises(ValidationError, match="prompt is required"):
            generate_image("   ", make_manager(tmp_path), GenerationLimiter(1))

    def test_model_load_failure_propagates(self, tmp_path):
        manager = make_manager(
            tmp_path, image_loader=lambda _: (_ for _ in ()).throw(RuntimeError("no weights"))
        )
        with pytest.raises(ModelUnavailableError):
            generate_image("x", manager, GenerationLimiter(1), infer=lambda **kw: None)

    def test_unsupported_format_rejected_before_inference(self, tmp_path):
        called = []
        with pytest.raises(ValidationError):
            generate_image(
                "x",
                make_manager(tmp_path),
                GenerationLimiter(1),
                output_format="tiff",
                infer=lambda **kw: called.append(1),
            )
        assert called == []


# --------------------------------------------------------------------------
# Video
# --------------------------------------------------------------------------


@pytest.mark.skipif(
    subprocess.run(["ffmpeg", "-version"], capture_output=True).returncode != 0,
    reason="ffmpeg not available",
)
class TestVideoPaths:
    def test_valid_video_is_generated_validated_and_reported(self, tmp_path):
        manager = make_manager(tmp_path)

        def infer(*, duration_seconds, fps, width, height, output_path, **kw):
            write_mp4(output_path, width, height, fps, duration_seconds)

        outcome = generate_video(
            "a fox running",
            manager,
            GenerationLimiter(1),
            duration_seconds=2,
            fps=16,
            width=256,
            height=256,
            infer=infer,
        )

        assert outcome.kind == "video"
        assert outcome.content_type == "video/mp4"
        assert outcome.path.exists()
        assert outcome.size_bytes > 0
        assert outcome.parameters["duration_seconds"] == 2
        assert outcome.parameters["fps"] == 16
        assert outcome.parameters["width"] == 256
        assert outcome.parameters["height"] == 256
        assert outcome.model == "Wan-AI/Wan2.1-T2V-1.3B"

    def test_image_to_video_with_base64_routes_to_ltx_and_passes_image(self, tmp_path):
        manager = make_manager(tmp_path)
        captured = {}

        # 1x1 red PNG base64
        import base64
        tiny_png = base64.b64encode(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
        ).decode("ascii")

        def infer(*, duration_seconds, fps, width, height, output_path, image=None, **kw):
            captured["image"] = image
            captured["width"] = width
            captured["height"] = height
            write_mp4(output_path, width, height, fps, duration_seconds)

        outcome = generate_video(
            "a person smiling and turning head",
            manager,
            GenerationLimiter(1),
            image_data=f"data:image/png;base64,{tiny_png}",
            duration_seconds=2,
            fps=16,
            width=256,
            height=256,
            infer=infer,
        )

        assert outcome.kind == "video"
        assert outcome.path.exists()
        assert outcome.model == "Lightricks/LTX-Video"
        assert captured.get("image") is not None
        assert hasattr(captured["image"], "size")

    def test_invalid_image_data_rejected(self, tmp_path):
        manager = make_manager(tmp_path)
        with pytest.raises(ValidationError, match="Invalid image_data"):
            generate_video(
                "animate this",
                manager,
                GenerationLimiter(1),
                image_data="not-a-valid-base64-image-string",
            )

    def test_missing_video_output_is_a_failure(self, tmp_path):
        with pytest.raises(GenerationFailedError, match="validation failed"):
            generate_video(
                "x",
                make_manager(tmp_path),
                GenerationLimiter(1),
                infer=lambda **kw: None,
            )

    def test_unreadable_video_is_rejected_and_removed(self, tmp_path):
        def infer(*, output_path, **kw):
            Path(output_path).write_bytes(b"not a real mp4 at all")

        with pytest.raises(GenerationFailedError):
            generate_video("x", make_manager(tmp_path), GenerationLimiter(1), infer=infer)
        assert list((tmp_path / "output").glob("*")) == []

    def test_duration_mismatch_is_rejected(self, tmp_path):
        """A 1s clip for a 8s request must not be reported as success."""

        def infer(*, width, height, fps, output_path, **kw):
            write_mp4(output_path, width, height, fps, 1)

        with pytest.raises(GenerationFailedError, match="duration"):
            generate_video(
                "x",
                make_manager(tmp_path),
                GenerationLimiter(1),
                duration_seconds=8,
                fps=16,
                width=256,
                height=256,
                infer=infer,
            )
        assert list((tmp_path / "output").glob("*")) == []

    def test_empty_prompt_rejected(self, tmp_path):
        with pytest.raises(ValidationError, match="prompt is required"):
            generate_video("", make_manager(tmp_path), GenerationLimiter(1))


# --------------------------------------------------------------------------
# Concurrency
# --------------------------------------------------------------------------


class TestConcurrencyLimit:
    def test_second_concurrent_generation_is_rejected_as_busy(self, tmp_path):
        manager = make_manager(tmp_path)
        limiter = GenerationLimiter(1)
        observed = {}

        def infer(*, output_path, width, height, **kw):
            try:
                generate_image("second", manager, limiter, infer=infer)
            except GenerationBusyError as exc:
                observed["busy"] = str(exc)
            write_png(output_path, width, height)

        generate_image("first", manager, limiter, infer=infer)

        assert "busy" in observed, "concurrent job must be refused, not OOM the GPU"
        assert "already running" in observed["busy"]

    def test_image_and_video_share_the_single_permit(self, tmp_path):
        manager = make_manager(tmp_path)
        limiter = GenerationLimiter(1)
        observed = {}

        def vid_infer(*, output_path, width, height, fps, duration_seconds, **kw):
            try:
                generate_image("img", manager, limiter, infer=lambda **kw: None)
            except GenerationBusyError:
                observed["video_blocked_image"] = True
            write_mp4(output_path, width, height, fps, duration_seconds)

        generate_video(
            "v",
            manager,
            limiter,
            duration_seconds=1,
            fps=16,
            width=256,
            height=256,
            infer=vid_infer,
        )
        assert observed.get("video_blocked_image") is True

    def test_permit_is_released_after_failure(self, tmp_path):
        manager = make_manager(tmp_path)
        limiter = GenerationLimiter(1)

        with pytest.raises(GenerationFailedError):
            generate_image("x", manager, limiter, infer=lambda **kw: None)

        assert limiter.active == 0
        # The slot is free again, so a subsequent valid call succeeds.
        outcome = generate_image(
            "y",
            manager,
            limiter,
            infer=lambda *, output_path, width, height, **kw: write_png(output_path, width, height),
        )
        assert outcome.path.exists()

    def test_active_count_is_observable(self, tmp_path):
        limiter = GenerationLimiter(2)
        assert limiter.active == 0
        assert limiter.max_concurrent == 2

    def test_job_progress_and_cancellation(self):
        limiter = GenerationLimiter(1)
        with limiter.slot(job_id="test_job_1", kind="video") as job:
            assert job.job_id == "test_job_1"
            assert limiter.active == 1
            limiter.record_progress("test_job_1", stage="inference", step=5, total_steps=20)
            active = limiter.get_active_job()
            assert active is not None
            assert active["job_id"] == "test_job_1"
            assert active["stage"] == "inference"
            assert active["step"] == 5
            assert active["total_steps"] == 20
            assert not limiter.is_cancelled("test_job_1")

            assert limiter.cancel_job("test_job_1") is True
            assert limiter.is_cancelled("test_job_1") is True

        assert limiter.active == 0
        assert limiter.get_active_job() is None

    def test_stale_job_auto_eviction(self):
        limiter = GenerationLimiter(1, stale_timeout_seconds=0.05)
        with limiter.slot(job_id="stale_job", kind="video"):
            assert limiter.active == 1
            # simulate passage of time beyond stale timeout
            time.sleep(0.08)
            # A new slot request should auto-evict the stale job and succeed!
            limiter._cleanup_stale_locked()
            assert limiter.active == 0

    def test_force_reset_clears_stuck_permit(self):
        limiter = GenerationLimiter(1)
        # simulate an abandoned slot
        with limiter.slot(job_id="abandoned", kind="video"):
            assert limiter.active == 1
            limiter.force_reset()
            assert limiter.active == 0
            assert limiter.get_active_job() is None
            # Next request can immediately acquire the slot
            with limiter.slot(job_id="new_job", kind="image"):
                assert limiter.active == 1
        assert limiter.active == 0
