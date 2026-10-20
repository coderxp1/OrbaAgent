# Authentication Activation Runbook

**Scope:** activating the OrbaAgent API authentication boundary (ADR-004) on the
production deployment. This runbook changes **only** the `orba-web` container's
environment and a restart of that container. It does not touch the GPU worker,
GPU 0, Wan, FLUX, LTX, ComfyUI, Ollama, WireGuard, the firewall, the upload
volume, or any existing secret.

**Do not run any step of this runbook without an explicit authorisation.**

---

## 0. What activating means

| | Before | After |
|---|---|---|
| `ORBA_AUTH_MODE` | unset (derived) | `required` |
| Anonymous `POST /api/chat` | 200 (generates media) | **401** |
| Anonymous `GET /api/artifacts/...` | 200 | **401** |
| Valid session cookie | n/a | 200, scoped to the caller's tenant |
| Cross-tenant artifact read | n/a | **403** |
| Worker → API artifact ingest | ingest token | ingest token (unchanged) |
| GPU worker, models, GPU 0 | — | **unchanged** |

The boundary is *implemented* in `cc6ac94` and later commits and is inert
until a credential is configured. Activating it is exactly the env change in
step 2 plus the container recreate in step 4.

---

## 1. Generate the secrets (nothing is printed)

Run on the production host as root. **No secret is echoed to stdout, a log, CI
output, or a chat transcript.**

```bash
# 1a. the tenant this deployment serves. It must match ORBA_TENANT_ID, or be
#     listed in ORBA_TENANTS. "default-tenant" is the default when unset.
TENANT="default-tenant"

umask 077

# 1b. generate. The values only ever exist in this shell's variables.
API_KEY="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
SESSION_SECRET="$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 64)"
API_KEY_SHA="$(printf '%s' "$API_KEY" | sha256sum | cut -d' ' -f1)"

# 1c. hand the RAW key to the operator exactly once, in a root-only file.
#     Only the digest is ever written into the deployment configuration.
install -m 0600 -o root -g root /dev/null /root/.orba_owner_key
printf '%s' "$API_KEY" > /root/.orba_owner_key
chmod 0600 /root/.orba_owner_key

# 1d. the RAW API key leaves the shell here. SESSION_SECRET is kept alive
#     because step 2 writes it into the deployment environment. It is unset
#     there, immediately after writing.
unset API_KEY
```

## 2. Write the deployment environment (atomic merge, digests only)

This step **preserves all existing settings** in `prod.env` (database
passwords, API tokens, MinIO credentials, etc.) and updates **only** the four
authentication variables. A timestamped backup is created before any write.

**Pre-replacement validation:** The candidate environment file (`$TMP`) is
strictly validated before modifying or replacing `$ENV_FILE`. If any validation
check fails, the candidate is discarded, execution aborts immediately, and the
existing `$ENV_FILE` remains completely untouched.

