"""HuggingFace diffusers backend.

Imported lazily so the worker and its unit tests do not need ``torch`` installed,
and so a missing/incompatible CUDA stack surfaces as a clear model-load error
rather than an import-time crash.

Device selection: the container is pinned to a single GPU via
``NVIDIA_VISIBLE_DEVICES=<uuid>`` + ``CUDA_VISIBLE_DEVICES=0``, so it sees exactly
one device and ``cuda:0`` inside the container is GPU 1 on the host. GPU 0 is not
present in this container's device namespace at all.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Optional

#: Text encoder cap for FLUX.1-schnell.
MAX_SEQUENCE_LENGTH = 256


def _torch():
    import torch  # imported here so the module can be imported without torch

    return torch


def _device() -> str:
    torch = _torch()
    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA is unavailable in the media worker; CPU fallback is disabled"
        )
    return "cuda"


def load_image_pipeline(model_path: str):
    """Load a text-to-image diffusion pipeline.

    Uses bfloat16 on CUDA. The pipeline is returned to the ModelManager, which
    caches it so the weights are read once per process.
    """
    import torch
    from diffusers import FluxPipeline

    device = _device()
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    pipeline = FluxPipeline.from_pretrained(model_path, torch_dtype=dtype, local_files_only=True)
    pipeline = pipeline.to(device)

    # Reduce peak VRAM; harmless when the optimisation is unavailable.
    try:
        pipeline.enable_attention_slicing()
    except Exception:
        pass

    return pipeline


def run_image_inference(
    *,
    pipeline,
    prompt: str,
    negative_prompt: Optional[str],
    width: int,
    height: int,
    steps: int,
    seed: Optional[int],
    output_path: Path,
) -> None:
    """Run one image generation and write the result to ``output_path``.

    Deterministic when ``seed`` is provided. ``negative_prompt`` is applied only
    when the pipeline advertises classifier-free guidance; FLUX.1-schnell is a
    guidance-distilled model that does not use it, in which case the parameter is
    ignored rather than silently changing the schedule.
    """
    torch = _torch()
    device = _device()

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu" if device == "cpu" else "cuda")
        generator.manual_seed(int(seed))

    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "max_sequence_length": MAX_SEQUENCE_LENGTH,
    }
    if generator is not None:
        kwargs["generator"] = generator

    # Only pass negative_prompt when the pipeline actually supports guidance.
    if negative_prompt and getattr(pipeline, "do_classifier_free_guidance", False):
        kwargs["negative_prompt"] = negative_prompt

    result = pipeline(**kwargs)
    images = getattr(result, "images", None)
    # Explicit None/length check: avoids 'truth value of array is ambiguous'
    # when a backend returns numpy arrays instead of PIL Images.
    if images is None or len(images) == 0:
        raise RuntimeError("diffusion pipeline returned no images")

    image = images[0]
    suffix = output_path.suffix.lower().lstrip(".") or "png"
    image.save(output_path, format="PNG" if suffix == "png" else suffix.upper())


def load_video_pipeline(model_path: str):
    """Load a text-to-video diffusion pipeline."""
    import torch
    from diffusers import DiffusionPipeline

    device = _device()
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    pipeline = DiffusionPipeline.from_pretrained(model_path, torch_dtype=dtype, local_files_only=True)
    pipeline = pipeline.to(device)
    try:
        pipeline.enable_attention_slicing()
    except Exception:
        pass
    return pipeline


def run_video_inference(
    *,
    pipeline,
    prompt: str,
    negative_prompt: Optional[str],
    duration_seconds: int,
    fps: int,
    width: int,
    height: int,
    output_path: Path,
    ffmpeg_path: str = "ffmpeg",
) -> None:
    """Run video generation and encode the frames to an MP4.

    Frames are written as PNGs and muxed with ffmpeg so the output has an exact
    frame rate and duration, which is what the validator checks.
    """
    import tempfile

    from diffusers.utils import export_to_video

    target_frames = max(1, int(round(duration_seconds * fps)))

    # Wan architecture uses 4x temporal compression, requiring (num_frames - 1) % 4 == 0 (4N + 1).
    if getattr(pipeline, "_class_name", "") == "WanPipeline" or hasattr(pipeline, "vae_scale_factor_temporal"):
        target_frames = max(1, ((target_frames - 1) // 4) * 4 + 1)

    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_frames": target_frames,
    }
    if negative_prompt:
        if getattr(pipeline, "do_classifier_free_guidance", False) or getattr(pipeline, "_class_name", "") == "WanPipeline":
            kwargs["negative_prompt"] = negative_prompt
            if getattr(pipeline, "_class_name", "") == "WanPipeline":
                kwargs.setdefault("guidance_scale", 5.0)

    result = pipeline(**kwargs)
    frames = getattr(result, "frames", None)
    # Explicit None/length check: avoids 'truth value of array is ambiguous'
    # when Wan (or any future pipeline) returns a numpy array instead of a list.
    if frames is None or len(frames) == 0:
        raise RuntimeError("video pipeline returned no frames")
    # Wan pipeline may return frames with a leading batch dimension:
    #   result.frames: List[List[PIL.Image]] or ndarray of shape (B, T, H, W, C)
    # Check type and shape carefully before unwrapping to ensure we do not
    # accidentally drop frames if the return is already a flat list or 4D array.
    if hasattr(frames, "ndim") and frames.ndim == 5:
        # 5D ndarray: (B, T, H, W, C) -> take first batch sequence (T, H, W, C)
        frames = frames[0]
    elif isinstance(frames, (list, tuple)) and len(frames) > 0:
        first = frames[0]
        if isinstance(first, (list, tuple)):
            # Nested list: [[frame_0, frame_1, ...]] -> take first batch sequence
            frames = first
        elif hasattr(first, "ndim") and getattr(first, "ndim") == 4 and len(frames) == 1:
            # List containing a single 4D array (T, H, W, C)
            frames = first
        # Otherwise: already a flat sequence of frames (List[PIL.Image] or List[ndarray(H,W,C)]), keep intact.

    # Resolve ffmpeg executable (fallback to imageio-ffmpeg if system ffmpeg is absent)
    import shutil
    actual_ffmpeg = ffmpeg_path
    if not shutil.which(actual_ffmpeg):
        try:
            import imageio_ffmpeg
            actual_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            actual_ffmpeg = ffmpeg_path

    # export_to_video writes an mp4 at the given fps using imageio-ffmpeg.
    with tempfile.TemporaryDirectory() as tmp:
        raw_path = os.path.join(tmp, "raw.mp4")
        export_to_video(frames, raw_path, fps=fps)

        # Re-encode to guarantee the container/format ffprobe expects.
        subprocess.run(
            [
                actual_ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-i",
                raw_path,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-r",
                str(fps),
                str(output_path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=600,
        )
