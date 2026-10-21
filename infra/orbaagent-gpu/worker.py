"""OrbaAgent GPU media worker — entrypoint.

The implementation lives in the ``orba_gpu`` package so each concern is unit
testable in isolation. This file only boots uvicorn.

Run:  python worker.py
Env:  MEDIA_WORKER_TOKEN (required), MEDIA_WORKER_TOKEN_FILE (preferred),
      MEDIA_GENERATION_BACKEND, MEDIA_WORKER_GPU_UUID, MEDIA_MODELS_DIR,
      MEDIA_OUTPUT_DIR, MEDIA_INGEST_URL, MEDIA_INGEST_TOKEN

The worker is pinned to GPU 1 (GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878) by the
container's NVIDIA_VISIBLE_DEVICES. GPU 0 runs the CoderXP/ComfyUI workload and
is not present in this container's device namespace.
"""

from __future__ import annotations

import logging

import uvicorn

from orba_gpu.app import create_app
from orba_gpu.build_info import cached_source_fingerprint
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
        "starting OrbaAgent GPU media worker on port %s (target GPU %s, backend '%s', video model '%s')",
        settings.port,
        settings.target_gpu_uuid,
        settings.backend or "unset",
        settings.video_model_id,
    )
    # Deployed-version identification (G4): the boot log carries the
    # source fingerprint and effective model configuration, so an
    # operator can prove which code and config this process runs.
    logger.info("worker source fingerprint: %s", cached_source_fingerprint())
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
