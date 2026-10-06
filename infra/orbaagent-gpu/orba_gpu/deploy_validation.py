"""Validate that a rendered GPU worker config keeps GPU 1 isolation intact.

Used two ways:

* by the on-host wrapper (``/usr/local/sbin/orbaagent-gpu validate``) against
  ``docker compose config`` output, so configuration drift is caught at runtime;
* by the unit tests against the checked-in compose files, so a bad edit is caught
  before it ever reaches the host.

The checks are deliberately blunt: anything that could widen GPU access, weaken
container isolation, or expose the worker publicly is a hard failure. There is no
"warning" path.
"""

from __future__ import annotations

EXPECTED_GPU_UUID = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"
FORBIDDEN_GPU_UUID = "GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4"


class IsolationError(Exception):
    """Raised when a configuration would weaken GPU or container isolation."""


def _code_lines(text: str) -> str:
    """Strip comments so documentation about forbidden settings is not flagged."""
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def validate_isolation(config_text: str) -> None:
    """Assert the configuration pins GPU 1 and nothing broader.

    Args:
        config_text: Rendered compose config, or the compose file itself.

    Raises:
        IsolationError: on the first violation found.
    """
    code = _code_lines(config_text)

    if not code.strip():
        raise IsolationError("configuration is empty")

    # --- GPU 0 must never appear at all -------------------------------------
    # Checked FIRST so a config that names GPU 0 in place of GPU 1 reports the
    # dangerous condition rather than a generic "not pinned" message.
    if FORBIDDEN_GPU_UUID in code:
        raise IsolationError(
            f"GPU 0 ({FORBIDDEN_GPU_UUID}) appears in the configuration; "
            "the CoderXP workload must remain untouched"
        )

    # --- GPU 1 must be pinned, explicitly -----------------------------------
    if EXPECTED_GPU_UUID not in code:
        raise IsolationError(
            f"expected GPU UUID {EXPECTED_GPU_UUID} is not pinned in the configuration"
        )

    # --- both pins must be present ------------------------------------------
    if "device_ids:" not in code:
        raise IsolationError("no device reservation found; the worker could see every GPU")
    if "NVIDIA_VISIBLE_DEVICES" not in code:
        raise IsolationError("NVIDIA_VISIBLE_DEVICES is not set")
    if "CUDA_VISIBLE_DEVICES" not in code:
        raise IsolationError("CUDA_VISIBLE_DEVICES is not set")

    # --- no broad GPU selectors or weakened isolation -----------------------
    forbidden_patterns = (
        ("--gpus", "the --gpus flag bypasses the device reservation"),
        ("count: all", "count: all would expose every GPU"),
        ("capabilities: [all]", "all capabilities would expose every GPU"),
        ("privileged: true", "privileged mode is root-equivalent and forbidden"),
        ("privileged:true", "privileged mode is root-equivalent and forbidden"),
        ("/dev/nvidia", "host NVIDIA device mounts bypass the runtime allowlist"),
        ("network_mode: host", "host networking removes the container boundary"),
        ("pid: host", "host PID namespace breaks container isolation"),
        ("ipc: host", "host IPC namespace breaks container isolation"),
    )
    lowered = code.lower()
    for needle, why in forbidden_patterns:
        if needle.lower() in lowered:
            raise IsolationError(f"forbidden setting '{needle}': {why}")

    # --- the worker port must not be published on a public interface --------
    # Match the mapping itself, not the surrounding YAML dash, so both
    # `- "127.0.0.1:8190:8190"` and `ports: ["0.0.0.0:8190:8190"]` are inspected.
    for line in code.splitlines():
        if "8190:8190" not in line:
            continue
        candidate = line.strip().lstrip("- ").strip().strip('"').strip("'").strip()
        if candidate.startswith("127.0.0.1:8190:8190"):
            continue
        raise IsolationError(
            f"port 8190 is published on a non-loopback interface ({candidate}); "
            "the worker must only be reachable over the private tunnel"
        )


def violations(config_text: str) -> list[str]:
    """Return a list of violations instead of raising (useful for reporting)."""
    try:
        validate_isolation(config_text)
        return []
    except IsolationError as exc:
        return [str(exc)]
