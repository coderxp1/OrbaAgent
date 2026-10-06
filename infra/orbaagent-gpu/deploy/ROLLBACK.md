# GPU Worker Rollback Procedure

Every step is reversible. **GPU 0 / CoderXP is never involved in any step** — the
OrbaAgent worker is a separate Docker project with its own container, network,
and image.

## 0. Decide the scope

| Scope | Go to |
| :--- | :--- |
| Worker misbehaving, host stays provisioned | §1 |
| Undo the delegation (sudoers, wrapper) | §2 |
| Undo the tunnel | §3 |
| Full removal from the host | §4 |
| Production-side rollback (ingest endpoint) | §5 |

## 1. Stop or disable the worker

```bash
# Stop and remove the worker container (keeps image, models, artifacts)
sudo orbaagent-gpu down

# Keep it installed but prevent it starting on boot
sudo docker compose --project-name orbaagent-gpu \
  -f /etc/orbaagent/gpu-worker/compose.yaml stop

# Recover from a crash loop
sudo orbaagent-gpu logs 200
sudo orbaagent-gpu down && sudo orbaagent-gpu up
```

The wrapper re-validates GPU isolation after every `up`, so a corrupted config
fails loudly instead of starting against the wrong GPU.

## 2. Revoke the delegation

```bash
sudo rm -f /etc/sudoers.d/orbaagent-gpu
sudo visudo -c                       # must still pass
sudo rm -f /usr/local/sbin/orbaagent-gpu
```

`klaus` immediately loses all ability to touch the worker. Nothing else is
affected: `klaus` was never in the `docker` group and never had Docker API access.

## 3. Tear down the tunnel

```bash
# GPU host
sudo systemctl disable --now wg-quick@wg-orba
sudo rm -f /etc/wireguard/wg-orba.conf
sudo ufw delete allow from 85.215.156.241 to any port 51820 proto udp
sudo ufw route delete allow in on wg-orba from 10.77.0.1 to 10.77.0.2 port 8190 proto tcp

# Production
sudo systemctl disable --now wg-quick@wg-orba
sudo rm -f /etc/wireguard/wg-orba.conf
```

Port 8190 was only ever bound to loopback and only reachable over the tunnel, so
removing the tunnel removes the last path to it.

## 4. Full removal

```bash
sudo orbaagent-gpu down
docker image rm orbaagent-gpu-worker 2>/dev/null || true

# The ACL grant on /srv/projects
sudo setfacl -x u:klaus /srv/projects

# Everything OrbaAgent owned. Models are re-downloadable; artifacts are not, so
# copy ./output elsewhere first if any generation is worth keeping.
sudo rm -rf /srv/projects/orbaagent-gpu
sudo rm -rf /etc/orbaagent

# §2 and §3 as well
```

**Do not** remove `/srv/projects` itself and **do not** touch
`/srv/projects/coderxp` — that belongs to the CoderXP workload.

## 5. Production-side rollback

The ingest endpoint is inert unless `ORBA_INTERNAL_INGEST_TOKEN` is set:
without it every request returns **503** and nothing touches the filesystem. So
there is nothing to undo for safety.

To remove the route entirely, deploy a revision without it:

```bash
cd /opt/orbaagent
git checkout --detach <previous-sha>
docker compose -f docker-compose.prod.yml up -d --no-deps api web
```

Rollback images from the last release are retained as
`orba-rollback-web:<sha>` / `orba-rollback-api:<sha>`.

Delete the ingest secret from the production environment when it is no longer
needed:

```bash
ssh deploy@85.215.156.241
# remove ORBA_INTERNAL_INGEST_TOKEN from /opt/orbaagent/.env, then:
docker compose -f docker-compose.prod.yml up -d --no-deps web
```

## 6. Rollback verification

After any rollback, confirm:

```bash
# Worker gone / stopped
sudo orbaagent-gpu status || true

# GPU 0 untouched — the headline check
nvidia-smi -i GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4 \
  --query-gpu=memory.used --format=csv,noheader     # ~10233 MiB, unchanged
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader
#   expect only: GPU-4634107e-..., 11416, python, ~10206 MiB

# Production unaffected
curl -s -o /dev/null -w '%{http_code}\n' https://orbaagent.dev/health          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://orbaagent.dev/app             # 200
```

## 7. Timings

| Scope | Expected |
| :--- | :--- |
| §1 stop worker | seconds; no production impact |
| §2 revoke delegation | immediate |
| §3 tunnel down | seconds; production keeps serving (media was already UNAVAILABLE) |
| §4 full removal | minutes; model deletion frees ~32 GB |
| §5 production | a container restart of `web` only (`--no-deps`) |

Production media capability is UNAVAILABLE throughout, so **no rollback here can
degrade a working feature** — the worker has never served generation to users.
