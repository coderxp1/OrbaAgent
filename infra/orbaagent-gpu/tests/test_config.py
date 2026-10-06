"""Tests for request-bound validation and settings resolution."""

from __future__ import annotations

import pytest

from orba_gpu.config import (
    DEFAULT_TARGET_GPU_UUID,
    MAX_IMAGE_DIMENSION,
    MAX_STEPS,
    MAX_VIDEO_DIMENSION,
    MAX_VIDEO_DURATION_SECONDS,
    Settings,
    ValidationError,
    validate_image_request,
    validate_video_request,
)


class TestSettingsFromEnv:
    def test_defaults_target_gpu_1(self):
        s = Settings.from_env({})
        assert s.target_gpu_uuid == DEFAULT_TARGET_GPU_UUID
        assert s.target_gpu_uuid == "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"

    def test_backend_defaults_to_unset(self):
        """No backend configured must remain unset — not silently defaulted."""
        s = Settings.from_env({})
        assert s.backend == ""
        assert s.image_backend_requested is False
        assert s.video_backend_requested is False

    def test_backend_requires_explicit_diffusers(self):
        assert Settings.from_env({"MEDIA_GENERATION_BACKEND": "diffusers"}).image_backend_requested
        # An unknown value must NOT count as implemented.
        assert not Settings.from_env({"MEDIA_GENERATION_BACKEND": "comfyui"}).image_backend_requested
        assert not Settings.from_env({"MEDIA_GENERATION_BACKEND": "yolo"}).image_backend_requested

    def test_token_is_not_in_repr(self):
        s = Settings.from_env({"MEDIA_WORKER_TOKEN": "supersecret" * 4})
        assert "supersecret" not in repr(s)
        assert s.token == "supersecret" * 4

    def test_ingest_token_is_not_in_repr(self):
        s = Settings.from_env({"MEDIA_INGEST_TOKEN": "ingestsecret" * 4})
        assert "ingestsecret" not in repr(s)

    def test_values_are_stripped(self):
        s = Settings.from_env(
            {"MEDIA_GENERATION_BACKEND": "  diffusers  ", "MEDIA_WORKER_TOKEN": "  abc  "}
        )
        assert s.backend == "diffusers"
        assert s.token == "abc"

    def test_port_parsing_falls_back_on_garbage(self):
        assert Settings.from_env({"MEDIA_WORKER_PORT": "not-a-number"}).port == 8190
        assert Settings.from_env({"MEDIA_WORKER_PORT": "9000"}).port == 9000

    def test_concurrency_is_at_least_one(self):
        assert Settings.from_env({"MEDIA_MAX_CONCURRENT_GENERATIONS": "0"}).max_concurrent_generations == 1


class TestValidateImageRequest:
    def test_valid_request_passes_through(self):
        assert validate_image_request(1024, 1024, 20, "png") == (1024, 1024, 20, "png")

    def test_dimensions_are_clamped_not_rejected(self):
        w, h, _, _ = validate_image_request(99999, 99999, 20, "png")
        assert (w, h) == (MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION)

    def test_steps_are_clamped(self):
        assert validate_image_request(512, 512, 9999, "png")[2] == MAX_STEPS
        assert validate_image_request(512, 512, 0, "png")[2] == 1

    def test_non_positive_dimensions_rejected(self):
        with pytest.raises(ValidationError, match="positive"):
            validate_image_request(0, 512, 20, "png")
        with pytest.raises(ValidationError, match="positive"):
            validate_image_request(512, -1, 20, "png")

    def test_unsupported_format_rejected(self):
        with pytest.raises(ValidationError, match="unsupported output_format"):
            validate_image_request(512, 512, 20, "tiff")

    def test_missing_format_defaults_to_png(self):
        assert validate_image_request(512, 512, 20, "")[3] == "png"

    def test_format_is_case_insensitive(self):
        assert validate_image_request(512, 512, 20, "PNG")[3] == "png"


class TestValidateVideoRequest:
    def test_valid_request_passes_through(self):
        assert validate_video_request(4, 16, 768, 768) == (4, 16, 768, 768)

    def test_duration_is_clamped(self):
        assert validate_video_request(999, 16, 768, 768)[0] == MAX_VIDEO_DURATION_SECONDS

    def test_resolution_is_clamped(self):
        _, _, w, h = validate_video_request(4, 16, 99999, 99999)
        assert (w, h) == (MAX_VIDEO_DIMENSION, MAX_VIDEO_DIMENSION)

    def test_fps_is_clamped(self):
        assert validate_video_request(4, 999, 768, 768)[1] == 30
        assert validate_video_request(4, 1, 768, 768)[1] == 8

    def test_non_positive_values_rejected(self):
        with pytest.raises(ValidationError):
            validate_video_request(0, 16, 768, 768)
        with pytest.raises(ValidationError):
            validate_video_request(4, 0, 768, 768)
        with pytest.raises(ValidationError):
            validate_video_request(4, 16, 0, 768)
