# GPU Worker Acceptance Procedure

A generation is **not** successful because the endpoint returned HTTP 200. It is
successful only when every item below holds. Run these in order; stop at the
first failure.

Nothing here enables media capability in production. Production must keep
reporting `image_generation = UNAVAILABLE` and `video_generation = UNAVAILABLE`
until **every** gate passes.

---

## Gate 0 — Preconditions (allocation of 2026-10-24: worker = GPU 0, GPU 1 = MOVA/Ollama)

The worker's GPU is no longer a constant in code. It is the **allocation policy** in
the root-owned `/etc/orbaagent/gpu-worker/worker.env`:

```
ORBA_WORKER_GPU_UUID=...            # the ONLY GPU the worker may use (host index 0)
ORBA_WORKER_GPU_INDEX=0             # checked against nvidia-smi, never used to select
ORBA_WORKER_FORBIDDEN_GPU_UUIDS=... # the MOVA/Ollama GPU (host index 1)
```

```bash
# Live identity of BOTH GPUs, by index. Record it; every later gate compares against it.
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name,memory.used --format=csv
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader

# The policy must describe THIS host (exit 0, table shows index 0 = WORKER, index 1 = FORBIDDEN)
sudo -n true && nvidia-smi --query-gpu=index,uuid,name --format=csv,noheader | \
  sudo PYTHONPATH=/etc/orbaagent/gpu-worker/src python3 -m orba_gpu.gpu_inventory \
    --policy-file /etc/orbaagent/gpu-worker/worker.env --check -
```

- [ ] `ORBA_WORKER_GPU_UUID` equals the UUID nvidia-smi reports at **index 0** (verified 2026-10-24: `GPU-4634107e-…`)
- [ ] `ORBA_WORKER_FORBIDDEN_GPU_UUIDS` equals the UUID at **index 1** (verified 2026-10-24: `GPU-82e03c6c-…`, where orbaagent-ollama is pinned and MOVA is reserved)
- [ ] `gpu_inventory --check` prints `inventory OK` and exits 0
- [ ] Baseline recorded: GPU 0 compute processes (expected: none), GPU 1 compute processes, ollama container ID, **no** `orbaagent-gpu-worker` container, **no** running orbaagent-comfyui

---

## Gate 1 — Isolation is enforced by configuration

Run offline, before starting anything. The validator reads the policy from the env file
and accepts hand-written YAML, `docker compose config` YAML and `--format json`:

```bash
sudo PYTHONPATH=/etc/orbaagent/gpu-worker/src python3 -m orba_gpu.deploy_validation \
  --policy-file /etc/orbaagent/gpu-worker/worker.env /etc/orbaagent/gpu-worker/compose.yaml
sudo orbaagent-gpu validate          # rendered config + live nvidia-smi inventory
```

- [ ] Both print `isolation OK: orbaagent-gpu-worker pinned to <GPU 0 UUID> … other GPU services: orbaagent-comfyui-><GPU 1>, orbaagent-ollama-><GPU 1>` and exit 0
- [ ] Tamper test A: in a **scratch copy** of worker.env set `ORBA_WORKER_GPU_UUID` to the GPU 1 UUID and run the validator with `--policy-file <scratch>` → exit **4**, message `forbidden GPU GPU-82e03c6c…` (proves a worker staged on GPU 1 is refused)
- [ ] Tamper test B: scratch worker.env with `ORBA_WORKER_GPU_UUID=` empty → `docker compose config` itself fails (`:?` guard) and `validate` exits 4

---

## Gate 2 — Only GPU 0 is visible inside the worker

Use the worker-scoped commands only. **Do not use `up`, `down` or `restart`** for this
rollout: `up` would start orbaagent-comfyui (must stay stopped) and `down`/`restart`
touch orbaagent-ollama (must stay untouched).

```bash
sudo orbaagent-gpu build             # worker image only
sudo orbaagent-gpu deploy-worker     # up -d --no-deps orbaagent-gpu-worker, then validate
docker exec orbaagent-gpu-worker nvidia-smi -L
docker exec orbaagent-gpu-worker nvidia-smi --query-compute-apps=gpu_uuid,pid --format=csv,noheader
```

- [ ] `nvidia-smi -L` lists **exactly one** GPU and its UUID is `ORBA_WORKER_GPU_UUID` (GPU 0)
- [ ] The GPU 1 UUID does **not** appear anywhere in the container
- [ ] `CUDA_VISIBLE_DEVICES` inside the container is `0` (container-local numbering, not a host index claim)
- [ ] `docker inspect orbaagent-gpu-worker` → `HostConfig.DeviceRequests[0].DeviceIDs == [<GPU 0 UUID>]`

---

## Gate 3 — GPU 1 (MOVA/Ollama) is untouched by the worker starting

```bash
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader
docker ps --no-trunc --format '{{.ID}} {{.Names}} {{.Status}}' | grep -E 'ollama|comfyui|worker'
```

