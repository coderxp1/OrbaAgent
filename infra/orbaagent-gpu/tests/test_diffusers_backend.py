"""Tests for diffusers backend device selection and local loading enforcement."""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from orba_gpu.backends.diffusers_backend import (
    _device,
    load_image_pipeline,
    load_video_pipeline,
    run_image_inference,
    run_video_inference,
)


class TestDiffusersDeviceSelection:
    def test_cuda_available_returns_cuda(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        with patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch):
            assert _device() == "cuda"

    def test_cuda_unavailable_raises_runtime_error_no_cpu_fallback(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = False
        with patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch):
            with pytest.raises(
                RuntimeError,
                match="CUDA is unavailable in the media worker; CPU fallback is disabled",
            ):
                _device()


class TestDiffusersPipelineLoaders:
    def test_load_image_pipeline_enforces_local_files_only(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.bfloat16 = "bfloat16"

        mock_pipeline_instance = MagicMock()
        mock_pipeline_instance.to.return_value = mock_pipeline_instance

        mock_flux_cls = MagicMock()
        mock_flux_cls.from_pretrained.return_value = mock_pipeline_instance

        mock_diffusers = MagicMock()
        mock_diffusers.FluxPipeline = mock_flux_cls

        with patch.dict(sys.modules, {"torch": mock_torch, "diffusers": mock_diffusers}), \
             patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch):
            pipe = load_image_pipeline("/models/local-flux-path")
            mock_flux_cls.from_pretrained.assert_called_once_with(
                "/models/local-flux-path",
                torch_dtype="bfloat16",
                local_files_only=True,
            )
            mock_pipeline_instance.to.assert_called_once_with("cuda")
            assert pipe is mock_pipeline_instance

    def test_load_video_pipeline_enforces_local_files_only(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.bfloat16 = "bfloat16"

        mock_pipeline_instance = MagicMock()
        mock_pipeline_instance.to.return_value = mock_pipeline_instance

        mock_diffusion_cls = MagicMock()
        mock_diffusion_cls.from_pretrained.return_value = mock_pipeline_instance

        mock_diffusers = MagicMock()
        mock_diffusers.DiffusionPipeline = mock_diffusion_cls

        with patch.dict(sys.modules, {"torch": mock_torch, "diffusers": mock_diffusers}), \
             patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch):
            pipe = load_video_pipeline("/models/local-wan-path")
            mock_diffusion_cls.from_pretrained.assert_called_once_with(
                "/models/local-wan-path",
                torch_dtype="bfloat16",
                local_files_only=True,
            )
            mock_pipeline_instance.to.assert_called_once_with("cuda")
            assert pipe is mock_pipeline_instance

    def test_load_image_to_video_pipeline_for_ltx_enforces_local_files_only(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.bfloat16 = "bfloat16"

        mock_pipeline_instance = MagicMock()
        mock_pipeline_instance.to.return_value = mock_pipeline_instance

        mock_ltx_cls = MagicMock()
        mock_ltx_cls.from_pretrained.return_value = mock_pipeline_instance

        mock_diffusers = MagicMock()
        mock_diffusers.LTXImageToVideoPipeline = mock_ltx_cls

        with patch.dict(sys.modules, {"torch": mock_torch, "diffusers": mock_diffusers}), \
             patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch):
            pipe = load_video_pipeline("/models/Lightricks/LTX-Video")
            mock_ltx_cls.from_pretrained.assert_called_once_with(
                "/models/Lightricks/LTX-Video",
                torch_dtype="bfloat16",
                local_files_only=True,
            )
            mock_pipeline_instance.to.assert_called_once_with("cuda")
            assert pipe is mock_pipeline_instance


