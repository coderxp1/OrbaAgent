"""Isolated tests for GPU worker artifact delivery to internal media-ingest.

Verifies the integration between the GPU worker generation pipeline, the
ingest client (orba_gpu.ingest), and the internal ingest endpoint contract
(apps/web/src/app/api/internal/media/ingest/route.ts).

All tests run in complete isolation:
- Mock ingest server binds to 127.0.0.1 on an ephemeral port in-process.
- Files are saved only to pytest's tmp_path fixture; production storage is never touched.
- Secrets are supplied via the environment / dynamic generation and never logged or printed.
"""

from __future__ import annotations

import http.server
import json
import os
import secrets
import socket
import threading
import time
from pathlib import Path
from typing import Generator, Optional
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

from orba_gpu.app import create_app
from orba_gpu.config import Settings
from orba_gpu.generation import GenerationLimiter
from orba_gpu.gpu_info import GpuInfo
from orba_gpu.ingest import IngestError, ingest_artifact
from orba_gpu.models import ModelManager

# Secure test token from environment or generated dynamically.
TEST_TOKEN = os.environ.get("MEDIA_INGEST_TEST_TOKEN") or secrets.token_urlsafe(32)
WORKER_AUTH_TOKEN = "worker-auth-test-secret-long-enough-12345"


class MockIngestHandler(http.server.BaseHTTPRequestHandler):
    """Replicates the contract of apps/web/src/app/api/internal/media/ingest/route.ts."""

    # Configured by the fixture
    expected_token: str = TEST_TOKEN
    expected_workspace: str = "default-tenant"
    max_size_bytes: int = 10 * 1024 * 1024  # 10 MiB limit for testing
    storage_dir: Path

    def log_message(self, format, *args):
        # Suppress noisy HTTP server logging during tests; never print tokens
        pass

    def do_POST(self):
        parsed_url = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))

        # Simulation hooks for server error & timeout
        if parsed_url.path == "/simulate/500":
            if content_length > 0:
                _ = self.rfile.read(content_length)
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Simulated internal server error"}).encode())
            return

        if parsed_url.path == "/simulate/timeout":
            if content_length > 0:
                _ = self.rfile.read(content_length)
            # Sleep longer than the client's test timeout
            time.sleep(2.0)
            self.send_response(200)
            self.end_headers()
            return

        # 1. Bearer Token Authentication
        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            if content_length > 0:
                _ = self.rfile.read(content_length)
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing bearer token"}).encode())
            return

        token_presented = auth_header[7:].strip()
        if not secrets.compare_digest(token_presented, self.expected_token):
            if content_length > 0:
                _ = self.rfile.read(content_length)
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid ingest token"}).encode())
            return

        # 2. Content-Length & Size Gate
        if content_length > self.max_size_bytes:
            # Drain the socket input so Windows doesn't abort the connection with RST
            _ = self.rfile.read(content_length)
            self.send_response(413)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"error": f"Artifact exceeds maximum size of {self.max_size_bytes} bytes"}
                ).encode()
            )
            return

        # 3. Multipart Form-Data Parsing
        content_type_header = self.headers.get("Content-Type", "")
        if not content_type_header.startswith("multipart/form-data"):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Expected multipart/form-data"}).encode())
            return

        boundary = ""
        for param in content_type_header.split(";"):
            param = param.strip()
            if param.startswith("boundary="):
                boundary = param[9:].strip("\"'")
        if not boundary:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing multipart boundary"}).encode())
            return

        raw_body = self.rfile.read(content_length)

        # Simple multipart parsing
        delimiter = f"--{boundary}".encode()
        parts = raw_body.split(delimiter)

        fields: dict[str, str] = {}
        file_bytes: Optional[bytes] = None
        filename: str = "artifact"

        for part in parts:
            if not part or part == b"--\r\n" or part == b"--":
                continue
            if b"\r\n\r\n" not in part:
                continue
            headers_raw, content = part.split(b"\r\n\r\n", 1)
            # Remove trailing \r\n from content
            if content.endswith(b"\r\n"):
                content = content[:-2]

            headers_str = headers_raw.decode("utf-8", errors="replace")
            if 'name="file"' in headers_str:
                file_bytes = content
                if 'filename="' in headers_str:
                    fn_start = headers_str.index('filename="') + 10
                    fn_end = headers_str.index('"', fn_start)
                    filename = headers_str[fn_start:fn_end]
            else:
                for line in headers_str.split("\r\n"):
                    if 'name="' in line:
                        n_start = line.index('name="') + 6
                        n_end = line.index('"', n_start)
                        field_name = line[n_start:n_end]
                        fields[field_name] = content.decode("utf-8", errors="replace")

        if file_bytes is None or len(file_bytes) == 0:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Empty artifact rejected"}).encode())
            return

        # 4. Workspace Check
        req_workspace = fields.get("workspace", "").strip()
        if req_workspace and req_workspace != self.expected_workspace:
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Workspace mismatch"}).encode())
            return

        # 5. Magic Byte Sniffing (PNG and MP4)
        head = file_bytes[:16]
        is_png = head.startswith(b"\x89PNG\r\n\x1a\n")
        # ISO-BMFF: 'ftyp' at offset 4
        is_mp4 = len(head) >= 8 and head[4:8] == b"ftyp"

        if is_png:
            content_type = "image/png"
            ext = "png"
        elif is_mp4:
            content_type = "video/mp4"
            ext = "mp4"
        else:
            self.send_response(415)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "error": "Unsupported artifact content: not a recognized image, video, or binary payload"
                    }
                ).encode()
            )
            return

        # 6. Isolated Storage
        workspace = req_workspace or self.expected_workspace
        bundle = fields.get("bundle", "test-bundle")
        stored_filename = f"{secrets.token_hex(8)}.{ext}"
        bundle_dir = self.storage_dir / workspace / bundle
        bundle_dir.mkdir(parents=True, exist_ok=True)
        (bundle_dir / stored_filename).write_bytes(file_bytes)

        artifact_id = f"art_{secrets.token_hex(12)}"
        url = f"/api/artifacts/{workspace}/{bundle}/{stored_filename}"

        response_body = {
            "artifactId": artifact_id,
            "url": url,
            "workspace": workspace,
            "bundle": bundle,
            "name": stored_filename,
            "type": content_type,
            "size": len(file_bytes),
        }

        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response_body).encode())


