"""Tests for the MOVA inference service (mova_service/app.py).

The inference subprocess is replaced by a fake runner; the tests assert
the service's contract: token auth, checkpoint gate, exact argv passed
to the pinned inference script, honest 502s with the log tail, and the
generated file returned as video/mp4.
"""

from __future__ import annotations

import base64
import importlib.util
import io
from pathlib import Path

import pytest
from PIL import Image

SERVICE_PATH = Path(__file__).resolve().parent.parent / "mova_service" / "app.py"

spec = importlib.util.spec_from_file_location("mova_service_app", SERVICE_PATH)
mova_service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mova_service)

from fastapi.testclient import TestClient  # noqa: E402

TOKEN = "test-mova-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture()
def service(tmp_path, monkeypatch):
    ckpt = tmp_path / "ckpt"
    ckpt.mkdir()
    (ckpt / "model_index.json").write_text("{}")
    monkeypatch.setattr(mova_service, "SERVICE_TOKEN", TOKEN)
    monkeypatch.setattr(mova_service, "CKPT_PATH", str(ckpt))
    monkeypatch.setattr(mova_service, "WORK_DIR", tmp_path / "jobs")
    return tmp_path, ckpt


def ref_b64() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), (10, 10, 10)).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def payload(**overrides):
    body = {
        "prompt": "a man speaks to camera",
        "negative_prompt": "",
        "ref_image_b64": ref_b64(),
        "num_frames": 49,
        "fps": 24,
        "width": 1280,
        "height": 720,
        "seed": 3,
        "num_inference_steps": 50,
        "offload": "cpu",
        "attn_type": "fa",
    }
    body.update(overrides)
    return body


class TestHealth:
    def test_health_reports_pin_and_checkpoint(self, service):
        client = TestClient(mova_service.create_app())
        res = client.get("/health", headers=AUTH)
        assert res.status_code == 200
        body = res.json()
        assert body["model_id"] == "OpenMOSS-Team/MOVA-720p"
        assert body["model_revision"] == "8462bea9a317a3591279faeedfd3ca01b055cb59"
        assert body["repo_commit"] == "1591b2557b42030a3421442c998dd6f5602ed9bd"
        assert body["ckpt_present"] is True

    def test_health_requires_token(self, service):
        client = TestClient(mova_service.create_app())
        assert client.get("/health").status_code == 401
        assert client.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401


class TestGenerate:
    def test_success_runs_pinned_inference_and_returns_mp4(self, service):
        seen = {}

        def fake_runner(argv, env, timeout):
            seen["argv"] = argv
            seen["env"] = env
            out = Path(argv[argv.index("--output_path") + 1])
            out.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x01" * 512)
            return 0, "inference ok"

        client = TestClient(mova_service.create_app(runner=fake_runner))
        res = client.post("/generate", json=payload(), headers=AUTH)
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("video/mp4")
        assert len(res.content) > 500
        argv = seen["argv"]
        assert argv[argv.index("--ckpt_path") + 1] == str(service[1])
        assert argv[argv.index("--cp_size") + 1] == "1"
        assert argv[argv.index("--offload") + 1] == "cpu"
        assert argv[argv.index("--num_frames") + 1] == "49"
        assert argv[argv.index("--num_inference_steps") + 1] == "50"
        assert "a man speaks to camera" in argv
        assert argv[argv.index("--seed") + 1] == "3"
        assert seen["env"]["CUDA_VISIBLE_DEVICES"] == "0"
        assert any(a.endswith("inference_single.py") for a in argv)

    def test_inference_failure_is_honest_502_with_log_tail(self, service):
        def failing_runner(argv, env, timeout):
            return 1, "Traceback ... CUDA out of memory"

        client = TestClient(mova_service.create_app(runner=failing_runner))
        res = client.post("/generate", json=payload(), headers=AUTH)
        assert res.status_code == 502
        assert "exit code 1" in res.json()["detail"]
        assert "CUDA out of memory" in res.json()["detail"]

    def test_missing_output_after_zero_exit_is_502(self, service):
        def empty_runner(argv, env, timeout):
            return 0, "done but wrote nothing"

        client = TestClient(mova_service.create_app(runner=empty_runner))
        res = client.post("/generate", json=payload(), headers=AUTH)
        assert res.status_code == 502
        assert "no output file" in res.json()["detail"]

    def test_missing_checkpoint_is_503(self, service, monkeypatch, tmp_path):
        empty = tmp_path / "empty-ckpt"
        empty.mkdir()
        monkeypatch.setattr(mova_service, "CKPT_PATH", str(empty))
        client = TestClient(mova_service.create_app(runner=lambda a, e, t: (0, "")))
        res = client.post("/generate", json=payload(), headers=AUTH)
        assert res.status_code == 503

    def test_generate_requires_token(self, service):
        client = TestClient(mova_service.create_app(runner=lambda a, e, t: (0, "")))
        assert client.post("/generate", json=payload()).status_code == 401

    def test_invalid_offload_rejected(self, service):
        client = TestClient(mova_service.create_app(runner=lambda a, e, t: (0, "")))
        res = client.post("/generate", json=payload(offload="bogus"), headers=AUTH)
        assert res.status_code == 400

    def test_invalid_ref_image_rejected(self, service):
        client = TestClient(mova_service.create_app(runner=lambda a, e, t: (0, "")))
        res = client.post("/generate", json=payload(ref_image_b64="!!!not-base64!!!"), headers=AUTH)
        assert res.status_code == 400
