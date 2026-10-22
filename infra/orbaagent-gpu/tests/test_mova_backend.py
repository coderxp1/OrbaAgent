"""Tests for the MOVA video backend (worker side).

The backend talks to the MOVA service over HTTP; these tests inject a
fake opener and assert the fail-closed contract: any service problem is
an exception, never a silent fallback and never a fabricated success.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import pytest
from PIL import Image

from orba_gpu.backends.mova_backend import (
    MovaBackend,
    MovaConfig,
    MovaServiceError,
    frames_for_duration,
)
from orba_gpu.config import MOVA_MODEL_ID, MOVA_MODEL_REVISION

MP4_BYTES = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 1024


def health_body(**overrides):
    body = {
        "status": "ok",
        "model_id": MOVA_MODEL_ID,
        "model_revision": MOVA_MODEL_REVISION,
        "ckpt_present": True,
    }
    body.update(overrides)
    return json.dumps(body).encode()


def make_opener(*, health=None, generate=None, calls=None):
    def opener(method, url, json_body, headers, timeout):
        if calls is not None:
            calls.append({"method": method, "url": url, "json": json_body, "headers": headers})
        if url.endswith("/health"):
            if isinstance(health, Exception):
                raise health
            return 200, {}, health if health is not None else health_body()
        if url.endswith("/generate"):
            if isinstance(generate, Exception):
                raise generate
            if generate is not None:
                return generate
            return 200, {"Content-Type": "video/mp4"}, MP4_BYTES
        raise AssertionError(f"unexpected URL {url}")

    return opener


def make_backend(opener, **config_kwargs):
    return MovaBackend(
        MovaConfig(service_url="http://mova.test:8200", token="t0ken", **config_kwargs),
        opener=opener,
    )


class TestServiceVerification:
    def test_verified_service_constructs(self):
        backend = make_backend(make_opener())
        assert backend is not None

    def test_unreachable_service_fails_closed(self):
        with pytest.raises(MovaServiceError, match="unreachable"):
            make_backend(make_opener(health=ConnectionError("refused")))

    def test_wrong_revision_fails_closed(self):
        with pytest.raises(MovaServiceError, match="revision"):
            make_backend(make_opener(health=health_body(model_revision="deadbeef")))

    def test_wrong_model_fails_closed(self):
        with pytest.raises(MovaServiceError, match="model"):
            make_backend(make_opener(health=health_body(model_id="Wan-AI/Wan2.1")))

    def test_missing_checkpoint_fails_closed(self):
        with pytest.raises(MovaServiceError, match="checkpoint"):
            make_backend(make_opener(health=health_body(ckpt_present=False)))

    def test_health_carries_token(self):
        calls = []
        make_backend(make_opener(calls=calls))
        assert calls[0]["headers"]["Authorization"] == "Bearer t0ken"


class TestFrameLattice:
    @pytest.mark.parametrize(
        "duration,frames",
        [(2, 49), (5, 121), (8, 193), (10, 241), (1, 25), (4, 97)],
    )
    def test_frames_follow_8k_plus_1(self, duration, frames):
        result = frames_for_duration(duration)
        assert result == frames
        assert (result - 1) % 8 == 0


class TestGenerateVideo:
    def test_success_writes_bytes_and_passes_payload(self, tmp_path):
        calls = []
        backend = make_backend(make_opener(calls=calls))
        target = tmp_path / "out.mp4"
        image = Image.new("RGB", (64, 64), (200, 30, 30))
        assert backend.generate_video(
            prompt="a woman smiles and says hello",
            negative_prompt="blurry",
            width=1280,
            height=720,
            steps=0,
            seed=7,
            output_format="mp4",
            output_path=str(target),
            duration_seconds=5,
            fps=16,
            image=image,
        ) is True
        assert target.read_bytes() == MP4_BYTES
        payload = calls[-1]["json"]
        assert payload["prompt"] == "a woman smiles and says hello"
        assert payload["num_frames"] == 121
        assert payload["fps"] == 24  # MOVA native rate, not the request's 16
        assert payload["width"] == 1280 and payload["height"] == 720
        assert payload["seed"] == 7
        assert payload["num_inference_steps"] == 50  # steps=0 -> configured default
        assert payload["offload"] == "cpu"
        ref = Image.open(io.BytesIO(base64.b64decode(payload["ref_image_b64"])))
        assert ref.size == (64, 64)

    def test_text_to_video_uses_white_reference(self, tmp_path):
        calls = []
        backend = make_backend(make_opener(calls=calls))
        target = tmp_path / "out.mp4"
        backend.generate_video(
            prompt="ocean wave at sunset",
            width=1280,
            height=720,
            output_path=str(target),
            duration_seconds=2,
            image=None,
        )
        payload = calls[-1]["json"]
        assert payload["num_frames"] == 49
        ref = Image.open(io.BytesIO(base64.b64decode(payload["ref_image_b64"])))
        assert ref.size == (1280, 720)
        assert ref.convert("RGB").getpixel((0, 0)) == (255, 255, 255)

    def test_service_error_raises_and_writes_nothing(self, tmp_path):
        backend = make_backend(
            make_opener(generate=(502, {}, b'{"detail":"MOVA inference failed: CUDA OOM"}'))
        )
        target = tmp_path / "out.mp4"
        with pytest.raises(MovaServiceError, match="CUDA OOM"):
            backend.generate_video(
                prompt="x", output_path=str(target), duration_seconds=5, image=None
            )
        assert not target.exists()
        assert not (tmp_path / "out.mova.tmp").exists()

    def test_empty_body_raises(self, tmp_path):
        backend = make_backend(make_opener(generate=(200, {}, b"")))
        with pytest.raises(MovaServiceError, match="empty"):
            backend.generate_video(
                prompt="x", output_path=str(tmp_path / "o.mp4"), duration_seconds=5
            )

    def test_transport_failure_raises(self, tmp_path):
        backend = make_backend(make_opener(generate=TimeoutError("timed out")))
        with pytest.raises(MovaServiceError, match="failed"):
            backend.generate_video(
                prompt="x", output_path=str(tmp_path / "o.mp4"), duration_seconds=5
            )

    def test_non_mp4_format_rejected(self, tmp_path):
        backend = make_backend(make_opener())
        with pytest.raises(MovaServiceError, match="mp4 only"):
            backend.generate_video(
                prompt="x",
                output_format="webm",
                output_path=str(tmp_path / "o.webm"),
                duration_seconds=5,
            )
