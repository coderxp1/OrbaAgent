"""Tests that GPU isolation is enforced by configuration, not by luck.

Whichever GPU happens to be idle is not a safety mechanism. These tests assert
that the deployment configuration itself confines the worker to the single GPU
named by the allocation policy (ORBA_WORKER_GPU_UUID in the root-owned
worker.env) and that no GPU UUID is hard-coded for the worker anywhere.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import yaml

from orba_gpu.deploy_validation import (
    GPU_UUID_RE,
    POLICY_UUID_ENV,
    GpuAllocationPolicy,
    IsolationError,
    render_compose_template,
    validate_isolation,
)

GPU_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = GPU_ROOT.parent.parent

COMPOSE_PATH = GPU_ROOT / "compose.yaml"
DOCKERFILE_PATH = GPU_ROOT / "Dockerfile"
PROD_COMPOSE_PATH = REPO_ROOT / "docker-compose.prod.yml"

#: The worker's three pins must all be this exact interpolation: no UUID literal.
WORKER_PIN = "${ORBA_WORKER_GPU_UUID:?ORBA_WORKER_GPU_UUID must be set in worker.env}"

#: Synthetic UUIDs for rendering tests. They are NOT real devices; the real
#: mapping is read from the live host by `orbaagent-gpu validate`.
TEST_WORKER_UUID = "GPU-00000000-0000-0000-0000-00000000000a"
TEST_FORBIDDEN_UUID = "GPU-00000000-0000-0000-0000-00000000000b"
TEST_POLICY = GpuAllocationPolicy(TEST_WORKER_UUID, (TEST_FORBIDDEN_UUID,), 0)

#: orbaagent-ollama / orbaagent-comfyui are OUTSIDE the worker-only change and
#: keep their historical literal pin. This constant documents that, it does not
#: endorse it; see deploy/GPU-ALLOCATION-2026-10-24.md.
OLLAMA_GPU_UUID = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"

ANY_UUID_RE = re.compile(r"GPU-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def _worker_block(compose_text: str) -> str:
    """The raw text of the worker service only (up to the next service)."""
    start = compose_text.index("  orbaagent-gpu-worker:")
    end = compose_text.index("\n  orbaagent-comfyui:")
    return compose_text[start:end]


@pytest.fixture(scope="module")
def compose_text() -> str:
    return COMPOSE_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def compose() -> dict:
    return yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def worker_service(compose) -> dict:
    return compose["services"]["orbaagent-gpu-worker"]


@pytest.fixture(scope="module")
def ollama_service(compose) -> dict:
    return compose["services"]["orbaagent-ollama"]


class TestComposePinsThePolicyGpu:
    def test_pins_the_policy_gpu_in_env(self, worker_service):
        env = worker_service["environment"]
        visible = next(e for e in env if str(e).startswith("NVIDIA_VISIBLE_DEVICES="))
        assert visible.split("=", 1)[1] == WORKER_PIN

    def test_pins_the_policy_gpu_for_the_workers_own_queries(self, worker_service):
        env = worker_service["environment"]
        target = next(e for e in env if str(e).startswith("MEDIA_WORKER_GPU_UUID="))
        assert target.split("=", 1)[1] == WORKER_PIN

    def test_ollama_keeps_its_literal_pin_in_env(self, ollama_service):
        """Out of scope for the worker-only change: must be byte-for-byte unchanged."""
        env = ollama_service["environment"]
        visible = next(e for e in env if str(e).startswith("NVIDIA_VISIBLE_DEVICES="))
        assert visible.split("=", 1)[1] == OLLAMA_GPU_UUID

    def test_pins_the_policy_gpu_in_device_reservation(self, worker_service):
        devices = worker_service["deploy"]["resources"]["reservations"]["devices"]
        assert len(devices) == 1
        assert devices[0]["driver"] == "nvidia"
        assert devices[0]["device_ids"] == [WORKER_PIN]
        assert devices[0]["capabilities"] == ["gpu"]

    def test_ollama_keeps_its_literal_pin_in_device_reservation(self, ollama_service):
        devices = ollama_service["deploy"]["resources"]["reservations"]["devices"]
        assert len(devices) == 1
        assert devices[0]["driver"] == "nvidia"
        assert devices[0]["device_ids"] == [OLLAMA_GPU_UUID]
        assert devices[0]["capabilities"] == ["gpu"]

    def test_no_uuid_literal_anywhere_in_the_worker_service(self, compose_text):
        """A reallocation must never require editing compose; only worker.env."""
        block = "\n".join(line.split("#", 1)[0] for line in _worker_block(compose_text).splitlines())
        assert not ANY_UUID_RE.search(block), "worker service hard-codes a GPU UUID"
        assert block.count(WORKER_PIN) == 3, "all three pins must use the same interpolation"

    def test_rendering_without_a_policy_fails_closed(self, compose_text):
        with pytest.raises(IsolationError, match="ORBA_WORKER_GPU_UUID"):
            render_compose_template(compose_text, {})

    def test_rendered_compose_validates_against_the_policy(self, compose_text):
        rendered = render_compose_template(compose_text, {POLICY_UUID_ENV: TEST_WORKER_UUID})
        worker = yaml.safe_load(rendered)["services"]["orbaagent-gpu-worker"]
        env = [str(e) for e in worker["environment"]]
        assert f"NVIDIA_VISIBLE_DEVICES={TEST_WORKER_UUID}" in env
        assert f"MEDIA_WORKER_GPU_UUID={TEST_WORKER_UUID}" in env
        assert worker["deploy"]["resources"]["reservations"]["devices"][0]["device_ids"] == [TEST_WORKER_UUID]
        pins = validate_isolation(rendered, TEST_POLICY)
        assert pins["orbaagent-gpu-worker"] == TEST_WORKER_UUID

    def test_rendering_with_a_forbidden_uuid_is_rejected(self, compose_text):
        rendered = render_compose_template(compose_text, {POLICY_UUID_ENV: TEST_FORBIDDEN_UUID})
        with pytest.raises(IsolationError, match="forbidden"):
            validate_isolation(rendered, GpuAllocationPolicy(TEST_WORKER_UUID, (TEST_FORBIDDEN_UUID,)))

    def test_rendering_with_a_bare_index_is_rejected(self, compose_text):
        """`0` is not a device identity; the policy must be a UUID."""
        with pytest.raises(IsolationError, match="not a GPU UUID"):
            GpuAllocationPolicy("0").validate()

    def test_sets_cuda_visible_devices_to_the_single_visible_gpu(self, worker_service):
        env = worker_service["environment"]
        assert "CUDA_VISIBLE_DEVICES=0" in env

    def test_ollama_sets_cuda_visible_devices_to_the_single_visible_gpu(self, ollama_service):
        env = ollama_service["environment"]
        assert "CUDA_VISIBLE_DEVICES=0" in env

    def test_the_three_pins_agree(self, worker_service):
        """The env pins and the device reservation must name the same GPU."""
        env = worker_service["environment"]
        env_uuid = next(
            str(e).split("=", 1)[1] for e in env if str(e).startswith("NVIDIA_VISIBLE_DEVICES=")
        )
        target_uuid = next(
            str(e).split("=", 1)[1] for e in env if str(e).startswith("MEDIA_WORKER_GPU_UUID=")
        )
        device_uuid = worker_service["deploy"]["resources"]["reservations"]["devices"][0][
            "device_ids"
        ][0]
        assert env_uuid == device_uuid == target_uuid == WORKER_PIN


class TestComposeRefusesBroadGpuAccess:
    def test_no_gpus_all(self, compose_text):
        # Inspect executable lines only; a comment warning against `--gpus` is not a use.
        code_lines = [line.split("#", 1)[0] for line in compose_text.splitlines()]
        code = "\n".join(code_lines)
        assert "--gpus" not in code
        assert not re.search(r"^\s*gpus\s*:", code, re.MULTILINE)
        assert "count: all" not in code

    def test_not_privileged(self, worker_service, ollama_service):
        assert worker_service.get("privileged") is not True
        assert ollama_service.get("privileged") is not True

    def test_no_host_nvidia_device_mounts(self, worker_service, ollama_service):
        for volume in worker_service.get("volumes", []):
            assert "/dev/nvidia" not in str(volume)
        for volume in ollama_service.get("volumes", []):
            assert "/dev/nvidia" not in str(volume)

    def test_no_gpu_capabilities_beyond_gpu(self, worker_service, ollama_service):
        devices = worker_service["deploy"]["resources"]["reservations"]["devices"]
        for device in devices:
            assert device["capabilities"] == ["gpu"]
        ollama_devices = ollama_service["deploy"]["resources"]["reservations"]["devices"]
        for device in ollama_devices:
            assert device["capabilities"] == ["gpu"]

    def test_no_host_pid_or_ipc_namespace_sharing(self, worker_service, ollama_service):
        assert worker_service.get("pid") is None
        assert worker_service.get("ipc") is None
        assert worker_service.get("network_mode") != "host"
        assert ollama_service.get("pid") is None
        assert ollama_service.get("ipc") is None
        assert ollama_service.get("network_mode") != "host"

    def test_worker_port_is_private_wireguard_bound_only(self, worker_service):
        for mapping in worker_service["ports"]:
            assert str(mapping).startswith("10.77.0.2:"), (
                "port 8190 must be published on the private WireGuard interface only"
            )

    def test_ollama_port_is_private_wireguard_bound_only(self, ollama_service):
        for mapping in ollama_service["ports"]:
            assert str(mapping).startswith("10.77.0.2:11435"), (
                "port 11435 must be published on the private WireGuard interface only"
            )


class TestComposeDoesNotContainSecrets:
    def test_token_is_supplied_via_a_docker_secret_not_a_literal(self, compose):
        """The token comes from a secret file; no value is written in compose."""
        worker = compose["services"]["orbaagent-gpu-worker"]
        env = [str(e) for e in worker["environment"]]
        assert "MEDIA_WORKER_TOKEN_FILE=/run/secrets/media_worker_token" in env
        # No direct value assignment anywhere.
        assert not any(e.startswith("MEDIA_WORKER_TOKEN=") for e in env)
        assert "media_worker_token" in [s for s in worker["secrets"]]
        assert "media_worker_token" in compose["secrets"]

    def test_ingest_token_also_comes_from_a_secret(self, compose):
        worker = compose["services"]["orbaagent-gpu-worker"]
        env = [str(e) for e in worker["environment"]]
        assert "MEDIA_INGEST_TOKEN_FILE=/run/secrets/media_ingest_token" in env
        assert not any(e.startswith("MEDIA_INGEST_TOKEN=") for e in env)

    def test_legacy_hardcoded_token_is_absent(self, compose_text):
        assert "orbaagent-gpu-worker-auth" not in compose_text

    def test_no_hardcoded_media_ip(self, compose_text):
        # The loopback binding is fine; a routable hardcoded IP is not.
        assert "45.84.65.76" not in compose_text


class TestDockerfile:
    def test_no_privileged_or_gpu_flags(self):
        text = DOCKERFILE_PATH.read_text(encoding="utf-8")
        assert "--gpus" not in text

    def test_does_not_bake_a_token(self):
        text = DOCKERFILE_PATH.read_text(encoding="utf-8")
        assert "MEDIA_WORKER_TOKEN=" not in text
        assert "orbaagent-gpu-worker-auth" not in text

    def test_installs_the_real_generation_dependencies(self):
        """The diffusers backend needs these at runtime, not just torch."""
        text = DOCKERFILE_PATH.read_text(encoding="utf-8")
        for package in ("fastapi", "uvicorn", "pydantic", "diffusers", "transformers", "accelerate"):
            assert package in text, f"{package} must be installed for the real backend"
        assert "ffmpeg" in text, "ffmpeg/ffprobe is required for video validation"

    def test_comfyui_dockerfile_isolation(self):
        comfy_path = GPU_ROOT / "Dockerfile.comfyui"
        assert comfy_path.is_file(), "Dockerfile.comfyui must exist in repository root"
        text = comfy_path.read_text(encoding="utf-8")
        assert "--gpus" not in text
        assert "MEDIA_WORKER_TOKEN=" not in text
        assert "pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime" in text
        assert "USER orba-media" in text

    def test_comfyui_dockerfile_clone_ordering_and_permissions(self):
        """Regression test: Git clone must target an empty or non-existent directory.
        Creating /app/ComfyUI/models or other subdirectories before git clone causes:
        'fatal: destination path '/app/ComfyUI' already exists and is not an empty directory.'
        """
        comfy_path = GPU_ROOT / "Dockerfile.comfyui"
        text = comfy_path.read_text(encoding="utf-8")

        assert "git clone https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI" in text
        assert "git checkout v0.36.0" in text

        clone_idx = text.index("git clone https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI")

        # Ensure any mkdir for /app/ComfyUI occurs strictly AFTER git clone
        lines = text.splitlines()
        for line_no, line in enumerate(lines, 1):
            if "mkdir" in line and "/app/ComfyUI" in line:
                mkdir_idx = text.index(line)
                assert mkdir_idx > clone_idx, (
                    f"Line {line_no} creates /app/ComfyUI directories before git clone, "
                    f"which will cause git clone to fail with non-empty directory error!"
                )

        # Ensure chown for /app/ComfyUI happens after git clone so orba-media owns repo files
        chown_idx = text.index("chown -R orba-media:orba-media /app/ComfyUI")
        assert chown_idx > clone_idx, "chown of /app/ComfyUI must occur after git clone"

        # Ensure non-root runtime user switch is present
        user_idx = text.index("USER orba-media")
        assert user_idx > chown_idx, "USER switch to orba-media must occur after chown"

    def test_comfyui_dockerfile_dependencies_and_no_invalid_custom_node_clones(self):
        """Regression test: Do not clone kernel libraries or memory allocators into custom_nodes.
        Packages such as comfy-kitchen and comfy-aimdo are PyPI dependencies specified in
        ComfyUI's requirements.txt, not standalone ComfyUI custom nodes.
        Also verify that pip installs from requirements.txt without hardcoding non-existent git repos.
        """
        comfy_path = GPU_ROOT / "Dockerfile.comfyui"
        text = comfy_path.read_text(encoding="utf-8")

        # Invalid legacy URLs must not exist in Dockerfile
        assert "comfyui-kitchen.git" not in text, "Kernel library comfy-kitchen must not be cloned as a custom node"
        assert "comfyui-aimdo.git" not in text, "VRAM allocator comfy-aimdo must not be cloned as a custom node"
        assert "comfy-kitchen.git" not in text
        assert "comfy-aimdo.git" not in text

        # Requirements installation must be present
        assert "pip install --no-cache-dir --user -r /app/ComfyUI/requirements.txt" in text

    def test_all_compose_build_dockerfiles_exist_and_are_packaged(self):
        """Every dockerfile referenced in compose.yaml services MUST exist in the build context,
        be packaged in build_archive, be permitted in bootstrap allowlist, and installed by provision.
        """
        import yaml
        from deploy import build_archive
        from deploy import bootstrap_provision as bp

        compose_data = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))
        packed_names = {rel_path for _, rel_path in build_archive.get_files_to_pack()}
        prov_text = (GPU_ROOT / "deploy" / "provision-gpu-host.sh").read_text(encoding="utf-8")
        bash_bootstrap_text = (GPU_ROOT / "deploy" / "bootstrap-provision.sh").read_text(encoding="utf-8")

        for service_name, config in compose_data.get("services", {}).items():
            build_cfg = config.get("build")
            if not build_cfg:
                continue
            dockerfile_name = build_cfg.get("dockerfile", "Dockerfile")
            dockerfile_path = GPU_ROOT / dockerfile_name

            assert dockerfile_path.is_file(), (
                f"Service {service_name} specifies dockerfile '{dockerfile_name}', "
                f"but {dockerfile_path} does not exist!"
            )
            assert dockerfile_name in packed_names, (
                f"dockerfile '{dockerfile_name}' for service {service_name} is not packed by build_archive!"
            )
            assert dockerfile_name in bp.ALLOWED_EXACT, (
                f"dockerfile '{dockerfile_name}' for service {service_name} is missing from python bootstrap ALLOWED_EXACT!"
            )
            assert dockerfile_name in bash_bootstrap_text, (
                f"dockerfile '{dockerfile_name}' for service {service_name} is missing from bash bootstrap ALLOWED_EXACT!"
            )
            assert f'"{dockerfile_name}"' in prov_text or f"/{dockerfile_name}" in prov_text, (
                f"dockerfile '{dockerfile_name}' for service {service_name} is not installed by provision-gpu-host.sh!"
            )


class TestWorkerSourceHygiene:
    """The worker source must not hard-code any GPU UUID or a token."""

    def test_no_gpu_uuid_in_executable_code(self):
        """No module may name a real GPU. The device comes from the policy at
        runtime; a UUID literal in code is exactly the drift that forced this
        change (the old validator pinned two historical UUIDs)."""
        for path in (GPU_ROOT / "orba_gpu").rglob("*.py"):
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                code = line.split("#", 1)[0]
                assert not ANY_UUID_RE.search(code), (
                    f"{path.name}:{lineno} hard-codes a GPU UUID in executable code"
                )

    def test_no_gpu_uuid_in_the_wrapper(self):
        """The wrapper reads the policy from worker.env; it must not carry its own copy."""
        path = GPU_ROOT / "deploy" / "orbaagent-gpu"
        code = "\n".join(line.split("#", 1)[0] for line in path.read_text(encoding="utf-8").splitlines())
        assert not ANY_UUID_RE.search(code), f"{path.name} hard-codes a GPU UUID"

    def test_env_example_names_only_the_two_verified_gpus(self):
        """worker.env is the single place the allocation lives. It names exactly the
        two live-verified devices (issue #11) and the worker is NOT the ollama GPU."""
        path = GPU_ROOT / "deploy" / "worker.env.example"
        code = "\n".join(line.split("#", 1)[0] for line in path.read_text(encoding="utf-8").splitlines())
        found = {m.group(0) for m in ANY_UUID_RE.finditer(code)}
        assert len(found) == 2, found
        assert OLLAMA_GPU_UUID in found
        worker = next(line.split("=", 1)[1] for line in code.splitlines() if line.startswith("ORBA_WORKER_GPU_UUID="))
        assert worker != OLLAMA_GPU_UUID

    def test_no_hardcoded_token_in_worker_package(self):
        for path in (GPU_ROOT / "orba_gpu").rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            assert "orbaagent-gpu-worker-auth" not in text, f"{path.name} contains the old literal"

    def test_no_default_target_uuid(self):
        """An unset MEDIA_WORKER_GPU_UUID must stay unset, never fall back to a device."""
        from orba_gpu.config import DEFAULT_TARGET_GPU_UUID

        assert DEFAULT_TARGET_GPU_UUID == ""
        assert not GPU_UUID_RE.match(DEFAULT_TARGET_GPU_UUID)

    def test_no_committed_model_weights(self):
        """Model files are never committed; only code and config."""
        bad = [
            p
            for p in GPU_ROOT.rglob("*")
            if p.is_file() and p.suffix.lower() in (".safetensors", ".ckpt", ".bin", ".pt", ".pth")
        ]
        assert bad == [], f"model weights must not be committed: {bad}"
