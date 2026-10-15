"""Client for the production artifact ingest endpoint.

The GPU host and the production host do NOT share a filesystem, and production
storage is not mounted on the GPU host. Generated artifacts are therefore pushed
to production over HTTPS via a dedicated internal endpoint, authenticated with a
separate secret from the public upload path.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import urllib.error
import urllib.request

INGEST_TIMEOUT_SECONDS = 300


class IngestError(RuntimeError):
    """Raised when ingestion fails. Never converted into a success."""


@dataclass(frozen=True)
class IngestResult:
    artifact_id: str
    url: str
    size_bytes: int
    content_type: str
    workspace: str
    bundle: str


def ingest_artifact(
    *,
    ingest_url: str,
    ingest_token: str,
    artifact_path: Path,
    content_type: str,
    workspace: str,
    bundle: str,
    filename: Optional[str] = None,
    metadata: Optional[dict] = None,
    opener=None,
) -> IngestResult:
    """POST an artifact to the production ingest endpoint.

    Args:
        ingest_url: Full URL of the internal ingest endpoint.
        ingest_token: Dedicated ingest secret (not the public upload token).
        artifact_path: File to upload. Must exist and be non-empty.
        content_type: MIME type of the artifact.
        workspace: Target workspace; must match the server's configured workspace.
        bundle: Bundle grouping for the artifact.
        filename: Optional override for the stored filename.
        metadata: Optional JSON metadata persisted alongside the artifact.
        opener: Injection point for tests; receives an urllib Request.

    Raises:
        IngestError: on any non-2xx response, transport failure, or malformed reply.
    """
    if not ingest_url:
        raise IngestError("MEDIA_INGEST_URL is not configured; cannot deliver the artifact")
    if not ingest_token:
        raise IngestError("MEDIA_INGEST_TOKEN is not configured; cannot authenticate ingest")

    path = Path(artifact_path)
    if not path.exists():
        raise IngestError(f"artifact does not exist: {path.name}")
    if path.stat().st_size <= 0:
        raise IngestError("artifact is empty; refusing to ingest")

    name = filename or path.name
    boundary = "----orbaagent-ingest-boundary"
    body = _build_multipart(
        boundary=boundary,
        name=name,
        content_type=content_type,
        payload=path.read_bytes(),
        fields={"workspace": workspace, "bundle": bundle, "metadata": json.dumps(metadata or {})},
    )

    request = urllib.request.Request(
        ingest_url,
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {ingest_token}",
            "Accept": "application/json",
        },
    )

    send = opener or (lambda req: urllib.request.urlopen(req, timeout=INGEST_TIMEOUT_SECONDS))
    try:
        with send(request) as response:
            status = getattr(response, "status", None) or response.getcode()
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise IngestError(f"ingest rejected with HTTP {exc.code}: {detail}") from exc
    except Exception as exc:
        raise IngestError(f"ingest transport failure: {exc}") from exc

    if status is None or not (200 <= int(status) < 300):
        raise IngestError(f"ingest returned HTTP {status}")

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise IngestError(f"ingest returned an unreadable response: {exc}") from exc

    artifact_id = payload.get("artifactId")
    if not artifact_id:
        raise IngestError("ingest response did not include an artifactId")

    return IngestResult(
        artifact_id=artifact_id,
        url=payload.get("url", ""),
        size_bytes=int(payload.get("size", 0)),
        content_type=payload.get("type", content_type),
        workspace=payload.get("workspace", workspace),
        bundle=payload.get("bundle", bundle),
    )


def _build_multipart(
    *,
    boundary: str,
    name: str,
    content_type: str,
    payload: bytes,
    fields: dict,
) -> bytes:
    parts: list[bytes] = []
    for key, value in fields.items():
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        parts.append(str(value).encode())
        parts.append(b"\r\n")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'.encode()
    )
    parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
    parts.append(payload)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts)
