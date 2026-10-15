"""Tests for the model manager: lazy loading, caching, and honest failure."""

from __future__ import annotations

import pytest

from pathlib import Path

from orba_gpu.models import (
    BackendNotImplementedError,
    ModelManager,
    ModelUnavailableError,
    local_model_available,
    resolve_model_path,
)


def make_manager(backend="diffusers", image_loader=None, video_loader=None, tmp_path=None, populate=True):
    if tmp_path is None:
        import tempfile
        tmp_dir = Path(tempfile.mkdtemp())
    else:
        tmp_dir = Path(tmp_path)

    models_dir = tmp_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    if populate:
        img_dir = models_dir / "black-forest-labs" / "FLUX.1-schnell"
        img_dir.mkdir(parents=True, exist_ok=True)
        (img_dir / "model_index.json").write_text("{}")
        vid_dir = models_dir / "Wan-AI" / "Wan2.1-T2V-1.3B"
        vid_dir.mkdir(parents=True, exist_ok=True)
        (vid_dir / "model_index.json").write_text("{}")

    return ModelManager(
        models_dir=str(models_dir),
        output_dir=str(tmp_dir / "output"),
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
        m = make_manager(backend="yolo")
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
    def test_missing_storage_dir_raises(self, tmp_path):
        missing_root = tmp_path / "does-not-exist"
        with pytest.raises(ModelUnavailableError, match="model storage directory is missing"):
            resolve_model_path(str(missing_root), "org/model")

    def test_empty_arguments_raise(self, tmp_path):
        with pytest.raises(ModelUnavailableError, match="must be configured"):
            resolve_model_path("", "org/model")
        with pytest.raises(ModelUnavailableError, match="must be configured"):
            resolve_model_path(str(tmp_path), "")

    def test_missing_local_model_raises_unavailable(self, tmp_path):
        with pytest.raises(ModelUnavailableError, match="not available locally"):
            resolve_model_path(str(tmp_path), "org/model")

    def test_existing_local_dir_without_config_raises(self, tmp_path):
        target = tmp_path / "org" / "model"
        target.mkdir(parents=True)
        with pytest.raises(ModelUnavailableError, match="not available locally"):
            resolve_model_path(str(tmp_path), "org/model")

    def test_existing_local_dir_with_model_index_resolves_to_path(self, tmp_path):
        target = tmp_path / "org" / "model"
        target.mkdir(parents=True)
        (target / "model_index.json").write_text("{}")
        resolved = resolve_model_path(str(tmp_path), "org/model")
        assert resolved == str(target.resolve())

    def test_existing_local_dir_with_config_resolves_to_path(self, tmp_path):
        target = tmp_path / "org" / "model"
        target.mkdir(parents=True)
        (target / "config.json").write_text("{}")
        resolved = resolve_model_path(str(tmp_path), "org/model")
        assert resolved == str(target.resolve())

    def test_huggingface_cache_snapshot_resolves_to_snapshot_path(self, tmp_path):
        snapshot = tmp_path / "models--org--model" / "snapshots" / "rev123"
        snapshot.mkdir(parents=True)
        (snapshot / "model_index.json").write_text("{}")
        resolved = resolve_model_path(str(tmp_path), "org/model")
        assert resolved == str(snapshot.resolve())

    def test_huggingface_cache_without_config_raises(self, tmp_path):
        snapshot = tmp_path / "models--org--model" / "snapshots" / "rev123"
        snapshot.mkdir(parents=True)
        with pytest.raises(ModelUnavailableError, match="not available locally"):
            resolve_model_path(str(tmp_path), "org/model")

    def test_traversal_outside_models_dir_raises(self, tmp_path):
        outside = tmp_path.parent / "outside-model"
        outside.mkdir(exist_ok=True)
        (outside / "model_index.json").write_text("{}")
        with pytest.raises(ModelUnavailableError):
            resolve_model_path(str(tmp_path), "../outside-model")


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
