# Production Synchronization Audit — 2026-10-06

**Scope:** Read-only audit of OrbaAgent production server and GPU worker. No changes were made to either host.
**Auditor execution mode:** Read-only SSH inspection, live HTTP probes, container log review.
**Production host:** `85.215.156.241` (Ubuntu 24.04.4 LTS, kernel 6.8.0-139, up 31 days)
**GPU host:** `45.84.65.76` / `migrol-ag-gpu-worker01` (Ubuntu 26.04.1 LTS, kernel 7.0.0-34)
**Access used:** `deploy@85.215.156.241` (ed25519, SHA256:JRBrmCmHoM7LFtjL8eShxUmA8tcoZzAQOkQl4cXgjRs), `klaus@45.84.65.76` (ed25519, SHA256:LwOVYCnPjy3j6QUn1aLItjk3elHx9yuDjAVwEKWHryU). Both fingerprints verified to match the registered public keys before use.

---

## 1. Headline Finding

Production is **not** running a commit from any branch in this repository. It runs a build of an **uncommitted working tree** sitting on top of `0bcb47e`.

Two independent, mutually incompatible lines of development exist:

| | Source of truth | Location |
| :--- | :--- | :--- |
| **Production** | `0bcb47e` + 26 modified / 14 untracked files, never committed | `/opt/orbaagent` on `85.215.156.241` |
| **Developer branch** | `b28934f` on `feat/agent-runtime-tool-loop` + 61 modified / 11 untracked files | local working copy |

The two share only the merge base `1c8a2f5`. The developer branch is **17 commits ahead** of the production commit, but does **not** contain the productions's uncommitted work. Deploying either side over the other destroys work. This is the root cause of the "reports contradicted each other" symptom: there has never been a single authoritative revision.

**Nothing in this audit came from a test suite or from source inspection alone. Every PASS is a live production observation.**

---

## 2. Audit Matrix