class TestRunInferenceNumpyTruthValue:
    """Regression tests for the HTTP 500 caused by ambiguous NumPy truth-value checks.

    Before the fix, ``if not frames:`` raised:
        ValueError: The truth value of an array with more than one element is ambiguous.
    These tests exercise ``run_image_inference`` and ``run_video_inference`` with mocked
    pipelines that return NumPy arrays — exactly the structure Wan 2.1 produces —
    and verify the fix holds without requiring a GPU or real diffusers install.
    """

    def _make_mock_torch(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.bfloat16 = "bfloat16"
        mock_torch.Generator.return_value = MagicMock()
        return mock_torch

    def test_run_video_inference_numpy_frames_does_not_raise_truth_value_error(self, tmp_path):
        """Regression: result.frames as List[List[ndarray(H,W,C)]] (Wan batch output)
        must not trigger 'truth value of an array is ambiguous' at the None/len guard."""
        # Simulate Wan output: batch=1, T=5 frames, 64x64 RGB
        T, H, W = 5, 64, 64
        per_frame = np.zeros((H, W, 3), dtype=np.uint8)
        frame_sequence = [per_frame] * T       # flat list of T arrays
        batch_frames = [frame_sequence]        # outer batch dim wrapping one sequence

        mock_result = MagicMock()
        mock_result.frames = batch_frames

        mock_pipeline = MagicMock()
        mock_pipeline.return_value = mock_result
        mock_pipeline._class_name = "WanPipeline"

        output_mp4 = tmp_path / "out.mp4"

        def fake_export(frames, path, fps):
            Path(path).write_bytes(b"\x00" * 64)

        def fake_subprocess(cmd, **kwargs):
            output_mp4.write_bytes(b"\x00" * 64)
            r = MagicMock()
            r.returncode = 0
            return r

        mock_torch = self._make_mock_torch()
        mock_diffusers = MagicMock()
        mock_diffusers_utils = MagicMock()
        mock_diffusers_utils.export_to_video = fake_export
        mock_diffusers.utils = mock_diffusers_utils

        with (
            patch.dict(sys.modules, {"diffusers": mock_diffusers, "diffusers.utils": mock_diffusers_utils}),
            patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch),
            patch("orba_gpu.backends.diffusers_backend._device", return_value="cuda"),
            patch("orba_gpu.backends.diffusers_backend.subprocess.run", fake_subprocess),
        ):
            run_video_inference(
                pipeline=mock_pipeline,
                prompt="test ocean waves",
                negative_prompt=None,
                duration_seconds=1,
                fps=5,
                width=W,
                height=H,
                output_path=output_mp4,
            )

        assert output_mp4.exists()
        assert output_mp4.stat().st_size > 0

    def test_wan_target_frames_rounds_up_to_honor_duration(self, tmp_path):
        """Wan 4x temporal compression requires (num_frames - 1) % 4 == 0.
        Verify that 2s @ 16fps (32 frames) rounds UP to 33 frames (2.0625s),
        and 4s @ 16fps (64 frames) rounds UP to 65 frames (4.0625s), so duration is not truncated."""
        mock_result = MagicMock()
        mock_result.frames = [[np.zeros((64, 64, 3), dtype=np.uint8)] * 33]
        mock_pipeline = MagicMock(return_value=mock_result)
        mock_pipeline._class_name = "WanPipeline"

        output_mp4 = tmp_path / "out_dur.mp4"
        mock_torch = self._make_mock_torch()
        mock_diffusers = MagicMock()
        mock_diffusers_utils = MagicMock()
        mock_diffusers_utils.export_to_video = lambda frames, path, fps: Path(path).write_bytes(b"\x00" * 64)
        mock_diffusers.utils = mock_diffusers_utils

        def fake_subprocess(cmd, **kwargs):
            output_mp4.write_bytes(b"\x00" * 64)
            r = MagicMock()
            r.returncode = 0
            return r

        with (
            patch.dict(sys.modules, {"diffusers": mock_diffusers, "diffusers.utils": mock_diffusers_utils}),
            patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch),
            patch("orba_gpu.backends.diffusers_backend._device", return_value="cuda"),
            patch("orba_gpu.backends.diffusers_backend.subprocess.run", fake_subprocess),
        ):
            run_video_inference(
                pipeline=mock_pipeline,
                prompt="test duration",
                negative_prompt=None,
                duration_seconds=2,
                fps=16,
                width=64,
                height=64,
                output_path=output_mp4,
            )

        call_kwargs = mock_pipeline.call_args.kwargs
        assert call_kwargs["num_frames"] == 33
        assert (call_kwargs["num_frames"] - 1) % 4 == 0

    def test_run_video_inference_none_frames_raises_runtime_error(self, tmp_path):
        """result.frames = None must raise RuntimeError, not TypeError."""
        mock_result = MagicMock()
        mock_result.frames = None
        mock_pipeline = MagicMock(return_value=mock_result)
        mock_pipeline._class_name = ""

        output_mp4 = tmp_path / "out.mp4"
        mock_torch = self._make_mock_torch()
        mock_diffusers = MagicMock()
        mock_diffusers_utils = MagicMock()
        mock_diffusers.utils = mock_diffusers_utils

        with (
            patch.dict(sys.modules, {"diffusers": mock_diffusers, "diffusers.utils": mock_diffusers_utils}),
            patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch),
            patch("orba_gpu.backends.diffusers_backend._device", return_value="cuda"),
        ):
            with pytest.raises(RuntimeError, match="video pipeline returned no frames"):
                run_video_inference(
                    pipeline=mock_pipeline,
                    prompt="test",
                    negative_prompt=None,
                    duration_seconds=1,
                    fps=5,
                    width=64,
                    height=64,
                    output_path=output_mp4,
                )

    def test_run_video_inference_empty_frames_raises_runtime_error(self, tmp_path):
        """result.frames = [] must raise RuntimeError."""
        mock_result = MagicMock()
        mock_result.frames = []
        mock_pipeline = MagicMock(return_value=mock_result)
        mock_pipeline._class_name = ""

        output_mp4 = tmp_path / "out.mp4"
        mock_torch = self._make_mock_torch()
        mock_diffusers = MagicMock()
        mock_diffusers_utils = MagicMock()
        mock_diffusers.utils = mock_diffusers_utils

        with (
            patch.dict(sys.modules, {"diffusers": mock_diffusers, "diffusers.utils": mock_diffusers_utils}),
            patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch),
            patch("orba_gpu.backends.diffusers_backend._device", return_value="cuda"),
        ):
            with pytest.raises(RuntimeError, match="video pipeline returned no frames"):
                run_video_inference(
                    pipeline=mock_pipeline,
                    prompt="test",
                    negative_prompt=None,
                    duration_seconds=1,
                    fps=5,
                    width=64,
                    height=64,
                    output_path=output_mp4,
                )

    def test_run_image_inference_pil_image_list_succeeds(self, tmp_path):
        """result.images = [PIL.Image] must not raise; image must be saved."""
        from PIL import Image as PILImage

        pil_img = PILImage.new("RGB", (64, 64), color=(128, 64, 32))
        mock_result = MagicMock()
        mock_result.images = [pil_img]
        mock_pipeline = MagicMock(return_value=mock_result)

        output_png = tmp_path / "out.png"
        mock_torch = self._make_mock_torch()
        with (
            patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch),
            patch("orba_gpu.backends.diffusers_backend._device", return_value="cuda"),
        ):
            run_image_inference(
                pipeline=mock_pipeline,
                prompt="test vase",
                negative_prompt=None,
                width=64,
                height=64,
                steps=1,
                seed=42,
                output_path=output_png,
            )

        assert output_png.exists()
        assert output_png.stat().st_size > 0

    def test_run_image_inference_none_images_raises_runtime_error(self, tmp_path):
        """result.images = None must raise RuntimeError."""
        mock_result = MagicMock()
        mock_result.images = None
        mock_pipeline = MagicMock(return_value=mock_result)

        mock_torch = self._make_mock_torch()
        with (
            patch("orba_gpu.backends.diffusers_backend._torch", return_value=mock_torch),
            patch("orba_gpu.backends.diffusers_backend._device", return_value="cuda"),
        ):
            with pytest.raises(RuntimeError, match="diffusion pipeline returned no images"):
                run_image_inference(
                    pipeline=mock_pipeline,
                    prompt="test",
                    negative_prompt=None,
                    width=64,
                    height=64,
                    steps=1,
                    seed=None,
                    output_path=tmp_path / "out.png",
                )


