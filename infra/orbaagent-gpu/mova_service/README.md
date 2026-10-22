# MOVA service

Fail-closed HTTP shim around the pinned OpenMOSS/MOVA inference script
(`scripts/inference_single.py`), so the Orba media worker can request
MOVA-720p video generation over the private compose network.

- Model: `OpenMOSS-Team/MOVA-720p` @ revision
  `8462bea9a317a3591279faeedfd3ca01b055cb59` (Apache-2.0), mounted
  read-only at `/models/mova-720p`. Never downloaded at runtime.
- Code: OpenMOSS/MOVA @ `1591b2557b42030a3421442c998dd6f5602ed9bd`,
  cloned and verified in the image build.
- `GET /health` — reports model id, revision, checkpoint presence.
  The worker refuses to mark video ready unless all three match the pin.
- `POST /generate` — runs one inference (serialized; `cp_size=1`,
  configurable offload/attention), returns the MP4 bytes or an HTTP
  error with the inference log tail. No fallback model exists here.
- Auth: `Authorization: Bearer <token>` from `MOVA_SERVICE_TOKEN` or
  `MOVA_SERVICE_TOKEN_FILE` (Docker secret). No token → no start.

GPU: the compose service pins the same single GPU as the worker and
Ollama (GPU 1 on migrol-ag-gpu-worker01). Inside the container the
device is index 0; the service sets `CUDA_VISIBLE_DEVICES=0` for the
inference subprocess.
