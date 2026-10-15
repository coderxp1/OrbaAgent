#!/usr/bin/env python3
"""End-to-End Route Integration Test for OrbaAgent GPU Media Worker on GPU 1.

Exercises the real FastAPI ASGI app (/health, /api/generate/image, /api/generate/video)
with real Diffusers backend, real model resolution from /models, real Blackwell GPU 1
inference, and artifact generation.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def main():
    print("=" * 70)
    print("  OrbaAgent GPU Worker — End-to-End Route Integration Test")
    print("=" * 70, flush=True)

    # 1. Environment & Config Setup
    token = "test-integration-token-42"
    gpu_uuid = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"
    models_dir = "/models"
    output_dir = "/output"

    os.environ["MEDIA_WORKER_TOKEN"] = token
    os.environ["MEDIA_GENERATION_BACKEND"] = "diffusers"
    os.environ["MEDIA_MODELS_DIR"] = models_dir
    os.environ["MEDIA_OUTPUT_DIR"] = output_dir
    os.environ["MEDIA_WORKER_GPU_UUID"] = gpu_uuid

    from orba_gpu.app import create_app
    from orba_gpu.backends.diffusers_backend import (
        load_image_pipeline,
        load_video_pipeline,
        run_image_inference,
        run_video_inference,
    )
    from orba_gpu.config import Settings
    from orba_gpu.generation import GenerationLimiter
    from orba_gpu.gpu_info import get_gpu_info
    from orba_gpu.models import ModelManager

    settings = Settings(
        target_gpu_uuid=gpu_uuid,
        backend="diffusers",
        models_dir=models_dir,
        output_dir=output_dir,
        token=token,
        image_model_id="black-forest-labs/FLUX.1-schnell",
        video_model_id="Wan-AI/Wan2.1-T2V-1.3B",
    )

    manager = ModelManager(
        models_dir=models_dir,
        output_dir=output_dir,
        backend="diffusers",
        image_model_id="black-forest-labs/FLUX.1-schnell",
        video_model_id="Wan-AI/Wan2.1-T2V-1.3B",
        image_loader=load_image_pipeline,
        video_loader=load_video_pipeline,
    )

    app = create_app(
        settings=settings,
        manager=manager,
        limiter=GenerationLimiter(1),
        image_infer=run_image_inference,
        video_infer=run_video_inference,
        token=token,
        gpu_reader=get_gpu_info,
    )

    from fastapi.testclient import TestClient
    client = TestClient(app)
    auth_headers = {"Authorization": f"Bearer {token}"}

    # --------------------------------------------------------------------------
    # Test 1: Initial Health Check (Before models loaded in memory)
    # --------------------------------------------------------------------------
    print("\n--- Route Test 1: Initial GET /health ---")
    t0 = time.time()
    resp_health_1 = client.get("/health", headers=auth_headers)
    print(f"Status Code: {resp_health_1.status_code}")
    health_data_1 = resp_health_1.json()
    print("Response JSON:")
    print(json.dumps(health_data_1, indent=2))

    # Note the capability report
    img_cap_1 = health_data_1.get("capabilities", {}).get("image_generation")
    vid_cap_1 = health_data_1.get("capabilities", {}).get("video_generation")
    print(f"\nInitial Reported Capabilities:")
    print(f"  image_generation: {img_cap_1}")
    print(f"  video_generation: {vid_cap_1}")
    print(f"  unavailable_reason: {health_data_1.get('unavailable_reason')}")

    # --------------------------------------------------------------------------
    # Test 2: Image Generation Route (POST /api/generate/image)
    # Matches payload sent by MediaImageGenerateTool
    # --------------------------------------------------------------------------
    print("\n--- Route Test 2: POST /api/generate/image ---")
    image_payload = {
        "prompt": "A modern glass vase on a warm wooden table in morning sunlight",
        "negative_prompt": None,
        "width": 512,
        "height": 512,
        "steps": 4,
        "seed": 42,
        "model": "black-forest-labs/FLUX.1-schnell",
        "output_format": "png",
    }
    print("Request Payload:")
    print(json.dumps(image_payload, indent=2))

    t_img_start = time.time()
    resp_img = client.post("/api/generate/image", json=image_payload, headers=auth_headers)
    t_img_duration = time.time() - t_img_start

    print(f"\nResponse Status: {resp_img.status_code}")
    print(f"Execution Duration: {t_img_duration:.2f}s")
    try:
        img_result = resp_img.json()
        print("Response JSON:")
        print(json.dumps(img_result, indent=2))
    except Exception:
        print(f"Raw Response: {resp_img.text}")
        img_result = {}

    image_ok = False
    if resp_img.status_code == 200 and img_result.get("status") == "COMPLETED":
        job_id = img_result.get("jobId")
        # Check generated artifact on disk and validate with PIL
        expected_path = Path(output_dir) / f"{job_id}.png"
        if expected_path.is_file() and expected_path.stat().st_size > 1000:
            from PIL import Image
            with Image.open(expected_path) as img:
                img.verify()
            with Image.open(expected_path) as img:
                act_w, act_h = img.size
                act_fmt = img.format
            print(f"[PASS] Image artifact verified on disk: {expected_path} ({expected_path.stat().st_size:,} bytes, Format={act_fmt}, Size={act_w}x{act_h})")
            if act_w == 512 and act_h == 512 and act_fmt == "PNG":
                image_ok = True
            else:
                print(f"[FAIL] Image unexpected dimensions or format: {act_w}x{act_h}, format={act_fmt}")
        else:
            print(f"[FAIL] Image artifact missing or too small: {expected_path}")
    else:
        print(f"[FAIL] Image generation endpoint returned status {resp_img.status_code}")

    # --------------------------------------------------------------------------
    # Test 3: Health Check After Image Loaded
    # --------------------------------------------------------------------------
    print("\n--- Route Test 3: GET /health (After Image Model Loaded) ---")
    resp_health_2 = client.get("/health", headers=auth_headers)
    health_data_2 = resp_health_2.json()
    print(f"image_generation capability now: {health_data_2.get('capabilities', {}).get('image_generation')}")
    print(f"video_generation capability now: {health_data_2.get('capabilities', {}).get('video_generation')}")

    # --------------------------------------------------------------------------
    # Test 4: Video Generation Route (POST /api/generate/video)
    # Matches payload sent by MediaVideoGenerateTool
    # --------------------------------------------------------------------------
    print("\n--- Route Test 4: POST /api/generate/video ---")
    video_payload = {
        "prompt": "Gentle ocean waves rolling onto white sand",
        "negative_prompt": None,
        "duration_seconds": 1,
        "fps": 5,
        "width": 640,
        "height": 352,
        "model": "Wan-AI/Wan2.1-T2V-1.3B",
    }
    print("Request Payload:")
    print(json.dumps(video_payload, indent=2))

    t_vid_start = time.time()
    resp_vid = client.post("/api/generate/video", json=video_payload, headers=auth_headers)
    t_vid_duration = time.time() - t_vid_start

    print(f"\nResponse Status: {resp_vid.status_code}")
    print(f"Execution Duration: {t_vid_duration:.2f}s")
    try:
        vid_result = resp_vid.json()
        print("Response JSON:")
        print(json.dumps(vid_result, indent=2))
    except Exception:
        print(f"Raw Response: {resp_vid.text}")
        vid_result = {}

    video_ok = False
    if resp_vid.status_code == 200 and vid_result.get("status") == "COMPLETED":
        job_id = vid_result.get("jobId")
        expected_path = Path(output_dir) / f"{job_id}.mp4"
        if expected_path.is_file() and expected_path.stat().st_size > 1000:
            import imageio
            reader = imageio.get_reader(str(expected_path))
            meta = reader.get_meta_data()
            act_fps = meta.get("fps")
            act_size = meta.get("size")
            act_dur = meta.get("duration", 0.0)
            counted_frames = sum(1 for _ in reader)
            reader.close()
            print(f"[PASS] Video artifact verified & decoded on disk: {expected_path} ({expected_path.stat().st_size:,} bytes, Dimensions={act_size[0]}x{act_size[1]}, Frames={counted_frames}, FPS={act_fps}, Duration={act_dur:.2f}s)")
            if act_size[0] == 640 and act_size[1] == 352 and counted_frames >= 5:
                video_ok = True
            else:
                print(f"[FAIL] Video validation mismatch: size={act_size}, frames={counted_frames}")
        else:
            print(f"[FAIL] Video artifact missing or too small: {expected_path}")
    else:
        print(f"[FAIL] Video generation endpoint returned status {resp_vid.status_code}")

    # --------------------------------------------------------------------------
    # Test 5: Final Health Check
    # --------------------------------------------------------------------------
    print("\n--- Route Test 5: Final GET /health ---")
    resp_health_3 = client.get("/health", headers=auth_headers)
    health_data_3 = resp_health_3.json()
    print("Final Capabilities:")
    print(f"  image_generation: {health_data_3.get('capabilities', {}).get('image_generation')}")
    print(f"  video_generation: {health_data_3.get('capabilities', {}).get('video_generation')}")

    print("\n" + "=" * 70)
    print("  INTEGRATION TEST SUMMARY")
    print("=" * 70)
    print(f"Image Route (/api/generate/image): {'PASSED' if image_ok else 'FAILED'}")
    print(f"Video Route (/api/generate/video): {'PASSED' if video_ok else 'FAILED'}")
    print(f"Initial Health capabilities match lazy loading: image={img_cap_1}, video={vid_cap_1}")
    print(f"Final Health capabilities after loading:       image={health_data_3.get('capabilities', {}).get('image_generation')}, video={health_data_3.get('capabilities', {}).get('video_generation')}")

    if not image_ok or not video_ok:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