```bash
ENV_FILE="/etc/orbaagent/prod.env"

# 2a. back up the existing environment file (if any).
if [ -f "$ENV_FILE" ]; then
  BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
  cp -a "$ENV_FILE" "$BACKUP"
  chmod 0600 "$BACKUP"
  echo "backup → $BACKUP"
fi

# 2b. build the candidate update atomically in a tempfile on the same filesystem.
#     Creating $TMP via mktemp in $ENV_FILE's directory guarantees the same
#     filesystem, ensuring mv -f performs an atomic rename(2) system call.
TMP="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
chmod 0600 "$TMP"
if [ -f "$ENV_FILE" ]; then
  chown --reference="$ENV_FILE" "$TMP" 2>/dev/null || true
else
  chown root:root "$TMP" 2>/dev/null || true
fi

# preserve every existing line except the four we are replacing
if [ -f "$ENV_FILE" ]; then
  grep -v -E '^(ORBA_AUTH_MODE|ORBA_SESSION_SECRET|ORBA_API_KEYS|ORBA_TENANTS)=' \
    "$ENV_FILE" >> "$TMP" || true
fi

# append the authentication variables
{
  printf 'ORBA_AUTH_MODE=required\n'
  printf 'ORBA_SESSION_SECRET=%s\n' "$SESSION_SECRET"
  printf 'ORBA_API_KEYS=%s\n' "{\"$API_KEY_SHA\":{\"tenantId\":\"$TENANT\",\"userId\":\"owner\"}}"
  printf 'ORBA_TENANTS=%s\n' "$TENANT"
} >> "$TMP"

# 2c. VALIDATE CANDIDATE BEFORE REPLACEMENT.
#     The original file is NOT modified until all candidate checks pass.

# (i) Enforce and verify restrictive 0600 permissions on candidate
chmod 0600 "$TMP"
TMP_PERM="$(stat -c '%a' "$TMP" 2>/dev/null || stat -f '%A' "$TMP")"
if [ "$TMP_PERM" != "600" ] && [ "$TMP_PERM" != "-rw-------" ]; then
  echo "FAIL: Candidate file permissions are not 0600 ($TMP_PERM)" >&2
  echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
  rm -f "$TMP"
  exit 1
fi

# (ii) Enforce and verify ownership matches destination
if [ -f "$ENV_FILE" ]; then
  DEST_OWNER="$(stat -c '%u:%g' "$ENV_FILE" 2>/dev/null || stat -f '%u:%g' "$ENV_FILE")"
  TMP_OWNER="$(stat -c '%u:%g' "$TMP" 2>/dev/null || stat -f '%u:%g' "$TMP")"
  if [ "$TMP_OWNER" != "$DEST_OWNER" ]; then
    echo "FAIL: Candidate ownership ($TMP_OWNER) does not match destination ($DEST_OWNER)" >&2
    echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
    rm -f "$TMP"
    exit 1
  fi
fi

# (iii) File integrity check (non-empty)
if [ ! -s "$TMP" ]; then
  echo "FAIL: Candidate file is empty" >&2
  echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
  rm -f "$TMP"
  exit 1
fi

# (iv) Secret length check (measures exact characters, excluding newlines)
TMP_SECRET="$(grep '^ORBA_SESSION_SECRET=' "$TMP" | cut -d'=' -f2- | tr -d '\r\n')"
TMP_SECRET_LEN="${#TMP_SECRET}"
unset TMP_SECRET

if [ "$TMP_SECRET_LEN" -lt 32 ]; then
  echo "FAIL: Candidate ORBA_SESSION_SECRET is empty or too short ($TMP_SECRET_LEN chars, minimum 32)" >&2
  echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
  rm -f "$TMP"
  exit 1
fi

# (v) API keys JSON structure validation
if ! python3 -c 'import json, re, sys; env = dict(re.findall(r"^([A-Z_]+)=(.*)$", open(sys.argv[1]).read(), re.M)); keys = json.loads(env.get("ORBA_API_KEYS", "")); assert isinstance(keys, dict) and len(keys) > 0' "$TMP" 2>/dev/null; then
  echo "FAIL: Candidate ORBA_API_KEYS is invalid JSON or empty" >&2
  echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
  rm -f "$TMP"
  exit 1
fi

# (vi) Mode and tenants presence
if ! grep -q '^ORBA_AUTH_MODE=required$' "$TMP" || ! grep -q '^ORBA_TENANTS=' "$TMP"; then
  echo "FAIL: Candidate is missing required auth variables" >&2
  echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
  rm -f "$TMP"
  exit 1
fi

# 2d. Atomic replacement: all candidate validations passed cleanly.
#     Because $TMP already carries verified 0600 permissions and matching
#     ownership, rename(2) atomically swaps the destination inode without
#     any permission exposure window or reliance on post-rename chmod.
mv -f "$TMP" "$ENV_FILE"

# 2e. Clear secret variables from shell memory immediately.
unset SESSION_SECRET API_KEY_SHA
echo "OK: $ENV_FILE atomically updated with validated candidate configuration ($TMP_SECRET_LEN char secret, value not printed)"
```

**Disaster Recovery:** if an unforeseen operating system error occurs during rename, restore from the backup:

```bash
# restore prod.env from the most recent backup
cp -a /etc/orbaagent/prod.env.bak.* /etc/orbaagent/prod.env   # pick the correct timestamp
chmod 0600 /etc/orbaagent/prod.env
```

