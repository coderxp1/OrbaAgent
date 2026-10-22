"""MOVA inference service.

A thin, fail-closed HTTP shim around the pinned OpenMOSS/MOVA inference
script. It exists so the Orba media worker can request MOVA video
generation over the private compose network without sharing a process,
a GPU context, or a filesystem with the model runtime.

Rules:
* The checkpoint is mounted read-only and is NEVER downloaded here.
  /health reports whether it is present; generation refuses without it.
* Jobs are serialized with a lock: one inference at a time. A second
  request waits; it is never run concurrently against the same GPU.
* Any failure — bad payload, inference exit != 0, missing/empty output —
  is an HTTP error with the log tail. There is no fallback model.
* Auth: a shared bearer token (MOVA_SERVICE_TOKEN or its _FILE), compared
  in constant time. No token configured -> the service refuses to start.
"""

from __future__ import annotations

import base64
import hmac
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

MODEL_ID = "OpenMOSS-Team/MOVA-720p"
MODEL_REVISION = "8462bea9a317a3591279faeedfd3ca01b055cb59"
REPO_COMMIT = "1591b2557b42030a3421442c998dd6f5602ed9bd"

CKPT_PATH = os.environ.get("MOVA_CKPT_PATH", "/models/mova-720p")
REPO_DIR = os.environ.get("MOVA_REPO_DIR", "/opt/mova/repo")
WORK_DIR = Path(os.environ.get("MOVA_WORK_DIR", "/tmp/mova-jobs"))
JOB_TIMEOUT_SECONDS = int(os.environ.get("MOVA_JOB_TIMEOUT_SECONDS", "1800"))

#: Runner signature: (argv, env, timeout_seconds) -> (returncode, combined_output)
Runner = Callable[[list, dict, int], "tuple[int, str]"]


def _load_token() -> str:
    token_file = os.environ.get("MOVA_SERVICE_TOKEN_FILE", "")
    if token_file:
        try:
            return Path(token_file).read_text(encoding="utf-8").strip()
        except OSError:
            return ""
    return os.environ.get("MOVA_SERVICE_TOKEN", "").strip()


SERVICE_TOKEN = _load_token()


def _default_runner(argv: list, env: dict, timeout: int) -> "tuple[int, str]":
    merged_env = dict(os.environ)
    merged_env.update(env)
    try:
        proc = subprocess.run(
            argv,
            env=merged_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout or ""
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        return 124, f"{out}\n[inference timed out after {timeout}s and was killed]"


RUNNER: Runner = _default_runner


def ckpt_present() -> bool:
    return (Path(CKPT_PATH) / "model_index.json").is_file()


def build_inference_argv(payload: "GenerateRequest", ref_path: Path, out_path: Path) -> list:
    return [
        sys.executable,
        "-m",
        "torch.distributed.run",
        "--nproc_per_node=1",
        "--master_port=29521",
        str(Path(REPO_DIR) / "scripts" / "inference_single.py"),
        "--ckpt_path",
        CKPT_PATH,
        "--cp_size",
        "1",
        "--offload",
        payload.offload,
        "--attn_type",
        payload.attn_type,
        "--num_frames",
        str(payload.num_frames),
        "--fps",
        str(payload.fps),
        "--height",
        str(payload.height),
        "--width",
        str(payload.width),
        "--prompt",
        payload.prompt,
        "--negative_prompt",
        payload.negative_prompt,
        "--ref_path",
        str(ref_path),
        "--output_path",
        str(out_path),
        "--seed",
        str(payload.seed),
        "--num_inference_steps",
        str(payload.num_inference_steps),
    ]


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    negative_prompt: str = ""
    ref_image_b64: str = Field(min_length=1)
    num_frames: int = Field(ge=17, le=241)
    fps: int = Field(ge=1, le=60)
    width: int = Field(ge=64, le=1920)
    height: int = Field(ge=64, le=1920)
    seed: int = 1
    num_inference_steps: int = Field(default=50, ge=1, le=200)
    offload: str = "cpu"
    attn_type: str = "fa"


def create_app(runner: Optional[Runner] = None) -> FastAPI:
    if not SERVICE_TOKEN:
        raise RuntimeError(
            "MOVA service token is not configured (MOVA_SERVICE_TOKEN or "
            "MOVA_SERVICE_TOKEN_FILE); refusing to start an unauthenticated "
            "inference endpoint"
        )
    run = runner or RUNNER
    app = FastAPI(title="orba-mova-service")
    lock = threading.Lock()

    def authorize(authorization: Optional[str]) -> None:
        expected = f"Bearer {SERVICE_TOKEN}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/health")
    def health(authorization: Optional[str] = Header(default=None)):
        authorize(authorization)
        return {
            "status": "ok",
            "model_id": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "repo_commit": REPO_COMMIT,
            "ckpt_path": CKPT_PATH,
            "ckpt_present": ckpt_present(),
            "busy": lock.locked(),
        }

    @app.post("/generate")
    def generate(
        payload: GenerateRequest,
        request: Request,
        authorization: Optional[str] = Header(default=None),
    ):
        authorize(authorization)
        if payload.offload not in ("none", "cpu", "group"):
            raise HTTPException(status_code=400, detail=f"unsupported offload '{payload.offload}'")
        if payload.attn_type not in ("fa", "torch_flash", "torch_efficient"):
            raise HTTPException(status_code=400, detail=f"unsupported attn_type '{payload.attn_type}'")
        if not ckpt_present():
            raise HTTPException(
                status_code=503,
                detail=f"MOVA checkpoint not present at {CKPT_PATH}; refusing to generate",
            )
        try:
            ref_bytes = base64.b64decode(payload.ref_image_b64, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"ref_image_b64 is not valid base64: {exc}") from exc
        if not ref_bytes:
            raise HTTPException(status_code=400, detail="ref_image_b64 decoded to zero bytes")

        with lock:
            WORK_DIR.mkdir(parents=True, exist_ok=True)
            job_dir = Path(WORK_DIR) / f"job-{os.getpid()}-{threading.get_native_id()}"
            job_dir.mkdir(parents=True, exist_ok=True)
            ref_path = job_dir / "ref.png"
            out_path = job_dir / "output.mp4"
            ref_path.write_bytes(ref_bytes)
            argv = build_inference_argv(payload, ref_path, out_path)
            # The container is pinned to exactly one GPU by compose; inside
            # the container that device is index 0.
            returncode, output = run(argv, {"CUDA_VISIBLE_DEVICES": "0"}, JOB_TIMEOUT_SECONDS)
            if returncode != 0:
                tail = output[-2000:]
                raise HTTPException(
                    status_code=502,
                    detail=f"MOVA inference failed with exit code {returncode}. Log tail: {tail}",
                )
            if not out_path.is_file() or out_path.stat().st_size == 0:
                tail = output[-2000:]
                raise HTTPException(
                    status_code=502,
                    detail=f"MOVA inference exited 0 but produced no output file. Log tail: {tail}",
                )
            return FileResponse(
                str(out_path),
                media_type="video/mp4",
                filename="mova-output.mp4",
            )

    return app


app = None


def main() -> None:
    global app
    import uvicorn

    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("MOVA_SERVICE_PORT", "8200")))


if __name__ == "__main__":
    main()
