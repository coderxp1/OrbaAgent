"""Worker duration tolerance (gap G3).

The worker's validate_video previously allowed ±max(1.5s, 35%), so a
~3.4s clip passed validation for a 5s request. The tolerance is now
aligned with the application-side contract: max(1.0s, 20%).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from orba_gpu.validation import validate_video


def _runner(duration: float, width: int = 704, height: int = 1280):
    payload = {
        "streams": [
            {
                "width": width,
                "height": height,
                "avg_frame_rate": "24/1",
                "duration": str(duration),
            }
        ],
        "format": {"duration": str(duration)},
    }

    def run(cmd):  # noqa: ANN001, ANN202
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")

    return run


def _clip(tmp_path: Path) -> Path:
    p = tmp_path / "clip.mp4"
    p.write_bytes(b"\x00" * 2048)
    return p


def test_short_clip_now_fails_validation(tmp_path):
    # 3.4s delivered for a 5s request: deviation 1.6s — passed under the
    # old ±max(1.5s, 35%) = 1.75s tolerance, must fail now.
    result = validate_video(
        _clip(tmp_path),
        expected_duration_seconds=5,
        expected_width=704,
        expected_height=1280,
        runner=_runner(3.4),
    )
    assert not result.ok
    assert "duration" in (result.error or "")


def test_frame_quantized_duration_passes(tmp_path):
    # LTX frame quantization: 121 frames @ 24fps = 5.04s for a 5s ask.
    result = validate_video(
        _clip(tmp_path),
        expected_duration_seconds=5,
        expected_width=704,
        expected_height=1280,
        runner=_runner(5.04),
    )
    assert result.ok, result.error


def test_exact_duration_passes(tmp_path):
    result = validate_video(
        _clip(tmp_path),
        expected_duration_seconds=5,
        expected_width=704,
        expected_height=1280,
        runner=_runner(5.0),
    )
    assert result.ok, result.error