`ORBA_API_KEYS` stores only the **SHA-256 digest** of the key. `ORBA_SESSION_SECRET`


signs the session cookies and must never leave the server.

## 3. Preflight checks (read-only, before any restart)

```bash
# 3a. the configuration is present and well-formed
python3 - <<'PY'
import json, re
env = dict(re.findall(r'^([A-Z_]+)=(.*)$', open('/etc/orbaagent/prod.env').read(), re.M))
keys = json.loads(env['ORBA_API_KEYS'])
tenants = {rec['tenantId'] for rec in keys.values()}
served = {t.strip() for t in env.get('ORBA_TENANTS', '').split(',') if t.strip()}
served |= {(env.get('ORBA_TENANT_ID') or '').strip() or 'default-tenant'}
print('credentials      :', len(keys))
print('credential tenant:', sorted(tenants))
print('served tenants   :', sorted(served))
assert tenants <= served, 'FAIL: the credential names a tenant this deployment does not serve'
assert env.get('ORBA_AUTH_MODE') == 'required'
assert len(env.get('ORBA_SESSION_SECRET', '')) >= 16
print('OK: the configured tenant is served and the mode is required')
PY

# 3b. the raw key is still retrievable exactly once, for the operator
sudo test -s /root/.orba_owner_key && echo "raw key present (read it once, then shred)"

# 3c. the compose file passes the new variables to orba-web
cd /opt/orbaagent
docker compose -f docker-compose.prod.yml config | grep -E 'ORBA_(AUTH_MODE|API_KEYS|SESSION_SECRET|TENANTS)'
```

## 4. Apply (recreates the web container only)

```bash
cd /opt/orbaagent
docker compose -f docker-compose.prod.yml up -d orba-web
```

This recreates **only** `orba-web`. The GPU worker, ComfyUI, Ollama and the
GPU are not touched.

## 5. Post-deployment acceptance

```bash
# 5a. the boundary is live: anonymous is refused
curl -sS -o /dev/null -w '%{http_code}\n' https://orbaagent.dev/api/user/profile   # expect 401

# 5b. an authorised caller is served
curl -sS -X POST https://orbaagent.dev/api/auth/session \
  -H 'content-type: application/json' \
  --data "{\"credential\":\"$(sudo cat /root/.orba_owner_key)\"}" -c /tmp/orba.cookies
curl -sS -b /tmp/orba.cookies https://orbaagent.dev/api/user/profile             # expect 200

# 5c. the media path still works for the authorised caller
curl -sS -b /tmp/orba.cookies -X POST https://orbaagent.dev/api/chat \
  -H 'content-type: application/json' \
  --data '{"messages":[{"role":"user","content":"Generate an image of a red apple on a white table"}]}' \
  | head -c 400

# 5d. the GPU side is untouched
sudo orbaagent-gpu health          # expect healthy, Wan + FLUX loaded
nvidia-smi --query-gpu=index,uuid,memory.used --format=csv   # GPU 0 unchanged
```

In the browser: open `https://orbaagent.dev/login`, paste the credential, and
confirm the redirect into the application, that a refresh keeps the session,
and that **Sign out** in the header clears it.

## 6. Recovery

**Recovery must not silently reopen anonymous access.** The boundary stays on;
what is restored is *authorised* access.