| ITEM | STATUS | EVIDENCE | NEXT ACTION |
| :--- | :--- | :--- | :--- |
| SSH access, production | ✅ PASS | `deploy@85.215.156.241` key auth; `whoami`=`deploy`, `hostname`=`ubuntu` | None |
| SSH access, GPU | ✅ PASS | `klaus@45.84.65.76` key auth; `hostname`=`migrol-ag-gpu-worker01` | None |
| Key fingerprints | ✅ PASS | `ssh-keygen -lf` → `JRBrmCmHoM7…` (prod), `LwOVYCnPjy3…` (gpu); both match registered values | None |
| Production host OS | ✅ PASS | Ubuntu 24.04.4 LTS, kernel 6.8.0-139-generic | None |
| Deployed commit — actual | ⚠️ DRIFT | `git rev-parse HEAD` = `0bcb47e714cde255dc2f1987e24c141753fd3aa0` (branch `feat/phase1-model-gateway-web-chat`) | Commit production working tree to a branch; see §4 |
| Deployed commit — reported | ❌ FALSE | `/health` returns `commitSha=0bcb47e…`, but that value is the compose default `COMMIT_SHA` fallback, not a build artifact stamp | Inject real commit SHA at image build time |
| Production worktree cleanliness | ❌ FAIL | 26 ` M` files + 14 `??` entries = 3,020 insertions not in any commit | Commit before any deploy |
| `feat/phase1-model-gateway-web-chat` remote backup | ❌ FAIL | Branch exists only locally and on the server; `git branch -a` shows no `remotes/origin/feat/phase1-model-gateway-web-chat` | Push branch to origin immediately |
| Source vs production ancestry | ❌ DIVERGED | merge-base `1c8a2f5`; local ahead 17 commits; `origin/main` (`cb334f1`) ahead 2 over production | Reconcile; see §4 |
| Files deployed but absent from git | ❌ FAIL | At `0bcb47e`, these are untracked/absent yet running: `docker-compose.prod.yml`, `services/agent-runtime/src/registry.ts`, `memory.ts`, `changes.ts`, `integrations.ts`, `tools/`, `apps/web/src/components/AttachmentMenu.tsx` | Add and commit all |
| Containers running | ✅ PASS | 8/8 up: `orba-web`, `orba-api` (healthy), `orba-postgres` (healthy), `orba-redis` (healthy), `orba-minio` (healthy), `orba-traefik`, `orba-docker-socket-proxy`, `orba-catchall-404` | None |
| Image versions | ⚠️ UNSTAMPED | `orba-app-api` and `orba-app-web` carry no commit tag; inspected via `docker image inspect` only | Tag images with commit SHA |
| Docker networks | ✅ PASS | `orba-app_app-net`, `traefik-net`, `orba-proxy_socket-net` all present | None |
| **Redis present in production** | ✅ PASS | `orba-redis` container up 3 days, `redis:7-alpine`, healthy. `redis-cli ping` → `PONG`. `/health` → `"redis":"up"` | None — the previously unconfirmed item is confirmed present |
| Redis exposure | ✅ PASS | Bound `127.0.0.1:6379->6379/tcp` — not publicly reachable. `REDIS_URL=redis://redis:6379` | None |
| Redis usage | ⚠️ EMPTY | `redis-cli dbsize` → `0`. Connectivity is real but no keys are written | Investigate whether queues/job coordination actually use Redis |
| API `/health` | ✅ PASS | `GET https://orbaagent.dev/health` → `200`, `{"status":"ok",…,"checks":{"postgres":"up","redis":"up"}}` via router `orba-api@docker` → `172.19.0.4:3001` | None |
| **`POST /api/chat`** | ✅ PASS | Live call returned `200 text/event-stream` in 0.97 s with `pong`. Full SSE: `agent_activity` → `text_delta` → `agent_activity` → `done` → `[DONE]` | None — the previously reported 500 is **not** reproducible; JSON/SSE handling works |
| Model gateway, Langdock primary | ✅ PASS | `[ModelGateway Audit]` log: `provider":"langdock","model":"gpt-5.4","status":"success","latencyMs":934`; 9 tools registered | None |
| Model gateway, OpenRouter fallback | ✅ PASS | Audit log shows `provider":"openrouter","model":"openrouter/auto","status":"success"` with token accounting (`totalTokens:4717`) | None |
| `/api/providers/health` | ❌ FAIL (404) | Live probe → `404`. Route **does not exist in production source at all** (`grep` over `apps/web/src/app/api` → no match). It exists only as **untracked** local code at `apps/web/src/app/api/providers/health/route.ts` | Deploy the local route; then re-test |
| `/api/uploads` | ❌ FAIL (404) | `POST` → `404`. Route exists only as untracked local code `apps/web/src/app/api/uploads/route.ts` | Deploy; then prove text + folder upload |
| `/api/artifacts` | ❌ FAIL (404) | Route exists only as untracked local code `apps/web/src/app/api/artifacts/…` | Deploy; then prove `artifact_list` / `artifact_read` |
| `/api/connections` | ✅ PASS | Live → `200` | None |
| `/api/changes/review` | ✅ PASS | Live → `200` | None |
| `/app` workspace UI | ✅ PASS | Live → `200` | None |
| Attachment "＋" — 7 options | ⚠️ PARTIAL | Deployed source `AttachmentMenu.tsx` defines Files, Folders, Images, Videos, Text Note, Figma Link — but **no Screenshot item**. Local version adds `handleScreenshot()` + `<span>Screenshot</span>` | Deploy local `AttachmentMenu.tsx` |
| Attachment menu wiring | ✅ PASS | `apps/web/src/app/app/page.tsx` imports and renders `<AttachmentMenu>` at lines 560 and 888 (desktop + mobile), `onAttachFiles` → `setAttachedFiles` | None |
| Attachment backend pipeline | ❌ FAIL | The "+" collects files client-side only; no `/api/uploads` route exists (404), so nothing reaches `ORBA_UPLOAD_DIR` | Deploy uploads + artifacts routes |
| Assistant copy button | ⚠️ PARTIAL | Copy logic **is** implemented directly inside `MessageItem.tsx` (`handleCopyMessage`, `navigator.clipboard.writeText(message.content)`, `Copied!` title, Check↔Copy swap, 2 s reset) and is present in the production tree. See caveat below | Re-render and verify against spec |
| Copy button — dedicated component | ❌ DEAD CODE | `apps/web/src/components/CopyMessageButton.tsx` exists locally but is **imported by no file** (excluding itself, zero matches). It is not part of any render path | Delete, or wire it in |
| Copy button — size spec (28–32 px) | ⚠️ UNVERIFIED | Measured source class is `h-3.5 w-3.5` = **14 px**, below the 28–32 px requirement | Needs a decision: resize to spec |
| Copy button — Markdown fidelity | ⚠️ UNVERIFIED | `writeText(message.content)` copies the raw Markdown source, not rendered text | Confirm intended behaviour against spec |
| Traefik routing | ⚠️ MISMATCH | Traefik log shows `/api/providers/health` served by router `orba-web@docker` → `172.19.0.5:3000`, not `orba-api`. API router rule matches only `/health` and `/v1` | Decide canonical API surface; align router rules |
| TLS | ✅ PASS | `acme.json` 28,632 bytes, owned `root:root` `0600`, mounted at `/etc/traefik/acme/acme.json`; Traefik log records `TLSv1.3`/`TLS_AES_128_GCM_SHA256` on live requests | None |
| TLS resolver | ⚠️ NOTE | Router label uses `tls.certresolver=le-http` (HTTP-01). DNS-01 resolvers `le-staging`/`le-prod` exist in `traefik.yml` but need `IONOS_API_KEY`, which is **absent** from production `.env` | Not blocking; wire IONOS only if DNS-01 is required |
| API logs | ✅ PASS | `/health` polled every ~5 s, all `statusCode:200`, ~1.2 ms. No error-level entries | None |
| Web logs | ✅ PASS | `Next.js 16.3.4 Ready in 201ms`; ModelGateway audit lines only, no stack traces | None |
| SEO endpoints | ⚠️ MINOR | `/robots.txt` → `404`, `/sitemap.xml` → `404`, `/favicon.ico` → `404` | Add before public launch |
| Secrets in git | ✅ PASS | `.env` / `.env.local` matched by `.gitignore` (`*.env`, `.env.*`); `git ls-files` → untracked; `git log --all -- .env .env.local` → empty | None |
| pnpm version parity | ✅ PASS | Local `pnpm --version` = `10.34.5`; server lockfile `84027` vs local `84585` bytes — reconcile with a fresh install | Resolve after code reconciliation |
| **GPU hardware** | ✅ PASS | 2 × NVIDIA RTX PRO 6000 Blackwell Server Edition, 97,887 MiB each, driver 580.178.04, CUDA 13.0 | None |
| GPU UUID mapping | ✅ PASS | Index 0 = `GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4`; index 1 = `GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878` — matches the given contract exactly | None |
| **GPU 0 isolation** | ✅ PASS | GPU 0 holds 10,233 MiB used by PID 11416 (`python`) — the CoderXP workload; untouched by this audit | Never target GPU 0 |
| GPU 1 availability | ✅ PASS | `0 MiB` used, 2 % util, 35 °C — clean and reserved | Safe to claim |
| `klaus` privileges | ❌ BLOCKED | `id` → groups `klaus,sudo,users` — **no `docker`**. `docker ps` → `permission denied … /var/run/docker.sock`. `sudo -n true` → `interactive authentication is required` | Grant docker access or passwordless sudo for the deploy path |
| `/srv/projects/orbaagent-gpu/` | ❌ BLOCKED | `ls /srv/projects/` → `Permission denied`; parent is `drwx--x--- root coderxp-media` | Grant `klaus` access to the OrbaAgent subtree |
| GPU worker compose contract | ✅ PASS (source) | `infra/orbaagent-gpu/compose.yaml` pins `NVIDIA_VISIBLE_DEVICES=GPU-82e03c6c…` and `device_ids: ['GPU-82e03c6c…']` — GPU 1 only. **Exists locally only**; not deployed | Deploy after production passes |
| nvidia-container-toolkit | ✅ PASS | `/usr/bin/nvidia-ctk` present | None |

