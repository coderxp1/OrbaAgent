"""Secret loading and redaction.

Tokens must never appear in git, logs, health responses, error messages, or the
frontend bundle. This module is the single place tokens enter the process, and it
provides the redaction helper used on every outbound string.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Optional

#: Minimum acceptable token length. Short tokens are brute-forceable.
MIN_TOKEN_LENGTH = 32

REDACTED = "***redacted***"


class MissingSecretError(RuntimeError):
    """Raised when a required secret is absent or too weak."""


def _read_secret_file(path: str) -> Optional[str]:
    try:
        value = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None


def load_secret(
    *,
    env_var: str,
    file_var: Optional[str] = None,
    env: Optional[dict] = None,
    min_length: int = MIN_TOKEN_LENGTH,
) -> str:
    """Load a secret from a file (preferred) or an environment variable.

    A file indirection (``<X>_FILE``) is preferred because it works with Docker
    secrets and keeps the value out of ``docker inspect`` output.

    Raises:
        MissingSecretError: when absent, empty, or shorter than ``min_length``.
    """
    source = os.environ if env is None else env

    if file_var:
        file_path = (source.get(file_var) or "").strip()
        if file_path:
            value = _read_secret_file(file_path)
            if value:
                return _validate(value, env_var, min_length)

    raw = (source.get(env_var) or "").strip()
    if raw:
        return _validate(raw, env_var, min_length)

    raise MissingSecretError(
        f"{env_var} is not set. Provide it via {file_var or env_var + '_FILE'} "
        "(preferred, e.g. a Docker secret) or the environment. "
        "No default is provided."
    )


def _validate(value: str, name: str, min_length: int) -> str:
    if len(value) < min_length:
        raise MissingSecretError(
            f"{name} is too short ({len(value)} chars); at least {min_length} are required"
        )
    return value


class Redactor:
    """Removes known secret values from arbitrary strings."""

    def __init__(self, secrets: Iterable[str] = ()) -> None:
        self._secrets = [s for s in secrets if s]

    def add(self, secret: str) -> None:
        if secret:
            self._secrets.append(secret)

    def redact(self, text: object) -> str:
        out = str(text)
        for secret in self._secrets:
            if secret in out:
                out = out.replace(secret, REDACTED)
        return out

    def contains_secret(self, text: object) -> bool:
        out = str(text)
        return any(secret in out for secret in self._secrets)
