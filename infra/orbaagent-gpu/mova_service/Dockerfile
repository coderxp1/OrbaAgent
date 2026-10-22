# MOVA inference service image.
#
# Mirrors the isolated test image that produced the verified output on
# migrol-ag-gpu-worker01 (python:3.13-slim + torch 2.8.0 cu128 + the
# OpenMOSS/MOVA repo), with two production differences:
#   * the MOVA repo is cloned at the PINNED commit below (build fails if
#     the checkout does not match), and
#   * the entrypoint is the FastAPI service instead of a bare shell.
#
# The model checkpoint is NOT baked into this image. It is mounted
# read-only at /models/mova-720p from the host's pinned download
# (/srv/orba-mova/model, revision 8462bea9a317a3591279faeedfd3ca01b055cb59).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git curl ca-certificates \
    build-essential cmake ninja-build \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cu128 \
    torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0

ARG MOVA_REPO_COMMIT=1591b2557b42030a3421442c998dd6f5602ed9bd
WORKDIR /opt/mova
RUN git clone https://github.com/OpenMOSS/MOVA repo \
    && git -C repo checkout ${MOVA_REPO_COMMIT} \
    && test "$(git -C repo rev-parse HEAD)" = "${MOVA_REPO_COMMIT}"

WORKDIR /opt/mova/repo
RUN python -m pip install --no-cache-dir -e .

# bitsandbytes is a RUNTIME dependency of the pinned MOVA inference
# import chain, despite being declared only in MOVA's `train` extra:
# scripts/inference_single.py imports mova.diffusion.pipelines, whose
# __init__ also imports the training pipeline, which pulls in
# mova.engine.optimizers -> bnb_optimizers -> `from bitsandbytes
# import optim` at module level. A plain `pip install -e .` therefore
# produces an image whose first inference crashes with
# ModuleNotFoundError (proven on the GPU host, Test A attempt 1,
# 2026-10-22). Pinned to the version verified working in the isolated
# host environment; the import assertion makes the build fail loudly
# if this ever regresses.
RUN python -m pip install --no-cache-dir "bitsandbytes==0.50.2" \
    && python -c "import bitsandbytes; print('bitsandbytes', bitsandbytes.__version__)"

RUN python -m pip install --no-cache-dir "fastapi>=0.110" "uvicorn>=0.29" "pydantic>=2"

WORKDIR /opt/mova-service
COPY app.py /opt/mova-service/app.py

EXPOSE 8200
CMD ["python", "app.py"]
