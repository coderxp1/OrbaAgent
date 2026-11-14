# Runbook: temporarily disable image/video generation (VPS-only)

**Why:** the H200 GPU server that hosted the media worker (`10.77.0.2:8190`) is
decommissioned. While `MEDIA_WORKER_ENABLED` is on, every image/video request
waits on a dead health check (~3 s, plus up to 1.2 s capability probing per turn)
and then surfaces an internal error. Disabling makes media requests fail
immediately with a clear user-facing message.

**Scope:** only the `web` and `api` containers are recreated. Postgres, Redis,
MinIO and the `orba_uploads_data` volume are not touched, so existing images and
videos stay available. Chat, auth, files and every other tool are unaffected.

**Secret hygiene:** the override also blanks `MEDIA_WORKER_URL` and
`MEDIA_WORKER_TOKEN` inside the containers. The old token value was exposed in
git history (commit `ce342e9`) and must be treated as compromised. Remove it
from `/opt/orbaagent/.env` as well (step 2). Never print it.

## Preconditions

- Shell on the Orba VPS as the deploy user, in `/opt/orbaagent`.
- The deployed checkout contains this branch's `docker-compose.media-off.yml`.
  Production currently runs commit `d91a117`, which is **not on GitHub**. Before
  pulling anything, preserve that state:

```bash
cd /opt/orbaagent
git status --short > /root/orba-d91a117-status.txt
git bundle create /root/orba-d91a117.bundle --all
git diff > /root/orba-d91a117-uncommitted.diff
```

Then copy in only `docker-compose.media-off.yml`, rather than checking out
another revision. Use `git show origin/ops/media-disable-vps:docker-compose.media-off.yml > docker-compose.media-off.yml`
after `git fetch origin ops/media-disable-vps`.

## 1. Record the baseline

```bash
curl -fsS https://orbaagent.dev/health
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml images web api > /root/media-off-images-before.txt
```

## 2. Remove the compromised token from `.env` (value never printed)

```bash
cp -p .env /root/.env.bak.$(date +%Y%m%d%H%M%S)   # root-only backup, mode preserved
sed -i -E 's/^(MEDIA_WORKER_TOKEN)=.*/\1=/' .env
grep -c '^MEDIA_WORKER_TOKEN=$' .env               # expect 1
```

## 3. Apply

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.media-off.yml \
  up -d --no-deps --no-build web api
```

`--no-build` reuses the running images, so no code changes ship.
`--no-deps` leaves databases and storage running.

## 4. Verify

```bash
# containers healthy, same image IDs as before
docker compose -f docker-compose.prod.yml images web api | diff /root/media-off-images-before.txt - && echo "same images"
curl -fsS https://orbaagent.dev/health

# flags reached the containers (prints names only, not values)
for s in web api; do
  docker compose -f docker-compose.prod.yml exec -T "$s" sh -c \
    'echo "$0: ENABLED=$MEDIA_WORKER_ENABLED DISABLED=$MEDIA_WORKER_DISABLED URL_SET=${MEDIA_WORKER_URL:+yes} TOKEN_SET=${MEDIA_WORKER_TOKEN:+yes}"' "$s"
done
# expect: ENABLED=false DISABLED=true URL_SET= TOKEN_SET=
```

Functional checks in the app:

1. Ask for an image. The reply should come within about 1 s with: *"Image/Video
   generation is temporarily unavailable. Existing images and videos are not
   affected. Please try again later."* There should be no stack trace,
   hostname or IP.
2. Ask for a video. You should get the same message.
3. Open a chat that has a previously generated image or video. It should still
   load.
4. Run a normal chat turn and a file upload. Both should work as before.

## Rollback

```bash
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build web api
```

Note that rollback re-enables a media worker that no longer exists. Only roll
back if the override itself causes a regression. To restore the previous `.env`,
copy back the `/root/.env.bak.*` file. Do not restore the old token into a new
media backend: issue a fresh one when one exists.

## Re-enabling later

Once an approved media backend exists, follow these steps:

1. Generate a new token with `openssl rand -hex 32` and store it only in `.env`.
2. Set `MEDIA_WORKER_ENABLED=true` and the new `MEDIA_WORKER_URL`.
3. Run `up -d --no-deps --no-build web api` without the override file.
