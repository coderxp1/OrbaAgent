# OrbaAgent worker-only deployment and rollback runbook

Sources inspected: the attached *ORBA Product & Technical Blueprint v1*, pp. 10, 13–14; repository main at the exact base below; [mediaWorkerConfig.ts](https://raw.githubusercontent.com/coderxp1/OrbaAgent/586f3f51271421ddd4aae54f55828730ac05337e/services/agent-runtime/src/tools/mediaWorkerConfig.ts), [generation.py](https://raw.githubusercontent.com/coderxp1/OrbaAgent/586f3f51271421ddd4aae54f55828730ac05337e/infra/orbaagent-gpu/orba_gpu/generation.py), [existing ingest route](https://raw.githubusercontent.com/coderxp1/OrbaAgent/586f3f51271421ddd4aae54f55828730ac05337e/apps/web/src/app/api/internal/media/ingest/route.ts), and [open PR #10](https://github.com/coderxp1/OrbaAgent/pull/10). Code inspection and historical PR reports are not evidence of the currently running system.

**Status: prepared for review only. Do not execute installation, builds, pulls, inference, deployment or restarts without separate approval.**

Base: `coderxp1/OrbaAgent` main, `586f3f51271421ddd4aae54f55828730ac05337e`. Scope: the additive `infra/orbaagent-gpu/deploy/worker-only/` package. This package supersedes the earlier unshipped allocation draft; it does not change the legacy multi-service Compose files, application source, production Compose, existing sudoers, Ollama, ComfyUI, MOVA, models or firewall.

## 1. Evidence and authorization boundary

**User-reported live findings:** on `migrol-ag-gpu-worker01`, an operator confirmed the GPU index-to-UUID mapping, the Orba worker's absence, and a running Ollama service. Actual UUID values and timestamped output have not been supplied to this implementation session. Current ownership of every other GPU service/host is NOT established.

**No inference from old documentation:** a historical UUID, PID, container name or a momentarily idle GPU is not ownership evidence. The GPU-host policy is not transferable to any other server. No historical UUID is a default in this package.

**Agent 1 handoff:** [issue #11](https://github.com/coderxp1/OrbaAgent/issues/11). Direct agent discovery failed; the issue is a coordination request, not proof Agent 1 has received or approved it. Obtain Agent 1's reply or an authorized operator's equivalent evidence before installation/deployment.

Required evidence, with hostname and UTC time:

| Evidence | Pass condition |
|---|---|
| Live index, UUID, PCI bus and model | Exact UUID at host index 0 and distinct UUID at index 1 recorded from this host |
| Compute processes and ownership | Every GPU 0 occupant mapped to process/container/service, owner and project; owner explicitly authorizes the proposed sharing/VRAM/concurrency budget |
| GPU 1 occupants | Enumerated for MOVA planning; no assertion that GPU 1 is exclusive while Ollama/another workload occupies it |
| Worker state | Confirm absent immediately before this initial deployment; unexpected existing container is a STOP, not permission to replace it |
| Unrelated containers | IDs, image IDs, StartedAt and restart counts captured, especially Ollama, ComfyUI and any MOVA instance |
| Installed state | Existing compose/wrapper/runtime-env hashes and root ownership/modes; no token values or full environment dumps |
| Local image | Exact approved repository digest, local image ID, source provenance, dependency versions and vulnerability review; image is already available locally |
| Existing resources | Exact named volumes and private bridge network, disk space, approved model files and revisions; no network/volume creation by this rollout |
| Private connectivity | Existing WireGuard route, 8190 binding, existing ingest hostname/address and proxy routing confirmed; no firewall/public endpoint changes |
| Permissions | Root-controlled configuration, source and ancestors; no write ACL for delegated users; existing sudoers reviewed, no Docker-group grant |
| Rollback record | Baseline worker absence recorded; old wrapper/config preserved; local image and model volumes not pruned |

Minimal READ-ONLY operator procedure, on the actual GPU host (administrator privileges where needed):

```bash
hostname
date -u +%FT%TZ
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name,memory.total,memory.used --format=csv
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
sudo /usr/bin/docker container ls -a --no-trunc \
  --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}}'
sudo /usr/bin/docker compose version
sudo /usr/bin/docker volume ls
sudo /usr/bin/docker network ls
sudo stat -c '%U:%G %a %n' /etc/orbaagent/gpu-worker \
  /etc/orbaagent/gpu-worker/compose.yaml /etc/orbaagent/gpu-worker/worker.env \
  /usr/local/sbin/orbaagent-gpu
sudo sha256sum /etc/orbaagent/gpu-worker/compose.yaml \
  /etc/orbaagent/gpu-worker/worker.env /usr/local/sbin/orbaagent-gpu
```

For each observed PID, inspect `ps -o pid,ppid,user,lstart,comm -p "$PID"` and `/proc/$PID/cgroup`; correlate to **observed** container IDs and service owners. Do not infer ownership from UUID/index or kill anything. For each observed non-worker container, capture filtered inspection of `.Id`, `.Image`, `.State.StartedAt`, `.RestartCount`, `.HostConfig.DeviceRequests`, `.HostConfig.RestartPolicy` and Compose project/service labels. Avoid `.Config.Env` dumps and unrestricted logs. Restricted `getfacl`/`namei -l` checks may be done by an administrator; do not grant these commands to the delegated user just for this task.

Stop on unknown GPU 0 ownership, insufficient budget, changed mapping, unexpected worker presence, missing artifacts, conflicting port, unknown ingest routing, failed checks, or missing approval. Inventory validation proves identity, not ownership or capacity.

## 2. What the proposed controls do

Install locations after approval:

- `/etc/orbaagent/gpu-worker/worker-only/{control.py,compose.yaml,allocation.env,control.lock}`
- `/usr/local/sbin/orbaagent-gpu` becomes the reviewed wrapper shim.
- Existing `/etc/orbaagent/gpu-worker/worker.env` and `/etc/orbaagent/gpu-worker/secrets/` are reused without overwriting or sourcing their values in a shell.

`allocation.env` contains only the five keys in the example. Populate it exclusively from live evidence: worker UUID at host index 0, forbidden/MOVA UUID at host index 1, approved local immutable image digest, observed existing private Docker network name, and the recorded ownership approval reference. Empty/missing values fail. No UUID is generated or guessed. The reference is an operator attestation, not a cryptographically verified approval workflow.

The worker-only manifest has exactly one service, no `build`, no dependency services, `pull_policy: never`, `restart: "no"`, and external-only existing volumes/network. Automatic daemon restarts are deliberately disabled because they bypass preflight checks. Availability/restart automation is a separate design decision, not silently enabled here.

All Compose subprocesses receive a clean environment and both fixed env files. Parsed normalized JSON must match the narrow policy; snippets, extra service keys, device mounts, host namespaces, public ports, broad GPU selectors, extra env settings and configuration drift fail closed. The host mapping is checked immediately before a deployment/restart. A restart additionally checks the *actual running* container image, device requests, environment, mounts, ports, networks and security settings; a safe desired file cannot hide an unsafe running container.

The wrapper permits `validate`, `deploy-worker`, `restart-worker`, `health`, `status`, `logs [1..2000]`, `help`. Legacy `up`, `down`, `restart` and `build` are disabled. Existing sudoers needs no expansion. Root-owned lock serialization prevents two wrapper actions from overlapping; administrators must still avoid concurrent external Docker/config changes. Locks and filesystem modes do not defend against an administrator deliberately bypassing the wrapper.

`validate` is read-only but requires the approved image, resources and configuration to exist. It checks the desired config and live mapping, NOT successful GPU inference or actual device namespace visibility. Host Python needs only its standard library; Docker Compose must support normalized JSON config and the documented flags. Unsupported serialization fails closed and must be reviewed, not bypassed.

## 3. Future installation and deployment — NOT authorized now

1. Approve the exact branch target commit and this runbook. Resolve issue #11. Record the fresh absence baseline and freeze concurrent wrapper/config administration for the change window.
2. An administrator stages files from that exact reviewed revision. Inspect hashes on the operator machine and host. Preserve the entire old wrapper and relevant config with owner/mode in a **unique root-only evidence directory**. Preserve image metadata and the before-container inventory. Keep backups outside delegated write paths; never copy secrets to a public artifact or issue.
3. Create the new root-only control directory and lock; stage `control.py`/`compose.yaml` root:root 0644, allocation.env and lock 0600, directories root-owned and not group/other-writable. Do not replace legacy Compose or worker.env. Supply an already-approved, preloaded image by repository digest. No building or pulling is part of this procedure.
4. Confirm the existing worker.env explicitly supplies backend `diffusers`, image model `black-forest-labs/FLUX.1-schnell`, the already-approved video model, workspace and existing ingest destination. If any setting is absent or differs, STOP: do not replace worker.env with an example or silently change model/backend. Get approval for the additional change. New wrapper source fingerprint is not the worker image source fingerprint; record both separately.
5. Run the staged controller's `validate` as administrator with Python isolated mode. Install the reviewed shim via a same-filesystem temporary file and atomic rename, after saving the old shim. Verify root:root 0755 and bytes, then run the fixed installed wrapper's `validate`. Do not invoke the legacy wrapper's `build`, `up`, `down` or `restart` during transition. If staging/install fails, restore saved files before any container operation. File installation is a multi-step administrative transaction, not claimed to be crash-atomic; keep an exact journal and backups.
6. Obtain **separate deployment approval**, refresh mapping, workload/ownership evidence, resource budget and absence check. The authorized command is:

```bash
sudo /usr/local/sbin/orbaagent-gpu validate
sudo /usr/local/sbin/orbaagent-gpu deploy-worker
sudo /usr/local/sbin/orbaagent-gpu status
sudo /usr/local/sbin/orbaagent-gpu health
```

The only mutation is `docker compose ... up --detach --no-deps --no-build --pull never --force-recreate orbaagent-gpu-worker` against the separate one-service manifest. It cannot build/pull/start ComfyUI or recreate Ollama/MOVA. It neither brings down a project nor removes orphans. No production website/API command is involved. A post-check failure is reported as failure; automatic rollback is NOT claimed. Follow section 5.

7. Compare every non-worker baseline container ID/image/StartedAt/restart count and GPU process to the before inventory. Normal memory fluctuation is not proof of a restart; use identities and process continuity. Any unexpected change blocks acceptance and requires investigation, not more restarts.

## 4. Post-deployment acceptance — separately authorized

### A. Identity, isolation and health

- Record new worker container ID, local image ID, repository digest, image/source provenance, start time, labels and wrapper/control hashes.
- Verify actual `HostConfig.DeviceRequests` names only the live UUID of host GPU 0. `NVIDIA_VISIBLE_DEVICES` and `MEDIA_WORKER_GPU_UUID` must match it; `CUDA_VISIBLE_DEVICES=0` means container-local device numbering, NOT a second claim about host ordering.
- Administrator runs the fixed read-only inspection `docker exec orbaagent-gpu-worker nvidia-smi --query-gpu=uuid,name --format=csv,noheader`. Require exactly one row matching that UUID; the live GPU 1 UUID must not be exposed. This command is an operator acceptance check, not a new general-purpose delegated exec capability.
- With the trusted image's Python/Torch, check `torch.cuda.device_count()==1` and device properties; preserve results. Do not confuse NVML output alone with CUDA visibility. Capture GPU process UUIDs while the authorized inference runs.
- Confirm private host binding `10.77.0.2:8190`, no public host binding, unchanged existing network/firewall and non-worker services.
- Authenticated `/health` must report `gpu.available=true`, the correct `gpu.device_uuid`, `generation_backend=diffusers`, expected model IDs and concurrency one. Lazy-loading capabilities can be false before inference; healthy HTTP is not generation readiness. Main does not provide PR #10's source fingerprint; prove image provenance through the approved digest, not a nonexistent field.
- Missing/invalid authentication must be refused. Do not paste tokens into shell history, process arguments, issues or logs.

### B. Real FLUX generation and existing ingest delivery

Before inference, verify the actual cached FLUX model revision/required files and CUDA/Torch compatibility. No dependency installation or weight download is authorized by this runbook. If artifacts are missing, obtain separate approval for supply/provisioning.

After separate inference/write approval, submit ONE image request (no automatic retry on timeout) through Orba's existing interface in the intended project/workspace. Suggested prompt: “A ceramic orange sphere on a dark blue table, studio photograph.” Request PNG, 512x512, 4 steps, fixed seed 42. Observe the existing tool call path and job; do not enable production features or change runtime settings here. If the existing interface is disabled/unreachable, report the gate blocked and use an explicitly approved direct worker smoke test only as partial evidence.

Direct-worker test payload, when separately authorized:

```json
{"prompt":"A ceramic orange sphere on a dark blue table, studio photograph","width":512,"height":512,"steps":4,"seed":42,"output_format":"png"}
```

Send it to the existing private worker `/api/generate/image` with the existing secret read from its protected file inside the operator process. Add the **verified** existing workspace if needed; never invent a tenant. Use a bounded timeout suitable for cold model loading and preserve request timestamp/job ID. A timeout has ambiguous execution status: investigate the current job, do not retry blindly.

All of these must pass:

1. Actual GPU inference ran on the approved UUID, with no process attributable to this worker on GPU 1. Record model revision, request, effective parameters, job ID and timing.
2. A nonempty PNG exists, decodes fully, and has 512x512 dimensions. Record actual byte count and SHA-256; inspect the image for obvious garbage or placeholder content.
3. Worker result indicates **`delivered_to_production: true`**, a nonempty `artifact_id`/`artifactId` and `artifact_url`/`artifactUrl`. HTTP 200, a local path, `COMPLETED`, or a thumbnail alone is insufficient. In the inspected `app.py`, `_finalize` can return `status: "COMPLETED"` even when delivery failed and includes local path fields. Therefore the explicit delivery flag plus independent authorized retrieval/hash/decode checks are mandatory. Undelivered output remains incomplete even if inference succeeded.
4. Existing ingestion is used: worker `ingest.py` -> configured `MEDIA_INGEST_URL` -> web `/api/internal/media/ingest`. It uses the existing dedicated bearer secret corresponding to `ORBA_INTERNAL_INGEST_TOKEN`, multipart file, allowed workspace, generated server-side filename, MIME sniffing and size validation. Do not add a new endpoint, bypass tenant checks, use a public upload fallback, or copy files manually to simulate delivery.
5. Retrieve the returned `/api/artifacts/...` URL through the application's existing authorized access flow from a real user session. Verify MIME, byte count, decode and SHA-256 against the worker's generated bytes. Render/download it through the Orba UI and confirm the intended workspace/project. An administrator-only successful curl is not user-delivery proof.
6. Existing private routing works for the approved ingest URL: HTTP WireGuard address or existing HTTPS hostname mapped to `10.77.0.1`. Preserve whichever is actually deployed; do not weaken TLS or rewrite proxy/API configuration to make the test pass.
7. Retain evidence with the artifact, source/model/provenance and permissions. Do not delete a production artifact as an unapproved “cleanup.”

The ingest route performs `request.formData()` before its file-size check, so its application-level limit is not evidence of a streaming request-body limit. Reverse-proxy/body size limits and cross-project artifact authorization need their own verification; this worker-only patch does not solve them.

### C. Video and broader blueprint goals

A passed FLUX image gate does NOT establish T2V, I2V, editing, speech, captions or MOVA. Keep each capability explicitly unverified until its own request-to-delivered-file acceptance passes. Verify the configured video backend/model revision without changing it here; decode the actual MP4 with ffprobe, check dimensions, duration/FPS, nonzero motion and any requested audio. For I2V, prove the selected attachment's hash chain through tool, worker and output metadata; no basename fallback or wrong-project asset substitution. PR #10 contains related integrity/source-fingerprint work and remains separate; this package neither merges nor deploys it. MOVA testing remains a separate project/allocation and is not started by this manifest.

Blueprint §§26–28 and 35 require actual creative artifacts, project/provenance/permission context, verified completion, and separation between agent decisions and worker execution. This change addresses one infrastructure prerequisite, not the complete media engine or autonomous development platform.

## 5. Worker-only rollback

### Initial rollout: baseline worker ABSENT (the currently reported case)

1. Stop submitting new Orba media jobs; preserve failure evidence. Do not stop Ollama, ComfyUI, MOVA or the website/API.
2. Administrator resolves the **new worker's exact container ID** and verifies its exact name plus Compose project/service labels. Stop/remove **only that verified container ID** using `docker container stop "$WORKER_ID"` and `docker container rm "$WORKER_ID"`. Never use project-wide `down`, `rm -f` wildcards, `--remove-orphans`, volume deletion, system prune or model deletion. A hung container requires explicit escalation before a forced stop.
3. Confirm worker absence. This restores the observed service baseline; there is **no old running worker image to recreate**. Do not boot a historical GPU 1 worker as “rollback.”
4. Restore the saved wrapper bytes/mode by atomic rename as the last config step if reverting the administrative installation. Remove/archive only files newly installed by this change after confirming no operation uses them. Preserve the evidence/lock journal, secrets, original worker.env, all named volumes, models, existing network, other containers and firewall.
5. Recompare unrelated containers and GPU processes against baseline. Record that generation is unavailable because the worker is absent; do not label rollback successful before absence and unrelated workload continuity are verified. The restored legacy wrapper contains broad operations—do not invoke them.

### Later worker-to-worker upgrade

A different baseline requires a separately approved rollback record: save the prior **worker-only** manifest/policy, wrapper/control files, immutable image digest and local image ID, plus current running identity. Retain the old image locally without retagging a mutable tag. Restore that approved worker-only configuration and perform the same validation-before-deployment against the current live mapping and ownership; use no-build/no-pull/no-deps deployment of only the worker. If the old image or policy is no longer safe, stop only the new worker and escalate; never rebuild, repin to a historical UUID or restart another service to force rollback. This package does not automate crash recovery or transactional file restoration.

## 6. Review limitations and next decisions

- No host connectivity, installation, Docker build/pull/render, restart, deployment, GPU inference or ingest write was performed in this review session.
- Real Docker/Compose serialization compatibility and local image availability remain operator gates. Fail-closed incompatibility is not permission to bypass validation.
- The earlier broad-validator draft and shim-based checks are not the shipped implementation. Legacy provisioning/bootstrap scripts still encode old allocation assumptions; do not run them for this rollout.
- Runtime token/workspace/ingest settings and image source provenance must be reconciled with the host. Full application tests and real GPU acceptance remain outstanding.
- Before approval: finish Agent 1 ownership handoff, review the code, run the targeted suite under actual pytest if desired, run a read-only Docker Compose render with approved configuration, and approve the exact image/source/rollout separately. After approval: install controls, validate, deploy only worker, verify FLUX plus user-visible artifact delivery, then independently validate video goals.
