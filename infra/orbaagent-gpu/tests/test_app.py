"""Tests for the FastAPI surface: auth, honest readiness, and secret hygiene.

These drive the real endpoint functions through FastAPI's in-process TestClient.
Inference is injected, but the generation pipeline, the limiter, and the output
validators are the real ones, and the artifact is a real file on disk.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from orba_gpu.app import create_app
from orba_gpu.config import Settings
from orba_gpu.generation import GenerationLimiter
from orba_gpu.gpu_info import GpuInfo
from orba_gpu.models import ModelManager

TOKEN = "test-worker-token-that-is-long-enough-1234"
GPU1_UUID = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"


def available_gpu(uuid: str) -> GpuInfo:
    return GpuInfo(
        available=True,
        uuid=uuid,
        name="NVIDIA RTX PRO 6000 Blackwell Server Edition",
        memory_total_mib=97887,
        memory_used_mib=0,
        memory_free_mib=97887,
    )


def unavailable_gpu(uuid: str) -> GpuInfo:
    return GpuInfo(available=False, uuid=uuid, error="GPU not present in this container")


def build_client(
    tmp_path: Path,
    *,
    backend="",
    gpu_reader=available_gpu,
    image_infer=None,
    video_infer=None,
    limiter=None,
    ingest_url="",
    ingest_token="",
):
    settings = Settings(
        target_gpu_uuid=GPU1_UUID,
        backend=backend,
        models_dir=str(tmp_path / "models"),
        output_dir=str(tmp_path / "output"),
        token=TOKEN,
        ingest_url=ingest_url,
        ingest_token=ingest_token,
    )
    manager = ModelManager(
        models_dir=settings.models_dir,
        output_dir=settings.output_dir,
        backend=backend,
        image_model_id="black-forest-labs/FLUX.1-schnell",
        video_model_id="Wan-AI/Wan2.1-T2V-1.3B",
        image_loader=lambda _: "image-pipeline",
        video_loader=lambda _: "video-pipeline",
    )
    app = create_app(
        settings=settings,
        manager=manager,
        limiter=limiter or GenerationLimiter(1),
        image_infer=image_infer,
        video_infer=video_infer,
        token=TOKEN,
        gpu_reader=gpu_reader,
    )
    return TestClient(app), manager


def auth_headers():
    return {"Authorization": f"Bearer {TOKEN}"}


def write_png(output_path, width, height):
    Image.new("RGB", (width, height), (5, 6, 7)).save(output_path, format="PNG")


class TestAuthentication:
    def test_missing_auth_is_401(self, tmp_path):
        client, _ = build_client(tmp_path)
        assert client.get("/health").status_code == 401

    def test_wrong_token_is_403(self, tmp_path):
        client, _ = build_client(tmp_path)
        resp = client.get("/health", headers={"Authorization": "Bearer wrong-token"})
        assert resp.status_code == 403

    def test_non_bearer_scheme_is_403(self, tmp_path):
        client, _ = build_client(tmp_path)
        resp = client.get("/health", headers={"Authorization": f"Basic {TOKEN}"})
        assert resp.status_code == 403

    def test_correct_token_is_accepted(self, tmp_path):
        client, _ = build_client(tmp_path)
        assert client.get("/health", headers=auth_headers()).status_code == 200

    def test_generation_endpoints_require_auth(self, tmp_path):
        client, _ = build_client(tmp_path)
        assert client.post("/api/generate/image", json={"prompt": "x"}).status_code == 401
        assert client.post("/api/generate/video", json={"prompt": "x"}).status_code == 401

    def test_app_refuses_to_start_without_a_token(self, tmp_path):
        """An unauthenticated GPU endpoint is worse than an outage."""
        with pytest.raises(RuntimeError, match="MEDIA_WORKER_TOKEN"):
            create_app(settings=Settings(token=""), token=None)


class TestHealthReporting:
    def test_unset_backend_reports_generation_unavailable(self, tmp_path):
        client, _ = build_client(tmp_path)
        body = client.get("/health", headers=auth_headers()).json()

        assert body["capabilities"]["image_generation"] is False
        assert body["capabilities"]["video_generation"] is False
        assert body["generation_backend"] is None
        assert "MEDIA_GENERATION_BACKEND is not set" in body["unavailable_reason"]

    def test_configured_backend_but_no_model_loaded_is_still_unavailable(self, tmp_path):
        """Config alone must never make the capability available."""
        client, _ = build_client(tmp_path, backend="diffusers")
        body = client.get("/health", headers=auth_headers()).json()

        assert body["generation_backend"] == "diffusers"
        assert body["capabilities"]["image_generation"] is False
        assert body["capabilities"]["video_generation"] is False
        assert "no model is loaded" in body["unavailable_reason"]
        assert body["models"]["image"]["requested"] is True
        assert body["models"]["image"]["loaded"] is False

    def test_ready_only_after_a_real_load(self, tmp_path):
        client, manager = build_client(tmp_path, backend="diffusers")
        manager.load_image()

        body = client.get("/health", headers=auth_headers()).json()
        assert body["capabilities"]["image_generation"] is True
        assert body["capabilities"]["video_generation"] is False  # video not loaded
        assert body["models"]["image"]["loaded"] is True
        assert body["models"]["video"]["loaded"] is False

    def test_missing_gpu_disables_generation_even_when_model_loaded(self, tmp_path):
        client, manager = build_client(
            tmp_path, backend="diffusers", gpu_reader=unavailable_gpu
        )
        manager.load_image()

        body = client.get("/health", headers=auth_headers()).json()
        assert body["gpu"]["available"] is False
        assert body["capabilities"]["image_generation"] is False

    def test_health_reports_the_uuid_it_actually_queried(self, tmp_path):
        client, _ = build_client(tmp_path)
        body = client.get("/health", headers=auth_headers()).json()
        assert body["gpu"]["device_uuid"] == GPU1_UUID

    def test_concurrency_limits_are_reported(self, tmp_path):
        client, _ = build_client(tmp_path, limiter=GenerationLimiter(1))
        body = client.get("/health", headers=auth_headers()).json()
        assert body["max_concurrent_generations"] == 1
        assert body["active_generations"] == 0


class TestGenerateImageEndpoint:
    def test_unavailable_when_backend_unset(self, tmp_path):
        client, _ = build_client(tmp_path, backend="")
        resp = client.post("/api/generate/image", json={"prompt": "x"}, headers=auth_headers())
        assert resp.status_code == 503
        assert resp.json()["detail"]["status"] == "MEDIA_GENERATION_UNAVAILABLE"

    def test_unavailable_when_backend_value_has_no_implementation(self, tmp_path):
        """`comfyui` is a recognized name with no implementation in this worker."""
        client, _ = build_client(tmp_path, backend="comfyui")
        resp = client.post("/api/generate/image", json={"prompt": "x"}, headers=auth_headers())
        assert resp.status_code == 503
        message = resp.json()["detail"]["message"]
        assert "no image generation backend is implemented" in message.lower()
        assert resp.json()["detail"]["status"] == "MEDIA_GENERATION_UNAVAILABLE"

    def test_successful_generation_returns_verified_artifact(self, tmp_path):
        client, _ = build_client(
            tmp_path,
            backend="diffusers",
            image_infer=lambda *, output_path, width, height, **kw: write_png(
                output_path, width, height
            ),
        )
        resp = client.post(
            "/api/generate/image",
            json={"prompt": "a red fox", "width": 256, "height": 256, "seed": 7},
            headers=auth_headers(),
        )
        assert resp.status_code == 200
        body = resp.json()

        assert body["status"] == "COMPLETED"
        assert body["content_type"] == "image/png"
        assert body["size_bytes"] > 0
        assert len(body["sha256"]) == 64
        assert body["jobId"].startswith("img_")
        # No filesystem paths leak.
        assert "path" not in body
        assert str(tmp_path) not in resp.text
        # The artifact genuinely exists on disk.
        assert list((tmp_path / "output").glob("*.png"))

    def test_generation_failure_is_500_not_a_fake_success(self, tmp_path):
        client, _ = build_client(
            tmp_path, backend="diffusers", image_infer=lambda **kw: None  # writes nothing
        )
        resp = client.post("/api/generate/image", json={"prompt": "x"}, headers=auth_headers())
        assert resp.status_code == 500
        assert resp.json()["detail"]["status"] == "GENERATION_FAILED"
        assert "COMPLETED" not in resp.text

    def test_empty_prompt_is_400(self, tmp_path):
        client, _ = build_client(tmp_path, backend="diffusers")
        resp = client.post("/api/generate/image", json={"prompt": "  "}, headers=auth_headers())
        assert resp.status_code == 400

    def test_busy_is_503_with_busy_status(self, tmp_path):
        limiter = GenerationLimiter(1)
        holder = {}

        def infer(*, output_path, width, height, **kw):
            # While this runs, the single permit is held.
            inner = client.post(
                "/api/generate/image", json={"prompt": "second"}, headers=auth_headers()
            )
            holder["inner_status"] = inner.status_code
            write_png(output_path, width, height)

        client, _ = build_client(tmp_path, backend="diffusers", image_infer=infer, limiter=limiter)
        outer = client.post("/api/generate/image", json={"prompt": "first"}, headers=auth_headers())

        assert outer.status_code == 200
        assert holder["inner_status"] == 503

    def test_model_load_failure_is_503_model_unavailable(self, tmp_path):
        settings = Settings(
            target_gpu_uuid=GPU1_UUID,
            backend="diffusers",
            models_dir=str(tmp_path / "models"),
            output_dir=str(tmp_path / "output"),
            token=TOKEN,
        )
        manager = ModelManager(
            models_dir=settings.models_dir,
            output_dir=settings.output_dir,
            backend="diffusers",
            image_model_id="black-forest-labs/FLUX.1-schnell",
            video_model_id="Wan-AI/Wan2.1-T2V-1.3B",
            image_loader=lambda _: (_ for _ in ()).throw(RuntimeError("cannot find weights")),
        )
        client = TestClient(
            create_app(
                settings=settings,
                manager=manager,
                token=TOKEN,
                gpu_reader=available_gpu,
            )
        )
        resp = client.post("/api/generate/image", json={"prompt": "x"}, headers=auth_headers())
        assert resp.status_code == 503
        assert resp.json()["detail"]["status"] == "MODEL_UNAVAILABLE"


class TestSecretHygiene:
    def test_token_never_appears_in_health_response(self, tmp_path):
        client, _ = build_client(tmp_path, backend="diffusers")
        resp = client.get("/health", headers=auth_headers())
        assert TOKEN not in resp.text

    def test_token_never_appears_in_error_responses(self, tmp_path):
        client, _ = build_client(tmp_path, backend="diffusers")
        resp = client.post("/api/generate/image", json={"prompt": "x"}, headers=auth_headers())
        assert TOKEN not in resp.text

    def test_ingest_token_never_appears_in_responses(self, tmp_path):
        secret = "ingest-secret-should-never-leak-abcdef"
        client, _ = build_client(
            tmp_path, backend="diffusers", ingest_token=secret, ingest_url="http://example.invalid"
        )
        for resp in (
            client.get("/health", headers=auth_headers()),
            client.post("/api/generate/image", json={"prompt": "x"}, headers=auth_headers()),
        ):
            assert secret not in resp.text

    def test_ingest_failure_is_reported_not_hidden(self, tmp_path):
        """A generated-but-undelivered artifact must say so, not claim delivery."""
        client, _ = build_client(
            tmp_path,
            backend="diffusers",
            image_infer=lambda *, output_path, width, height, **kw: write_png(
                output_path, width, height
            ),
            ingest_url="http://127.0.0.1:1/ingest",  # unreachable
            ingest_token="ingest-token-that-is-long-enough-123456",
        )
        resp = client.post("/api/generate/image", json={"prompt": "x"}, headers=auth_headers())
        assert resp.status_code == 200
        body = resp.json()
        assert body["delivered_to_production"] is False
        assert "ingest failed" in body["ingest_note"]
