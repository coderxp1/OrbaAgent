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