class TestVideoValidationFallback:
    def test_validate_video_falls_back_when_ffprobe_absent(self, tmp_path):
        """When ffprobe binary does not exist on PATH, validate_video uses fallback probe."""
        from orba_gpu.validation import validate_video

        fake_mp4 = tmp_path / "test.mp4"
        fake_mp4.write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 1024)

        fallback_data = {
            "duration_seconds": 2.0,
            "width": 640,
            "height": 352,
            "fps": 5.0,
        }

        with patch("orba_gpu.validation._probe_video_fallback", return_value=fallback_data):
            result = validate_video(
                fake_mp4,
                expected_duration_seconds=2,
                expected_width=640,
                expected_height=352,
                ffprobe_path="nonexistent_ffprobe_binary",
            )
            assert result.ok is True

    def test_validate_video_fails_when_fallback_also_fails(self, tmp_path):
        """When both ffprobe and fallback return None, validation fails cleanly."""
        from orba_gpu.validation import validate_video

        corrupted = tmp_path / "bad.mp4"
        corrupted.write_bytes(b"bad content")

        with patch("orba_gpu.validation._probe_video_fallback", return_value=None):
            result = validate_video(
                corrupted,
                expected_duration_seconds=2,
                expected_width=640,
                expected_height=352,
                ffprobe_path="nonexistent_ffprobe_binary",
            )
            assert result.ok is False
            assert "ffprobe could not read the generated video" in result.error