```bash
# 6a. the login flow is broken but the deployment is fine: mint a new key
#     and add its digest to ORBA_API_KEYS. The operator exchanges it for a
#     session exactly as before.
NEW_KEY="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)"
NEW_SHA="$(printf '%s' "$NEW_KEY" | sha256sum | cut -d' ' -f1)"
install -m 0600 -o root -g root /dev/null /root/.orba_owner_key
printf '%s' "$NEW_KEY" > /root/.orba_owner_key && chmod 0600 /root/.orba_owner_key
python3 - "$NEW_SHA" <<'PY'
import json, re, sys
path = '/etc/orbaagent/prod.env'
env = dict(re.findall(r'^([A-Z_]+)=(.*)$', open(path).read(), re.M))
keys = json.loads(env['ORBA_API_KEYS'])
keys[sys.argv[1]] = {"tenantId": "default-tenant", "userId": "owner"}
lines = [f"{k}={v}" for k, v in env.items() if k != 'ORBA_API_KEYS']
lines.append('ORBA_API_KEYS=' + json.dumps(keys))
open(path, 'w').write('\n'.join(lines) + '\n')
PY
unset NEW_KEY NEW_SHA
cd /opt/orbaagent && docker compose -f docker-compose.prod.yml up -d orba-web

# 6b. only the session cookie is stale: re-exchange the existing key
curl -sS -X POST https://orbaagent.dev/api/auth/session \
  -H 'content-type: application/json' \
  --data "{\"credential\":\"$(sudo cat /root/.orba_owner_key)\"}" -c /tmp/orba.cookies

# 6c. standing the boundary down is an explicit, audited decision. It reopens
#     anonymous access to media generation and artifact reads, so it needs the
#     owner's sign-off, and it must remove the credentials as well - otherwise
#     the derived mode would stay "required" and lock everyone out.
#     sed -i 's/^ORBA_AUTH_MODE=.*/ORBA_AUTH_MODE=permissive/' /etc/orbaagent/prod.env
#     sed -i '/^ORBA_API_KEYS=/d' /etc/orbaagent/prod.env
#     cd /opt/orbaagent && docker compose -f docker-compose.prod.yml up -d orba-web
```

Rolling the **code** back is `git revert` of the activation commits followed by
`docker compose -f docker-compose.prod.yml up -d orba-web`. There is no
database migration, no schema change, and no model to restore.

## 7. Secure key handoff and disposal

The raw owner API key must be imported into the authorized operator's password
manager **without exposing it on screen, in chat, in shell history, or in
terminal session recordings**.

### 7a. Primary recommended workflow: Direct workstation clipboard pipe

From the authorized operator's local workstation, pipe the key over SSH directly
into the local OS clipboard without echoing to stdout or writing to local disk:

```bash
# macOS:
ssh root@<host> 'cat /root/.orba_owner_key' | pbcopy

# Linux (Wayland):
ssh root@<host> 'cat /root/.orba_owner_key' | wl-copy

# Linux (X11):
ssh root@<host> 'cat /root/.orba_owner_key' | xclip -selection clipboard

# Windows (PowerShell):
ssh root@<host> 'cat /root/.orba_owner_key' | Set-Clipboard
```

Immediately paste the key directly into the operator's password manager entry
(such as 1Password, Bitwarden, or KeePassXC) and save it.

### 7b. Secure shredding on the production host

Immediately after saving the key in the password manager, shred the root key
file from the host filesystem:

```bash
sudo shred -u /root/.orba_owner_key 2>/dev/null || sudo rm -f /root/.orba_owner_key
```

### 7c. Scope and limitations disclosure

* **Verification Scope**: Automated testing verifies the generation of the
  restricted file (`0600`), piped capture into a simulated sink without
  stdout/terminal leakage, and host file shredding. Direct integration with a
  live, third-party password manager vault (e.g. 1Password/Bitwarden) has
  **not** been executed by test automation.
* **Clipboard History Caveat**: If an unconfined clipboard history utility is
  running on the operator's workstation, it may log clipboard contents. The
  operator should ensure clipboard history is cleared or bypassed.
* **Root Window**: Between Step 1c and Step 7b, the plaintext key resides in
  `/root/.orba_owner_key` with mode `0600` on the host until shredded.


## Notes and known limitations

* A session is a **stateless signed cookie**. Logout clears the browser
  cookie, but the token itself remains valid until it expires (one hour).
  Server-side revocation arrives with the stateful session store (ADR-004).
* A cookie-authenticated state-changing request must carry an `Origin` header.
  Browsers always send it; non-browser clients must use the API key path.
* The GitHub OAuth callback now requires an authenticated caller and a
  browser-bound `state`. The live GitHub round trip has not been exercised in a
  non-production environment; the first production use of the connector
  exercises it.
* The desktop client and any scripted caller must use the API key path, not
  the session cookie.
