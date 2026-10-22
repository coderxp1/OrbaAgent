"""MOVA video backend: delegates inference to the MOVA service over HTTP.

Design rules (same as the rest of this worker):

* Fail closed. If the MOVA service is unreachable, reports a different model
  revision than the pinned one, or returns an error/empty body, generation
  raises. There is NO fallback to WAN, LTX, or any other backend — a MOVA
  failure is a user-visible error, never a silently different video.
* The service is verified at construction: it must answer /health with the
  pinned model id + revision and confirm the checkpoint is present on disk.
  Only then does the model manager report the video slot as loaded.
* The model is never downloaded per request; the service mounts the pinned
  checkpoint read-only and loads it in its own process.

MOVA specifics:
* Native rate is 24 fps; frame counts follow the 8k+1 lattice
  (49 frames = 2.04 s, 121 = 5.04 s, 193 = 8.04 s, 241 = 10.04 s). The
  worker's duration validation tolerance absorbs the <=0.05 s overshoot,
  and the app-side finalizer reports the measured duration honestly.
* Text-to-video requests use MOVA's documented T2VA convention: a pure
  white image as the reference (first) frame.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from ..config import MOVA_MODEL_ID, MOVA_MODEL_REVISION

logger = logging.getLogger(__name__)

MOVA_NATIVE_FPS = 24

#: (method, url, json_body_or_None, headers, timeout) -> (status, headers, body)
HttpOpener = Callable[
    [str, str, Optional[dict], dict, float], "tuple[int, dict, bytes]"
]


class MovaServiceError(RuntimeError):
    """The MOVA service failed or returned an unusable result."""


@dataclass(frozen=True)
class MovaConfig:
    service_url: str
    token: str = ""
    model_id: str = MOVA_MODEL_ID
    model_revision: str = MOVA_MODEL_REVISION
    offload: str = "cpu"
    steps: int = 50
    timeout_seconds: int = 14400  # measured-latency default; see config.py
    attn_type: str = "fa"


def frames_for_duration(duration_seconds: float, fps: int = MOVA_NATIVE_FPS) -> int:
    """Map a duration to MOVA's 8k+1 frame lattice at its native rate."""
    target = max(17, int(round(duration_seconds * fps)))
    k = round((target - 1) / 8)
    return max(17, min(241, 8 * k + 1))


def _default_opener(
    method: str,
    url: str,
    json_body: Optional[dict],
    headers: dict,
    timeout: float,
) -> "tuple[int, dict, bytes]":
    data = None
    req_headers = dict(headers)
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers or {}), exc.read()


class MovaBackend:
    """A video 'pipeline' whose generate_video() calls the MOVA service."""

    def __init__(self, config: MovaConfig, opener: Optional[HttpOpener] = None) -> None:
        self._config = config
        self._opener = opener or _default_opener
        self._base = config.service_url.rstrip("/")
        self._verify_service()

    # -- service verification -------------------------------------------

    def _headers(self) -> dict:
        headers = {}
        if self._config.token:
            headers["Authorization"] = f"Bearer {self._config.token}"
        return headers

    def _verify_service(self) -> None:
        try:
            status, _headers, body = self._opener(
                "GET", f"{self._base}/health", None, self._headers(), 30
            )
        except Exception as exc:
            raise MovaServiceError(
                f"MOVA service at {self._base} is unreachable: {exc}"
            ) from exc
        if status != 200:
            raise MovaServiceError(
                f"MOVA service health check failed with HTTP {status}"
            )
        try:
            health = json.loads(body.decode("utf-8"))
        except Exception as exc:
            raise MovaServiceError("MOVA service health response was not JSON") from exc
        if health.get("model_id") != self._config.model_id:
            raise MovaServiceError(
                f"MOVA service reports model '{health.get('model_id')}', "
                f"expected '{self._config.model_id}'"
            )
        if health.get("model_revision") != self._config.model_revision:
            raise MovaServiceError(
                f"MOVA service reports revision '{health.get('model_revision')}', "
                f"expected pinned revision '{self._config.model_revision}'"
            )
        if not health.get("ckpt_present"):
            raise MovaServiceError(
                "MOVA service reports the model checkpoint is not present"
            )
        logger.info(
            "MOVA service verified at %s (model %s @ %s)",
            self._base,
            self._config.model_id,
            self._config.model_revision[:12],
        )

    # -- generation -------------------------------------------------------

    def generate_video(
        self,
        *,
        prompt: str,
        negative_prompt: Optional[str] = None,
        width: int = 1280,
        height: int = 720,
        steps: int = 0,
        seed: int = 1,
        output_format: str = "mp4",
        output_path: str,
        duration_seconds: Optional[float] = None,
        fps: Optional[int] = None,
        image: Any = None,
    ) -> bool:
        if (output_format or "mp4").lower() != "mp4":
            raise MovaServiceError(
                f"MOVA backend produces mp4 only, got '{output_format}'"
            )
        duration = float(duration_seconds or 5)
        num_frames = frames_for_duration(duration)

        if image is not None:
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            ref_png = buffer.getvalue()
            mode = "image-to-video"
        else:
            # MOVA T2VA convention: a pure white reference frame.
            from PIL import Image

            buffer = io.BytesIO()
            Image.new("RGB", (int(width), int(height)), "white").save(
                buffer, format="PNG"
            )
            ref_png = buffer.getvalue()
            mode = "text-to-video (white reference frame)"
        logger.info(
            "MOVA generate_video: mode=%s frames=%d (%0.2fs @ %dfps) %dx%d",
            mode,
            num_frames,
            num_frames / MOVA_NATIVE_FPS,
            MOVA_NATIVE_FPS,
            width,
            height,
        )

        payload = {
            "prompt": prompt,
            "negative_prompt": negative_prompt or "",
            "ref_image_b64": base64.b64encode(ref_png).decode("ascii"),
            "num_frames": num_frames,
            "fps": MOVA_NATIVE_FPS,
            "width": int(width),
            "height": int(height),
            "seed": int(seed),
            "num_inference_steps": int(steps) if steps and steps > 0 else self._config.steps,
            "offload": self._config.offload,
            "attn_type": self._config.attn_type,
        }
        try:
            status, headers, body = self._opener(
                "POST",
                f"{self._base}/generate",
                payload,
                self._headers(),
                float(self._config.timeout_seconds),
            )
        except Exception as exc:
            raise MovaServiceError(f"MOVA generation request failed: {exc}") from exc
        if status != 200:
            detail = body.decode("utf-8", errors="replace")[:1000]
            raise MovaServiceError(
                f"MOVA service returned HTTP {status}: {detail}"
            )
        if not body:
            raise MovaServiceError("MOVA service returned an empty video body")

        target = Path(output_path)
        tmp = target.with_suffix(".mova.tmp")
        tmp.write_bytes(body)
        if tmp.stat().st_size == 0:
            tmp.unlink(missing_ok=True)
            raise MovaServiceError("MOVA service returned a zero-byte video")
        os.replace(tmp, target)
        logger.info("MOVA video written: %s (%d bytes)", target, target.stat().st_size)
        return True
