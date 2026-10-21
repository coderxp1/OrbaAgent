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


def fit_image_to_frame(image, target_w: int, target_h: int):
    """Fit a source image into a target frame without cropping or stretching.

    Scales the image proportionally so it fits entirely inside the target
    frame and centres it on a black canvas of exactly ``target_w x target_h``
    (letterbox / pillarbox padding). The previous behaviour resized the
    source directly to the target dimensions, which stretched faces and
    bodies whenever the source aspect ratio differed from the requested
    output ratio (e.g. a landscape photo forced into a 9:16 vertical video).
    """
    from PIL import Image

    image = image.convert("RGB")
    if image.size == (target_w, target_h):
        return image
    scale = min(target_w / image.width, target_h / image.height)
    new_w = max(1, round(image.width * scale))
    new_h = max(1, round(image.height * scale))
    resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (target_w, target_h), (0, 0, 0))
    canvas.paste(resized, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas


def load_image_to_video_pipeline(model_path: str):
    """Load an image-to-video diffusion pipeline (Lightricks/LTX-Video)."""
    import torch
    import diffusers

    device = _device()
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    # LTX-Video official Diffusers classes
    pipeline_cls = getattr(diffusers, "LTXImageToVideoPipeline", None)
    if pipeline_cls is None:
        pipeline_cls = getattr(diffusers, "LTXPipeline", None)
    if pipeline_cls is None:
        pipeline_cls = getattr(diffusers, "DiffusionPipeline", None)

    if pipeline_cls is None:
        raise RuntimeError("No compatible diffusers pipeline class found for LTX-Video")

    pipeline = pipeline_cls.from_pretrained(
        model_path,
        torch_dtype=dtype,
        local_files_only=True,
    )
    pipeline = pipeline.to(device)
    try:
        pipeline.enable_attention_slicing()
    except Exception:
        pass
    return pipeline


def load_text_to_video_pipeline(model_path: str):
    """Load an LTX text-to-video diffusion pipeline (Lightricks/LTX-Video)."""
    import torch
    import diffusers

    device = _device()
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    t2v_cls = getattr(diffusers, "LTXPipeline", None)
    if t2v_cls is None:
        t2v_cls = getattr(diffusers, "DiffusionPipeline", None)

    if t2v_cls is None:
        raise RuntimeError("No compatible diffusers pipeline class found for LTX text-to-video")

    pipeline = t2v_cls.from_pretrained(
        model_path,
        torch_dtype=dtype,
        local_files_only=True,
    )

    pipeline = pipeline.to(device)
    try:
        pipeline.enable_attention_slicing()
    except Exception:
        pass
    return pipeline


def load_video_pipeline(model_path: str, model_type: str = "auto"):
    """Load an LTX-Video diffusion pipeline (Image-to-Video or Text-to-Video)."""
    if model_type == "image-to-video":
        return load_image_to_video_pipeline(model_path)
    return load_text_to_video_pipeline(model_path)


def run_image_to_video_inference(
    *,
    pipeline,
    prompt: str,
    image: Any,
    negative_prompt: Optional[str] = None,
    duration_seconds: int = 4,
    fps: int = 24,
    width: int = 768,
    height: int = 768,
    output_path: Path,
    ffmpeg_path: str = "ffmpeg",
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> None:
    """Run genuine neural image-conditioned video inference (LTX-Video).

    Accepts a validated source image and motion prompt, conditions the diffusion process
    on the image latents, and generates new video frames.
    Does NOT substitute FFmpeg zoom, pan, brightness breathing, or any still-image animation.
    """
    if image is None:
        raise ValueError("Image-to-video inference requires a valid conditioning image")

    from PIL import Image

    if not isinstance(image, Image.Image):
        raise TypeError(f"Conditioning image must be a PIL Image instance, got {type(image)}")

    # Ensure RGB color space
    image = image.convert("RGB")

    # LTX-Video spatial constraint: dimensions must be divisible by 32
    target_w = max(256, (width // 32) * 32)
    target_h = max(256, (height // 32) * 32)
    # Preserve the source composition: proportional fit + padding, never a
    # direct stretch to the target frame and never a centre crop.
    resized_image = fit_image_to_frame(image, target_w, target_h)

    # LTX-Video temporal constraint: num_frames must equal k * 8 + 1
    effective_fps = 24
    target_frames = max(9, int(round(duration_seconds * effective_fps)))
    rem = (target_frames - 1) % 8
    if rem != 0:
        target_frames = (target_frames - 1 + (8 - rem)) + 1

    kwargs = {
        "image": resized_image,
        "prompt": prompt,
        "width": target_w,
        "height": target_h,
        "num_frames": target_frames,
        "frame_rate": effective_fps,
        "num_inference_steps": 30,
        "guidance_scale": 3.0,
    }
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt

    total_steps = kwargs["num_inference_steps"]

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
        raise RuntimeError("Image-to-video pipeline returned no frames")

    _export_and_encode_video(
        pipeline=pipeline,
        frames=frames,
        result=result,
        effective_fps=effective_fps,
        output_path=output_path,
        ffmpeg_path=ffmpeg_path,
    )


def run_text_to_video_inference(
    *,
    pipeline,
    prompt: str,
    negative_prompt: Optional[str] = None,
    duration_seconds: int = 4,
    fps: int = 24,
    width: int = 768,
    height: int = 768,
    output_path: Path,
    ffmpeg_path: str = "ffmpeg",
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> None:
    """Run genuine neural text-to-video inference using LTX-Video."""
    # LTX-Video spatial constraint: divisible by 32
    target_w = max(256, (width // 32) * 32)
    target_h = max(256, (height // 32) * 32)

    # LTX-Video temporal constraint: num_frames = k * 8 + 1 at 24 FPS
    effective_fps = 24
    target_frames = max(9, int(round(duration_seconds * effective_fps)))
    rem = (target_frames - 1) % 8
    if rem != 0:
        target_frames = (target_frames - 1 + (8 - rem)) + 1

    kwargs = {
        "prompt": prompt,
        "width": target_w,
        "height": target_h,
        "num_frames": target_frames,
        "frame_rate": effective_fps,
        "num_inference_steps": 30,
        "guidance_scale": 3.0,
    }
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt

    total_steps = kwargs["num_inference_steps"]

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
        raise RuntimeError("LTX text-to-video pipeline returned no frames")

    _export_and_encode_video(
        pipeline=pipeline,
        frames=frames,
        result=result,
        effective_fps=effective_fps,
        output_path=output_path,
        ffmpeg_path=ffmpeg_path,
    )


def run_video_inference(
    *,
    pipeline,
    prompt: str,
    negative_prompt: Optional[str] = None,
    duration_seconds: int = 4,
    fps: int = 24,
    width: int = 768,
    height: int = 768,
    output_path: Path,
    image: Any = None,
    ffmpeg_path: str = "ffmpeg",
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> None:
    """Run video inference, dispatching to genuine Image-to-Video or Text-to-Video."""
    if image is not None:
        return run_image_to_video_inference(
            pipeline=pipeline,
            prompt=prompt,
            image=image,
            negative_prompt=negative_prompt,
            duration_seconds=duration_seconds,
            fps=24,
            width=width,
            height=height,
            output_path=output_path,
            ffmpeg_path=ffmpeg_path,
            progress_callback=progress_callback,
        )

    return run_text_to_video_inference(
        pipeline=pipeline,
        prompt=prompt,
        negative_prompt=negative_prompt,
        duration_seconds=duration_seconds,
        fps=24,
        width=width,
        height=height,
        output_path=output_path,
        ffmpeg_path=ffmpeg_path,
        progress_callback=progress_callback,
    )


def _export_and_encode_video(
    *,
    pipeline: Any,
    frames: Any,
    result: Any,
    effective_fps: int,
    output_path: Path,
    ffmpeg_path: str = "ffmpeg",
) -> None:
    """Helper to convert pipeline frames to an MP4 artifact using ffmpeg."""
    import tempfile

    try:
        from diffusers.utils import encode_video
        has_encode_video = True
    except ImportError:
        has_encode_video = False

    from diffusers.utils import export_to_video

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
