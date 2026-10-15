"""Tests for the least-privilege delegation design.

These are static assertions over the checked-in reference artifacts. They cannot
prove what is installed on the host, but they do prevent the design from drifting
into something broader than intended — which is the realistic failure mode when
someone "just adds one more command" later.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from orba_gpu.deploy_validation import (
    EXPECTED_GPU_UUID,
    FORBIDDEN_GPU_UUID,
    IsolationError,
    validate_isolation,
    violations,
)

GPU_ROOT = Path(__file__).resolve().parent.parent
DEPLOY = GPU_ROOT / "deploy"
REPO_ROOT = GPU_ROOT.parent.parent

SUDOERS = DEPLOY / "sudoers-orbaagent-gpu"
WRAPPER = DEPLOY / "orbaagent-gpu"
DEPLOY_COMPOSE = DEPLOY / "compose.yaml"
WORKER_ENV = DEPLOY / "worker.env.example"
PROVISION = DEPLOY / "provision-gpu-host.sh"
WG_GPU = DEPLOY / "wireguard" / "wg-orba.gpu-host.conf.example"
WG_PROD = DEPLOY / "wireguard" / "wg-orba.production.conf.example"


# ---------------------------------------------------------------------------
# Isolation validator
# ---------------------------------------------------------------------------


class TestIsolationValidator:
    def test_accepts_the_real_deployment_compose(self):
        validate_isolation(DEPLOY_COMPOSE.read_text(encoding="utf-8"))

    def test_accepts_the_repository_compose(self):
        validate_isolation((GPU_ROOT / "compose.yaml").read_text(encoding="utf-8"))

    def test_rejects_gpu0_uuid(self):
        text = f"device_ids: ['{FORBIDDEN_GPU_UUID}']\nNVIDIA_VISIBLE_DEVICES=all\nCUDA_VISIBLE_DEVICES=0"
        with pytest.raises(IsolationError, match="GPU 0"):
            validate_isolation(text)

    def test_rejects_missing_device_reservation(self):
        text = f"NVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\nCUDA_VISIBLE_DEVICES=0"
        with pytest.raises(IsolationError, match="device reservation"):
            validate_isolation(text)

    def test_rejects_missing_nvidia_visible_devices(self):
        text = f"device_ids: ['{EXPECTED_GPU_UUID}']\nCUDA_VISIBLE_DEVICES=0"
        with pytest.raises(IsolationError, match="NVIDIA_VISIBLE_DEVICES"):
            validate_isolation(text)

    def test_rejects_gpus_all_flag(self):
        text = f"device_ids: ['{EXPECTED_GPU_UUID}']\nNVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\nCUDA_VISIBLE_DEVICES=0\ncommand: --gpus all"
        with pytest.raises(IsolationError, match="--gpus"):
            validate_isolation(text)

    def test_rejects_count_all(self):
        text = f"device_ids: ['{EXPECTED_GPU_UUID}']\nNVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\nCUDA_VISIBLE_DEVICES=0\ncount: all"
        with pytest.raises(IsolationError, match="count: all"):
            validate_isolation(text)

    def test_rejects_privileged(self):
        text = f"device_ids: ['{EXPECTED_GPU_UUID}']\nNVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\nCUDA_VISIBLE_DEVICES=0\nprivileged: true"
        with pytest.raises(IsolationError, match="privileged"):
            validate_isolation(text)

    def test_rejects_host_nvidia_mounts(self):
        text = f"device_ids: ['{EXPECTED_GPU_UUID}']\nNVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\nCUDA_VISIBLE_DEVICES=0\n- /dev/nvidia0:/dev/nvidia0"
        with pytest.raises(IsolationError, match="/dev/nvidia"):
            validate_isolation(text)

    def test_rejects_host_networking(self):
        text = f"device_ids: ['{EXPECTED_GPU_UUID}']\nNVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\nCUDA_VISIBLE_DEVICES=0\nnetwork_mode: host"
        with pytest.raises(IsolationError, match="host networking"):
            validate_isolation(text)

    def test_rejects_public_port_publication(self):
        text = (
            f"device_ids: ['{EXPECTED_GPU_UUID}']\n"
            f"NVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\n"
            f"CUDA_VISIBLE_DEVICES=0\n"
            f"- 0.0.0.0:8190:8190"
        )
        with pytest.raises(IsolationError, match="8190"):
            validate_isolation(text)

    def test_rejects_empty_config(self):
        with pytest.raises(IsolationError, match="empty"):
            validate_isolation("   \n\n")

    def test_comments_about_forbidden_settings_do_not_trip_the_check(self):
        """Documentation explaining what NOT to do must be allowed."""
        text = (
            f"# never use --gpus all, privileged: true, or /dev/nvidia mounts\n"
            f"device_ids: ['{EXPECTED_GPU_UUID}']\n"
            f"NVIDIA_VISIBLE_DEVICES={EXPECTED_GPU_UUID}\n"
            f"CUDA_VISIBLE_DEVICES=0\n"
        )
        validate_isolation(text)

    def test_violations_returns_a_list(self):
        assert violations(DEPLOY_COMPOSE.read_text(encoding="utf-8")) == []
        assert violations("nothing here") != []


# ---------------------------------------------------------------------------
# Sudoers policy
# ---------------------------------------------------------------------------


class TestSudoersPolicy:
    @pytest.fixture(scope="class")
    def text(self) -> str:
        return SUDOERS.read_text(encoding="utf-8")

    @pytest.fixture(scope="class")
    def rules(self, text) -> list[str]:
        return [
            line.strip()
            for line in text.splitlines()
            if line.strip().startswith("klaus ")
        ]

    def test_grants_only_the_wrapper(self, rules):
        assert rules, "no rules found"
        for rule in rules:
            assert "/usr/local/sbin/orbaagent-gpu" in rule, rule

    def test_never_grants_docker(self, text):
        code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
        for forbidden in ("/usr/bin/docker", "/usr/bin/dockerd", "docker-compose", "/var/run/docker.sock"):
            assert forbidden not in code, f"sudoers must not reference {forbidden}"

    def test_never_grants_a_shell_or_systemctl(self, text):
        code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
        for forbidden in ("/bin/sh", "/bin/bash", "systemctl", "journalctl", "su ", "visudo"):
            assert forbidden not in code, f"sudoers must not grant {forbidden}"

    def test_no_bare_all_grant(self, text):
        code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
        assert not re.search(r"klaus\s+ALL=\(ALL\)\s+NOPASSWD:\s*ALL", code)
        assert "NOPASSWD: ALL" not in code

    def test_no_bare_wildcard_after_the_wrapper(self, rules):
        """A trailing `*` directly after the wrapper would let arbitrary subcommands reach it."""
        for rule in rules:
            assert not re.search(r"/usr/local/sbin/orbaagent-gpu\s+\*", rule), f"bare wildcard rule is too broad: {rule}"

    def test_logs_argument_delegation_rule(self, rules):
        logs_rules = [r for r in rules if "logs" in r]
        assert logs_rules, "expected a logs rule"
        # Must not contain unparseable regex/bracket patterns rejected by visudo-rs
        for rule in logs_rules:
            assert "[" not in rule and "]" not in rule, f"bracket character classes are rejected by visudo-rs: {rule}"
        has_logs_wildcard = any(r.endswith("logs *") for r in logs_rules)
        assert has_logs_wildcard, "expected logs * rule for numeric argument delegation"

    def test_covers_the_documented_commands(self, rules):
        granted = set()
        for rule in rules:
            tail = rule.split("/usr/local/sbin/orbaagent-gpu", 1)[1].strip()
            granted.add(tail or "help")
        for expected in ("up", "down", "restart", "deploy-worker", "restart-worker", "status", "build", "validate", "health", "help"):
            assert expected in granted, f"{expected} should be delegable"
        # And nothing beyond that list.
        allowed_prefixes = {
            "up", "down", "restart", "deploy-worker", "restart-worker", "status", "build", "validate", "health", "help", "logs", "logs *",
        }
        assert granted <= allowed_prefixes, f"unexpected grants: {granted - allowed_prefixes}"

    def test_visudo_syntax_validation(self, text):
        """Validate sudoers policy syntax using visudo if available, and static AST guards."""
        import shutil
        import subprocess
        import tempfile

        # Assert no syntax-breaking bracket wildcards
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("klaus "):
                assert "[" not in stripped and "]" not in stripped, f"brackets are invalid in sudoers command arguments: {stripped}"

        # If visudo binary is present (e.g. Linux CI or host), execute visudo -c -f
        visudo_path = shutil.which("visudo")
        if visudo_path:
            with tempfile.NamedTemporaryFile("w", delete=False) as f:
                f.write(text)
                tmp_path = f.name
            try:
                proc = subprocess.run([visudo_path, "-c", "-f", tmp_path], capture_output=True, text=True)
                assert proc.returncode == 0, f"visudo validation failed:\n{proc.stderr}"
            finally:
                Path(tmp_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Wrapper script
# ---------------------------------------------------------------------------


class TestWrapperScript:
    @pytest.fixture(scope="class")
    def text(self) -> str:
        return WRAPPER.read_text(encoding="utf-8")

    def test_every_docker_invocation_uses_literal_arguments(self, text):
        """The case statement must pass fixed subcommands, never raw caller input.

        `docker_compose` does forward its own "$@" internally, which is correct —
        the safety property is that every CALL SITE supplies a literal, and that
        the only caller-derived value (`logs`) is validated to be numeric first.
        """
        code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())

        # Every call site must be a literal compose subcommand.
        call_sites = re.findall(r"docker_compose\s+([^\n|&;]*?)\s*(?:\|\||$)", code, re.MULTILINE)
        assert call_sites, "expected docker_compose call sites"
        for site in call_sites:
            assert not site.strip().startswith('"$'), f"raw caller input forwarded: {site!r}"
            assert "$1" not in site and "$@" not in site, f"raw caller input forwarded: {site!r}"

        # The one dynamic value is the log line count, and it is digit-guarded.
        assert "logs)" in code
        assert '[!0-9]*' in code, "logs argument must be rejected unless numeric"

    def test_no_arbitrary_docker_subcommands(self, text):
        code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
        for forbidden in ("docker run", "docker exec", "docker create", "docker cp", "docker pull"):
            assert forbidden not in code, f"wrapper must not perform {forbidden}"

    def test_case_statement_enumerates_every_command(self, text):
        for command in ("up)", "down)", "restart)", "deploy-worker)", "restart-worker)", "status)", "logs)", "build)", "validate)", "health)", "help|"):
            assert command in text, f"missing case branch {command}"

    def test_rejects_unknown_commands(self, text):
        assert "unknown command" in text

    def test_validates_isolation_after_start(self, text):
        assert "validate_isolation" in text
        # `up`, `restart`, `deploy-worker`, and `restart-worker` must all re-validate.
        for branch in ("up)", "restart)", "deploy-worker)", "restart-worker)"):
            block = text.split(f"    {branch}", 1)[1].split(";;", 1)[0]
            assert "validate_isolation" in block, f"{branch} must validate isolation"

    def test_deploy_worker_targets_only_worker_container_with_no_deps(self, text):
        """deploy-worker must use --no-deps and target only orbaagent-gpu-worker,
        preventing orbaagent-ollama or other services from being restarted or recreated.
        """
        deploy_block = text.split("    deploy-worker)", 1)[1].split(";;", 1)[0]
        code = "\n".join(line.split("#", 1)[0] for line in deploy_block.splitlines())
        assert "up -d --no-deps orbaagent-gpu-worker" in code
        assert "validate_isolation" in code
        assert "ollama" not in code
        assert "comfyui" not in code

    def test_restart_worker_targets_only_worker_container(self, text):
        """restart-worker must target only orbaagent-gpu-worker without touching other services."""
        restart_block = text.split("    restart-worker)", 1)[1].split(";;", 1)[0]
        code = "\n".join(line.split("#", 1)[0] for line in restart_block.splitlines())
        assert "restart orbaagent-gpu-worker" in code
        assert "validate_isolation" in code
        assert "ollama" not in code
        assert "comfyui" not in code

    def test_uses_a_literal_compose_path(self, text):
        assert 'COMPOSE_FILE="/etc/orbaagent/gpu-worker/compose.yaml"' in text

    def test_uses_env_i_to_discard_caller_environment(self, text):
        assert "env -i" in text

    def test_refuses_when_config_is_not_root_owned(self, text):
        assert "is not owned by root" in text
        assert "must be mode 644" in text

    def test_no_arbitrary_execution_primitives(self, text):
        code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
        for forbidden in ("eval ", "sh -c", "bash -c"):
            assert forbidden not in code, f"wrapper must not use {forbidden}"

    def test_has_a_usage_command(self, text):
        assert "usage()" in text

    def test_bounds_log_lines(self, text):
        assert '"$lines" -gt 2000' in text
        assert '[!0-9]*' in text


# ---------------------------------------------------------------------------
# Deployment compose and env
# ---------------------------------------------------------------------------


class TestDeploymentArtifacts:
    def test_deployment_compose_pins_gpu1(self):
        text = DEPLOY_COMPOSE.read_text(encoding="utf-8")
        assert EXPECTED_GPU_UUID in text
        assert FORBIDDEN_GPU_UUID not in text
        validate_isolation(text)

    def test_worker_env_contains_no_secrets(self):
        text = WORKER_ENV.read_text(encoding="utf-8")
        for name in ("TOKEN=", "PASSWORD=", "SECRET=", "KEY="):
            for line in text.splitlines():
                stripped = line.strip()
                if stripped.startswith("#") or "=" not in stripped:
                    continue
                assert not stripped.startswith(name), f"secret-looking entry: {stripped}"

    def test_worker_env_does_not_pin_gpu_settings(self):
        """GPU pins must live only in the root-owned compose file."""
        code = "\n".join(
            line.split("#", 1)[0] for line in WORKER_ENV.read_text(encoding="utf-8").splitlines()
        )
        assert "NVIDIA_VISIBLE_DEVICES" not in code
        assert "CUDA_VISIBLE_DEVICES" not in code
        assert "device_ids" not in code

    def test_worker_env_points_ingest_at_the_tunnel_not_the_internet(self):
        text = WORKER_ENV.read_text(encoding="utf-8")
        assert "MEDIA_INGEST_URL=http://10.77.0.1/api/internal/media/ingest" in text
        assert "45.84.65.76" not in text

    def test_provisioning_script_never_touches_coderxp_write_paths(self):
        text = PROVISION.read_text(encoding="utf-8")
        for line in text.splitlines():
            code = line.split("#", 1)[0]
            assert "chown" not in code or "coderxp" not in code
            assert "chmod" not in code or "coderxp" not in code
            assert not re.search(r"\brm\s+-rf\s+/srv/projects/coderxp", code)

    def test_provisioning_script_does_not_add_the_docker_group(self):
        code = "\n".join(
            line.split("#", 1)[0] for line in PROVISION.read_text(encoding="utf-8").splitlines()
        )
        assert "usermod" not in code or "docker" not in code
        assert "gpasswd" not in code

    def test_provisioning_validates_sudoers_before_installing(self):
        text = PROVISION.read_text(encoding="utf-8")
        assert "visudo -cf" in text
        assert text.index("visudo -cf") < text.index('install -o root -g root -m 0440 "$tmp_sudoers"')

    def test_provisioning_uses_traverse_only_acl(self):
        assert "u:${WORKER_USER}:--x" in PROVISION.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Immutability of the build context and configuration
# ---------------------------------------------------------------------------


class TestBuildContextImmutability:
    """klaus must not be able to modify worker code, the Dockerfile, or config.

    The earlier version of the provisioning script ran
    `chown -R klaus:klaus "$REPO_DIR"` over a directory that also held the
    Dockerfile and worker sources, which would have let the delegated account
    change container security settings. These tests keep that closed.
    """

    @pytest.fixture(scope="class")
    def provision(self) -> str:
        return PROVISION.read_text(encoding="utf-8")

    @pytest.fixture(scope="class")
    def provision_code(self, provision) -> str:
        return "\n".join(line.split("#", 1)[0] for line in provision.splitlines())

    def test_build_context_lives_under_the_root_owned_config_dir(self):
        text = DEPLOY_COMPOSE.read_text(encoding="utf-8")
        assert "context: /etc/orbaagent/gpu-worker/src" in text

    def test_build_context_is_not_the_worker_writable_dir(self):
        text = DEPLOY_COMPOSE.read_text(encoding="utf-8")
        for line in text.splitlines():
            code = line.split("#", 1)[0]
            if "context:" in code:
                assert "/srv/projects" not in code, "build context must not be klaus-writable"

    def test_provisioning_never_chowns_the_config_or_build_context_to_klaus(self, provision_code):
        """Config and build context may be chowned TO root, never AWAY from root."""
        for line in provision_code.splitlines():
            if "chown" not in line:
                continue
            touches_protected = any(
                token in line
                for token in ("$DEPLOY_DIR", "$SRC_DIR", "$WRAPPER", "$SUDOERS_FILE", "/etc/orbaagent", "$SECRETS_DIR")
            )
            if not touches_protected:
                continue
            assert "root:root" in line, f"protected path must be owned by root: {line.strip()}"
            assert "WORKER_USER" not in line, f"protected path must never go to klaus: {line.strip()}"

    def test_only_the_data_dir_is_chowned_to_klaus(self, provision_code):
        chowns = [line.strip() for line in provision_code.splitlines() if "chown" in line]
        joined = "\n".join(chowns)
        assert "$REPO_DIR" in joined, "the data directory should be klaus-owned"
        assert "root:root" in joined, "config/build artifacts must be root-owned"

    def test_build_context_files_are_forced_to_root(self, provision_code):
        assert 'chown -R root:root "$SRC_DIR"' in provision_code
        assert 'find "$SRC_DIR" -type f -exec chmod 644' in provision_code
        assert 'find "$SRC_DIR" -type d -exec chmod 755' in provision_code

    def test_provisioning_fails_closed_on_writable_build_context(self, provision_code):
        assert 'find "$SRC_DIR" -perm /022' in provision_code
        assert "refusing to continue" in provision_code

    def test_worker_code_is_actually_copied_into_the_build_context(self, provision_code):
        assert '"$SOURCE_DIR/Dockerfile"' in provision_code
        assert '"$SOURCE_DIR/Dockerfile.comfyui"' in provision_code
        assert '"$SOURCE_DIR/worker.py"' in provision_code
        assert '"$SOURCE_DIR/orba_gpu"' in provision_code

    def test_secrets_live_under_the_root_owned_config_dir(self, provision_code):
        assert 'target="$SECRETS_DIR/$name"' in provision_code
        assert "$REPO_DIR/secrets" not in provision_code

    def test_config_files_are_sourced_from_the_bundle_not_the_data_dir(self, provision_code):
        assert '"$SOURCE_DIR/deploy/compose.yaml"' in provision_code
        assert '"$SOURCE_DIR/deploy/orbaagent-gpu"' in provision_code
        assert '"$SOURCE_DIR/deploy/sudoers-orbaagent-gpu"' in provision_code

    def test_docker_secrets_use_absolute_root_owned_paths(self):
        text = DEPLOY_COMPOSE.read_text(encoding="utf-8")
        assert "file: /etc/orbaagent/gpu-worker/secrets/media_worker_token" in text
        assert "file: /etc/orbaagent/gpu-worker/secrets/media_ingest_token" in text

    def test_volumes_are_named_not_bind_mounts(self):
        """A bind mount would need a host path writable by the container."""
        text = DEPLOY_COMPOSE.read_text(encoding="utf-8")
        for line in text.splitlines():
            code = line.split("#", 1)[0].strip()
            if code.startswith("- ") and ":/" in code and "secrets" not in code:
                assert not code.startswith("- ./"), f"bind mount found: {code}"
        assert "orbaagent_models:/models" in text
        assert "orbaagent_output:/output" in text
        assert "orbaagent_data:/data" in text

    def test_provisioning_accepts_a_source_directory(self, provision_code):
        """The bundle is staged in /tmp, so the script cannot assume a checkout."""
        assert "SOURCE_DIR" in provision_code
        assert "BASH_SOURCE" in provision_code


# ---------------------------------------------------------------------------
# WireGuard design
# ---------------------------------------------------------------------------


class TestWireGuardDesign:
    def test_gpu_side_listens_only_for_the_production_peer(self):
        text = WG_GPU.read_text(encoding="utf-8")
        assert "Address = 10.77.0.2/32" in text
        assert "ListenPort = 51820" in text
        assert "AllowedIPs = 10.77.0.1/32" in text

    def test_production_side_is_the_initiator(self):
        text = WG_PROD.read_text(encoding="utf-8")
        assert "Address = 10.77.0.1/32" in text
        assert "Endpoint = 45.84.65.76:51820" in text
        assert "AllowedIPs = 10.77.0.2/32" in text
        # A client side must not listen.
        assert "ListenPort" not in "\n".join(
            line.split("#", 1)[0] for line in text.splitlines()
        )

    def test_no_route_covers_a_public_subnet(self):
        """AllowedIPs must be a single host, never 0.0.0.0/0 or the GPU host's /25."""
        for path in (WG_GPU, WG_PROD):
            for line in path.read_text(encoding="utf-8").splitlines():
                code = line.split("#", 1)[0]
                if "AllowedIPs" in code:
                    assert "0.0.0.0/0" not in code
                    assert "45.84.65.0/25" not in code
                    assert "/32" in code

    def test_no_private_keys_are_committed(self):
        for path in (WG_GPU, WG_PROD):
            text = path.read_text(encoding="utf-8")
            for line in text.splitlines():
                if line.strip().startswith("PrivateKey"):
                    # Only placeholder form is acceptable.
                    assert "<" in line and ">" in line, f"real key committed in {path.name}"

    def test_examples_are_named_as_examples(self):
        for path in (WG_GPU, WG_PROD):
            assert path.name.endswith(".example")
