#!/usr/bin/env bash
# ==============================================================================
# scripts/infra/update-auth-env.sh
# Canonical atomic environment update script for OrbaAgent auth activation.
#
# Preserves all existing settings, comments, and spacing in $ENV_FILE.
# Enforces pre-replacement validation of ownership, 0600 permissions,
# secret length, JSON syntax, and required variables on the candidate file.
# Atomic rename(2) is executed ONLY after all candidate validations pass.
# ==============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/orbaagent/prod.env}"
TENANT="${TENANT:-default-tenant}"
AUTH_MODE="${AUTH_MODE:-required}"
SESSION_SECRET="${SESSION_SECRET:-}"
API_KEY_SHA="${API_KEY_SHA:-}"

if [ -z "$SESSION_SECRET" ] || [ -z "$API_KEY_SHA" ]; then
  echo "FAIL: SESSION_SECRET and API_KEY_SHA environment variables must be provided" >&2
  exit 1
fi

if [ "$AUTH_MODE" != "required" ] && [ "$AUTH_MODE" != "permissive" ]; then
  echo "FAIL: AUTH_MODE must be 'required' or 'permissive' (got '$AUTH_MODE')" >&2
  exit 1
fi

# 1. Back up existing environment file if present
if [ -f "$ENV_FILE" ]; then
  BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
  cp -a "$ENV_FILE" "$BACKUP"
  chmod 0600 "$BACKUP"
  echo "backup → $BACKUP"
fi

# 2. Build candidate in a tempfile on the exact same filesystem (guarantees atomic rename)
TMP="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
chmod 0600 "$TMP"

# Enforce candidate ownership matches destination, or root:root if new
if [ -f "$ENV_FILE" ]; then
  if ! chown --reference="$ENV_FILE" "$TMP" 2>/dev/null; then
    echo "FAIL: Could not set candidate ownership to match $ENV_FILE" >&2
    echo "Recovery: Ensure this step is run as root or with permissions to match $ENV_FILE ownership." >&2
    rm -f "$TMP"
    exit 1
  fi
else
  if ! chown root:root "$TMP" 2>/dev/null; then
    echo "FAIL: Could not set candidate ownership to root:root" >&2
    echo "Recovery: Ensure this step is run as root." >&2
    rm -f "$TMP"
    exit 1
  fi
fi

# Preserve every existing line except the four authentication keys we update
if [ -f "$ENV_FILE" ]; then
  grep -v -E '^(ORBA_AUTH_MODE|ORBA_SESSION_SECRET|ORBA_API_KEYS|ORBA_TENANTS)=' \
    "$ENV_FILE" >> "$TMP" || true
fi

# Append new authentication settings
{
  printf 'ORBA_AUTH_MODE=%s\n' "$AUTH_MODE"
  printf 'ORBA_SESSION_SECRET=%s\n' "$SESSION_SECRET"
  printf 'ORBA_API_KEYS=%s\n' "{\"$API_KEY_SHA\":{\"tenantId\":\"$TENANT\",\"userId\":\"owner\"}}"
  printf 'ORBA_TENANTS=%s\n' "$TENANT"
} >> "$TMP"

# 3. PRE-REPLACEMENT VALIDATION: Validate candidate thoroughly BEFORE replacement.
#    If any check fails, $TMP is unlinked and $ENV_FILE remains 100% untouched.

# (i) Enforce and verify restrictive 0600 permissions on candidate
chmod 0600 "$TMP"
TMP_PERM="$(stat -c '%a' "$TMP" 2>/dev/null || stat -f '%A' "$TMP")"
if [ "$TMP_PERM" != "600" ] && [ "$TMP_PERM" != "-rw-------" ]; then
  echo "FAIL: Candidate file permissions are not 0600 ($TMP_PERM)" >&2
  echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
  rm -f "$TMP"
  exit 1
fi

# (ii) Verify candidate ownership matches destination
if [ -f "$ENV_FILE" ]; then
  DEST_OWNER="$(stat -c '%u:%g' "$ENV_FILE" 2>/dev/null || stat -f '%u:%g' "$ENV_FILE")"
  TMP_OWNER="$(stat -c '%u:%g' "$TMP" 2>/dev/null || stat -f '%u:%g' "$TMP")"
  if [ "$TMP_OWNER" != "$DEST_OWNER" ]; then
    echo "FAIL: Candidate ownership ($TMP_OWNER) does not match destination ($DEST_OWNER)" >&2
    echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
    echo "Recovery: Re-run the step as root so ownership can be matched." >&2
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
if ! grep -q "^ORBA_AUTH_MODE=${AUTH_MODE}$" "$TMP" || ! grep -q '^ORBA_TENANTS=' "$TMP"; then
  echo "FAIL: Candidate is missing required auth variables" >&2
  echo "Aborting before replacement: $ENV_FILE remains untouched." >&2
  rm -f "$TMP"
  exit 1
fi

# 4. Atomic replacement: all candidate validations passed cleanly.
#    Because $TMP already carries verified 0600 permissions and matching
#    ownership, rename(2) atomically swaps the destination inode without
#    any permission exposure window or reliance on post-rename chmod.
mv -f "$TMP" "$ENV_FILE"

# 5. Clear secret variables from shell memory immediately.
unset SESSION_SECRET API_KEY_SHA
echo "OK: $ENV_FILE atomically updated with validated candidate configuration ($TMP_SECRET_LEN char secret, value not printed)"
