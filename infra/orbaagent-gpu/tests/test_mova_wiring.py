"""Wiring tests: config -> model manager -> generation outcome.

Proves the per-slot split (FLUX images via diffusers while video routes
to MOVA), the fail-closed behavior when the MOVA configuration is
absent, and the provenance fix: a generation outcome records the
worker's configured video model, never a hard-coded LTX default.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from orba_gpu.backends.mova_backend import MovaBackend, MovaConfig
from orba_gpu.config import MOVA_MODEL_ID, MOVA_MODEL_REVISION, Settings
from orba_gpu.generation import GenerationLimiter, generate_video
from orba_gpu.models import (
    BackendNotImplementedError,
    ModelManager,
    ModelUnavailableError,
)

FFMPEG = "ffmpeg"


def write_mp4(output_path: Path, width: int, height: int, fps: int, duration: int):
    subprocess.run(
        [
            FFMPEG, "-y", "-f", "lavfi", "-i",
            f"color=c=black:s={width}x{height}:r={fps}:d={duration}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(output_path),
        ],
        check=True, capture_output=True,
    )


def health_opener(method, url, json_body, headers, timeout):
    if url.endswith("/health"):
        return 200, {}, json.dumps({
            "status": "ok",
            "model_id": MOVA_MODEL_ID,
            "model_revision": MOVA_MODEL_REVISION,
            "ckpt_present": True,
        }).encode()
    raise AssertionError(f"unexpected {url}")


class TestConfig:
    def test_video_backend_defaults_to_shared_backend(self):
        settings = Settings.from_env({"MEDIA_GENERATION_BACKEND": "diffusers"})
        assert settings.video_backend == "diffusers"

    def test_video_backend_independent_split(self):
        settings = Settings.from_env({
            "MEDIA_GENERATION_BACKEND": "diffusers",
            "MEDIA_GENERATION_VIDEO_BACKEND": "mova",
            "MEDIA_GENERATION_VIDEO_MODEL": MOVA_MODEL_ID,
        })
        assert settings.backend == "diffusers"
        assert settings.video_backend == "mova"
        assert settings.image_backend_requested is True
        assert settings.image_backend_implemented is True
        assert settings.video_backend_requested is True
        assert settings.video_backend_implemented is True

    def test_mova_defaults(self):
        settings = Settings.from_env({})
        assert settings.mova_service_url == "http://mova:8200"
        assert settings.mova_offload == "cpu"
        assert settings.mova_steps == 50
        assert settings.mova_timeout_seconds == 14400


def make_mova_manager(tmp_path, monkeypatch, *, with_config=True):
    import orba_gpu.backends.mova_backend as mova_module

    monkeypatch.setattr(mova_module, "_default_opener", health_opener)
    return ModelManager(
        models_dir=str(tmp_path / "models"),
        output_dir=str(tmp_path / "output"),
        backend="diffusers",
        image_model_id="black-forest-labs/FLUX.1-schnell",
        video_model_id=MOVA_MODEL_ID,
        image_loader=lambda _: "image-pipeline",
        video_loader=lambda _: "video-pipeline",
        video_backend="mova",
        mova_config=MovaConfig(service_url="http://mova.test:8200") if with_config else None,
    )


class TestModelManager:
    def test_load_video_returns_mova_backend(self, tmp_path, monkeypatch):
        manager = make_mova_manager(tmp_path, monkeypatch)
        pipeline = manager.load_video()
        assert isinstance(pipeline, MovaBackend)
        assert manager.video_ready is True

    def test_image_slot_still_uses_image_loader(self, tmp_path, monkeypatch):
        flux_dir = tmp_path / "models" / "black-forest-labs" / "FLUX.1-schnell"
        flux_dir.mkdir(parents=True)
        (flux_dir / "config.json").write_text("{}")
        manager = make_mova_manager(tmp_path, monkeypatch)
        assert manager.load_image() == "image-pipeline"

    def test_status_reports_video_requested(self, tmp_path, monkeypatch):
        manager = make_mova_manager(tmp_path, monkeypatch)
        status = manager.status()
        assert status["video"]["requested"] is True
        assert status["video_backend_configured"] == "mova"

    def test_missing_mova_config_fails_closed(self, tmp_path, monkeypatch):
        manager = make_mova_manager(tmp_path, monkeypatch, with_config=False)
        with pytest.raises(BackendNotImplementedError):
            manager.load_video()

    def test_unreachable_service_fails_closed(self, tmp_path, monkeypatch):
        import orba_gpu.backends.mova_backend as mova_module

        def dead_opener(method, url, json_body, headers, timeout):
            raise ConnectionError("no route")

        monkeypatch.setattr(mova_module, "_default_opener", dead_opener)
        manager = ModelManager(
            models_dir=str(tmp_path / "models"),
            output_dir=str(tmp_path / "output"),
            backend="diffusers",
            image_model_id="black-forest-labs/FLUX.1-schnell",
            video_model_id=MOVA_MODEL_ID,
            video_backend="mova",
            mova_config=MovaConfig(service_url="http://mova.test:8200"),
        )
        with pytest.raises(ModelUnavailableError):
            manager.load_video()
        assert manager.video_ready is False


class TestGenerationProvenance:
    def test_outcome_records_configured_model_not_ltx_default(self, tmp_path, monkeypatch):
        import orba_gpu.backends.mova_backend as mova_module

        class FakeMovaBackend:
            def __init__(self, config):
                self.config = config

            def generate_video(self, *, prompt, negative_prompt=None, width=1280,
                               height=720, steps=0, seed=1, output_format="mp4",
                               output_path, duration_seconds=None, fps=None, image=None):
                write_mp4(Path(output_path), width, height, 24, int(duration_seconds or 5))
                return True

        monkeypatch.setattr(mova_module, "MovaBackend", FakeMovaBackend)
        manager = ModelManager(
            models_dir=str(tmp_path / "models"),
            output_dir=str(tmp_path / "output"),
            backend="diffusers",
            image_model_id="black-forest-labs/FLUX.1-schnell",
            video_model_id=MOVA_MODEL_ID,
            image_loader=lambda _: "image-pipeline",
            video_backend="mova",
            mova_config=MovaConfig(service_url="http://mova.test:8200"),
        )
        outcome = generate_video(
            "an ocean wave at sunset",
            manager,
            GenerationLimiter(1),
            duration_seconds=5,
            fps=16,
            width=1280,
            height=720,
            model="",
        )
        assert outcome.model == MOVA_MODEL_ID
        assert outcome.kind == "video"
        assert outcome.path.is_file() and outcome.size_bytes > 0

    def test_mova_failure_propagates_as_generation_failure(self, tmp_path, monkeypatch):
        import orba_gpu.backends.mova_backend as mova_module
        from orba_gpu.generation import GenerationFailedError

        class FailingMovaBackend:
            def __init__(self, config):
                self.config = config

            def generate_video(self, **kwargs):
                raise RuntimeError("MOVA service returned HTTP 502: CUDA OOM")

        monkeypatch.setattr(mova_module, "MovaBackend", FailingMovaBackend)
        manager = ModelManager(
            models_dir=str(tmp_path / "models"),
            output_dir=str(tmp_path / "output"),
            backend="diffusers",
            image_model_id="black-forest-labs/FLUX.1-schnell",
            video_model_id=MOVA_MODEL_ID,
            video_backend="mova",
            mova_config=MovaConfig(service_url="http://mova.test:8200"),
        )
        with pytest.raises(GenerationFailedError):
            generate_video(
                "an ocean wave at sunset",
                manager,
                GenerationLimiter(1),
                duration_seconds=5,
                fps=16,
                width=1280,
                height=720,
                model="",
            )
        # No artifact may remain after a failed generation.
        assert list((tmp_path / "output").glob("*.mp4")) == []
