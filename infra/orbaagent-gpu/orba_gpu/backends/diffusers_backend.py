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
    """Load a video diffusion pipeline (Wan-AI/Wan2.1-T2V-1.3B, Lightricks/LTX-Video, etc.)."""
    import torch
    from diffusers import DiffusionPipeline

    device = _device()
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    pipeline = None
    import diffusers

    # LTX-Video pipeline loader (Diffusers LTXImageToVideoPipeline or LTXPipeline)
    if "ltx" in model_path.lower():
        ltx_i2v_cls = getattr(diffusers, "LTXImageToVideoPipeline", None)
        if ltx_i2v_cls is not None:
            try:
                pipeline = ltx_i2v_cls.from_pretrained(
                    model_path, torch_dtype=dtype, local_files_only=True
                )
            except Exception:
                pipeline = None

    kandinsky_cls = getattr(diffusers, "Kandinsky6TI2VAPipeline", None)
    if pipeline is None and kandinsky_cls is not None and "kandinsky" in model_path.lower():
        try:
            pipeline = kandinsky_cls.from_pretrained(
                model_path, torch_dtype=dtype, local_files_only=True
            )
        except Exception:
            pipeline = None

    # Generic DiffusionPipeline loader (used for foundation models, Prism, Wan, etc.)
    if pipeline is None:
        pipeline = diffusers.DiffusionPipeline.from_pretrained(
            model_path, torch_dtype=dtype, local_files_only=True
        )

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
    negative_prompt: Optional[str] = None,
    duration_seconds: int = 4,
    fps: int = 16,
    width: int = 768,
    height: int = 768,
    output_path: Path,
    image: Any = None,
    ffmpeg_path: str = "ffmpeg",
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> None:
    """Run video generation and encode the frames and audio to an MP4.

    Supports native joint video-audio models (Kandinsky 6.0, Prism), pure text-to-video (Wan 2.1),
    and genuine image-conditioned video generation (Lightricks LTX-Video).
    """
    import tempfile

    try:
        from diffusers.utils import encode_video
        has_encode_video = True
    except ImportError:
        has_encode_video = False

    from diffusers.utils import export_to_video

    pipeline_class = getattr(pipeline, "_class_name", "") or pipeline.__class__.__name__
    is_ltx = "LTX" in pipeline_class
    is_kandinsky = "Kandinsky" in pipeline_class
    is_wan = "Wan" in pipeline_class or hasattr(pipeline, "vae_scale_factor_temporal")

    if is_ltx:
        effective_fps = 24
        # LTX-Video frame count rule: num_frames must equal k * 8 + 1
        target_frames = max(9, int(round(duration_seconds * effective_fps)))
        rem = (target_frames - 1) % 8
        if rem != 0:
            target_frames = (target_frames - 1 + (8 - rem)) + 1
        # LTX-Video spatial rule: dimensions must be divisible by 32
        width = max(256, (width // 32) * 32)
        height = max(256, (height // 32) * 32)
    elif is_kandinsky:
        target_frames = 121
        effective_fps = 24
    elif is_wan:
        effective_fps = fps
        target_frames = max(1, int(round(duration_seconds * fps)))
        rem = (target_frames - 1) % 4
        if rem != 0:
            target_frames = (target_frames - 1 + (4 - rem)) + 1
        else:
            target_frames = max(1, target_frames)
    else:
        effective_fps = fps
        target_frames = max(1, int(round(duration_seconds * fps)))

    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_frames": target_frames,
    }

    if is_ltx:
        kwargs["num_inference_steps"] = 30
        kwargs["guidance_scale"] = 3.0
        if image is not None:
            if hasattr(image, "resize"):
                kwargs["image"] = image.resize((width, height))
            else:
                kwargs["image"] = image
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
    elif is_kandinsky:
        kwargs["num_inference_steps"] = 10
        kwargs["guidance_scale"] = 1.0
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
    elif is_wan:
        kwargs["num_inference_steps"] = 25
        kwargs["guidance_scale"] = 5.0
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
    elif negative_prompt:
        if getattr(pipeline, "do_classifier_free_guidance", False):
            kwargs["negative_prompt"] = negative_prompt

    total_steps = kwargs.get("num_inference_steps", 25)

    def on_step_end(pipe, step_idx, timestep, callback_kwargs):
        if progress_callback:
            progress_callback(step_idx + 1, total_steps)
        return callback_kwargs

    try:
        call_code = getattr(pipeline.__call__, "__code__", None)
        if call_code and "callback_on_step_end" in call_code.co_varnames:
            kwargs["callback_on_step_end"] = on_step_end
        elif hasattr(pipeline, "callback_on_step_end"):
            kwargs["callback_on_step_end"] = on_step_end
    except Exception:
        pass

    result = pipeline(**kwargs)
    frames = getattr(result, "frames", None)
    if frames is None or len(frames) == 0:
        raise RuntimeError("video pipeline returned no frames")

    if hasattr(frames, "ndim") and frames.ndim == 5:
        frames = frames[0]
    elif isinstance(frames, (list, tuple)) and len(frames) > 0:
        first = frames[0]
        if isinstance(first, (list, tuple)):
            frames = first
        elif hasattr(first, "ndim") and getattr(first, "ndim") == 4 and len(frames) == 1:
            frames = first

    audio = getattr(result, "audio", None)
    audio_sample_rate = getattr(pipeline, "audio_sample_rate", 44100)

    # Resolve ffmpeg executable (fallback to imageio-ffmpeg if system ffmpeg is absent)
    import shutil
    actual_ffmpeg = ffmpeg_path
    if not shutil.which(actual_ffmpeg):
        try:
            import imageio_ffmpeg
            actual_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            actual_ffmpeg = ffmpeg_path

    with tempfile.TemporaryDirectory() as tmp:
        raw_path = os.path.join(tmp, "raw.mp4")
        if has_encode_video and audio is not None:
            try:
                encode_video(
                    frames,
                    raw_path,
                    fps=effective_fps,
                    audio=audio[0][None] if hasattr(audio, "__getitem__") else audio,
                    audio_sample_rate=audio_sample_rate,
                )
            except Exception:
                export_to_video(frames, raw_path, fps=effective_fps)
        else:
            export_to_video(frames, raw_path, fps=effective_fps)

        # Check if raw_path has an audio stream
        has_audio = False
        try:
            ffprobe_exe = actual_ffmpeg.replace("ffmpeg", "ffprobe")
            probe = subprocess.run(
                [ffprobe_exe, "-i", raw_path, "-show_streams", "-select_streams", "a", "-loglevel", "error"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            has_audio = bool(probe.stdout.strip())
        except Exception:
            has_audio = False

        ffmpeg_cmd = [
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
            str(effective_fps),
        ]
        if has_audio:
            ffmpeg_cmd.extend(["-c:a", "aac", "-b:a", "192k"])

        ffmpeg_cmd.append(str(output_path))

        subprocess.run(
            ffmpeg_cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=600,
        )
