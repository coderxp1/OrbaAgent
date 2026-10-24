"""OrbaAgent GPU media worker — entrypoint.

The implementation lives in the ``orba_gpu`` package so each concern is unit
testable in isolation. This file only boots uvicorn.

Run:  python worker.py
Env:  MEDIA_WORKER_TOKEN (required), MEDIA_WORKER_TOKEN_FILE (preferred),
      MEDIA_GENERATION_BACKEND, MEDIA_WORKER_GPU_UUID, MEDIA_MODELS_DIR,
      MEDIA_OUTPUT_DIR, MEDIA_INGEST_URL, MEDIA_INGEST_TOKEN

The worker is pinned to a single GPU by the container's device reservation and
NVIDIA_VISIBLE_DEVICES, both derived from the root-owned allocation policy
(ORBA_WORKER_GPU_UUID in worker.env). Every other GPU on the host is absent from
this container's device namespace. MEDIA_WORKER_GPU_UUID carries the same UUID so
the worker's own nvidia-smi queries target exactly the device it was given.
"""

from __future__ import annotations

import logging

import uvicorn

from orba_gpu.app import create_app
from orba_gpu.config import Settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("orba_gpu_worker")

app = create_app()


if __name__ == "__main__":
    settings = Settings.from_env()
    logger.info(
        "starting OrbaAgent GPU media worker on port %s (target GPU %s, backend '%s')",
        settings.port,
        settings.target_gpu_uuid,
        settings.backend or "unset",
    )
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