---

## 3. Blockers, Ordered

**B1 — No canonical revision.** Production's running code is uncommitted and unpushed. Any `git pull`, `git checkout`, or clean on `/opt/orbaagent` silently destroys the phase-1 gateway work that is currently serving live traffic. This must be fixed before any deployment step.

**B2 — Untracked production artifacts.** At commit `0bcb47e`, `docker-compose.prod.yml` itself is untracked. The deployment definition is not in version control.

**B3 — GPU access insufficient.** `klaus` cannot reach the Docker socket and cannot read `/srv/projects/`. Phase 2 cannot begin at step 5 until this is granted.

**B4 — Three missing endpoints.** `/api/providers/health`, `/api/uploads`, `/api/artifacts` return 404 in production. All three exist as untracked local code. This is a deployment gap, not an implementation gap.

**B5 — Attachment button incomplete in production.** The Screenshot option is absent from the deployed `AttachmentMenu.tsx`; the other six options are present and wired.

---

## 4. Recommended Reconciliation Path

The two lines of development must be merged, not chosen between. Recommended order:

1. **Freeze production.** Stop further ad-hoc edits on `/opt/orbaagent` until reconciliation completes.
2. **Rescue production work.** On the server, commit the 26 modified + 14 untracked files onto `feat/phase1-model-gateway-web-chat`, then push that branch to `origin`. This makes the live code recoverable.
3. **Bring the local uncommitted work under version control.** Commit all 61 modified + 11 untracked files locally on `feat/agent-runtime-tool-loop`, then push.
4. **Merge.** Merge `feat/phase1-model-gateway-web-chat` into `feat/agent-runtime-tool-loop` (or vice versa) and resolve conflicts explicitly. Expect conflicts in `services/model-gateway/*`, `apps/web/src/app/app/page.tsx`, `apps/web/src/components/MessageItem.tsx`, `useAgentChat.ts`, and `pnpm-lock.yaml`.
5. **Stamp the build.** Replace the hardcoded `COMMIT_SHA` default in `docker-compose.prod.yml` with a build-time SHA so `/health` reports the real revision.
6. **Deploy the reconciled revision** and re-run the acceptance tests in §5.

