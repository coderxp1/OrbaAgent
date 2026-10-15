"""Tests for the authenticated artifact ingest client."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from orba_gpu.ingest import IngestError, ingest_artifact

TOKEN = "ingest-token-that-is-long-enough-123456"
URL = "https://orbaagent.dev/api/internal/media/ingest"


class FakeResponse(io.BytesIO):
    def __init__(self, payload: dict, status: int = 201):
        super().__init__(json.dumps(payload).encode())
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def make_artifact(tmp_path: Path, content: bytes = b"\x89PNG\r\n\x1a\nfake") -> Path:
    p = tmp_path / "generated.png"
    p.write_bytes(content)
    return p


def opener_returning(payload: dict, status: int = 201):
    calls = []

    def opener(request):
        calls.append(request)
        return FakeResponse(payload, status=status)

    opener.calls = calls  # type: ignore[attr-defined]
    return opener


def test_successful_ingest_returns_canonical_id(tmp_path):
    artifact = make_artifact(tmp_path)
    opener = opener_returning(
        {"artifactId": "abc123", "url": "/api/artifacts/w/b/f.png", "size": 12, "type": "image/png"}
    )

    result = ingest_artifact(
        ingest_url=URL,
        ingest_token=TOKEN,
        artifact_path=artifact,
        content_type="image/png",
        workspace="default-tenant",
        bundle="job_1",
        opener=opener,
    )

    assert result.artifact_id == "abc123"
    assert result.url == "/api/artifacts/w/b/f.png"
    assert result.workspace == "default-tenant"


def test_request_carries_bearer_auth_and_multipart(tmp_path):
    artifact = make_artifact(tmp_path)
    opener = opener_returning({"artifactId": "x"})

    ingest_artifact(
        ingest_url=URL,
        ingest_token=TOKEN,
        artifact_path=artifact,
        content_type="image/png",
        workspace="default-tenant",
        bundle="job_1",
        opener=opener,
    )

    request = opener.calls[0]  # type: ignore[attr-defined]
    assert request.get_header("Authorization") == f"Bearer {TOKEN}"
    assert "multipart/form-data" in request.get_header("Content-type")
    body = request.data
    assert b'name="workspace"' in body
    assert b"default-tenant" in body
    assert b'name="file"; filename="generated.png"' in body


def test_missing_url_is_rejected(tmp_path):
    with pytest.raises(IngestError, match="MEDIA_INGEST_URL"):
        ingest_artifact(
            ingest_url="",
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
        )


def test_missing_token_is_rejected(tmp_path):
    with pytest.raises(IngestError, match="MEDIA_INGEST_TOKEN"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token="",
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
        )


def test_missing_artifact_is_rejected(tmp_path):
    with pytest.raises(IngestError, match="does not exist"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=tmp_path / "nope.png",
            content_type="image/png",
            workspace="w",
            bundle="b",
        )


def test_empty_artifact_is_rejected(tmp_path):
    empty = tmp_path / "empty.png"
    empty.write_bytes(b"")
    with pytest.raises(IngestError, match="empty"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=empty,
            content_type="image/png",
            workspace="w",
            bundle="b",
        )


def test_http_error_is_surfaced(tmp_path):
    import urllib.error

    def opener(request):
        raise urllib.error.HTTPError(URL, 413, "Too Large", {}, io.BytesIO(b"too big"))

    with pytest.raises(IngestError, match="HTTP 413"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=opener,
        )


def test_transport_failure_is_surfaced(tmp_path):
    def opener(request):
        raise ConnectionError("network unreachable")

    with pytest.raises(IngestError, match="transport failure"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=opener,
        )


def test_response_without_artifact_id_is_a_failure(tmp_path):
    opener = opener_returning({"ok": True})
    with pytest.raises(IngestError, match="did not include an artifactId"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=opener,
        )


def test_unreadable_response_is_a_failure(tmp_path):
    def opener(request):
        return FakeResponse({"x": 1}, status=201)

    # Corrupt the payload after construction.
    def bad_opener(request):
        resp = FakeResponse({}, status=201)
        resp = io.BytesIO(b"not json at all")
        resp.status = 201  # type: ignore[attr-defined]
        return resp

    with pytest.raises(IngestError, match="unreadable response"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=bad_opener,
        )


def test_video_mp4_successful_ingest(tmp_path):
    video_path = tmp_path / "generated.mp4"
    # Minimal ISO-BMFF header with 'ftyp' box
    video_path.write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 32)
    opener = opener_returning(
        {
            "artifactId": "vid_art_999",
            "url": "/api/artifacts/w/b/video.mp4",
            "size": 48,
            "type": "video/mp4",
            "workspace": "default-tenant",
            "bundle": "job_vid_1",
        }
    )

    result = ingest_artifact(
        ingest_url=URL,
        ingest_token=TOKEN,
        artifact_path=video_path,
        content_type="video/mp4",
        workspace="default-tenant",
        bundle="job_vid_1",
        opener=opener,
    )

    assert result.artifact_id == "vid_art_999"
    assert result.url == "/api/artifacts/w/b/video.mp4"
    assert result.content_type == "video/mp4"
    assert result.workspace == "default-tenant"
    assert result.bundle == "job_vid_1"


def test_invalid_auth_401_and_403_raise_ingest_error(tmp_path):
    import urllib.error

    def unauthorized_opener(request):
        raise urllib.error.HTTPError(URL, 401, "Unauthorized", {}, io.BytesIO(b"missing token"))

    with pytest.raises(IngestError, match="HTTP 401"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=unauthorized_opener,
        )

    def forbidden_opener(request):
        raise urllib.error.HTTPError(URL, 403, "Forbidden", {}, io.BytesIO(b"invalid token"))

    with pytest.raises(IngestError, match="HTTP 403"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=forbidden_opener,
        )


def test_rejected_content_415_raises_ingest_error(tmp_path):
    import urllib.error

    def unsupported_opener(request):
        raise urllib.error.HTTPError(
            URL, 415, "Unsupported Media Type", {}, io.BytesIO(b"unrecognized content")
        )

    with pytest.raises(IngestError, match="HTTP 415"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="text/plain",
            workspace="w",
            bundle="b",
            opener=unsupported_opener,
        )


def test_server_errors_500_and_503_raise_ingest_error(tmp_path):
    import urllib.error

    def server_error_opener(request):
        raise urllib.error.HTTPError(
            URL, 500, "Internal Server Error", {}, io.BytesIO(b"storage failure")
        )

    with pytest.raises(IngestError, match="HTTP 500"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=server_error_opener,
        )

    def service_unavailable_opener(request):
        raise urllib.error.HTTPError(
            URL, 503, "Service Unavailable", {}, io.BytesIO(b"ingest unconfigured")
        )

    with pytest.raises(IngestError, match="HTTP 503"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=service_unavailable_opener,
        )


def test_socket_timeout_raises_ingest_error(tmp_path):
    import socket
    import urllib.error

    def timeout_opener(request):
        raise urllib.error.URLError(socket.timeout("timed out"))

    with pytest.raises(IngestError, match="transport failure"):
        ingest_artifact(
            ingest_url=URL,
            ingest_token=TOKEN,
            artifact_path=make_artifact(tmp_path),
            content_type="image/png",
            workspace="w",
            bundle="b",
            opener=timeout_opener,
        )

