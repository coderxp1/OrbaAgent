"""Tests for the model manager: lazy loading, caching, and honest failure."""

from __future__ import annotations

import pytest

from orba_gpu.models import (
    BackendNotImplementedError,
    ModelManager,
    ModelUnavailableError,
    local_model_available,
    resolve_model_path,
)


def make_manager(backend="diffusers", image_loader=None, video_loader=None, tmp_path=None):
    return ModelManager(
        models_dir=str(tmp_path or "/models"),
        output_dir=str(tmp_path or "/output"),
        backend=backend,
        image_model_id="black-forest-labs/FLUX.1-schnell",
        video_model_id="Wan-AI/Wan2.1-T2V-1.3B",
        image_loader=image_loader,
        video_loader=video_loader,
    )


class TestReadiness:
    def test_unset_backend_is_not_ready(self):
        m = make_manager(backend="")
        assert m.image_ready is False
        assert m.video_ready is False
        assert m.backend_configured is False

    def test_configured_backend_alone_does_not_make_it_ready(self):
        """The core rule: config must never equal availability."""
        calls = []

        def loader(_):
            calls.append(1)
            return "pipeline"

        m = make_manager(image_loader=loader)
        assert m.backend_configured is True
        # Still not ready, and nothing has been loaded yet.
        assert m.image_ready is False
        assert calls == []

    def test_ready_only_after_successful_load(self):
        m = make_manager(image_loader=lambda _: "pipeline")
        assert m.image_ready is False
        m.load_image()
        assert m.image_ready is True

    def test_status_reports_requested_vs_loaded(self):
        m = make_manager(image_loader=lambda _: "pipeline")
        status = m.status()
        assert status["backend_configured"] == "diffusers"
        assert status["image"]["requested"] is True
        assert status["image"]["loaded"] is False
        m.load_image()
        assert m.status()["image"]["loaded"] is True


class TestLazyCaching:
    def test_model_is_loaded_once_and_reused(self):
        calls = []

        def loader(path):
            calls.append(path)
            return object()

        m = make_manager(image_loader=loader)
        first = m.load_image()
        second = m.load_image()
        third = m.load_image()

        assert first is second is third
        assert len(calls) == 1, "a 24GB model must not be re-read on every request"

    def test_video_and_image_are_cached_separately(self):
        img_calls, vid_calls = [], []

        m = make_manager(
            image_loader=lambda _: img_calls.append(1) or "img",
            video_loader=lambda _: vid_calls.append(1) or "vid",
        )
        m.load_image()
        m.load_video()
        m.load_image()
        m.load_video()

        assert len(img_calls) == 1
        assert len(vid_calls) == 1

    def test_unload_all_clears_the_cache(self):
        calls = []
        m = make_manager(image_loader=lambda _: calls.append(1) or "p")
        m.load_image()
        m.unload_all()
        assert m.image_ready is False
        m.load_image()
        assert len(calls) == 2


class TestFailureBehaviour:
    def test_loader_failure_raises_and_is_recorded(self):
        def boom(_):
            raise OSError("weights missing on disk")

        m = make_manager(image_loader=boom)
        with pytest.raises(ModelUnavailableError, match="failed to load image model"):
            m.load_image()

        status = m.status()["image"]
        assert status["loaded"] is False
        assert "weights missing" in (status["load_error"] or "")

    def test_failed_load_is_not_reported_as_ready(self):
        m = make_manager(image_loader=lambda _: (_ for _ in ()).throw(RuntimeError("cuda OOM")))
        with pytest.raises(ModelUnavailableError):
            m.load_image()
        assert m.image_ready is False

    def test_failure_does_not_silently_substitute_another_model(self):
        """A missing model must raise, never fall back to a different one."""
        attempted = []

        def loader(path):
            attempted.append(path)
            raise FileNotFoundError(f"no such model: {path}")

        m = make_manager(image_loader=loader)
        with pytest.raises(ModelUnavailableError):
            m.load_image()

        # Exactly the requested model was attempted — nothing else.
        assert len(attempted) == 1
        assert "FLUX.1-schnell" in attempted[0]

    def test_unimplemented_backend_raises_clearly(self):
        m = make_manager(backend="comfyui")
        with pytest.raises(BackendNotImplementedError, match="MEDIA_GENERATION_BACKEND=diffusers"):
            m.load_image()
        with pytest.raises(BackendNotImplementedError):
            m.load_video()

    def test_no_loader_configured_raises_backend_error(self):
        m = make_manager(image_loader=None)
        with pytest.raises(BackendNotImplementedError, match="no loader is implemented"):
            m.load_image()

    def test_cached_pipeline_survives_a_second_call_after_failure(self):
        """A transient failure must not permanently poison the slot."""
        state = {"fail": True}

        def loader(_):
            if state["fail"]:
                raise RuntimeError("transient")
            return "pipeline"

        m = make_manager(image_loader=loader)
        with pytest.raises(ModelUnavailableError):
            m.load_image()
        state["fail"] = False
        assert m.load_image() == "pipeline"
        assert m.image_ready is True


class TestModelPathResolution:
    def test_missing_local_dir_falls_back_to_hub_id(self, tmp_path):
        assert resolve_model_path(str(tmp_path), "org/model") == "org/model"

    def test_existing_local_dir_resolves_to_path(self, tmp_path):
        target = tmp_path / "org" / "model"
        target.mkdir(parents=True)
        resolved = resolve_model_path(str(tmp_path), "org/model")
        assert resolved.endswith("model")
        assert str(tmp_path) in resolved

    def test_traversal_outside_models_dir_is_not_resolved_to_a_path(self, tmp_path):
        outside = tmp_path.parent / "outside-model"
        outside.mkdir(exist_ok=True)
        resolved = resolve_model_path(str(tmp_path), "../outside-model")
        # Must not hand back a path outside the models directory.
        assert resolved == "../outside-model"


class TestLocalModelAvailable:
    def test_plain_directory_with_config(self, tmp_path):
        d = tmp_path / "org" / "model"
        d.mkdir(parents=True)
        (d / "config.json").write_text("{}")
        assert local_model_available(str(tmp_path), "org/model") is True

    def test_hub_cache_layout(self, tmp_path):
        cache = tmp_path / "models--org--model" / "snapshots" / "abc"
        cache.mkdir(parents=True)
        (cache / "model.safetensors").write_bytes(b"x")
        assert local_model_available(str(tmp_path), "org/model") is True

    def test_missing_model_is_false(self, tmp_path):
        assert local_model_available(str(tmp_path), "org/model") is False

    def test_empty_inputs_are_false(self, tmp_path):
        assert local_model_available("", "org/model") is False
        assert local_model_available(str(tmp_path), "") is False
