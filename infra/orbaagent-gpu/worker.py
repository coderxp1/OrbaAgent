import os
import subprocess
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="OrbaAgent GPU Media Worker", version="1.1.0")

# ---------------------------------------------------------------------------
# Authentication
#
# MEDIA_WORKER_TOKEN is REQUIRED. There is deliberately no fallback literal:
# a previous revision defaulted to a hardcoded shared secret that was also
# committed to this repository, which made every deployment guessable.
# ---------------------------------------------------------------------------
AUTH_TOKEN = os.getenv("MEDIA_WORKER_TOKEN", "").strip()

if not AUTH_TOKEN:
    raise RuntimeError(
        "MEDIA_WORKER_TOKEN is not set. Refusing to start without a worker "
        "authentication token. Set it via the environment or a Docker secret; "
        "do not commit a token to source control."
    )


def verify_auth(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.replace("Bearer ", "").strip()
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")
    return token


def get_gpu_info():
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode == 0 and res.stdout.strip():
            parts = [p.strip() for p in res.stdout.strip().split(",")]
            return {
                "available": True,
                "device": "GPU 1",
                "name": parts[0] if len(parts) > 0 else "RTX PRO 6000 Blackwell Server Edition",
                "memory_total": f"{parts[1]} MiB" if len(parts) > 1 else "97887 MiB",
                "memory_used": f"{parts[2]} MiB" if len(parts) > 2 else "0 MiB",
                "memory_free": f"{parts[3]} MiB" if len(parts) > 3 else "97887 MiB",
            }
    except Exception:
        pass
    return {
        "available": False,
        "device": "GPU 1",
        "name": "NVIDIA RTX PRO 6000 Blackwell Server Edition",
        "error": "Failed to query nvidia-smi inside container",
    }


# ---------------------------------------------------------------------------
# Media generation backend
#
# No diffusion or video model is installed in this image. The previous revision
# drew the prompt text onto a flat Pillow rectangle and returned
# {"status": "COMPLETED"}, advertising models it did not run. That is a false
# success report and has been removed.
#
# Generation now reports unavailability until a real backend exists. To wire one
# up, install the model runtime and set MEDIA_GENERATION_BACKEND accordingly.
# ---------------------------------------------------------------------------
MEDIA_GENERATION_UNAVAILABLE = "MEDIA_GENERATION_UNAVAILABLE"

MEDIA_GENERATION_BACKEND = os.getenv("MEDIA_GENERATION_BACKEND", "").strip()
# Optional: name of the pipeline actually loaded, surfaced verbatim in responses.
MEDIA_GENERATION_MODEL = os.getenv("MEDIA_GENERATION_MODEL", "").strip()

IMAGE_BACKEND_READY = MEDIA_GENERATION_BACKEND in {"diffusers", "comfyui"}
VIDEO_BACKEND_READY = MEDIA_GENERATION_BACKEND in {"diffusers-video", "comfyui-video"}


class ImageGenRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 1024
    height: int = 1024
    steps: int = 20
    seed: Optional[int] = None
    model: str = ""
    output_format: str = "png"


class VideoGenRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    duration_seconds: int = 4
    fps: int = 16
    width: int = 768
    height: int = 768
    model: str = ""


def _unavailable(operation: str) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "status": MEDIA_GENERATION_UNAVAILABLE,
            "operation": operation,
            "message": (
                f"Real {operation} generation is not available: no generation "
                "backend is deployed on this worker. Refusing to return fabricated output."
            ),
            "configured_backend": MEDIA_GENERATION_BACKEND or None,
            "required_env": "MEDIA_GENERATION_BACKEND (e.g. diffusers | comfyui)",
        },
    )


@app.get("/health")
def health(token: str = Depends(verify_auth)):
    gpu_info = get_gpu_info()
    gpu_present = bool(gpu_info.get("available", False))
    return {
        "worker": "healthy",
        "status": "ok",
        "gpu": gpu_info,
        "capabilities": {
            # Generation is reported from backend readiness, NOT merely from the
            # GPU being present. A visible GPU does not imply a loaded model.
            "image_generation": gpu_present and IMAGE_BACKEND_READY,
            "video_generation": gpu_present and VIDEO_BACKEND_READY,
            "media_processing": gpu_present,
        },
        "generation_backend": MEDIA_GENERATION_BACKEND or None,
        "generation_model": MEDIA_GENERATION_MODEL or None,
        "unavailable_reason": None
        if IMAGE_BACKEND_READY or VIDEO_BACKEND_READY
        else "No generation backend deployed; generation endpoints return 503 "
        f"{MEDIA_GENERATION_UNAVAILABLE}.",
    }


@app.post("/api/generate/image")
def generate_image(req: ImageGenRequest, token: str = Depends(verify_auth)):
    # No image generation backend is implemented. Returning fabricated output
    # here would be a false success report, so this always reports unavailability
    # while IMAGE_BACKEND_READY is False.
    raise _unavailable("image")


@app.post("/api/generate/video")
def generate_video(req: VideoGenRequest, token: str = Depends(verify_auth)):
    # No video generation backend is implemented. See generate_image above.
    raise _unavailable("video")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("MEDIA_WORKER_PORT", "8190"))
    uvicorn.run(app, host="0.0.0.0", port=port)

