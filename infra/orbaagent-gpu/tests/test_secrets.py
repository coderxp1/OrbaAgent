"""Tests for secret loading and redaction."""

from __future__ import annotations

import pytest

from orba_gpu.secrets import (
    MIN_TOKEN_LENGTH,
    REDACTED,
    MissingSecretError,
    Redactor,
    load_secret,
)

GOOD = "a" * MIN_TOKEN_LENGTH


class TestLoadSecret:
    def test_reads_from_env(self):
        assert load_secret(env_var="MEDIA_WORKER_TOKEN", env={"MEDIA_WORKER_TOKEN": GOOD}) == GOOD

    def test_reads_from_file_when_configured(self, tmp_path):
        secret_file = tmp_path / "token"
        secret_file.write_text(GOOD + "\n")
        value = load_secret(
            env_var="MEDIA_WORKER_TOKEN",
            file_var="MEDIA_WORKER_TOKEN_FILE",
            env={"MEDIA_WORKER_TOKEN_FILE": str(secret_file)},
        )
        assert value == GOOD  # trailing newline stripped

    def test_file_takes_precedence_over_env(self, tmp_path):
        secret_file = tmp_path / "token"
        secret_file.write_text("f" * MIN_TOKEN_LENGTH)
        value = load_secret(
            env_var="MEDIA_WORKER_TOKEN",
            file_var="MEDIA_WORKER_TOKEN_FILE",
            env={
                "MEDIA_WORKER_TOKEN_FILE": str(secret_file),
                "MEDIA_WORKER_TOKEN": "e" * MIN_TOKEN_LENGTH,
            },
        )
        assert value.startswith("f")

    def test_missing_secret_raises(self):
        with pytest.raises(MissingSecretError, match="is not set"):
            load_secret(env_var="MEDIA_WORKER_TOKEN", env={})

    def test_no_default_is_provided(self):
        """There must be no fallback literal."""
        with pytest.raises(MissingSecretError) as exc:
            load_secret(env_var="MEDIA_WORKER_TOKEN", env={})
        assert "No default is provided" in str(exc.value)

    def test_short_secret_is_rejected(self):
        with pytest.raises(MissingSecretError, match="too short"):
            load_secret(env_var="MEDIA_WORKER_TOKEN", env={"MEDIA_WORKER_TOKEN": "short"})

    def test_unreadable_file_falls_back_to_env(self, tmp_path):
        value = load_secret(
            env_var="MEDIA_WORKER_TOKEN",
            file_var="MEDIA_WORKER_TOKEN_FILE",
            env={
                "MEDIA_WORKER_TOKEN_FILE": str(tmp_path / "does-not-exist"),
                "MEDIA_WORKER_TOKEN": GOOD,
            },
        )
        assert value == GOOD

    def test_blank_env_value_is_treated_as_missing(self):
        with pytest.raises(MissingSecretError):
            load_secret(env_var="MEDIA_WORKER_TOKEN", env={"MEDIA_WORKER_TOKEN": "   "})

    def test_legacy_hardcoded_token_is_not_accepted_as_a_default(self):
        """The removed committed literal must not resurface anywhere."""
        with pytest.raises(MissingSecretError):
            load_secret(
                env_var="MEDIA_WORKER_TOKEN",
                env={"SOMETHING_ELSE": "orbaagent-gpu-worker-auth"},
            )


class TestRedactor:
    def test_redacts_known_secrets(self):
        r = Redactor([GOOD])
        assert r.redact(f"failed with token {GOOD}") == f"failed with token {REDACTED}"

    def test_redacts_every_occurrence(self):
        r = Redactor([GOOD])
        assert r.redact(f"{GOOD} and {GOOD}").count(REDACTED) == 2

    def test_leaves_clean_text_untouched(self):
        r = Redactor([GOOD])
        assert r.redact("nothing sensitive here") == "nothing sensitive here"

    def test_contains_secret_detects_leaks(self):
        r = Redactor([GOOD])
        assert r.contains_secret(f"oops {GOOD}") is True
        assert r.contains_secret("clean") is False

    def test_multiple_secrets(self):
        other = "b" * MIN_TOKEN_LENGTH
        r = Redactor([GOOD, other])
        assert r.contains_secret(f"{GOOD} {other}") is True
        assert GOOD not in r.redact(f"{GOOD} {other}")

    def test_empty_secrets_are_ignored(self):
        r = Redactor(["", None])  # type: ignore[list-item]
        assert r.redact("text") == "text"
