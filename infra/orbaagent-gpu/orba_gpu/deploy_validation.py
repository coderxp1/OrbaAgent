"""Validate that a rendered GPU worker config pins exactly the GPU named by policy.

Used three ways:

* by the on-host wrapper (``/usr/local/sbin/orbaagent-gpu validate``) against
  ``docker compose config`` output, so configuration drift is caught at runtime;
* by the unit tests against the checked-in compose files, so a bad edit is caught
  before it ever reaches the host;
* by operators, offline, to dry-run a proposed compose/worker.env pair.

WHY THE GPU IS A POLICY, NOT A CONSTANT
---------------------------------------
Earlier revisions hard-coded two GPU UUIDs here ("expected" = GPU 1, "forbidden"
= GPU 0). That tied the worker's isolation guarantee to one historical host
mapping, and reallocating the worker meant editing code, compose files, tests and
docs in lock-step. It also meant anyone proposing a change had to *guess* the
UUIDs without seeing the live host.

The allocation is now read from the root-owned ``worker.env`` (or the process
environment, or a ``--policy-file``):

    ORBA_WORKER_GPU_UUID            the single GPU the worker may use (``GPU-…``)
    ORBA_WORKER_FORBIDDEN_GPU_UUIDS comma-separated GPUs the worker must never
                                    touch (other tenants, test allocations)
    ORBA_WORKER_GPU_INDEX           optional host-side index the UUID is expected
                                    to have (checked live by ``gpu_inventory``)

There is no default. A missing or malformed policy is a hard failure, exactly like
a widened GPU selector. There is no "warning" path.

WHAT IS CHECKED
---------------
Textual checks (blunt, against the comment-stripped config):
  * no ``--gpus``, ``count: all``, ``capabilities: [all]``, ``privileged``,
    ``/dev/nvidia*`` mounts, host network/pid/ipc, ``gpus:`` keys;
  * no unrendered ``${…}`` interpolation left over;
  * ``device_ids``, ``NVIDIA_VISIBLE_DEVICES`` and ``CUDA_VISIBLE_DEVICES`` present;
  * the policy UUID appears; 8190/11435 only published on 10.77.0.2.

Structural checks (PyYAML; fail closed when unavailable):
  * the worker service ``orbaagent-gpu-worker`` exists and pins the policy UUID
    in all three places (device reservation, NVIDIA_VISIBLE_DEVICES,
    MEDIA_WORKER_GPU_UUID), with ``CUDA_VISIBLE_DEVICES=0``, one nvidia device,
    capabilities exactly ``[gpu]``;
  * no forbidden UUID appears anywhere in the worker service;
  * every other service that reserves a GPU names exactly one explicit UUID
    (never ``all``, never a bare index);
  * every published port of every service binds the WireGuard address only.

Other services are deliberately *not* held to the worker's forbidden list:
orbaagent-ollama / orbaagent-comfyui keep their own pins and are out of scope for
a worker-only change. Their pins are reported in the OK line so drift is visible.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Iterable, Mapping, Optional

POLICY_UUID_ENV = "ORBA_WORKER_GPU_UUID"
POLICY_FORBIDDEN_ENV = "ORBA_WORKER_FORBIDDEN_GPU_UUIDS"
POLICY_INDEX_ENV = "ORBA_WORKER_GPU_INDEX"

WORKER_SERVICE = "orbaagent-gpu-worker"
TUNNEL_HOST_IP = "10.77.0.2"

GPU_UUID_RE = re.compile(
    r"^GPU-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)

# ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:?error}, ${VAR?error}, ${VAR:+alt}
_INTERP_RE = re.compile(
    r"\$(?:(?P<escaped>\$)|\{(?P<name>[A-Za-z_][A-Za-z0-9_]*)(?::?(?P<op>[-?+])(?P<arg>[^}]*))?\})"
)

def _kv(key: str, value: str) -> "re.Pattern[str]":
    """Regex for ``key: value`` in YAML or ``"key": "value"`` in JSON (lower-cased input)."""
    return re.compile(r"(^|[\s{,])[\"']?" + key + r"[\"']?\s*:\s*[\"']?" + value + r"\b")


_FORBIDDEN_PATTERNS = (
    ("--gpus", re.compile(r"--gpus"), "the --gpus flag bypasses the device reservation"),
    ("count: all", _kv("count", "all"), "count: all would expose every GPU"),
    ("capabilities: [all]", re.compile(r"capabilities[\"']?\s*:\s*\[\s*[\"']?all"), "all capabilities would expose every GPU"),
    ("privileged: true", _kv("privileged", "true"), "privileged mode is root-equivalent and forbidden"),
    ("/dev/nvidia", re.compile(r"/dev/nvidia"), "host NVIDIA device mounts bypass the runtime allowlist"),
    ("network_mode: host", _kv("network_mode", "host"), "host networking removes the container boundary"),
    ("pid: host", _kv("pid", "host"), "host PID namespace breaks container isolation"),
    ("ipc: host", _kv("ipc", "host"), "host IPC namespace breaks container isolation"),
    ("gpus:", re.compile(r"(^|[\s{,])[\"']?gpus[\"']?\s*:", re.MULTILINE), "the shorthand GPU key bypasses the device reservation"),
)


class IsolationError(Exception):
    """Raised when a configuration would weaken GPU or container isolation."""


class PolicyError(IsolationError):
    """Raised when the GPU allocation policy itself is missing or malformed."""


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GpuAllocationPolicy:
    """Which GPU the worker may use, and which it must never touch."""

    worker_uuid: str
    forbidden_uuids: tuple[str, ...] = field(default_factory=tuple)
    worker_index: Optional[int] = None

    def validate(self) -> None:
        if not self.worker_uuid:
            raise PolicyError(f"{POLICY_UUID_ENV} is not set; refusing to validate without a GPU policy")
        if not GPU_UUID_RE.match(self.worker_uuid):
            raise PolicyError(
                f"{POLICY_UUID_ENV}={self.worker_uuid!r} is not a GPU UUID "
                "(expected GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx; a bare index is never acceptable)"
            )
        for uuid in self.forbidden_uuids:
            if not GPU_UUID_RE.match(uuid):
                raise PolicyError(f"{POLICY_FORBIDDEN_ENV} contains a non-UUID entry: {uuid!r}")
        lowered = {u.lower() for u in self.forbidden_uuids}
        if self.worker_uuid.lower() in lowered:
            raise PolicyError(
                f"{POLICY_UUID_ENV} ({self.worker_uuid}) is also listed in {POLICY_FORBIDDEN_ENV}"
            )
        if len(lowered) != len(self.forbidden_uuids):
            raise PolicyError(f"{POLICY_FORBIDDEN_ENV} contains duplicates")
        if self.worker_index is not None and self.worker_index < 0:
            raise PolicyError(f"{POLICY_INDEX_ENV} must be a non-negative integer")

    def is_forbidden(self, uuid: str) -> bool:
        return uuid.lower() in {u.lower() for u in self.forbidden_uuids}

    def describe(self) -> str:
        parts = [f"worker={self.worker_uuid}"]
        if self.worker_index is not None:
            parts.append(f"expected host index={self.worker_index}")
        parts.append(
            "forbidden=" + (",".join(self.forbidden_uuids) if self.forbidden_uuids else "<none declared>")
        )
        return " ".join(parts)


def _split_csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def policy_from_mapping(source: Mapping[str, str]) -> GpuAllocationPolicy:
    """Build (and validate) a policy from an environment-like mapping."""
    index_raw = (source.get(POLICY_INDEX_ENV) or "").strip()
    index: Optional[int] = None
    if index_raw:
        if not index_raw.isdigit():
            raise PolicyError(f"{POLICY_INDEX_ENV}={index_raw!r} is not a non-negative integer")
        index = int(index_raw)
    policy = GpuAllocationPolicy(
        worker_uuid=(source.get(POLICY_UUID_ENV) or "").strip(),
        forbidden_uuids=_split_csv(source.get(POLICY_FORBIDDEN_ENV) or ""),
        worker_index=index,
    )
    policy.validate()
    return policy


def policy_from_env(env: Optional[Mapping[str, str]] = None) -> GpuAllocationPolicy:
    return policy_from_mapping(os.environ if env is None else env)


def parse_env_file(text: str) -> dict[str, str]:
    """Parse a ``KEY=VALUE`` file the way ``docker compose --env-file`` does.

    Comments and blank lines are ignored, a single layer of matching quotes is
    stripped, nothing is executed or expanded. Later keys override earlier ones.
    """
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _, value = line.partition("=")
        key = key.strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[key] = value
    return values


def policy_from_env_file(path: str) -> GpuAllocationPolicy:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError as exc:
        raise PolicyError(f"cannot read policy file {path}: {exc}") from exc
    return policy_from_mapping(parse_env_file(text))


# ---------------------------------------------------------------------------
# Compose template rendering (offline stand-in for `docker compose config`)
# ---------------------------------------------------------------------------


def render_compose_template(text: str, variables: Mapping[str, str]) -> str:
    """Interpolate ``${VAR}`` forms the way compose does, for offline validation.

    Only the brace forms are supported (that is all our compose files use).
    ``${VAR:?msg}`` with an unset/empty VAR raises IsolationError, mirroring the
    hard failure ``docker compose config`` produces on the host.
    """

    def substitute(match: re.Match[str]) -> str:
        if match.group("escaped"):
            return "$"
        name = match.group("name")
        op = match.group("op")
        arg = match.group("arg") or ""
        value = variables.get(name)
        is_set = value is not None and value != ""
        if op is None:
            return value or ""
        if op == "-":
            return value if is_set else arg
        if op == "+":
            return arg if is_set else ""
        if op == "?":
            if is_set:
                return value  # type: ignore[return-value]
            raise IsolationError(f"required variable {name} is unset: {arg or 'no message'}")
        return match.group(0)

    return _INTERP_RE.sub(substitute, text)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


_COMMENT_RE = re.compile(r"(^|\s)#.*$")


def _code_lines(text: str) -> str:
    """Strip YAML comments so documentation about forbidden settings is not flagged.

    A ``#`` only starts a comment at the beginning of a line or after whitespace,
    which is the YAML rule; a ``#`` embedded in a value (``url#frag``) is kept.
    """
    return "\n".join(_COMMENT_RE.sub("", line) for line in text.splitlines())


def _env_as_dict(environment) -> dict[str, str]:
    """Normalise compose ``environment`` (list of KEY=VALUE, or mapping)."""
    out: dict[str, str] = {}
    if isinstance(environment, Mapping):
        for key, value in environment.items():
            out[str(key)] = "" if value is None else str(value)
    elif isinstance(environment, list):
        for item in environment:
            item = str(item)
            key, sep, value = item.partition("=")
            out[key.strip()] = value.strip() if sep else ""
    return out


def _devices_of(service: Mapping) -> list:
    deploy = service.get("deploy") or {}
    resources = deploy.get("resources") or {}
    reservations = resources.get("reservations") or {}
    devices = reservations.get("devices") or []
    return list(devices) if isinstance(devices, list) else []


def _ports_of(service: Mapping) -> list:
    ports = service.get("ports") or []
    return list(ports) if isinstance(ports, list) else []


def _check_port_binding(service_name: str, ports: Iterable) -> None:
    """Accept short syntax (``"ip:host:container"``) and the long syntax that
    ``docker compose config`` (2.40.x) emits: ``{mode, host_ip, target,
    published, protocol}`` where ``published`` is a string and ``target`` an int.
    """
    for mapping in ports:
        if isinstance(mapping, Mapping):
            host_ip = str(mapping.get("host_ip") or "")
            published = mapping.get("published")
            if published in (None, ""):
                continue  # not published on the host at all
            if host_ip != TUNNEL_HOST_IP:
                raise IsolationError(
                    f"service {service_name} publishes port {published} on "
                    f"{host_ip or '0.0.0.0'}; only {TUNNEL_HOST_IP} (WireGuard) is permitted"
                )
        else:
            candidate = str(mapping).strip().strip('"').strip("'")
            if not candidate.startswith(f"{TUNNEL_HOST_IP}:"):
                raise IsolationError(
                    f"service {service_name} publishes {candidate}; only "
                    f"{TUNNEL_HOST_IP}:<port>:<port> (WireGuard) is permitted"
                )


def _check_service_hardening(name: str, service: Mapping) -> None:
    """Structural twin of the textual forbidden patterns, applied to EVERY service.

    Works on parsed documents regardless of serialization (YAML/JSON), so a
    rendered config cannot slip past the textual scan through quoting/formatting.
    """
    if service.get("privileged") is True:
        raise IsolationError(f"service {name}: privileged mode is root-equivalent and forbidden")
    if str(service.get("network_mode") or "").lower() == "host":
        raise IsolationError(f"service {name}: host networking removes the container boundary")
    for key in ("pid", "ipc", "uts", "userns_mode"):
        if str(service.get(key) or "").lower() == "host":
            raise IsolationError(f"service {name}: host {key} namespace breaks container isolation")
    if "gpus" in service:
        raise IsolationError(f"service {name}: the shorthand gpus key bypasses the device reservation")
    for device in service.get("devices") or []:
        if "/dev/nvidia" in str(device):
            raise IsolationError(f"service {name}: host NVIDIA device mounts bypass the runtime allowlist")
    for volume in service.get("volumes") or []:
        source = volume.get("source") if isinstance(volume, Mapping) else str(volume)
        if "/dev/nvidia" in str(source or ""):
            raise IsolationError(f"service {name}: host NVIDIA device mounts bypass the runtime allowlist")
    for device in _devices_of(service):
        if isinstance(device, Mapping) and str(device.get("count", "")).lower() == "all":
            raise IsolationError(f"service {name}: count: all would expose every GPU")


def _single_device_uuid(service_name: str, device: Mapping) -> str:
    if str(device.get("driver", "")).lower() != "nvidia":
        raise IsolationError(f"service {service_name}: device reservation driver must be nvidia")
    capabilities = device.get("capabilities")
    if capabilities != ["gpu"]:
        raise IsolationError(
            f"service {service_name}: device capabilities must be exactly [gpu], got {capabilities!r}"
        )
    if "count" in device:
        raise IsolationError(f"service {service_name}: device reservation uses count; pin a UUID instead")
    ids = device.get("device_ids")
    if not isinstance(ids, list) or len(ids) != 1:
        raise IsolationError(
            f"service {service_name}: device_ids must name exactly one GPU, got {ids!r}"
        )
    uuid = str(ids[0]).strip()
    if not GPU_UUID_RE.match(uuid):
        raise IsolationError(
            f"service {service_name}: device_ids entry {uuid!r} is not an explicit GPU UUID"
        )
    return uuid


def _check_worker_service(policy: GpuAllocationPolicy, service: Mapping) -> None:
    name = WORKER_SERVICE
    devices = _devices_of(service)
    if len(devices) != 1:
        raise IsolationError(
            f"service {name}: expected exactly one nvidia device reservation, found {len(devices)}"
        )
    device_uuid = _single_device_uuid(name, devices[0])
    env = _env_as_dict(service.get("environment"))

    visible = env.get("NVIDIA_VISIBLE_DEVICES", "")
    cuda = env.get("CUDA_VISIBLE_DEVICES", None)
    target = env.get("MEDIA_WORKER_GPU_UUID", "")

    # Anything forbidden anywhere in the worker is fatal, reported first.
    for label, value in (("device_ids", device_uuid), ("NVIDIA_VISIBLE_DEVICES", visible), ("MEDIA_WORKER_GPU_UUID", target)):
        for candidate in _split_csv(value):
            if policy.is_forbidden(candidate):
                raise IsolationError(
                    f"service {name}: {label} names forbidden GPU {candidate}; "
                    "that device belongs to another workload and must remain untouched"
                )

    if device_uuid.lower() != policy.worker_uuid.lower():
        raise IsolationError(
            f"service {name}: device_ids pins {device_uuid}, policy requires {policy.worker_uuid}"
        )
    if visible.lower() != policy.worker_uuid.lower():
        raise IsolationError(
            f"service {name}: NVIDIA_VISIBLE_DEVICES is {visible!r}, policy requires {policy.worker_uuid}"
        )
    if cuda is None:
        raise IsolationError(f"service {name}: CUDA_VISIBLE_DEVICES is not set")
    if str(cuda) != "0":
        raise IsolationError(
            f"service {name}: CUDA_VISIBLE_DEVICES must be 0 (the single visible device), got {cuda!r}"
        )
    if target.lower() != policy.worker_uuid.lower():
        raise IsolationError(
            f"service {name}: MEDIA_WORKER_GPU_UUID is {target!r}, policy requires {policy.worker_uuid}; "
            "the worker's own nvidia-smi queries would target a different device than the container sees"
        )
    for key in ("privileged",):
        if service.get(key) is True:
            raise IsolationError(f"service {name}: {key} is forbidden")


def _check_other_service(name: str, service: Mapping) -> Optional[str]:
    """Return the pinned UUID of a non-worker GPU service (or None if it has no GPU)."""
    devices = _devices_of(service)
    env = _env_as_dict(service.get("environment"))
    visible = env.get("NVIDIA_VISIBLE_DEVICES")
    if visible is not None and visible.strip().lower() in ("", "all", "void"):
        raise IsolationError(f"service {name}: NVIDIA_VISIBLE_DEVICES={visible!r} would expose every GPU")
    if not devices:
        if visible:
            raise IsolationError(
                f"service {name}: NVIDIA_VISIBLE_DEVICES is set without a device reservation; "
                "the runtime allowlist would not be enforced"
            )
        return None
    if len(devices) != 1:
        raise IsolationError(f"service {name}: expected exactly one device reservation, found {len(devices)}")
    uuid = _single_device_uuid(name, devices[0])
    if visible is not None and visible.strip().lower() != uuid.lower():
        raise IsolationError(
            f"service {name}: NVIDIA_VISIBLE_DEVICES ({visible}) and device_ids ({uuid}) disagree"
        )
    return uuid


def _load_yaml(code: str):
    """Parse a rendered config.

    Accepts both ``docker compose config`` (YAML) and ``docker compose config
    --format json`` output. JSON is tried first because a JSON document is also
    valid YAML but the dedicated parser gives better errors and needs no PyYAML.
    """
    import json

    stripped = code.lstrip()
    if stripped.startswith("{"):
        try:
            return json.loads(stripped)
        except ValueError as exc:
            raise IsolationError(f"configuration is not valid JSON: {exc}") from exc
    try:
        import yaml  # type: ignore
    except ImportError as exc:  # pragma: no cover - exercised on hosts without python3-yaml
        raise IsolationError(
            "PyYAML is not installed; structural validation of YAML is impossible and the "
            "configuration is therefore rejected (install python3-yaml, or validate "
            "`docker compose config --format json` output instead)"
        ) from exc
    try:
        return yaml.safe_load(code)
    except yaml.YAMLError as exc:
        raise IsolationError(f"configuration is not valid YAML: {exc}") from exc


def validate_isolation(config_text: str, policy: Optional[GpuAllocationPolicy] = None) -> dict[str, str]:
    """Assert the configuration pins the policy GPU for the worker and nothing broader.

    Args:
        config_text: Rendered compose config, the compose file itself (``${…}``
            forms are rendered offline with the policy variables), or a bare
            YAML fragment (tests).
        policy: Allocation policy. Defaults to the process environment.

    Returns:
        Mapping of service name -> pinned GPU UUID for every GPU service found
        (empty for fragments without a ``services`` key).

    Raises:
        IsolationError: on the first violation found.
    """
    if policy is None:
        policy = policy_from_env()
    policy.validate()

    code = _code_lines(config_text)
    if not code.strip():
        raise IsolationError("configuration is empty")

    # Offline rendering of ${…}: mirrors `docker compose config --env-file worker.env`.
    if "${" in code:
        code = render_compose_template(code, {POLICY_UUID_ENV: policy.worker_uuid})
    if "${" in code:
        raise IsolationError("configuration still contains unrendered ${...} interpolation")

    # --- no broad GPU selectors or weakened isolation -----------------------
    # Textual, format-agnostic (matches hand-written YAML, `docker compose config`
    # YAML and `--format json`): the key may be bare or quoted, the value bare or
    # quoted. Structural per-service checks below repeat the important ones.
    lowered = code.lower()
    for needle, pattern, why in _FORBIDDEN_PATTERNS:
        if pattern.search(lowered):
            raise IsolationError(f"forbidden setting '{needle}': {why}")

    # --- all three pins must be present --------------------------------------
    if not re.search(r"[\"']?device_ids[\"']?\s*:", code):
        raise IsolationError("no device reservation found; the worker could see every GPU")
    if "NVIDIA_VISIBLE_DEVICES" not in code:
        raise IsolationError("NVIDIA_VISIBLE_DEVICES is not set")
    if "CUDA_VISIBLE_DEVICES" not in code:
        raise IsolationError("CUDA_VISIBLE_DEVICES is not set")

    # --- short-syntax port publication (textual, catches fragments) ----------
    for line in code.splitlines():
        for mapping, what in (("8190:8190", "the worker"), ("11435:11434", "Ollama")):
            if mapping in line:
                candidate = line.strip().lstrip("- ").strip().strip('"').strip("'").strip()
                if not candidate.startswith(f"{TUNNEL_HOST_IP}:{mapping}"):
                    raise IsolationError(
                        f"port {mapping.split(':', 1)[0]} is published on a non-private interface ({candidate}); "
                        f"{what} must only be reachable over the private WireGuard tunnel "
                        f"({TUNNEL_HOST_IP}:{mapping})"
                    )

    # --- fragment mode (no `services:` key) ----------------------------------
    # Used by unit tests and ad-hoc checks of snippets. No per-service structure
    # exists, so any forbidden UUID anywhere is fatal. Checked FIRST so a fragment
    # naming a forbidden GPU in place of the policy GPU reports the dangerous
    # condition, not a generic "not pinned".
    if not re.search(r"(^|[\s{,])[\"']?services[\"']?\s*:", code, re.MULTILINE):
        for uuid in policy.forbidden_uuids:
            if uuid.lower() in lowered:
                raise IsolationError(
                    f"forbidden GPU {uuid} appears in the configuration; "
                    "that device belongs to another workload and must remain untouched"
                )
        if policy.worker_uuid.lower() not in lowered:
            raise IsolationError(f"policy GPU {policy.worker_uuid} is not pinned in the configuration")
        return {}

    # --- structural checks (real compose documents) --------------------------
    document = _load_yaml(code)
    services = document.get("services") if isinstance(document, Mapping) else None
    if not isinstance(services, Mapping):
        raise IsolationError("`services` is not a mapping")
    if WORKER_SERVICE not in services:
        raise IsolationError(f"service {WORKER_SERVICE} is missing from the configuration")

    pins: dict[str, str] = {}
    for name, service in services.items():
        if not isinstance(service, Mapping):
            raise IsolationError(f"service {name} is not a mapping")
        _check_service_hardening(str(name), service)
        _check_port_binding(str(name), _ports_of(service))
        if name == WORKER_SERVICE:
            _check_worker_service(policy, service)
            pins[str(name)] = policy.worker_uuid
        else:
            uuid = _check_other_service(str(name), service)
            if uuid:
                pins[str(name)] = uuid
    return pins


def violations(config_text: str, policy: Optional[GpuAllocationPolicy] = None) -> list[str]:
    """Return a list of violations instead of raising (useful for reporting)."""
    try:
        validate_isolation(config_text, policy)
        return []
    except IsolationError as exc:
        return [str(exc)]


def main(argv: Optional[list[str]] = None) -> int:
    """CLI entry point.

        docker compose config | python3 -m orba_gpu.deploy_validation --policy-file /etc/orbaagent/gpu-worker/worker.env -
        ORBA_WORKER_GPU_UUID=GPU-… python3 -m orba_gpu.deploy_validation /etc/orbaagent/gpu-worker/compose.yaml

    Exit codes: 0 ok · 2 usage · 3 unreadable input · 4 isolation/policy violation
    """
    import sys
    from pathlib import Path

    args = list(sys.argv if argv is None else argv)[1:]
    policy_file: Optional[str] = None
    positional: list[str] = []
    while args:
        arg = args.pop(0)
        if arg == "--policy-file":
            if not args:
                print("usage: --policy-file requires a path", file=sys.stderr)
                return 2
            policy_file = args.pop(0)
        elif arg.startswith("--policy-file="):
            policy_file = arg.split("=", 1)[1]
        else:
            positional.append(arg)

    if len(positional) != 1:
        print(
            "usage: python3 -m orba_gpu.deploy_validation [--policy-file worker.env] <config-file|->",
            file=sys.stderr,
        )
        return 2

    if positional[0] == "-":
        text = sys.stdin.read()
    else:
        try:
            text = Path(positional[0]).read_text(encoding="utf-8")
        except OSError as exc:
            print(f"cannot read {positional[0]}: {exc}", file=sys.stderr)
            return 3

    try:
        policy = policy_from_env_file(policy_file) if policy_file else policy_from_env()
        pins = validate_isolation(text, policy)
    except IsolationError as exc:
        print(f"ISOLATION FAILURE: {exc}", file=sys.stderr)
        return 4

    others = ", ".join(f"{name}->{uuid}" for name, uuid in sorted(pins.items()) if name != WORKER_SERVICE)
    print(
        f"isolation OK: {WORKER_SERVICE} pinned to {policy.worker_uuid}; "
        f"forbidden GPUs absent from the worker ({', '.join(policy.forbidden_uuids) or 'none declared'})"
        + (f"; other GPU services: {others}" if others else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
