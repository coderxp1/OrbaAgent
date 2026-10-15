#!/usr/bin/env python3
"""Isolated Generation Smoke Test on GPU 1 (RTX PRO 6000 Blackwell).

Tests FLUX.1-schnell and Wan 2.1 locally against the promoted paths in
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


def test_wan_video(models_dir: str, output_dir: str) -> bool:
    log_section("3. Wan 2.1 Video Generation Smoke Test")
    import torch
    from diffusers import DiffusionPipeline

    model_path = os.path.join(models_dir, "Wan-AI", "Wan2.1-T2V-1.3B")
    output_path = os.path.join(output_dir, "smoke_test_wan.mp4")
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
    print("\nLoading DiffusionPipeline (local_files_only=True, dtype=bfloat16)...")
    try:
        pipeline = DiffusionPipeline.from_pretrained(
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
        print(f"FAIL loading Wan pipeline: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Wan 2.1 small test parameters: height & width divisible by 16 (640=16*40, 352=16*22)
    # Frames: 4N+1 (5 frames = 1.0s at 5 fps)
    prompt = "A gentle ocean wave rolling onto sand"
    width = 640
    height = 352
    num_frames = 5
    steps = 8
    fps = 5

    print(f"\nRunning generation:")
    print(f"  Prompt:     {prompt}")
    print(f"  Size:       {width}x{height} (both divisible by 16)")
    print(f"  Frames:     {num_frames} (divisible by 4N+1)")
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

        # Export frames to MP4 using export_to_video
        from diffusers.utils import export_to_video
        raw_path = os.path.join(output_dir, "raw_wan.mp4")
        if hasattr(frames, "ndim") and frames.ndim == 5:
            video_frames = frames[0]
        elif isinstance(frames, (list, tuple)) and len(frames) > 0 and isinstance(frames[0], (list, tuple)):
            video_frames = frames[0]
        else:
            video_frames = frames
        export_to_video(video_frames, raw_path, fps=fps)

        # Ensure valid MP4 container using imageio-ffmpeg bundled binary if ffmpeg is missing
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

        # Validate video in-container using bundled imageio (no host ffprobe needed)
        import imageio
        try:
            reader = imageio.get_reader(target_file)
            meta = reader.get_meta_data()
            act_fps = meta.get("fps", fps)
            act_size = meta.get("size", (width, height))
            act_dur = meta.get("duration", 0.0)
            counted_frames = 0
            for _ in reader:
                counted_frames += 1
            reader.close()

            print(f"\nIn-Container Video Validation (via imageio):")
            print(f"  Container/Path:    {target_file}")
            print(f"  Dimensions:        {act_size[0]}x{act_size[1]} (width x height)")
            print(f"  Frame Count:       {counted_frames}")
            print(f"  FPS:               {act_fps}")
            print(f"  Duration:          {act_dur:.2f}s")
            print(f"  File Size:         {file_size:,} bytes")

            if file_size > 5000 and counted_frames >= num_frames:
                print("\n>>> Wan 2.1 VIDEO SMOKE TEST: PASSED <<<")
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
        print(f"FAIL during Wan inference: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        del pipeline
        torch.cuda.empty_cache()


def main() -> None:
    parser = argparse.ArgumentParser(description="Isolated GPU 1 generation smoke tests")
    parser.add_argument("--mode", choices=["all", "image", "video", "inspect"], default="video")
    parser.add_argument("--models-dir", default="/models")
    parser.add_argument("--output-dir", default="/output")
    args = parser.parse_args()

    runtime_info = inspect_runtime()

    if args.mode == "inspect":
        print("\nInspection complete.")
        return

    flux_ok = None
    wan_ok = None

    if args.mode in ("all", "image"):
        flux_ok = test_flux_image(args.models_dir, args.output_dir)

    if args.mode in ("all", "video"):
        wan_ok = test_wan_video(args.models_dir, args.output_dir)

    log_section("SUMMARY OF SMOKE TESTS")
    if flux_ok is not None:
        print(f"FLUX.1-schnell Image Test: {'PASSED' if flux_ok else 'FAILED'}")
    if wan_ok is not None:
        print(f"Wan 2.1 Video Test:        {'PASSED' if wan_ok else 'FAILED'}")

    if (flux_ok is False) or (wan_ok is False):
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