Until step 2 completes, **no deployment command should be run against production.**

---

## 5. Acceptance Tests to Re-run After Deployment

| # | Test | Pass condition |
| :--- | :--- | :--- |
| 1 | `GET /health` | `200`; `commitSha` equals the newly deployed SHA, not `0bcb47e` |
| 2 | `GET /api/providers/health` | `200`, booleans/counts only, no secret material in the body |
| 3 | `POST /api/chat` | `200 text/event-stream`; completes with `done` + `[DONE]` |
| 4 | Gateway audit log | `langdock` success line present; OpenRouter reachable |
| 5 | `POST /api/uploads` (text) | `200`; file lands under `ORBA_UPLOAD_DIR/<workspace>/<bundle>/<relPath>` |
| 6 | Folder upload | Relative paths preserved |
| 7 | Image upload | Metadata returned; no false vision claims |
| 8 | Video upload | Metadata returned; no false understanding claims |
| 9 | `artifact_list` / `artifact_read` | Lists and reads the uploaded artifact within the same turn |
| 10 | Path traversal | `../` sequences rejected |
| 11 | Workspace isolation | Artifact from workspace A not readable in workspace B |
| 12 | Attachment "＋" | All 7 options render and are interactive on the live site |
| 13 | Copy button | Visible on every assistant message; copies full Markdown; Check + "Copied" appears then resets |
| 14 | `redis-cli dbsize` | Non-zero once queues/jobs are exercised |

---

## 6. Explicit Non-Claims

- No redeployment was performed.
- No production configuration, container, image, or file was modified.
- GPU 0 was inspected only via `nvidia-smi` queries and remains untouched.
- No GPU worker was deployed.
- Vision or video understanding was not tested and is not claimed.
- The copy button's 28–32 px requirement was assessed by reading the source class (`h-3.5 w-3.5`); the rendered pixel size was not measured in a browser.
- `/api/providers/health`, `/api/uploads`, and `/api/artifacts` were verified absent in production; their local implementations were read but not executed.