@pytest.fixture
def mock_ingest_server(tmp_path: Path) -> Generator[str, None, None]:
    """Spins up a lightweight mock ingest HTTP server on localhost."""
    storage_dir = tmp_path / "mock_ingest_storage"
    storage_dir.mkdir(parents=True, exist_ok=True)

    MockIngestHandler.expected_token = TEST_TOKEN
    MockIngestHandler.expected_workspace = "default-tenant"
    MockIngestHandler.max_size_bytes = 10 * 1024 * 1024
    MockIngestHandler.storage_dir = storage_dir

    server = http.server.HTTPServer(("127.0.0.1", 0), MockIngestHandler)
    port = server.server_port
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    base_url = f"http://127.0.0.1:{port}"
    yield base_url

    server.shutdown()
    server.server_close()


from PIL import Image


def make_png_artifact(path: Path, width: int = 512, height: int = 512) -> Path:
    """Create a valid PNG file on disk using Pillow."""
    img = Image.new("RGB", (width, height), color=(34, 139, 34))
    img.save(path, format="PNG")
    return path


def make_mp4_artifact(path: Path) -> Path:
    """Create a valid MP4 structure with ftyp box."""
    mp4_bytes = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
    path.write_bytes(mp4_bytes)
    return path


# -----------------------------------------------------------------------------
# 1. Direct Ingest Client (orba_gpu.ingest) against live Mock Ingest Endpoint
# -----------------------------------------------------------------------------


def test_live_mock_image_upload_success(mock_ingest_server: str, tmp_path: Path):
    """Test successful image upload against live mock ingest endpoint."""
    img_path = make_png_artifact(tmp_path / "valid.png")

    result = ingest_artifact(
        ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
        ingest_token=TEST_TOKEN,
        artifact_path=img_path,
        content_type="image/png",
        workspace="default-tenant",
        bundle="bundle-image-01",
    )

    assert result.artifact_id.startswith("art_")
    assert "/api/artifacts/default-tenant/bundle-image-01/" in result.url
    assert result.content_type == "image/png"
    assert result.size_bytes == img_path.stat().st_size


def test_live_mock_video_upload_success(mock_ingest_server: str, tmp_path: Path):
    """Test successful video upload against live mock ingest endpoint."""
    vid_path = make_mp4_artifact(tmp_path / "valid.mp4")

    result = ingest_artifact(
        ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
        ingest_token=TEST_TOKEN,
        artifact_path=vid_path,
        content_type="video/mp4",
        workspace="default-tenant",
        bundle="bundle-video-01",
    )

    assert result.artifact_id.startswith("art_")
    assert "/api/artifacts/default-tenant/bundle-video-01/" in result.url
    assert result.content_type == "video/mp4"
    assert result.size_bytes == vid_path.stat().st_size