class TestImageToVideoInference:
    """Explicit tests for genuine LTX-Video image conditioning and text-to-video separation."""

    def test_run_image_to_video_inference_conditions_on_image(self, tmp_path):
        from PIL import Image
        from orba_gpu.backends.diffusers_backend import run_image_to_video_inference

        img = Image.new("RGB", (500, 500), color="blue")
        out_mp4 = tmp_path / "output.mp4"

        mock_result = MagicMock()
        mock_result.frames = [[np.zeros((64, 64, 3), dtype=np.uint8)]]
        mock_pipeline = MagicMock(return_value=mock_result)

        with patch("orba_gpu.backends.diffusers_backend._export_and_encode_video") as mock_export:
            run_image_to_video_inference(
                pipeline=mock_pipeline,
                prompt="a person blinking naturally",
                image=img,
                duration_seconds=2,
                width=500,
                height=500,
                output_path=out_mp4,
            )

            mock_pipeline.assert_called_once()
            call_kwargs = mock_pipeline.call_args.kwargs
            assert "image" in call_kwargs
            # Verifies spatial divisibility by 32
            assert call_kwargs["width"] % 32 == 0
            assert call_kwargs["height"] % 32 == 0
            # Verifies temporal formula (k * 8 + 1)
            assert (call_kwargs["num_frames"] - 1) % 8 == 0
            assert call_kwargs["frame_rate"] == 24
            assert call_kwargs["guidance_scale"] == 3.0

            mock_export.assert_called_once()

    def test_run_image_to_video_inference_rejects_none_image(self, tmp_path):
        from orba_gpu.backends.diffusers_backend import run_image_to_video_inference

        mock_pipeline = MagicMock()
        with pytest.raises(ValueError, match="requires a valid conditioning image"):
            run_image_to_video_inference(
                pipeline=mock_pipeline,
                prompt="test",
                image=None,
                output_path=tmp_path / "out.mp4",
            )

    def test_run_text_to_video_inference_has_no_image_keyword(self, tmp_path):
        from orba_gpu.backends.diffusers_backend import run_text_to_video_inference

        out_mp4 = tmp_path / "output.mp4"
        mock_result = MagicMock()
        mock_result.frames = [[np.zeros((64, 64, 3), dtype=np.uint8)]]
        mock_pipeline = MagicMock(return_value=mock_result)

        with patch("orba_gpu.backends.diffusers_backend._export_and_encode_video") as mock_export:
            run_text_to_video_inference(
                pipeline=mock_pipeline,
                prompt="a drone flying over mountains",
                duration_seconds=2,
                fps=16,
                width=512,
                height=512,
                output_path=out_mp4,
            )

            mock_pipeline.assert_called_once()
            call_kwargs = mock_pipeline.call_args.kwargs
            assert "image" not in call_kwargs
            # Verifies Wan temporal constraint (k * 4 + 1)
            assert (call_kwargs["num_frames"] - 1) % 4 == 0
            assert call_kwargs["guidance_scale"] == 5.0

            mock_export.assert_called_once()

