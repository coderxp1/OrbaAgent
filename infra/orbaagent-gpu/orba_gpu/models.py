"""Lazy, cached model management.

Design rules enforced here:

* A configured environment variable never makes a capability available. Only a
  successfully initialised backend does.
* Models are loaded on first use and cached, so a 24 GB pipeline is not re-read
  from disk for every request.
* There is no silent substitution: asking for an unconfigured or missing model is
  an error, not a fallback to a different one.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional


class ModelUnavailableError(RuntimeError):
    """Raised when a model cannot be loaded. Never swallowed into a fallback."""


class BackendNotImplementedError(RuntimeError):
    """Raised when generation is requested with no implemented backend selected."""


@dataclass(frozen=True)
class ModelStatus:
    """Observable state of one model slot."""

    slot: str
    model_id: str
    requested: bool
    loaded: bool
    load_error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "model_id": self.model_id,
            "requested": self.requested,
            "loaded": self.loaded,
            "load_error": self.load_error,
        }


def local_model_available(models_dir: str, model_id: str) -> bool:
    """Whether the model appears to be present on disk.

    Accepts either a HuggingFace cache layout or a plain local directory. This is
    a cheap pre-check only; it does not imply the model is loadable.
    """
    if not models_dir or not model_id:
        return False
    root = Path(models_dir)
    if not root.is_dir():
        return False

    # Plain local directory (config.json present is the strongest cheap signal).
    candidate = root / model_id
    if (candidate / "config.json").is_file():
        return True
    if candidate.is_dir() and any(candidate.glob("*.safetensors")):
        return True

    # HuggingFace hub cache layout: models--<org>--<name>
    cache_name = "models--" + model_id.replace("/", "--")
    cache_dir = root / cache_name
    return cache_dir.is_dir() and any(cache_dir.rglob("*.safetensors"))


def _is_relative_to(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def resolve_model_path(models_dir: str, model_id: str) -> str:
    """Resolve only an existing local Diffusers directory; never return a Hub ID."""
    if not models_dir or not model_id:
        raise ModelUnavailableError("model directory and model ID must be configured")
    root = Path(models_dir).resolve()
    if not root.is_dir():
        raise ModelUnavailableError(f"model storage directory is missing: {root}")

    candidate = root / model_id
    if candidate.is_dir() and _is_relative_to(candidate, root):
        if (candidate / "model_index.json").is_file() or (candidate / "config.json").is_file():
            return str(candidate)

    # Hugging Face cache layout: models--org--name/snapshots/<revision>
    cache_dir = root / ("models--" + model_id.replace("/", "--"))
    snapshots = cache_dir / "snapshots"
    if cache_dir.is_dir() and _is_relative_to(cache_dir, root) and snapshots.is_dir():
        for snapshot in sorted(snapshots.iterdir(), reverse=True):
            if snapshot.is_dir() and (
                (snapshot / "model_index.json").is_file()
                or (snapshot / "config.json").is_file()
            ):
                return str(snapshot)

    raise ModelUnavailableError(
        f"model '{model_id}' is not available locally under {root}; "
        "provision and validate the model before enabling generation"
    )


class ModelManager:
    """Loads and caches generation pipelines on demand."""

    def __init__(
        self,
        models_dir: str,
        output_dir: str,
        backend: str,
        image_model_id: str,
        video_model_id: str,
        image_loader: Optional[Callable[[str], Any]] = None,
        video_loader: Optional[Callable[[str], Any]] = None,
        video_backend: Optional[str] = None,
        mova_config: Optional[Any] = None,
    ) -> None:
        self._models_dir = models_dir
        self._output_dir = output_dir
        self._backend = backend
        # The video slot may use a different backend than the image slot
        # (e.g. FLUX images via diffusers + MOVA video via its service).
        # Defaults to the shared backend for backward compatibility.
        self._video_backend = video_backend or backend
        self._mova_config = mova_config
        self._image_model_id = image_model_id
        self._video_model_id = video_model_id
        self._image_loader = image_loader
        self._video_loader = video_loader

        self._lock = threading.Lock()
        self._image_pipeline: Any = None
        self._video_pipeline: Any = None
        self._image_error: Optional[str] = None
        self._video_error: Optional[str] = None

    # -- readiness -------------------------------------------------------

    @property
    def output_dir(self) -> str:
        return self._output_dir

    @property
    def image_model_id(self) -> str:
        return self._image_model_id

    @property
    def video_model_id(self) -> str:
        return self._video_model_id

    @property
    def backend_configured(self) -> bool:
        return bool(self._backend)

    @property
    def video_backend(self) -> str:
        return self._video_backend

    @property
    def image_ready(self) -> bool:
        """True only when an image pipeline is actually loaded in memory."""
        return self._image_pipeline is not None

    @property
    def video_ready(self) -> bool:
        return self._video_pipeline is not None

    def status(self) -> dict:
        return {
            "backend_configured": self._backend or None,
            "video_backend_configured": self._video_backend or None,
            "image": ModelStatus(
                slot="image",
                model_id=self._image_model_id,
                requested=self._backend in ("diffusers", "comfyui"),
                loaded=self.image_ready,
                load_error=self._image_error,
            ).to_dict(),
            "video": ModelStatus(
                slot="video",
                model_id=self._video_model_id,
                requested=self._video_backend in ("diffusers", "comfyui", "mova"),
                loaded=self.video_ready,
                load_error=self._video_error,
            ).to_dict(),
        }

    # -- loading ---------------------------------------------------------

    def _resolve_loader(self, slot: str) -> Callable[[str], Any]:
        if slot == "image":
            if self._image_loader is not None:
                return self._image_loader
        else:
            if self._video_loader is not None:
                return self._video_loader
        raise BackendNotImplementedError(
            f"no loader is implemented for the '{slot}' slot on backend "
            f"'{self._backend or 'unset'}'"
        )

    def load_image(self) -> Any:
        """Load (or return the cached) image pipeline."""
        with self._lock:
            if self._image_pipeline is not None:
                return self._image_pipeline
            if self._backend == "comfyui":
                from .backends.comfyui_backend import ComfyUIBackend
                self._image_pipeline = ComfyUIBackend(self._models_dir)
                self._image_error = None
                return self._image_pipeline
            if self._backend != "diffusers":
                raise BackendNotImplementedError(
                    "image generation requires MEDIA_GENERATION_BACKEND=diffusers or comfyui"
                )
            loader = self._resolve_loader("image")
            try:
                model_path = resolve_model_path(self._models_dir, self._image_model_id)
                self._image_pipeline = loader(model_path)
                self._image_error = None
            except Exception as exc:
                self._image_error = str(exc)
                raise ModelUnavailableError(
                    f"failed to load image model '{self._image_model_id}': {exc}"
                ) from exc
            return self._image_pipeline

    def load_video(self, model_id: Optional[str] = None, model_type: str = "auto") -> Any:
        """Load (or return the cached) video pipeline for the requested model."""
        target_model = model_id or self._video_model_id
        cache_key = f"{target_model}:{model_type}"
        with self._lock:
            if not hasattr(self, "_video_pipelines"):
                self._video_pipelines = {}
            if cache_key in self._video_pipelines:
                return self._video_pipelines[cache_key]
            if target_model in self._video_pipelines and model_type == "auto":
                return self._video_pipelines[target_model]
            if self._video_backend == "comfyui":
                from .backends.comfyui_backend import ComfyUIBackend
                self._video_pipeline = ComfyUIBackend(self._models_dir)
                self._video_pipelines[cache_key] = self._video_pipeline
                self._video_error = None
                return self._video_pipeline
            if self._video_backend == "mova":
                from .backends.mova_backend import MovaBackend, MovaConfig

                if self._mova_config is None:
                    raise BackendNotImplementedError(
                        "video backend 'mova' selected but no MOVA service "
                        "configuration was provided to the model manager"
                    )
                try:
                    # Construction verifies the service is reachable and is
                    # serving the pinned model revision; anything else is a
                    # hard failure — there is no fallback backend.
                    backend_obj = MovaBackend(self._mova_config)
                except Exception as exc:
                    self._video_error = str(exc)
                    raise ModelUnavailableError(
                        f"MOVA video service unavailable: {exc}"
                    ) from exc
                self._video_pipeline = backend_obj
                self._video_pipelines[cache_key] = backend_obj
                self._video_pipelines[self._video_model_id] = backend_obj
                self._video_error = None
                return backend_obj
            if self._video_backend != "diffusers":
                raise BackendNotImplementedError(
                    "video generation requires MEDIA_GENERATION_VIDEO_BACKEND "
                    "in (diffusers, comfyui, mova)"
                )
            loader = self._resolve_loader("video")
            try:
                model_path = resolve_model_path(self._models_dir, target_model)
                import inspect
                try:
                    sig = inspect.signature(loader)
                    if "model_type" in sig.parameters:
                        pipeline = loader(model_path, model_type=model_type)
                    else:
                        pipeline = loader(model_path)
                except Exception:
                    pipeline = loader(model_path)
                self._video_pipelines[cache_key] = pipeline
                self._video_pipelines[target_model] = pipeline
                if target_model == self._video_model_id:
                    self._video_pipeline = pipeline
                self._video_error = None
                return pipeline
            except Exception as exc:
                self._video_error = str(exc)
                raise ModelUnavailableError(
                    f"failed to load video model '{target_model}': {exc}"
                ) from exc

    def unload_all(self) -> None:
        """Drop cached pipelines (used by tests and for VRAM reclamation)."""
        with self._lock:
            self._image_pipeline = None
            self._video_pipeline = None
            if hasattr(self, "_video_pipelines"):
                self._video_pipelines.clear()