def test_live_mock_invalid_authentication(mock_ingest_server: str, tmp_path: Path):
    """Test rejection with HTTP 403 when authentication token is invalid."""
    img_path = make_png_artifact(tmp_path / "valid.png")

    with pytest.raises(IngestError, match="HTTP 403"):
        ingest_artifact(
            ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
            ingest_token="wrong-secret-token",
            artifact_path=img_path,
            content_type="image/png",
            workspace="default-tenant",
            bundle="bundle-01",
        )


def test_live_mock_rejected_unsupported_content(mock_ingest_server: str, tmp_path: Path):
    """Test rejection with HTTP 415 when artifact fails magic byte check."""
    txt_path = tmp_path / "not_an_image.txt"
    txt_path.write_bytes(b"This is just plain text, not a PNG or MP4.")

    with pytest.raises(IngestError, match="HTTP 415"):
        ingest_artifact(
            ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
            ingest_token=TEST_TOKEN,
            artifact_path=txt_path,
            content_type="text/plain",
            workspace="default-tenant",
            bundle="bundle-01",
        )


def test_live_mock_oversized_file_rejected(mock_ingest_server: str, tmp_path: Path):
    """Test rejection with HTTP 413 when artifact exceeds size limit."""
    big_path = tmp_path / "oversized.png"
    # Write slightly more than MockIngestHandler.max_size_bytes (10 MiB)
    big_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * (10 * 1024 * 1024 + 100))

    with pytest.raises(IngestError, match="HTTP 413"):
        ingest_artifact(
            ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
            ingest_token=TEST_TOKEN,
            artifact_path=big_path,
            content_type="image/png",
            workspace="default-tenant",
            bundle="bundle-01",
        )


def test_live_mock_server_error(mock_ingest_server: str, tmp_path: Path):
    """Test server 500 error raises IngestError and does not report success."""
    img_path = make_png_artifact(tmp_path / "valid.png")

    with pytest.raises(IngestError, match="HTTP 500"):
        ingest_artifact(
            ingest_url=f"{mock_ingest_server}/simulate/500",
            ingest_token=TEST_TOKEN,
            artifact_path=img_path,
            content_type="image/png",
            workspace="default-tenant",
            bundle="bundle-01",
        )


# -----------------------------------------------------------------------------
# 2. Worker App End-to-End Delivery and Failure Propagation (_finalize)
# -----------------------------------------------------------------------------


import subprocess


def write_mp4(output_path: Path, width: int = 512, height: int = 512, fps: int = 16, duration: int = 2):
    subprocess.run(
        [
            "ffmpeg",
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
    )


def build_test_worker_client(
    tmp_path: Path,
    ingest_url: str = "",
    ingest_token: str = "",
) -> TestClient:
    """Instantiate the full GPU worker FastAPI application with test configuration."""
    models_path = tmp_path / "models"
    img_dir = models_path / "black-forest-labs" / "FLUX.1-schnell"
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / "config.json").write_text("{}")
    vid_dir = models_path / "Lightricks" / "LTX-Video"
    vid_dir.mkdir(parents=True, exist_ok=True)
    (vid_dir / "model_index.json").write_text("{}")
    (vid_dir / "config.json").write_text("{}")

    settings = Settings(
        backend="diffusers",
        models_dir=str(models_path),
        output_dir=str(tmp_path / "output"),
        token=WORKER_AUTH_TOKEN,
        ingest_url=ingest_url,
        ingest_token=ingest_token,
    )

    manager = ModelManager(
        models_dir=settings.models_dir,
        output_dir=settings.output_dir,
        backend="diffusers",
        image_model_id="black-forest-labs/FLUX.1-schnell",
        video_model_id="Lightricks/LTX-Video",
        image_loader=lambda _: "image-pipeline",
        video_loader=lambda _: "video-pipeline",
    )

    # Injected fake inference that writes a valid verified PNG
    def fake_image_infer(*, output_path: Path, width: int, height: int, **kw):
        make_png_artifact(output_path, width=width, height=height)

    # Injected fake video inference that writes a valid verified MP4
    def fake_video_infer(
        *, output_path: Path, width: int, height: int, fps: int = 16, duration_seconds: int = 2, **kw
    ):
        write_mp4(output_path, width=width, height=height, fps=fps, duration=duration_seconds)

    app = create_app(
        settings=settings,
        manager=manager,
        limiter=GenerationLimiter(1),
        image_infer=fake_image_infer,
        video_infer=fake_video_infer,
        token=WORKER_AUTH_TOKEN,
        gpu_reader=lambda uuid: GpuInfo(
            available=True,
            uuid="GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878",
            name="NVIDIA RTX PRO 6000 Blackwell",
        ),
    )
    return TestClient(app)


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {WORKER_AUTH_TOKEN}"}


