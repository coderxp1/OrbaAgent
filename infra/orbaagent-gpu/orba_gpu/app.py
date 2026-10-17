"""FastAPI application for the OrbaAgent GPU media worker.

The endpoints use ``def`` (not ``async def``) deliberately: generation is
CPU/GPU-bound and blocking, so FastAPI runs these in its worker threadpool. An
``async def`` endpoint would block the event loop for the entire inference.

Responses never include filesystem paths — only artifact ids, MIME types, sizes,
hashes and generation metadata.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException

from .config import Settings, ValidationError
from .generation import (
    GenerationBusyError,
    GenerationFailedError,
    GenerationLimiter,
    generate_image,
    generate_video,
)
from .gpu_info import get_gpu_info
from .ingest import IngestError, ingest_artifact
from .models import BackendNotImplementedError, ModelManager, ModelUnavailableError
from .secrets import MissingSecretError, Redactor, load_secret

logger = logging.getLogger("orba_gpu_worker")

MEDIA_GENERATION_UNAVAILABLE = "MEDIA_GENERATION_UNAVAILABLE"


def _unavailable(operation: str, reason: str, backend: Optional[str]) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "status": MEDIA_GENERATION_UNAVAILABLE,
            "operation": operation,
            "message": reason,
            "configured_backend": backend or None,
            "required_env": "MEDIA_GENERATION_BACKEND=diffusers plus loaded model weights",
        },
    )


def _load_image_pipeline(model_path: str):
    from .backends.diffusers_backend import load_image_pipeline as _load

    return _load(model_path)


def _load_video_pipeline(model_path: str):
    from .backends.diffusers_backend import load_video_pipeline as _load

    return _load(model_path)


def create_app(
    settings: Optional[Settings] = None,
    manager: Optional[ModelManager] = None,
    limiter: Optional[GenerationLimiter] = None,
    image_infer=None,
    video_infer=None,
    token: Optional[str] = None,
    gpu_reader=None,
) -> FastAPI:
    """Build the worker app.

    All collaborators are injectable so the unit tests can exercise the real
    request/validation/limiter/response code paths without a GPU, torch, or
    diffusers installed.
    """
    settings = settings or Settings.from_env()

    if token is not None:
        auth_token = token
    else:
        try:
            auth_token = load_secret(
                env_var="MEDIA_WORKER_TOKEN", file_var="MEDIA_WORKER_TOKEN_FILE"
            )
        except MissingSecretError as exc:
            # Refuse to start: an unauthenticated generation endpoint on a GPU
            # host is worse than an outage.
            raise RuntimeError(str(exc)) from exc

    redactor = Redactor([auth_token, settings.ingest_token])

    model_manager = manager or ModelManager(
        models_dir=settings.models_dir,
        output_dir=settings.output_dir,
        backend=settings.backend,
        image_model_id=settings.image_model_id,
        video_model_id=settings.video_model_id,
        image_loader=_load_image_pipeline,
        video_loader=_load_video_pipeline,
    )
    generation_limiter = limiter or GenerationLimiter(settings.max_concurrent_generations)

    def read_gpu():
        if gpu_reader is not None:
            return gpu_reader(settings.target_gpu_uuid)
        return get_gpu_info(settings.target_gpu_uuid)

    def verify_auth(authorization: Optional[str] = Header(None)) -> str:
        if not authorization:
            raise HTTPException(status_code=401, detail="Missing Authorization header")
        presented = authorization.replace("Bearer ", "").strip()
        # Constant-time-ish comparison; avoids trivial timing oracles.
        if len(presented) != len(auth_token) or not _constant_time_equals(presented, auth_token):
            raise HTTPException(status_code=403, detail="Invalid token")
        return presented

    app = FastAPI(title="OrbaAgent GPU Media Worker", version="2.0.0")

    @app.get("/health")
    def health(token: str = Depends(verify_auth)):
        gpu = read_gpu()
        gpu_present = bool(getattr(gpu, "available", False))
        model_status = model_manager.status()

        image_ready = gpu_present and model_manager.image_ready
        video_ready = gpu_present and model_manager.video_ready

        if image_ready or video_ready:
            unavailable_reason = None
        elif not settings.backend:
            unavailable_reason = (
                "MEDIA_GENERATION_BACKEND is not set; no generation backend is configured."
            )
        elif not gpu_present:
            unavailable_reason = (
                getattr(gpu, "error", None)
                or f"GPU {settings.target_gpu_uuid} is not available to this worker."
            )
        else:
            unavailable_reason = (
                "Generation backend is configured but no model is loaded yet. "
                "The first request loads the weights."
            )

        return {
            "worker": "healthy",
            "status": "ok",
            "gpu": gpu.to_dict() if hasattr(gpu, "to_dict") else gpu,
            "capabilities": {
                # Derived from actual readiness, never from configuration alone.
                "image_generation": image_ready,
                "video_generation": video_ready,
                "media_processing": gpu_present,
            },
            "generation_backend": settings.backend or None,
            "models": model_status,
            "active_generations": generation_limiter.active,
            "active_job": generation_limiter.get_active_job() if hasattr(generation_limiter, "get_active_job") else None,
            "max_concurrent_generations": generation_limiter.max_concurrent,
            "unavailable_reason": unavailable_reason,
        }

    @app.post("/api/jobs/cancel")
    def cancel_job_endpoint(payload: Optional[dict] = None, token: str = Depends(verify_auth)):
        job_id = (payload or {}).get("job_id")
        cancelled = generation_limiter.cancel_job(job_id) if hasattr(generation_limiter, "cancel_job") else False
        return {"status": "CANCELLED" if cancelled else "NOT_FOUND", "job_id": job_id}

    @app.post("/api/jobs/reset")
    def reset_limiter_endpoint(token: str = Depends(verify_auth)):
        if hasattr(generation_limiter, "force_reset"):
            generation_limiter.force_reset()
        return {"status": "RESET", "active_generations": generation_limiter.active}

    @app.post("/api/generate/image")
    def generate_image_endpoint(payload: dict, token: str = Depends(verify_auth)):
        if not settings.image_backend_implemented:
            raise _unavailable(
                "image",
                "No image generation backend is implemented for the configured value."
                if settings.backend
                else "No generation backend is configured on this worker.",
                settings.backend,
            )
        try:
            outcome = generate_image(
                prompt=str(payload.get("prompt", "")),
                manager=model_manager,
                limiter=generation_limiter,
                negative_prompt=payload.get("negative_prompt"),
                width=int(payload.get("width", 1024)),
                height=int(payload.get("height", 1024)),
                steps=int(payload.get("steps", 20)),
                seed=payload.get("seed"),
                model=str(payload.get("model") or ""),
                output_format=str(payload.get("output_format") or "png"),
                infer=image_infer,
            )
        except GenerationBusyError as exc:
            raise HTTPException(status_code=503, detail={"status": "BUSY", "message": str(exc)}) from exc
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=redactor.redact(exc)) from exc
        except ModelUnavailableError as exc:
            raise HTTPException(
                status_code=503,
                detail={"status": "MODEL_UNAVAILABLE", "message": redactor.redact(exc)},
            ) from exc
        except BackendNotImplementedError as exc:
            raise _unavailable("image", redactor.redact(exc), settings.backend)
        except GenerationFailedError as exc:
            raise HTTPException(
                status_code=500,
                detail={"status": "GENERATION_FAILED", "message": redactor.redact(exc)},
            ) from exc

        return _finalize(outcome, settings, redactor)

    @app.post("/api/generate/video")
    def generate_video_endpoint(payload: dict, token: str = Depends(verify_auth)):
        if not settings.video_backend_implemented:
            raise _unavailable(
                "video",
                "No video generation backend is implemented for the configured value."
                if settings.backend
                else "No generation backend is configured on this worker.",
                settings.backend,
            )
        try:
            outcome = generate_video(
                prompt=str(payload.get("prompt", "")),
                manager=model_manager,
                limiter=generation_limiter,
                negative_prompt=payload.get("negative_prompt"),
                duration_seconds=int(payload.get("duration_seconds", 4)),
                fps=int(payload.get("fps", 16)),
                width=int(payload.get("width", 768)),
                height=int(payload.get("height", 768)),
                model=str(payload.get("model") or ""),
                infer=video_infer,
            )
        except GenerationBusyError as exc:
            raise HTTPException(status_code=503, detail={"status": "BUSY", "message": str(exc)}) from exc
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=redactor.redact(exc)) from exc
        except ModelUnavailableError as exc:
            raise HTTPException(
                status_code=503,
                detail={"status": "MODEL_UNAVAILABLE", "message": redactor.redact(exc)},
            ) from exc
        except BackendNotImplementedError as exc:
            raise _unavailable("video", redactor.redact(exc), settings.backend)
        except GenerationFailedError as exc:
            raise HTTPException(
                status_code=500,
                detail={"status": "GENERATION_FAILED", "message": redactor.redact(exc)},
            ) from exc

        return _finalize(outcome, settings, redactor)

    def _finalize(outcome, cfg: Settings, red: Redactor) -> dict:
        """Deliver the verified artifact to production, then report success.

        If ingest is not configured the artifact stays local and the response
        says so explicitly — it never pretends the artifact is retrievable.
        """
        delivered = False
        artifact_id = outcome.artifact_id
        url = ""
        ingest_note = "ingest not configured; artifact retained on the GPU host only"

        if cfg.ingest_url and cfg.ingest_token:
            try:
                result = ingest_artifact(
                    ingest_url=cfg.ingest_url,
                    ingest_token=cfg.ingest_token,
                    artifact_path=outcome.path,
                    content_type=outcome.content_type,
                    workspace=_workspace_from_env(),
                    bundle=outcome.job_id,
                    filename=outcome.path.name,
                    metadata={
                        "kind": outcome.kind,
                        "model": outcome.model,
                        "parameters": outcome.parameters,
                        "sha256": outcome.sha256,
                        "duration_ms": outcome.duration_ms,
                    },
                )
                delivered = True
                artifact_id = result.artifact_id
                url = result.url
                ingest_note = "delivered to production"
            except IngestError as exc:
                ingest_note = f"artifact generated but ingest failed: {red.redact(exc)}"

        return {
            "jobId": outcome.job_id,
            "status": "COMPLETED",
            "artifact_id": artifact_id,
            "artifactId": artifact_id,
            "artifact_url": url,
            "artifactUrl": url,
            "artifact_path": str(outcome.path),
            "artifactPath": str(outcome.path),
            "content_type": outcome.content_type,
            "size_bytes": outcome.size_bytes,
            "sha256": outcome.sha256,
            "model": outcome.model,
            "durationMs": outcome.duration_ms,
            "delivered_to_production": delivered,
            "ingest_note": ingest_note,
        }

    return app


def _workspace_from_env() -> str:
    import os

    return os.getenv("ORBA_TENANT_ID", "").strip() or "default-tenant"


def _constant_time_equals(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a.encode(), b.encode())
