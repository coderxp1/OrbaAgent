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
    ) -> None:
        self._models_dir = models_dir
        self._output_dir = output_dir
        self._backend = backend
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
    def image_ready(self) -> bool:
        """True only when an image pipeline is actually loaded in memory."""
        return self._image_pipeline is not None

    @property
    def video_ready(self) -> bool:
        return self._video_pipeline is not None

    def status(self) -> dict:
        return {
            "backend_configured": self._backend or None,
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
                requested=self._backend in ("diffusers", "comfyui"),
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

    def load_video(self) -> Any:
        """Load (or return the cached) video pipeline."""
        with self._lock:
            if self._video_pipeline is not None:
                return self._video_pipeline
            if self._backend == "comfyui":
                from .backends.comfyui_backend import ComfyUIBackend
                self._video_pipeline = ComfyUIBackend(self._models_dir)
                self._video_error = None
                return self._video_pipeline
            if self._backend != "diffusers":
                raise BackendNotImplementedError(
                    "video generation requires MEDIA_GENERATION_BACKEND=diffusers or comfyui"
                )
            loader = self._resolve_loader("video")
            try:
                model_path = resolve_model_path(self._models_dir, self._video_model_id)
                self._video_pipeline = loader(model_path)
                self._video_error = None
            except Exception as exc:
                self._video_error = str(exc)
                raise ModelUnavailableError(
                    f"failed to load video model '{self._video_model_id}': {exc}"
                ) from exc
            return self._video_pipeline

    def unload_all(self) -> None:
        """Drop cached pipelines (used by tests and for VRAM reclamation)."""
        with self._lock:
            self._image_pipeline = None
            self._video_pipeline = None