def test_app_successful_delivery_propagates_artifact_id_and_url(
    mock_ingest_server: str, tmp_path: Path
):
    """When ingest succeeds, worker response reports delivered_to_production=True

    and populates both artifact_id/artifactId and artifact_url/artifactUrl.
    """
    client = build_test_worker_client(
        tmp_path,
        ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
        ingest_token=TEST_TOKEN,
    )

    resp = client.post("/api/generate/image", json={"prompt": "test prompt"}, headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "COMPLETED"
    assert body["delivered_to_production"] is True
    assert body["ingest_note"] == "delivered to production"

    # Both snake_case and camelCase aliases must be populated
    assert body["artifact_id"].startswith("art_")
    assert body["artifactId"] == body["artifact_id"]
    assert "/api/artifacts/default-tenant/" in body["artifact_url"]
    assert body["artifactUrl"] == body["artifact_url"]
    assert body["artifactPath"] == body["artifact_path"]


def test_app_delivery_failure_is_not_reported_as_delivered(
    mock_ingest_server: str, tmp_path: Path
):
    """When ingest fails (e.g. wrong token 403), delivered_to_production is False

    and artifact_url is empty. The failed delivery is never masked.
    """
    client = build_test_worker_client(
        tmp_path,
        ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
        ingest_token="invalid-token-forbidden",
    )

    resp = client.post("/api/generate/image", json={"prompt": "test prompt"}, headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "COMPLETED"  # Generation on GPU succeeded
    assert body["delivered_to_production"] is False  # Ingest failed
    assert body["artifact_url"] == ""
    assert body["artifactUrl"] == ""
    assert "ingest failed: ingest rejected with HTTP 403" in body["ingest_note"]


def test_app_delivery_server_error_500_is_not_reported_as_delivered(
    mock_ingest_server: str, tmp_path: Path
):
    """When ingest server returns 500, delivered_to_production is False."""
    client = build_test_worker_client(
        tmp_path,
        ingest_url=f"{mock_ingest_server}/simulate/500",
        ingest_token=TEST_TOKEN,
    )

    resp = client.post("/api/generate/image", json={"prompt": "test prompt"}, headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()

    assert body["delivered_to_production"] is False
    assert body["artifact_url"] == ""
    assert "ingest failed: ingest rejected with HTTP 500" in body["ingest_note"]


def test_app_delivery_unconfigured_retains_artifact_locally(tmp_path: Path):
    """When ingest is not configured, delivered_to_production is False with explicit note."""
    client = build_test_worker_client(tmp_path, ingest_url="", ingest_token="")

    resp = client.post("/api/generate/image", json={"prompt": "test prompt"}, headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "COMPLETED"
    assert body["delivered_to_production"] is False
    assert body["artifact_url"] == ""
    assert "ingest not configured" in body["ingest_note"]


def test_app_successful_video_delivery_propagates_artifact_id_and_url(
    mock_ingest_server: str, tmp_path: Path
):
    """When video ingest succeeds, worker response reports delivered_to_production=True
    and populates artifact_id/artifactId and artifact_url/artifactUrl.
    """
    client = build_test_worker_client(
        tmp_path,
        ingest_url=f"{mock_ingest_server}/api/internal/media/ingest",
        ingest_token=TEST_TOKEN,
    )

    resp = client.post(
        "/api/generate/video",
        json={
            "prompt": "a running fox",
            "width": 512,
            "height": 512,
            "duration_seconds": 2,
            "fps": 16,
        },
        headers=auth_headers(),
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "COMPLETED"
    assert body["delivered_to_production"] is True
    assert body["content_type"] == "video/mp4"
    assert body["artifact_id"].startswith("art_")
    assert body["artifactId"] == body["artifact_id"]
    assert "/api/artifacts/default-tenant/" in body["artifact_url"]
    assert body["artifactUrl"] == body["artifact_url"]
    assert body["artifactPath"] == body["artifact_path"]