- [ ] No process attributable to the worker on the GPU 1 UUID
- [ ] orbaagent-ollama container ID and `StartedAt` identical to Gate 0 (not recreated, not restarted)
- [ ] orbaagent-comfyui still not running
- [ ] Rollback rehearsal (optional, recommended before Gate 5): `sudo orbaagent-gpu down-worker` removes only the worker; ollama ID unchanged; then `deploy-worker` again

---

## Gate 4 — Honest unavailability before models load

```bash
sudo orbaagent-gpu health
```

With `MEDIA_GENERATION_BACKEND` set but no model loaded yet:

- [ ] `/health` returns 200
- [ ] `capabilities.image_generation` is **false**
- [ ] `capabilities.video_generation` is **false**
- [ ] `models.image.loaded` is false
- [ ] `unavailable_reason` explains that no model is loaded

- [ ] `POST /api/generate/image` returns **503** with
      `status == "MEDIA_GENERATION_UNAVAILABLE"` — **not** 200

---

## Gate 5 — Real image generation

```bash
TOKEN=$(sudo cat /srv/projects/orbaagent-gpu/secrets/media_worker_token)
curl -s -X POST http://127.0.0.1:8190/api/generate/image \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"a red fox in snow","width":1024,"height":1024,"steps":4,"seed":42}' \
  | tee /tmp/img.json
```

- [ ] Response `status == "COMPLETED"`
- [ ] `content_type == "image/png"`, `size_bytes > 0`, `sha256` is 64 hex chars
- [ ] **The FLUX model actually loaded** — check logs for weight loading, and
      `/health` now reports `models.image.loaded == true`
- [ ] The artifact exists on the GPU host under `output/`
- [ ] **Independent validation with Pillow** (do not trust the worker's own claim):

```bash
docker exec orbaagent-gpu-worker python3 - <<'PY'
from PIL import Image
import glob, os
p = sorted(glob.glob('/output/img_*.png'), key=os.path.getmtime)[-1]
with Image.open(p) as im:
    im.verify()
with Image.open(p) as im:
    print("file:", p)
    print("format:", im.format, "size:", im.size, "mode:", im.mode)
    assert im.format == "PNG" and im.size[0] > 0 and im.size[1] > 0
print("PILLOW VALIDATION: PASS")
PY
```

- [ ] `PILLOW VALIDATION: PASS`

---

## Gate 6 — Real video generation

```bash
curl -s -X POST http://127.0.0.1:8190/api/generate/video \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"a fox running through snow","duration_seconds":2,"fps":16,"width":480,"height":480}' \
  | tee /tmp/vid.json
```

- [ ] `status == "COMPLETED"`, `content_type == "video/mp4"`
- [ ] **Wan model actually loaded**; `/health` reports `models.video.loaded == true`
- [ ] **Independent validation with ffprobe**:

```bash
docker exec orbaagent-gpu-worker sh -c '
  f=$(ls -t /output/vid_*.mp4 | head -1)
  echo "file: $f"
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,avg_frame_rate,duration \
    -show_entries format=duration -of json "$f"
'
```

- [ ] ffprobe reports a real duration, resolution, and frame rate
- [ ] No `COMPLETED` was reported without the file existing

---

## Gate 7 — Concurrency guard

```bash
# Fire two generations at once; one must be refused, not OOM the GPU
( curl -s .../api/generate/image -d '{...}' & curl -s .../api/generate/image -d '{...}' & wait )
```

- [ ] One returns 200, the other returns **503 with `status: "BUSY"`**
- [ ] `nvidia-smi` shows no OOM and GPU 1 (MOVA/Ollama) is still untouched

---

## Gate 8 — Artifact ingestion into production

```bash
# On production, confirm the endpoint is live and authenticating
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://orbaagent.dev/api/internal/media/ingest   # 401 (no token)
```

- [ ] The response above is **401** (proof it is not unauthenticated), not 404
- [ ] A generation over the tunnel returns `delivered_to_production == true`
- [ ] `artifact_url` is present and retrievable from production
- [ ] Retrieving that URL returns 200 with the correct content type
- [ ] A cross-workspace fetch of the same artifact returns **403**
- [ ] Oversized and non-media payloads are rejected (413 / 415)

---

## Gate 9 — End-to-end from production

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://orbaagent.dev/app        # 200
```

- [ ] Production `/health` still 200, `postgres=up`, `redis=up`
- [ ] The generated artifact is retrievable **from production**, having never
      shared a filesystem with the GPU host
- [ ] Container restart counts on postgres/redis/minio/traefik unchanged

---

## Gate 10 — Only now may capability become available

- [ ] Gates 0–9 all pass
- [ ] `MEDIA_WORKER_ENABLED=true` and `MEDIA_WORKER_URL=http://10.77.0.2:8190`
      set **on production**, tokens configured
- [ ] Production capability reports AVAILABLE **because the worker reports a
      loaded backend**, not because a variable was set
- [ ] If any gate fails, production is reverted to `MEDIA_WORKER_ENABLED` unset,
      which immediately returns it to `UNAVAILABLE`

---

## Failure handling

Stop at the first failed gate and roll back per [ROLLBACK.md](ROLLBACK.md).
A failed generation must leave **no** partial artifact on disk — the worker
deletes it. If you find one, that is itself a defect worth reporting.
