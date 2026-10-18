#!/usr/bin/env python3
"""Isolated Generation Smoke Test on GPU 1 (RTX PRO 6000 Blackwell).

Tests FLUX.1-schnell and Lightricks LTX-Video locally against the promoted paths in
/models without downloading weights, while verifying GPU isolation and VRAM.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path


def log_section(title: str) -> None:
    print(f"\n{'=' * 70}")
    print(f"  {title}")
    print(f"{'=' * 70}\n", flush=True)


def get_vram_mb() -> tuple[float, float, float]:
    """Return (allocated_mb, reserved_mb, total_mb)."""
    import torch

    if not torch.cuda.is_available():
        return 0.0, 0.0, 0.0
    allocated = torch.cuda.memory_allocated(0) / (1024 * 1024)
    reserved = torch.cuda.memory_reserved(0) / (1024 * 1024)
    props = torch.cuda.get_device_properties(0)
    total = props.total_memory / (1024 * 1024)
    return allocated, reserved, total


def inspect_runtime() -> dict:
    log_section("1. Runtime Environment & GPU 1 Inspection")
    info = {}

    import torch

    info["python_version"] = sys.version
    info["torch_version"] = torch.__version__
    info["cuda_available"] = torch.cuda.is_available()
    info["cuda_version"] = torch.version.cuda
    info["cudnn_version"] = torch.backends.cudnn.version() if torch.backends.cudnn.is_available() else None

    print(f"Python:              {sys.version.split()[0]}")
    print(f"PyTorch Version:     {torch.__version__}")
    print(f"CUDA Available:      {torch.cuda.is_available()}")
    print(f"CUDA Runtime:        {torch.version.cuda}")
    print(f"cuDNN Version:       {info['cudnn_version']}")

    try:
        import diffusers

        info["diffusers_version"] = diffusers.__version__
        print(f"Diffusers Version:   {diffusers.__version__}")
    except ImportError as e:
        info["diffusers_version"] = None
        print(f"Diffusers:           NOT INSTALLED ({e})")

    try:
        import transformers

        info["transformers_version"] = transformers.__version__
        print(f"Transformers Version:{transformers.__version__}")
    except ImportError as e:
        info["transformers_version"] = None
        print(f"Transformers:        NOT INSTALLED ({e})")

    if not torch.cuda.is_available():
        print("\nFATAL: CUDA is not available! Isolated test cannot run on GPU.")
        sys.exit(1)

    device_count = torch.cuda.device_count()
    device_name = torch.cuda.get_device_name(0)
    capability = torch.cuda.get_device_capability(0)
    arch_list = torch.cuda.get_arch_list() if hasattr(torch.cuda, "get_arch_list") else []

    info["device_count"] = device_count
    info["device_name"] = device_name
    info["capability"] = capability
    info["arch_list"] = arch_list

    print(f"Device Count:        {device_count} (Must be exactly 1 for strict isolation)")
    print(f"Device 0 Name:       {device_name}")
    print(f"Compute Capability:  {capability}")
    print(f"Supported Archs:     {arch_list}")

    alloc, res, total = get_vram_mb()
    print(f"Initial VRAM:        Allocated: {alloc:.1f} MB | Reserved: {res:.1f} MB | Total: {total:.1f} MB")

    if device_count != 1:
        print(f"\nWARNING: Expected exactly 1 visible GPU for isolation, found {device_count}!")

    return info


def test_flux_image(models_dir: str, output_dir: str) -> bool:
    log_section("2. FLUX.1-schnell Image Generation Smoke Test")
    import torch
    from diffusers import FluxPipeline
    from PIL import Image

    model_path = os.path.join(models_dir, "black-forest-labs", "FLUX.1-schnell")
    output_path = os.path.join(output_dir, "smoke_test_flux.png")
    os.makedirs(output_dir, exist_ok=True)

    print(f"Model Path:          {model_path}")
    print(f"Output Target:       {output_path}")

    # Verify local files exist
    model_index = os.path.join(model_path, "model_index.json")
    if not os.path.isfile(model_index):
        print(f"FAIL: model_index.json not found at {model_index}")
        return False
    print("Local model_index.json confirmed.")

    t0 = time.time()
    print("\nLoading FluxPipeline (local_files_only=True, dtype=bfloat16)...")
    try:
        pipeline = FluxPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )
        pipeline = pipeline.to("cuda")
        try:
            pipeline.enable_attention_slicing()
        except Exception:
            pass
        t_load = time.time() - t0
        alloc, res, total = get_vram_mb()
        print(f"Model loaded successfully in {t_load:.2f}s.")
        print(f"VRAM after load:     Allocated: {alloc:.1f} MB | Reserved: {res:.1f} MB")
    except Exception as e:
        print(f"FAIL loading FLUX pipeline: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

    prompt = "A high quality minimalist geometric sculpture in soft studio lighting"
    width = 512
    height = 512
    steps = 4
    seed = 42

    print(f"\nRunning generation:")
    print(f"  Prompt:   {prompt}")
    print(f"  Size:     {width}x{height}")
    print(f"  Steps:    {steps}")
    print(f"  Seed:     {seed}")

    generator = torch.Generator(device="cuda").manual_seed(seed)
    t_gen_start = time.time()
    try:
        torch.cuda.reset_peak_memory_stats(0)
        result = pipeline(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            max_sequence_length=256,
            generator=generator,
        )
        torch.cuda.synchronize()
        t_gen = time.time() - t_gen_start
        peak_alloc = torch.cuda.max_memory_allocated(0) / (1024 * 1024)
        print(f"Generation completed in {t_gen:.2f}s.")
        print(f"Peak VRAM during gen: {peak_alloc:.1f} MB")

        images = getattr(result, "images", None)
        if images is None or len(images) == 0:
            print("FAIL: No images returned by pipeline.")
            return False

        image = images[0]
        image.save(output_path, format="PNG")
        file_size = os.path.getsize(output_path)
        print(f"Image saved to:      {output_path} ({file_size:,} bytes)")

        # Validate with PIL
        with Image.open(output_path) as img:
            img.verify()
        with Image.open(output_path) as img:
            act_w, act_h = img.size
            img_format = img.format
        print(f"Validation:          Format: {img_format}, Size: {act_w}x{act_h} (non-empty, valid PNG)")

        if act_w == width and act_h == height and file_size > 1000:
            print("\n>>> FLUX.1-schnell SMOKE TEST: PASSED <<<")
            return True
        else:
            print(f"FAIL: Unexpected dimensions ({act_w}x{act_h}) or file size too small ({file_size} B)")
            return False

    except Exception as e:
        print(f"FAIL during FLUX inference: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Cleanup pipeline to free VRAM for video test
        del pipeline
        torch.cuda.empty_cache()


def test_ltx_video(models_dir: str, output_dir: str) -> bool:
    log_section("3. LTX-Video Text-to-Video Generation Smoke Test")
    import torch
    import diffusers

    model_path = os.path.join(models_dir, "Lightricks", "LTX-Video")
    output_path = os.path.join(output_dir, "smoke_test_ltx_t2v.mp4")
    os.makedirs(output_dir, exist_ok=True)

    print(f"Model Path:          {model_path}")
    print(f"Output Target:       {output_path}")

    model_index = os.path.join(model_path, "model_index.json")
    if not os.path.isfile(model_index):
        print(f"FAIL: model_index.json not found at {model_index}")
        return False
    print("Local model_index.json confirmed.")

    t0 = time.time()
    print("\nLoading LTXPipeline (local_files_only=True, dtype=bfloat16)...")
    pipe_cls = getattr(diffusers, "LTXPipeline", None) or getattr(diffusers, "DiffusionPipeline")
    try:
        pipeline = pipe_cls.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )
        pipeline = pipeline.to("cuda")
        try:
            pipeline.enable_attention_slicing()
        except Exception:
            pass
        t_load = time.time() - t0
        alloc, res, total = get_vram_mb()
        print(f"Model loaded successfully in {t_load:.2f}s.")
        print(f"Pipeline Class:      {pipeline.__class__.__name__}")
        print(f"VRAM after load:     Allocated: {alloc:.1f} MB | Reserved: {res:.1f} MB")
    except Exception as e:
        print(f"FAIL loading LTX pipeline: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

    prompt = "A gentle ocean wave rolling onto sand in golden hour"
    width = 512
    height = 512
    num_frames = 25
    steps = 20
    fps = 24

    print(f"\nRunning generation:")
    print(f"  Prompt:     {prompt}")
    print(f"  Size:       {width}x{height} (divisible by 32)")
    print(f"  Frames:     {num_frames} (k*8+1)")
    print(f"  Steps:      {steps}")
    print(f"  Target FPS: {fps}")

    t_gen_start = time.time()
    try:
        torch.cuda.reset_peak_memory_stats(0)
        result = pipeline(
            prompt=prompt,
            width=width,
            height=height,
            num_frames=num_frames,
            num_inference_steps=steps,
            frame_rate=fps,
            guidance_scale=3.0,
        )
        torch.cuda.synchronize()
        t_gen = time.time() - t_gen_start
        peak_alloc = torch.cuda.max_memory_allocated(0) / (1024 * 1024)
        print(f"Generation completed in {t_gen:.2f}s.")
        print(f"Peak VRAM during gen: {peak_alloc:.1f} MB")

        frames = getattr(result, "frames", None)
        if frames is None or len(frames) == 0:
            print("FAIL: No frames returned by pipeline.")
            return False

        from diffusers.utils import export_to_video
        raw_path = os.path.join(output_dir, "raw_ltx_t2v.mp4")
        if hasattr(frames, "ndim") and frames.ndim == 5:
            video_frames = frames[0]
        elif isinstance(frames, (list, tuple)) and len(frames) > 0 and isinstance(frames[0], (list, tuple)):
            video_frames = frames[0]
        else:
            video_frames = frames
        export_to_video(video_frames, raw_path, fps=fps)

        import shutil
        ffmpeg_bin = shutil.which("ffmpeg")
        if not ffmpeg_bin:
            try:
                import imageio_ffmpeg
                ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
            except Exception:
                ffmpeg_bin = None

        if ffmpeg_bin:
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-i", raw_path,
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-r", str(fps),
                output_path,
            ]
            try:
                subprocess.run(ffmpeg_cmd, check=True, capture_output=True, text=True, timeout=120)
                target_file = output_path
            except Exception as e:
                print(f"Transcode fallback note: {e}")
                target_file = raw_path
        else:
            target_file = raw_path

        file_size = os.path.getsize(target_file)
        print(f"Video saved to:      {target_file} ({file_size:,} bytes)")

        import imageio
        try:
            reader = imageio.get_reader(target_file)
            meta = reader.get_meta_data()
            act_fps = meta.get("fps", fps)
            act_size = meta.get("size", (width, height))
            act_dur = meta.get("duration", 0.0)
            counted_frames = sum(1 for _ in reader)
            reader.close()

            print(f"\nIn-Container Video Validation (via imageio):")
            print(f"  Container/Path:    {target_file}")
            print(f"  Dimensions:        {act_size[0]}x{act_size[1]} (width x height)")
            print(f"  Frame Count:       {counted_frames}")
            print(f"  FPS:               {act_fps}")
            print(f"  Duration:          {act_dur:.2f}s")
            print(f"  File Size:         {file_size:,} bytes")

            if file_size > 5000 and counted_frames >= num_frames:
                print("\n>>> LTX-Video TEXT-TO-VIDEO SMOKE TEST: PASSED <<<")
                return True
            else:
                print(f"FAIL: Video validation failed (frames={counted_frames}, size={file_size} B)")
                return False
        except Exception as val_err:
            print(f"FAIL: imageio failed to read generated MP4: {val_err}")
            import traceback
            traceback.print_exc()
            return False

    except Exception as e:
        print(f"FAIL during LTX inference: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        del pipeline
        torch.cuda.empty_cache()


def test_ltx_image_to_video(models_dir: str, output_dir: str, input_image_path: str = None) -> bool:
    log_section("4. LTX-Video Image-to-Video Generation Smoke Test")
    import torch
    import diffusers
    from PIL import Image

    model_path = os.path.join(models_dir, "Lightricks", "LTX-Video")
    output_path = os.path.join(output_dir, "smoke_test_ltx_i2v.mp4")
    os.makedirs(output_dir, exist_ok=True)

    print(f"Model Path:          {model_path}")
    print(f"Output Target:       {output_path}")

    model_index = os.path.join(model_path, "model_index.json")
    if not os.path.isfile(model_index):
        print(f"FAIL: model_index.json not found at {model_index}")
        return False

    if input_image_path and os.path.isfile(input_image_path):
        source_image = Image.open(input_image_path).convert("RGB")
        print(f"Using provided source image: {input_image_path} ({source_image.size})")
    else:
        source_image = Image.new("RGB", (512, 512), color=(140, 100, 80))
        print(f"Using synthetic source image: 512x512")

    t0 = time.time()
    print("\nLoading LTXImageToVideoPipeline (local_files_only=True, dtype=bfloat16)...")
    pipe_cls = getattr(diffusers, "LTXImageToVideoPipeline", None) or getattr(diffusers, "DiffusionPipeline")
    try:
        pipeline = pipe_cls.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )
        pipeline = pipeline.to("cuda")
        try:
            pipeline.enable_attention_slicing()
        except Exception:
            pass
        t_load = time.time() - t0
        print(f"Model loaded successfully in {t_load:.2f}s.")
    except Exception as e:
        print(f"FAIL loading LTX I2V pipeline: {type(e).__name__}: {e}")
        return False

    prompt = "natural subtle head turn, gentle blink, soft warm lighting"
    width = 512
    height = 512
    num_frames = 25
    steps = 20
    fps = 24

    t_gen_start = time.time()
    try:
        torch.cuda.reset_peak_memory_stats(0)
        result = pipeline(
            image=source_image,
            prompt=prompt,
            width=width,
            height=height,
            num_frames=num_frames,
            num_inference_steps=steps,
            frame_rate=fps,
            guidance_scale=3.0,
        )
        torch.cuda.synchronize()
        t_gen = time.time() - t_gen_start
        peak_alloc = torch.cuda.max_memory_allocated(0) / (1024 * 1024)
        print(f"Generation completed in {t_gen:.2f}s.")
        print(f"Peak VRAM during gen: {peak_alloc:.1f} MB")

        frames = getattr(result, "frames", None)
        if frames is None or len(frames) == 0:
            print("FAIL: No frames returned by pipeline.")
            return False

        from diffusers.utils import export_to_video
        raw_path = os.path.join(output_dir, "raw_ltx_i2v.mp4")
        video_frames = frames[0] if (isinstance(frames, (list, tuple)) and len(frames) > 0 and isinstance(frames[0], (list, tuple))) else frames
        export_to_video(video_frames, raw_path, fps=fps)

        import shutil
        ffmpeg_bin = shutil.which("ffmpeg")
        if ffmpeg_bin:
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-i", raw_path,
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-r", str(fps),
                output_path,
            ]
            try:
                subprocess.run(ffmpeg_cmd, check=True, capture_output=True, text=True, timeout=120)
                target_file = output_path
            except Exception:
                target_file = raw_path
        else:
            target_file = raw_path

        file_size = os.path.getsize(target_file)
        print(f"Video saved to: {target_file} ({file_size:,} bytes)")
        if file_size > 5000:
            print("\n>>> LTX-Video IMAGE-TO-VIDEO SMOKE TEST: PASSED <<<")
            return True
        return False
    except Exception as e:
        print(f"FAIL during LTX I2V inference: {type(e).__name__}: {e}")
        return False
    finally:
        del pipeline
        torch.cuda.empty_cache()


def main() -> None:
    parser = argparse.ArgumentParser(description="Isolated GPU 1 generation smoke tests")
    parser.add_argument("--mode", choices=["all", "image", "video", "t2v", "i2v", "inspect"], default="video")
    parser.add_argument("--models-dir", default="/models")
    parser.add_argument("--output-dir", default="/output")
    parser.add_argument("--input-image", default=None, help="Optional source image for image-to-video test")
    args = parser.parse_args()

    runtime_info = inspect_runtime()

    if args.mode == "inspect":
        print("\nInspection complete.")
        return

    flux_ok = None
    t2v_ok = None
    i2v_ok = None

    if args.mode in ("all", "image"):
        flux_ok = test_flux_image(args.models_dir, args.output_dir)

    if args.mode in ("all", "video", "t2v"):
        t2v_ok = test_ltx_video(args.models_dir, args.output_dir)

    if args.mode in ("all", "video", "i2v"):
        i2v_ok = test_ltx_image_to_video(args.models_dir, args.output_dir, args.input_image)

    log_section("SUMMARY OF SMOKE TESTS")
    if flux_ok is not None:
        print(f"FLUX.1-schnell Image Test:      {'PASSED' if flux_ok else 'FAILED'}")
    if t2v_ok is not None:
        print(f"LTX-Video Text-to-Video Test:   {'PASSED' if t2v_ok else 'FAILED'}")
    if i2v_ok is not None:
        print(f"LTX-Video Image-to-Video Test:  {'PASSED' if i2v_ok else 'FAILED'}")

    results = [r for r in (flux_ok, t2v_ok, i2v_ok) if r is not None]
    if any(r is False for r in results):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
