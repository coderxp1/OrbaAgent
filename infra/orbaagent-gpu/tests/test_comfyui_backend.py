"""Tests for ComfyUI backend workflows, MP4 video validation, and honest failure."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from orba_gpu.backends.comfyui_backend import ComfyUIBackend


@pytest.fixture
def temp_dirs(tmp_path):
    models_dir = tmp_path / "models"
    output_dir = tmp_path / "output"
    models_dir.mkdir()
    output_dir.mkdir()
    return models_dir, output_dir


class TestComfyUIBackendWorkflows:
    def test_generate_image_copies_completed_artifact(self, temp_dirs):
        models_dir, output_dir = temp_dirs
        backend = ComfyUIBackend(str(models_dir))

        with patch("orba_gpu.backends.comfyui_backend.COMFYUI_OUTPUT_DIR", str(output_dir)), \
             patch.object(backend, "_queue_prompt", return_value="prompt-123"), \
             patch.object(backend, "_wait_for_completion", return_value=True):
            
            # Create a mock output file that ComfyUI would have generated
            test_img = output_dir / "orba_img_42_00001_.png"
            test_img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)

            dest_path = str(output_dir / "result.png")
            success = backend.generate_image(
                prompt="a prompt",
                negative_prompt="",
                width=512,
                height=512,
                steps=20,
                seed=42,
                output_format="png",
                output_path=dest_path,
            )

            assert success is True
            assert os.path.exists(dest_path)
            assert os.path.getsize(dest_path) > 0

    def test_generate_video_encodes_mp4_with_valid_container_header(self, temp_dirs):
        models_dir, output_dir = temp_dirs
        backend = ComfyUIBackend(str(models_dir))

        def queue_and_write_frames(workflow):
            # Simulate ComfyUI writing frames under the workflow's prefix
            prefix = workflow["9"]["inputs"]["filename_prefix"]
            for i in range(1, 5):
                frame = output_dir / f"{prefix}_{i:05d}.png"
                frame.write_bytes(b"\x89PNG\r\n\x1a\nfakeframe")
            return "prompt-vid-1"

        with patch("orba_gpu.backends.comfyui_backend.COMFYUI_OUTPUT_DIR", str(output_dir)), \
             patch.object(backend, "_queue_prompt", side_effect=queue_and_write_frames), \
             patch.object(backend, "_wait_for_completion", return_value=True):

            dest_path = str(output_dir / "result.mp4")

            # Mock subprocess.run to simulate ffmpeg producing an MP4 with an ftyp box
            def mock_ffmpeg(*args, **kwargs):
                with open(dest_path, "wb") as f:
                    f.write(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00" + b"\x00" * 200)
                return MagicMock(returncode=0)

            with patch("subprocess.run", side_effect=mock_ffmpeg):
                success = backend.generate_video(
                    prompt="a video prompt",
                    negative_prompt="",
                    width=512,
                    height=512,
                    steps=10,
                    seed=7,
                    output_format="mp4",
                    output_path=dest_path,
                )

                assert success is True
                assert os.path.exists(dest_path)
                with open(dest_path, "rb") as f:
                    assert b"ftyp" in f.read(16)

    def test_generate_video_refuses_image_to_video_instead_of_dropping_photo(self, temp_dirs):
        models_dir, output_dir = temp_dirs
        backend = ComfyUIBackend(str(models_dir))

        with patch.object(backend, "_queue_prompt", return_value="prompt-i2v") as queue:
            success = backend.generate_video(
                prompt="animate this photo",
                negative_prompt="",
                width=576,
                height=1024,
                steps=10,
                seed=3,
                output_format="mp4",
                output_path=str(output_dir / "i2v.mp4"),
                duration_seconds=5,
                fps=16,
                image=object(),  # any conditioning image must be refused, not ignored
            )

        assert success is False
        queue.assert_not_called()

    def test_generate_video_frame_count_and_fps_follow_requested_duration(self, temp_dirs):
        models_dir, output_dir = temp_dirs
        backend = ComfyUIBackend(str(models_dir))

        captured = {}

        def capture_queue(workflow):
            captured["workflow"] = workflow
            prefix = workflow["9"]["inputs"]["filename_prefix"]
            for i in range(1, 5):
                frame = output_dir / f"{prefix}_{i:05d}.png"
                frame.write_bytes(b"\x89PNG\r\n\x1a\nfakeframe")
            return "prompt-vid-dur"

        dest_path = str(output_dir / "result.mp4")

        def mock_ffmpeg(*args, **kwargs):
            captured["ffmpeg_args"] = args[0]
            with open(dest_path, "wb") as f:
                f.write(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00" + b"\x00" * 200)
            return MagicMock(returncode=0)

        with patch("orba_gpu.backends.comfyui_backend.COMFYUI_OUTPUT_DIR", str(output_dir)), \
             patch.object(backend, "_queue_prompt", side_effect=capture_queue), \
             patch.object(backend, "_wait_for_completion", return_value=True), \
             patch("subprocess.run", side_effect=mock_ffmpeg):
            success = backend.generate_video(
                prompt="a video prompt",
                negative_prompt="",
                width=512,
                height=512,
                steps=10,
                seed=7,
                output_format="mp4",
                output_path=dest_path,
                duration_seconds=5,
                fps=16,
            )

        assert success is True
        # 5s at 16 fps = 80 frames, not the old hard-coded 16 frames at 8 fps.
        assert captured["workflow"]["6"]["inputs"]["batch_size"] == 80
        ffmpeg_args = captured["ffmpeg_args"]
        assert ffmpeg_args[ffmpeg_args.index("-r") + 1] == "16"

    def test_generate_video_ignores_stale_frames_from_previous_runs(self, temp_dirs):
        models_dir, output_dir = temp_dirs
        backend = ComfyUIBackend(str(models_dir))

        # A leftover frame from an earlier run with the same seed (old
        # seed-only prefix) must not be stitched into this run's video.
        stale = output_dir / "orba_vid_7_00001.png"
        stale.write_bytes(b"\x89PNG\r\n\x1a\nstaleframe")

        captured = {}

        def queue_and_write_frames(workflow):
            prefix = workflow["9"]["inputs"]["filename_prefix"]
            captured["prefix"] = prefix
            for i in range(1, 3):
                frame = output_dir / f"{prefix}_{i:05d}.png"
                frame.write_bytes(b"\x89PNG\r\n\x1a\nfakeframe")
            return "prompt-vid-stale"

        dest_path = str(output_dir / "result.mp4")

        def mock_ffmpeg(*args, **kwargs):
            argv = args[0]
            concat_path = argv[argv.index("-i") + 1]
            with open(concat_path) as fh:
                captured["concat"] = fh.read()
            with open(dest_path, "wb") as f:
                f.write(b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x02\x00" + b"\x00" * 200)
            return MagicMock(returncode=0)

        with patch("orba_gpu.backends.comfyui_backend.COMFYUI_OUTPUT_DIR", str(output_dir)), \
             patch.object(backend, "_queue_prompt", side_effect=queue_and_write_frames), \
             patch.object(backend, "_wait_for_completion", return_value=True), \
             patch("subprocess.run", side_effect=mock_ffmpeg):
            success = backend.generate_video(
                prompt="a video prompt",
                negative_prompt="",
                width=512,
                height=512,
                steps=10,
                seed=7,
                output_format="mp4",
                output_path=dest_path,
                duration_seconds=5,
                fps=16,
            )

        assert success is True
        assert captured["prefix"] != "orba_vid_7"
        assert "orba_vid_7_00001.png" not in captured["concat"]
        assert captured["prefix"] in captured["concat"]

    def test_generate_video_fails_honestly_when_no_frames_generated(self, temp_dirs):
        models_dir, output_dir = temp_dirs
        backend = ComfyUIBackend(str(models_dir))

        with patch("orba_gpu.backends.comfyui_backend.COMFYUI_OUTPUT_DIR", str(output_dir)), \
             patch.object(backend, "_queue_prompt", return_value="prompt-vid-2"), \
             patch.object(backend, "_wait_for_completion", return_value=True):

            dest_path = str(output_dir / "result.mp4")
            success = backend.generate_video(
                prompt="a prompt",
                negative_prompt="",
                width=512,
                height=512,
                steps=10,
                seed=999,
                output_format="mp4",
                output_path=dest_path,
            )

            assert success is False
            assert not os.path.exists(dest_path)

    def test_generate_video_fails_when_output_lacks_ftyp_mp4_header(self, temp_dirs):
        models_dir, output_dir = temp_dirs
        backend = ComfyUIBackend(str(models_dir))

        def queue_and_write_frame(workflow):
            prefix = workflow["9"]["inputs"]["filename_prefix"]
            frame = output_dir / f"{prefix}_00001.png"
            frame.write_bytes(b"\x89PNG\r\n\x1a\n")
            return "prompt-vid-3"

        with patch("orba_gpu.backends.comfyui_backend.COMFYUI_OUTPUT_DIR", str(output_dir)), \
             patch.object(backend, "_queue_prompt", side_effect=queue_and_write_frame), \
             patch.object(backend, "_wait_for_completion", return_value=True):

            dest_path = str(output_dir / "result.mp4")

            # Corrupt ffmpeg output (e.g. only raw text or garbage without ftyp box)
            def mock_corrupt_ffmpeg(*args, **kwargs):
                with open(dest_path, "wb") as f:
                    f.write(b"not an mp4 file at all")
                return MagicMock(returncode=0)

            with patch("subprocess.run", side_effect=mock_corrupt_ffmpeg):
                success = backend.generate_video(
                    prompt="a prompt",
                    negative_prompt="",
                    width=512,
                    height=512,
                    steps=10,
                    seed=11,
                    output_format="mp4",
                    output_path=dest_path,
                )

                assert success is False
