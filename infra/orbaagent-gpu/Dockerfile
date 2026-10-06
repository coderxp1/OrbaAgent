FROM pytorch/pytorch:2.6.0-cuda12.6-cudnn9-runtime

WORKDIR /app

# ffmpeg provides both ffmpeg and ffprobe. ffprobe is required at runtime to
# validate generated video before success is reported.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# API surface plus the real generation runtime.
#
# diffusers/transformers/accelerate are what back MEDIA_GENERATION_BACKEND=diffusers.
# Without them a configured backend would fail at model-load time, which the worker
# surfaces as MODEL_UNAVAILABLE rather than fabricating output.
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    pydantic \
    pillow \
    diffusers \
    transformers \
    accelerate \
    safetensors \
    sentencepiece \
    imageio \
    imageio-ffmpeg

COPY orba_gpu /app/orba_gpu
COPY worker.py /app/worker.py

EXPOSE 8190

# MEDIA_WORKER_TOKEN is required at runtime; the worker refuses to start without it.
CMD ["python", "worker.py"]
