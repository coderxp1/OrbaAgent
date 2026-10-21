"""Focused LTX-Video T2V/I2V media-contract checks (no GPU, mocked pipeline).

These prove the parameters that reach the diffusers pipeline:
  * vertical 9:16 dims survive validation and rounding (576x1024),
  * T2V never receives an ``image`` kwarg,
  * I2V receives a real PIL conditioning image at 576x1024 and its
    source-image content (corner colours) is preserved through resize.

They do NOT prove model quality; that requires the GPU smoke test.
"""

from PIL import Image, ImageDraw
from unittest.mock import MagicMock, patch

import numpy as np

from orba_gpu.backends.diffusers_backend import (
    run_image_to_video_inference,
    run_text_to_video_inference,
)

W, H = 576, 1024  # exact 9:16, both divisible by 32


def _result():
    result = MagicMock()
    result.frames = [[np.zeros((64, 64, 3), dtype=np.uint8)]]
    return result


def _quadrant_image():
    img = Image.new("RGB", (W, H), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W // 2, H // 2), fill=(255, 0, 0))       # TL red
    draw.rectangle((W // 2, 0, W, H // 2), fill=(0, 255, 0))       # TR green
    draw.rectangle((0, H // 2, W // 2, H), fill=(0, 0, 255))       # BL blue
    draw.rectangle((W // 2, H // 2, W, H), fill=(255, 255, 0))     # BR yellow
    return img


def test_t2v_vertical_9x16_has_no_image_conditioning(tmp_path):
    pipeline = MagicMock(return_value=_result())

    with patch("orba_gpu.backends.diffusers_backend._export_and_encode_video"):
        run_text_to_video_inference(
            pipeline=pipeline,
            prompt="a vertical drone shot over a canyon",
            duration_seconds=2,
            fps=16,
            width=W,
            height=H,
            output_path=tmp_path / "t2v.mp4",
        )

    kwargs = pipeline.call_args.kwargs
    assert "image" not in kwargs
    assert kwargs["width"] == W and kwargs["height"] == H
    assert kwargs["width"] * 16 == kwargs["height"] * 9
    assert kwargs["width"] % 32 == 0 and kwargs["height"] % 32 == 0
    assert (kwargs["num_frames"] - 1) % 8 == 0


def test_i2v_landscape_photo_into_vertical_frame_is_letterboxed_not_stretched_or_cropped(tmp_path):
    """Regression for the reported bug: a landscape photo requested as a
    vertical video had its subject stretched/cropped into 9:16.

    The conditioning image must be proportionally scaled to fit inside the
    vertical frame with black padding above/below: no stretch (the top of
    the frame would carry image content), no centre crop (the left/right
    halves would be cut away)."""
    pipeline = MagicMock(return_value=_result())

    # Landscape source: left half red, right half green.
    src = Image.new("RGB", (1024, 576), (255, 0, 0))
    draw = ImageDraw.Draw(src)
    draw.rectangle((512, 0, 1024, 576), fill=(0, 255, 0))

    with patch("orba_gpu.backends.diffusers_backend._export_and_encode_video"):
        run_image_to_video_inference(
            pipeline=pipeline,
            prompt="the person in this photo smiles and waves",
            image=src,
            duration_seconds=2,
            width=W,
            height=H,
            output_path=tmp_path / "i2v_letterbox.mp4",
        )

    cond = pipeline.call_args.kwargs["image"]
    assert cond.size == (W, H)
    # Padding bands carry no image content (proves no stretch to fill).
    assert cond.getpixel((W // 2, 5)) == (0, 0, 0)
    assert cond.getpixel((W // 2, H - 5)) == (0, 0, 0)
    # Both halves of the source survive in the middle band (proves no crop).
    mid_y = H // 2
    assert cond.getpixel((10, mid_y)) == (255, 0, 0)
    assert cond.getpixel((W - 10, mid_y)) == (0, 255, 0)


def test_i2v_vertical_9x16_preserves_source_content(tmp_path):
    pipeline = MagicMock(return_value=_result())

    with patch("orba_gpu.backends.diffusers_backend._export_and_encode_video"):
        run_image_to_video_inference(
            pipeline=pipeline,
            prompt="the subject turns their head and blinks",
            image=_quadrant_image(),
            duration_seconds=2,
            width=W,
            height=H,
            output_path=tmp_path / "i2v.mp4",
        )

    kwargs = pipeline.call_args.kwargs
    assert "image" in kwargs
    cond = kwargs["image"]
    assert isinstance(cond, Image.Image)
    assert cond.size == (W, H)
    assert kwargs["width"] == W and kwargs["height"] == H
    assert kwargs["width"] * 16 == kwargs["height"] * 9

    # Content (not just dimensions) survives: the four source colours remain
    # in their respective quadrants after the resize.
    for point, expected in (
        ((10, 10), (255, 0, 0)),
        ((W - 10, 10), (0, 255, 0)),
        ((10, H - 10), (0, 0, 255)),
        ((W - 10, H - 10), (255, 255, 0)),
    ):
        got = cond.getpixel(point)
        assert all(abs(a - b) <= 3 for a, b in zip(got, expected)), (point, got, expected)
