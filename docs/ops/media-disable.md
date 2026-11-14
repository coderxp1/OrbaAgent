# Runbook: temporarily disable GPU-dependent image/video generation (VPS-only)

> Status: **DRAFT, do not execute** until the owner has reviewed PR #13, the
> backup procedure (section 1) and this runbook.

**Why:** the H200 GPU server that hosted the media worker (`10.77.0.2:8190`) is
decommissioned. While `MEDIA_WORKER_ENABLED` is on, every image/video request
waits on a dead health check (~3 s, plus up to 1.2 s capability probing per turn)
and then surfaces an internal error.

**Scope:** this change affects only GPU-dependent media generation. Only the
`web` and `api` containers are recreated, with the **same images**: only their
environment changes. Postgres, Redis, MinIO, the proxy and the
`orba_uploads_data` volume are not touched. Existing images and videos, chat,
uploads, auth and all other tools are unaffected.

**Secret hygiene:** the override blanks `MEDIA_WORKER_URL` and
`MEDIA_WORKER_TOKEN` inside the containers. The old token (exposed in commit
`ce342e9`, fingerprint `sha256:25c785461228…`) is compromised. Step 3 removes it
from `/opt/orbaagent/.env`. Never print it.

## Two stages: what each one delivers

| Stage | What changes | User-visible result |
|---|---|---|
| **A. Env-only override** (this runbook) | `MEDIA_WORKER_ENABLED=false`, `MEDIA_WORKER_DISABLED=true`, blank URL/token; `--no-build` | Media fails **immediately**, with no network call and no 3 s wait. The message text is whatever the *running* `d91a117` image produces (likely the old wording, which names `MEDIA_WORKER_ENABLED`). |
| **B. Code deploy** (separate, later) | Ship PR #13's `publicMediaUnavailableMessage()` in a reviewed release candidate | Users see: *"Image/Video generation is temporarily unavailable. Existing images and videos are not affected. Please try again later."* |

Stage B requires a reviewed release candidate and deployment procedure. It is
**not** part of this runbook.

## 0. Preflight (read-only)

```bash
cd /opt/orbaagent
git rev-parse --short HEAD; git status --short | wc -l
# The running image must already implement the kill-switch. Expect file names, not "NONE":
docker compose -f docker-compose.prod.yml exec -T web sh -c \
  'grep -rl "MEDIA_WORKER_ENABLED" /app/services/agent-runtime/dist 2>/dev/null | head -3 || true; echo END'
```

If no file in the running image references `MEDIA_WORKER_ENABLED`, **stop**.
Stage A would have no effect on that image.

Structural check that the override touches only `web`/`api` environment (the
`--no-interpolate` flag keeps secrets out of the output):

```bash
docker compose -f docker-compose.prod.yml config --no-interpolate > /root/cfg-before.yml
docker compose -f docker-compose.prod.yml -f docker-compose.media-off.yml config --no-interpolate > /root/cfg-after.yml
diff /root/cfg-before.yml /root/cfg-after.yml   # expect only MEDIA_WORKER_* lines under api/web
```

## 1. Backups (must complete before any change)

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ); B=/var/backups/orba/$TS; install -d -m 0700 "$B"
cd /opt/orbaagent
# a) unpublished production source (d91a117 is not on GitHub)
git bundle create "$B/orbaagent-src.bundle" --all
git status --porcelain=v1 > "$B/git-status.txt"
git diff --binary > "$B/uncommitted.diff"
tar --exclude=node_modules --exclude=.next --exclude=dist -czf "$B/untracked.tgz" \
  $(git ls-files --others --exclude-standard) 2>/dev/null || true
# b) env (secrets stay root-only on this host)
install -m 0600 .env "$B/env.bak"
# c) image IDs currently running
docker compose -f docker-compose.prod.yml images > "$B/images.txt"
# d) database logical backup (stays on host, 0600)
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dumpall -U "$POSTGRES_USER"' | gzip > "$B/pg_dumpall.sql.gz"; chmod 0600 "$B/pg_dumpall.sql.gz"
sha256sum "$B"/* > "$B/SHA256SUMS"; ls -la "$B"
```

Stage A does not touch MinIO or the uploads volume, so no data backup of
those is required for it. They are covered by the general backup policy.

## 2. Record the baseline

```bash
curl -fsS https://orbaagent.dev/health
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml images web api > /root/media-off-images-before.txt
```

## 3. Remove the compromised token from `.env` (value never printed)

```bash
sed -i -E 's/^(MEDIA_WORKER_TOKEN)=.*/\1=/' .env
grep -c '^MEDIA_WORKER_TOKEN=$' .env               # expect 1
```

## 4. Apply

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.media-off.yml \
  up -d --no-deps --no-build web api
```

## 5. Verify

```bash
docker compose -f docker-compose.prod.yml images web api | diff /root/media-off-images-before.txt - && echo "same images"
curl -fsS https://orbaagent.dev/health
for s in web api; do
  docker compose -f docker-compose.prod.yml exec -T "$s" sh -c \
    'echo "$0: ENABLED=$MEDIA_WORKER_ENABLED DISABLED=$MEDIA_WORKER_DISABLED URL_SET=${MEDIA_WORKER_URL:+yes} TOKEN_SET=${MEDIA_WORKER_TOKEN:+yes}"' "$s"
done
# expect: ENABLED=false DISABLED=true URL_SET= TOKEN_SET=
```

Functional checks in the app:

1. Request an image. It should fail within about 1 s, without a stack trace or
   any `10.77.0.2` address. Record the exact message: Stage B will replace it.
2. Request a video. It should behave the same way.
3. Open an older chat with a generated image or video. The media should still
   load.
4. A normal chat turn, a file upload and a non-media tool should all work as
   before.

## Rollback

```bash
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build web api
# optional: restore the previous env (re-introduces the compromised token, avoid unless required)
# install -m 0600 /var/backups/orba/<TS>/env.bak /opt/orbaagent/.env
```

Rollback re-enables a media worker that no longer exists. Only use it if the
override causes a regression. Do not reuse the old token anywhere.

## Re-enabling later

Only after a separately reviewed media backend exists:

1. Generate a new token on the VPS with `openssl rand -hex 32`. Write it only
   to `.env` (mode 0600) and to the backend's secret file.
2. Set `MEDIA_WORKER_ENABLED=true` and the new `MEDIA_WORKER_URL`.
3. Run `up -d --no-deps --no-build web api` without the override file.
4. Verify the old token returns 401 at the new backend and the new token
   succeeds.
