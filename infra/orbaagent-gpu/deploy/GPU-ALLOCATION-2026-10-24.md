# GPU allocation change 2026-10-24 — worker on GPU 0, GPU 1 reserved for MOVA

**Status: implementation for review. Nothing in this document is authorization to
install, build, pull, restart, run inference or deploy.** Deployment approval is a
separate, explicit decision by Paul Hartmann after review of the exact commit.

## Decision and evidence

| Item | Value | Source |
|---|---|---|
| Worker GPU | host index 0, `GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4`, PCI `01:00.0` | Agent 1 read-only inspection, issue #11, host UTC 2026-10-24T16:35:14Z |
| Forbidden for worker | host index 1, `GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878`, PCI `02:00.0` | same |
| GPU 1 occupants | orbaagent-ollama container (0 MiB at observation); MOVA model on disk, not running | same |
| GPU 0 occupants | none observed (idle ≠ unowned; reservation confirmed by Paul 2026-10-24) | same |
| Worker baseline | absent (no container, no 8190 listener, no process) | same |
| Installed compose | Oct-19 multi-service file pinning worker/comfyui/ollama to GPU 1 | same |
| Host tooling | Docker 29.1.3, Compose 2.40.3 | same |

Still **unverified** (daemon access denied to the inspecting account): docker image /
volume / network lists, ollama `StartedAt`, real `worker.env` keys, cached FLUX
model revision, sudoers content. These are Gate 0 items for a privileged operator.

## What changes (worker-scoped, in the existing files)

| File | Change |
|---|---|
| `compose.yaml`, `deploy/compose.yaml` | worker's three pins (`device_ids`, `NVIDIA_VISIBLE_DEVICES`, `MEDIA_WORKER_GPU_UUID`) → `${ORBA_WORKER_GPU_UUID:?…}`; render fails closed when unset. **ollama/comfyui blocks byte-for-byte unchanged** |
| `deploy/worker.env.example` | new policy keys `ORBA_WORKER_GPU_UUID` (GPU 0), `ORBA_WORKER_GPU_INDEX=0`, `ORBA_WORKER_FORBIDDEN_GPU_UUIDS` (GPU 1) |
| `orba_gpu/deploy_validation.py` | policy-driven (no UUID constants); structural checks on parsed config; accepts hand-written YAML, `docker compose config` YAML **and** `--format json` (Compose 2.40.x shapes: env map, long ports/volumes, `command: null`, `deploy.placement`, `extra_hosts` list, secret absolute targets, `ipam`); worker must pin the policy GPU on all three pins; forbidden GPU anywhere in the worker → fail; other services reported, not re-pinned |
| `orba_gpu/gpu_inventory.py` (new) | live `nvidia-smi` inventory vs policy: UUID present, at declared index, forbidden UUIDs real |
| `deploy/orbaagent-gpu` | no UUID constants; `validate` = rendered-config validator **+** live inventory, both reading `--policy-file worker.env`; new `down-worker` (`rm --stop --force orbaagent-gpu-worker`) |
| `deploy/sudoers-orbaagent-gpu` | `+ down-worker` exact rule (no wildcard) |
| `orba_gpu/config.py`, `worker.py` | `DEFAULT_TARGET_GPU_UUID = ""` (no silent default); docstrings |
| `deploy/ACCEPTANCE.md`, `deploy/ROLLBACK.md` | Gates 0–3 and rollback rewritten for the policy and worker-only scope |
| tests | `test_gpu_isolation`, `test_delegation`, `test_adversarial`, `test_config` updated; `test_gpu_allocation_policy.py` new (policy, env-file, rendering, Compose-2.40-shape, inventory, verified allocation, "worker staged on GPU 1 fails") |

Not changed: `provision-gpu-host.sh`, `bootstrap_provision.py`, `build_archive.py`,
`prepare_ltx_model.sh` (they still carry the old GPU-1 constants and are **not** to be
run for this rollout), MOVA branch files, production `docker-compose.prod.yml`,
web/API, secrets, volumes, networks, firewall.

## Operator procedure (after explicit approval only)

1. Gate 0 of `ACCEPTANCE.md` (live mapping, baseline, inventory check with the new source staged in a temp dir).
2. Preserve current `/etc/orbaagent/gpu-worker/{compose.yaml,worker.env,src/}`,
   `/usr/local/sbin/orbaagent-gpu`, `/etc/sudoers.d/orbaagent-gpu` with sha256 + modes
   into a root-only evidence directory.
3. Install from the approved commit: `src/orba_gpu/*` (incl. `gpu_inventory.py`),
   `compose.yaml`, wrapper (0755), sudoers (`visudo -cf` first, 0440). Append the three
   `ORBA_WORKER_*` keys to the **existing** `worker.env` (do not replace it; do not touch
   backend/model/tenant/ingest values). All via temp file + atomic rename.
4. Gate 1 (`validate`, tamper tests A/B). Any failure → stop, restore step 2, report.
5. Separate approval → `build`, `deploy-worker`; Gates 2–3. **Never `up`/`down`/`restart`.**
6. Gates 4–10 (health, FLUX image, ingest, user-visible artifact) each separately authorized.

Rollback: `ROLLBACK.md` → "Worker-only rollback" (`down-worker`, restore step-2 files;
baseline is *worker absent*, never a GPU-1 worker).

## Known limitations

- The Compose-2.40.3 render shape used in tests is modeled from Agent 1's documented
  output, not a captured render. The on-host `validate` against the real render is Gate 1.
- `up` still starts every service and `down`/`restart` still act project-wide (unchanged
  legacy semantics, still delegated). They are documented as forbidden for this rollout;
  removing them from sudoers is a separate decision.
- No pytest in the review environment; see the test report in the PR/branch description.
