"""Tests for the GPU allocation policy, offline compose rendering and live inventory check.

Everything here uses synthetic UUIDs. The real index->UUID map of the host is
never written into the repository; `orbaagent-gpu validate` reads it live.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from orba_gpu import deploy_validation as dv
from orba_gpu import gpu_inventory as inv

GPU_ROOT = Path(__file__).resolve().parent.parent
DEPLOY_COMPOSE = GPU_ROOT / "deploy" / "compose.yaml"

A = "GPU-00000000-0000-0000-0000-00000000000a"
B = "GPU-00000000-0000-0000-0000-00000000000b"
C = "GPU-00000000-0000-0000-0000-00000000000c"
NAME = "NVIDIA RTX PRO 6000 Blackwell Server Edition"


# ---------------------------------------------------------------------------
# Policy parsing
# ---------------------------------------------------------------------------


class TestPolicy:
    def test_from_mapping_full(self):
        policy = dv.policy_from_mapping(
            {
                dv.POLICY_UUID_ENV: f" {A} ",
                dv.POLICY_FORBIDDEN_ENV: f"{B}, {C}",
                dv.POLICY_INDEX_ENV: "0",
            }
        )
        assert policy.worker_uuid == A
        assert policy.forbidden_uuids == (B, C)
        assert policy.worker_index == 0
        assert policy.is_forbidden(B.upper())
        assert not policy.is_forbidden(A)

    def test_index_is_optional(self):
        policy = dv.policy_from_mapping({dv.POLICY_UUID_ENV: A})
        assert policy.worker_index is None
        assert policy.forbidden_uuids == ()

    @pytest.mark.parametrize("bad", ["", "   ", "0", "1", "all", "GPU-1", "GPU-xyz", "GPU-00000000-0000-0000-0000-00000000000"])
    def test_rejects_non_uuid_worker_values(self, bad):
        with pytest.raises(dv.PolicyError):
            dv.policy_from_mapping({dv.POLICY_UUID_ENV: bad})

    def test_rejects_non_uuid_forbidden_entries(self):
        with pytest.raises(dv.PolicyError, match="non-UUID"):
            dv.policy_from_mapping({dv.POLICY_UUID_ENV: A, dv.POLICY_FORBIDDEN_ENV: "1"})

    def test_rejects_worker_in_forbidden_list(self):
        with pytest.raises(dv.PolicyError, match="also listed"):
            dv.policy_from_mapping({dv.POLICY_UUID_ENV: A, dv.POLICY_FORBIDDEN_ENV: f"{B},{A}"})

    def test_rejects_duplicate_forbidden_entries(self):
        with pytest.raises(dv.PolicyError, match="duplicates"):
            dv.policy_from_mapping({dv.POLICY_UUID_ENV: A, dv.POLICY_FORBIDDEN_ENV: f"{B},{B.lower()}"})

    def test_rejects_non_numeric_index(self):
        with pytest.raises(dv.PolicyError, match="integer"):
            dv.policy_from_mapping({dv.POLICY_UUID_ENV: A, dv.POLICY_INDEX_ENV: "zero"})

    def test_policy_error_is_an_isolation_error(self):
        """Callers that catch IsolationError must also fail closed on a bad policy."""
        assert issubclass(dv.PolicyError, dv.IsolationError)


class TestEnvFile:
    def test_parses_like_compose_env_file(self):
        text = (
            "# comment\n"
            "\n"
            f'ORBA_WORKER_GPU_UUID="{A}"\n'
            f"ORBA_WORKER_FORBIDDEN_GPU_UUIDS={B}  # trailing comment\n"
            "export ORBA_WORKER_GPU_INDEX=0\n"
            "MEDIA_GENERATION_BACKEND=diffusers\n"
            "not a key value line\n"
        )
        values = dv.parse_env_file(text)
        assert values[dv.POLICY_UUID_ENV] == A
        assert values[dv.POLICY_FORBIDDEN_ENV] == B
        assert values[dv.POLICY_INDEX_ENV] == "0"
        assert values["MEDIA_GENERATION_BACKEND"] == "diffusers"
        assert "not a key value line" not in values

    def test_policy_from_env_file(self, tmp_path):
        env_file = tmp_path / "worker.env"
        env_file.write_text(f"{dv.POLICY_UUID_ENV}={A}\n{dv.POLICY_FORBIDDEN_ENV}={B}\n{dv.POLICY_INDEX_ENV}=0\n")
        policy = dv.policy_from_env_file(str(env_file))
        assert policy == dv.GpuAllocationPolicy(A, (B,), 0)

    def test_missing_env_file_is_a_policy_error(self, tmp_path):
        with pytest.raises(dv.PolicyError, match="cannot read"):
            dv.policy_from_env_file(str(tmp_path / "missing.env"))

    def test_example_env_file_parses_to_a_valid_policy(self):
        """The shipped example carries the live-verified allocation (see TestVerifiedAllocation)."""
        text = (GPU_ROOT / "deploy" / "worker.env.example").read_text(encoding="utf-8")
        policy = dv.policy_from_mapping(dv.parse_env_file(text))
        assert policy.worker_index == 0 and len(policy.forbidden_uuids) == 1


# ---------------------------------------------------------------------------
# Offline rendering
# ---------------------------------------------------------------------------


class TestRenderComposeTemplate:
    def test_plain_default_and_required_forms(self):
        text = "a=${X}\nb=${Y:-dflt}\nc=${X:?need X}\nd=${Z:+alt}\ne=$$literal\nf=${Y-dflt2}"
        out = dv.render_compose_template(text, {"X": "x", "Z": "z"})
        assert out == "a=x\nb=dflt\nc=x\nd=alt\ne=$literal\nf=dflt2"

    def test_required_unset_raises_with_the_message(self):
        with pytest.raises(dv.IsolationError, match="need X"):
            dv.render_compose_template("${X:?need X}", {})

    def test_required_empty_raises(self):
        with pytest.raises(dv.IsolationError, match="X"):
            dv.render_compose_template("${X:?}", {"X": ""})

    def test_deployment_compose_renders_fully(self):
        rendered = dv.render_compose_template(DEPLOY_COMPOSE.read_text(encoding="utf-8"), {dv.POLICY_UUID_ENV: A})
        assert "${" not in dv._code_lines(rendered)
        assert rendered.count(A) == 3


# ---------------------------------------------------------------------------
# Structural validation of compose documents
# ---------------------------------------------------------------------------


def _doc(worker_extra: str = "", extra_services: str = "", uuid: str = A) -> str:
    return f"""services:
  orbaagent-gpu-worker:
    image: worker
    ports:
      - "10.77.0.2:8190:8190"
    environment:
      - NVIDIA_VISIBLE_DEVICES={uuid}
      - CUDA_VISIBLE_DEVICES=0
      - MEDIA_WORKER_GPU_UUID={uuid}
{worker_extra}    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['{uuid}']
              capabilities: [gpu]
{extra_services}"""


POLICY = dv.GpuAllocationPolicy(A, (B,), 0)


class TestStructuralValidation:
    def test_minimal_worker_passes(self):
        assert dv.validate_isolation(_doc(), POLICY) == {"orbaagent-gpu-worker": A}

    def test_missing_worker_service(self):
        text = _doc().replace("orbaagent-gpu-worker:", "something-else:")
        with pytest.raises(dv.IsolationError, match="missing"):
            dv.validate_isolation(text, POLICY)

    def test_worker_on_forbidden_gpu_is_reported_as_forbidden(self):
        with pytest.raises(dv.IsolationError, match="forbidden GPU"):
            dv.validate_isolation(_doc(uuid=B), POLICY)

    def test_worker_on_unknown_gpu_is_a_policy_mismatch(self):
        with pytest.raises(dv.IsolationError, match="policy requires"):
            dv.validate_isolation(_doc(uuid=C), POLICY)

    def test_cuda_visible_devices_must_be_zero(self):
        text = _doc().replace("CUDA_VISIBLE_DEVICES=0", "CUDA_VISIBLE_DEVICES=1")
        with pytest.raises(dv.IsolationError, match="CUDA_VISIBLE_DEVICES must be 0"):
            dv.validate_isolation(text, POLICY)

    def test_media_worker_gpu_uuid_must_match(self):
        text = _doc().replace(f"MEDIA_WORKER_GPU_UUID={A}", f"MEDIA_WORKER_GPU_UUID={C}")
        with pytest.raises(dv.IsolationError, match="MEDIA_WORKER_GPU_UUID"):
            dv.validate_isolation(text, POLICY)

    def test_media_worker_gpu_uuid_on_forbidden_gpu(self):
        text = _doc().replace(f"MEDIA_WORKER_GPU_UUID={A}", f"MEDIA_WORKER_GPU_UUID={B}")
        with pytest.raises(dv.IsolationError, match="forbidden GPU"):
            dv.validate_isolation(text, POLICY)

    def test_two_device_reservations_rejected(self):
        text = _doc().replace("              capabilities: [gpu]\n", f"              capabilities: [gpu]\n            - driver: nvidia\n              device_ids: ['{C}']\n              capabilities: [gpu]\n")
        with pytest.raises(dv.IsolationError, match="exactly one"):
            dv.validate_isolation(text, POLICY)

    def test_two_device_ids_rejected(self):
        text = _doc().replace(f"device_ids: ['{A}']", f"device_ids: ['{A}', '{C}']")
        with pytest.raises(dv.IsolationError, match="exactly one GPU"):
            dv.validate_isolation(text, POLICY)

    def test_bare_index_device_id_rejected(self):
        text = _doc().replace(f"device_ids: ['{A}']", "device_ids: ['0']")
        with pytest.raises(dv.IsolationError):
            dv.validate_isolation(text, POLICY)

    def test_count_rejected_even_when_one(self):
        text = _doc().replace(f"device_ids: ['{A}']", "count: 1")
        with pytest.raises(dv.IsolationError, match="count|device reservation"):
            dv.validate_isolation(text, POLICY)

    def test_gpus_shorthand_rejected(self):
        with pytest.raises(dv.IsolationError, match="gpus:"):
            dv.validate_isolation(_doc(worker_extra="    gpus: all\n"), POLICY)

    def test_other_service_may_use_a_forbidden_gpu(self):
        """ollama/comfyui/MOVA pins are reported, not re-pinned by the worker policy."""
        extra = f"""  orbaagent-mova:
    image: mova
    environment:
      NVIDIA_VISIBLE_DEVICES: {B}
      CUDA_VISIBLE_DEVICES: "0"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['{B}']
              capabilities: [gpu]
"""
        pins = dv.validate_isolation(_doc(extra_services=extra), POLICY)
        assert pins == {"orbaagent-gpu-worker": A, "orbaagent-mova": B}

    def test_other_service_may_not_see_all_gpus(self):
        extra = """  helper:
    image: helper
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
"""
        with pytest.raises(dv.IsolationError, match="every GPU"):
            dv.validate_isolation(_doc(extra_services=extra), POLICY)

    def test_other_service_pins_must_agree(self):
        extra = f"""  helper:
    image: helper
    environment:
      - NVIDIA_VISIBLE_DEVICES={C}
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['{B}']
              capabilities: [gpu]
"""
        with pytest.raises(dv.IsolationError, match="disagree"):
            dv.validate_isolation(_doc(extra_services=extra), POLICY)

    def test_long_syntax_public_port_rejected(self):
        text = _doc().replace('      - "10.77.0.2:8190:8190"\n', '      - mode: ingress\n        host_ip: 0.0.0.0\n        target: 8190\n        published: "8190"\n        protocol: tcp\n')
        with pytest.raises(dv.IsolationError, match="publishes port 8190"):
            dv.validate_isolation(text, POLICY)

    def test_short_syntax_public_port_on_other_service_rejected(self):
        extra = """  helper:
    image: helper
    ports:
      - "0.0.0.0:9000:9000"
"""
        with pytest.raises(dv.IsolationError, match="helper publishes"):
            dv.validate_isolation(_doc(extra_services=extra), POLICY)

    def test_rendered_environment_mapping_is_accepted(self):
        text = _doc().replace(
            f"      - NVIDIA_VISIBLE_DEVICES={A}\n      - CUDA_VISIBLE_DEVICES=0\n      - MEDIA_WORKER_GPU_UUID={A}\n",
            f"      NVIDIA_VISIBLE_DEVICES: {A}\n      CUDA_VISIBLE_DEVICES: \"0\"\n      MEDIA_WORKER_GPU_UUID: {A}\n",
        )
        assert dv.validate_isolation(text, POLICY)["orbaagent-gpu-worker"] == A


class TestCli:
    def test_cli_with_policy_file(self, tmp_path, capsys):
        env_file = tmp_path / "worker.env"
        env_file.write_text(f"{dv.POLICY_UUID_ENV}={A}\n{dv.POLICY_FORBIDDEN_ENV}={B}\n")
        rc = dv.main(["prog", "--policy-file", str(env_file), str(DEPLOY_COMPOSE)])
        out = capsys.readouterr()
        assert rc == 0, out.err
        assert "isolation OK" in out.out and A in out.out

    def test_cli_without_policy_fails_closed(self, tmp_path, capsys, monkeypatch):
        monkeypatch.delenv(dv.POLICY_UUID_ENV, raising=False)
        rc = dv.main(["prog", str(DEPLOY_COMPOSE)])
        assert rc == 4
        assert "ISOLATION FAILURE" in capsys.readouterr().err

    def test_cli_usage(self, capsys):
        assert dv.main(["prog"]) == 2
        assert dv.main(["prog", "--policy-file"]) == 2


# ---------------------------------------------------------------------------
# Live inventory check
# ---------------------------------------------------------------------------


CSV = f"0, {A}, {NAME}\n1, {B}, {NAME}\n"


class TestInventory:
    def test_parse(self):
        devices = inv.parse_nvidia_smi_csv("index, uuid, name\n" + CSV)
        assert [(d.index, d.uuid) for d in devices] == [(0, A), (1, B)]
        assert devices[0].name == NAME

    @pytest.mark.parametrize("bad", ["", "\n", "0, nope, x", "x, GPU-00000000-0000-0000-0000-00000000000a, n", "0, GPU-00000000-0000-0000-0000-00000000000a"])
    def test_parse_rejects_garbage(self, bad):
        with pytest.raises(inv.InventoryError):
            inv.parse_nvidia_smi_csv(bad)

    def test_parse_rejects_duplicate_uuid(self):
        with pytest.raises(inv.InventoryError, match="twice"):
            inv.parse_nvidia_smi_csv(f"0, {A}, n\n1, {A}, n\n")

    def test_matching_policy(self):
        assert inv.check_inventory(inv.parse_nvidia_smi_csv(CSV), dv.GpuAllocationPolicy(A, (B,), 0)) == []

    def test_index_mismatch_is_reported(self):
        problems = inv.check_inventory(inv.parse_nvidia_smi_csv(CSV), dv.GpuAllocationPolicy(A, (B,), 1))
        assert len(problems) == 1 and "host index 0" in problems[0]

    def test_index_check_skipped_when_undeclared(self):
        assert inv.check_inventory(inv.parse_nvidia_smi_csv(CSV), dv.GpuAllocationPolicy(A, (B,))) == []

    def test_absent_worker_uuid_is_reported(self):
        problems = inv.check_inventory(inv.parse_nvidia_smi_csv(CSV), dv.GpuAllocationPolicy(C, (B,), 0))
        assert any("not present" in p for p in problems)

    def test_stale_forbidden_uuid_is_reported(self):
        problems = inv.check_inventory(inv.parse_nvidia_smi_csv(CSV), dv.GpuAllocationPolicy(A, (C,), 0))
        assert any("stale" in p for p in problems)

    def test_never_selects_by_index(self):
        """Swapping the host order must not change which UUID is the worker."""
        swapped = f"0, {B}, {NAME}\n1, {A}, {NAME}\n"
        problems = inv.check_inventory(inv.parse_nvidia_smi_csv(swapped), dv.GpuAllocationPolicy(A, (B,), 0))
        assert problems and "host index 1" in problems[0]

    def test_cli_check_from_stdin(self, tmp_path, capsys, monkeypatch):
        env_file = tmp_path / "worker.env"
        env_file.write_text(f"{dv.POLICY_UUID_ENV}={A}\n{dv.POLICY_FORBIDDEN_ENV}={B}\n{dv.POLICY_INDEX_ENV}=0\n")
        import io
        monkeypatch.setattr("sys.stdin", io.StringIO(CSV))
        rc = inv.main(["prog", "--policy-file", str(env_file), "--check", "-"])
        out = capsys.readouterr()
        assert rc == 0, out.err
        assert "WORKER" in out.out and "FORBIDDEN" in out.out and "inventory OK" in out.out

    def test_cli_check_mismatch_exits_4(self, tmp_path, capsys):
        csv_file = tmp_path / "inv.csv"
        csv_file.write_text(CSV)
        env_file = tmp_path / "worker.env"
        env_file.write_text(f"{dv.POLICY_UUID_ENV}={A}\n{dv.POLICY_INDEX_ENV}=1\n")
        rc = inv.main(["prog", "--policy-file", str(env_file), "--check", str(csv_file)])
        assert rc == 4
        assert "INVENTORY MISMATCH" in capsys.readouterr().err

    def test_cli_missing_nvidia_smi_exits_3(self, tmp_path, capsys):
        env_file = tmp_path / "worker.env"
        env_file.write_text(f"{dv.POLICY_UUID_ENV}={A}\n")
        rc = inv.main(["prog", "--policy-file", str(env_file), "--check", "--nvidia-smi", str(tmp_path / "nope")])
        assert rc == 3
        assert "INVENTORY FAILURE" in capsys.readouterr().err

    def test_cli_requires_a_mode(self, capsys):
        assert inv.main(["prog"]) == 2


# ---------------------------------------------------------------------------
# Real-render shape (Docker Compose 2.40.3) and the verified 2026-10-24 allocation
# ---------------------------------------------------------------------------
#
# Agent 1's read-only inspection of migrol-ag-gpu-worker01 (issue #11, host UTC
# 2026-10-24T16:35:14Z) established the live mapping:
#     index 0 -> GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4   (OrbaAgent worker)
#     index 1 -> GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878   (MOVA reservation; Ollama)
# and documented how `docker compose config` 2.40.3 differs from hand-written YAML:
# `command: null` / `entrypoint: null`, `deploy.placement: {}`, `extra_hosts` as a
# string list, secret `target: /run/secrets/<name>`, `networks.*.ipam: {}`, env as a
# map, ports/volumes in long syntax. `_render_like_compose_2_40` reproduces that
# shape from the checked-in compose files. It is a MODEL of the documented output,
# not a captured render; the on-host `orbaagent-gpu validate` is the real gate.

VERIFIED_GPU0 = "GPU-4634107e-3bae-d5d5-ff97-2355d0b92ce4"
VERIFIED_GPU1 = "GPU-82e03c6c-8c27-c076-eb42-7e37e9a5a878"
VERIFIED_POLICY = dv.GpuAllocationPolicy(VERIFIED_GPU0, (VERIFIED_GPU1,), worker_index=0)
VERIFIED_INVENTORY = (
    f"0, {VERIFIED_GPU0}, NVIDIA RTX PRO 6000 Blackwell Server Edition\n"
    f"1, {VERIFIED_GPU1}, NVIDIA RTX PRO 6000 Blackwell Server Edition\n"
)
REPO_COMPOSE = GPU_ROOT / "compose.yaml"


def _render_like_compose_2_40(compose_path: Path, worker_uuid: str, project: str = "orbaagent-gpu") -> dict:
    import yaml

    text = dv.render_compose_template(compose_path.read_text(encoding="utf-8"), {dv.POLICY_UUID_ENV: worker_uuid})
    doc = yaml.safe_load(text)
    out: dict = {"name": project, "services": {}}
    for name, svc in doc["services"].items():
        rendered: dict = {"command": None, "entrypoint": None}
        for key, value in svc.items():
            if key == "environment":
                rendered[key] = dv._env_as_dict(value)
            elif key == "ports":
                rendered[key] = []
                for item in value:
                    host_ip, published, target = str(item).split(":")
                    rendered[key].append({"mode": "ingress", "host_ip": host_ip, "target": int(target),
                                          "published": published, "protocol": "tcp"})
            elif key == "volumes":
                rendered[key] = []
                for item in value:
                    source, target = str(item).split(":")[:2]
                    read_only = str(item).endswith(":ro")
                    if source.startswith("./") or source.startswith("/"):
                        entry = {"type": "bind", "source": "/abs" + source.lstrip("."), "target": target,
                                 "bind": {"create_host_path": True}}
                    else:
                        entry = {"type": "volume", "source": source, "target": target, "volume": {}}
                    if read_only:
                        entry["read_only"] = True
                    rendered[key].append(entry)
            elif key == "networks":
                rendered[key] = {n: None for n in value}
            elif key == "extra_hosts":
                rendered[key] = [str(x) for x in value]
            elif key == "secrets":
                rendered[key] = [{"source": s, "target": f"/run/secrets/{s}"} for s in value]
            elif key == "deploy":
                rendered[key] = dict(value)
                rendered[key]["placement"] = {}
            else:
                rendered[key] = value
        out["services"][name] = rendered
    out["networks"] = {n: {"name": f"{project}_{n}", "driver": "bridge", "ipam": {}} for n in doc.get("networks", {})}
    out["volumes"] = {v: {"name": (spec or {}).get("name", f"{project}_{v}")} for v, spec in doc.get("volumes", {}).items()}
    out["secrets"] = {s: {"name": f"{project}_{s}", "file": spec["file"]} for s, spec in doc.get("secrets", {}).items()}
    return out


class TestComposeRenderShape:
    """The validator must accept what `docker compose config` 2.40.x really emits."""

    @pytest.mark.parametrize("path", [DEPLOY_COMPOSE, REPO_COMPOSE], ids=["deploy", "repo"])
    def test_yaml_render_of_both_compose_files_validates(self, path):
        import yaml

        rendered = yaml.safe_dump(_render_like_compose_2_40(path, VERIFIED_GPU0), sort_keys=False)
        pins = dv.validate_isolation(rendered, VERIFIED_POLICY)
        assert pins["orbaagent-gpu-worker"] == VERIFIED_GPU0
        assert pins["orbaagent-ollama"] == VERIFIED_GPU1  # untouched, reported only
        assert pins["orbaagent-comfyui"] == VERIFIED_GPU1  # untouched, reported only

    @pytest.mark.parametrize("path", [DEPLOY_COMPOSE, REPO_COMPOSE], ids=["deploy", "repo"])
    def test_json_render_of_both_compose_files_validates(self, path):
        import json

        rendered = json.dumps(_render_like_compose_2_40(path, VERIFIED_GPU0), indent=2)
        assert dv.validate_isolation(rendered, VERIFIED_POLICY)["orbaagent-gpu-worker"] == VERIFIED_GPU0

    def test_render_keeps_the_documented_2_40_quirks(self):
        rendered = _render_like_compose_2_40(DEPLOY_COMPOSE, VERIFIED_GPU0)
        worker = rendered["services"]["orbaagent-gpu-worker"]
        assert worker["command"] is None and worker["entrypoint"] is None
        assert worker["deploy"]["placement"] == {}
        assert worker["extra_hosts"] == ["orbaagent.dev:10.77.0.1"]
        assert worker["secrets"][0]["target"].startswith("/run/secrets/")
        assert rendered["networks"]["orbaagent_media_net"]["ipam"] == {}
        assert isinstance(worker["environment"], dict)
        assert worker["ports"][0]["published"] == "8190" and worker["ports"][0]["target"] == 8190

    def test_hash_inside_a_rendered_value_is_not_treated_as_a_comment(self):
        import yaml

        doc = _render_like_compose_2_40(DEPLOY_COMPOSE, VERIFIED_GPU0)
        doc["services"]["orbaagent-gpu-worker"]["environment"]["MEDIA_INGEST_URL"] = "http://10.77.0.1/api/internal/media/ingest#frag"
        dv.validate_isolation(yaml.safe_dump(doc, sort_keys=False), VERIFIED_POLICY)


class TestVerifiedAllocation:
    """GPU 0 for the worker, GPU 1 forbidden: a worker staged on GPU 1 must fail."""

    @pytest.mark.parametrize("path", [DEPLOY_COMPOSE, REPO_COMPOSE], ids=["deploy", "repo"])
    def test_worker_staged_on_gpu1_is_rejected_as_forbidden(self, path):
        """Simulates worker.env with ORBA_WORKER_GPU_UUID set to GPU 1 by mistake."""
        import yaml

        rendered = yaml.safe_dump(_render_like_compose_2_40(path, VERIFIED_GPU1), sort_keys=False)
        with pytest.raises(dv.IsolationError, match=r"forbidden GPU GPU-82e03c6c"):
            dv.validate_isolation(rendered, VERIFIED_POLICY)

    @pytest.mark.parametrize("path", [DEPLOY_COMPOSE, REPO_COMPOSE], ids=["deploy", "repo"])
    def test_worker_staged_on_gpu1_is_rejected_from_the_raw_file_too(self, path):
        rendered = dv.render_compose_template(path.read_text(encoding="utf-8"), {dv.POLICY_UUID_ENV: VERIFIED_GPU1})
        with pytest.raises(dv.IsolationError, match="forbidden GPU"):
            dv.validate_isolation(rendered, VERIFIED_POLICY)

    def test_policy_that_puts_the_worker_on_gpu1_is_itself_rejected(self):
        with pytest.raises(dv.PolicyError, match="also listed"):
            dv.policy_from_mapping({dv.POLICY_UUID_ENV: VERIFIED_GPU1, dv.POLICY_FORBIDDEN_ENV: VERIFIED_GPU1})

    def test_shipped_worker_env_example_encodes_the_verified_allocation(self):
        text = (GPU_ROOT / "deploy" / "worker.env.example").read_text(encoding="utf-8")
        policy = dv.policy_from_mapping(dv.parse_env_file(text))
        assert policy == VERIFIED_POLICY
        inv_devices = inv.parse_nvidia_smi_csv(VERIFIED_INVENTORY)
        assert inv.check_inventory(inv_devices, policy) == []

    def test_shipped_example_against_a_swapped_host_mapping_fails(self):
        """If the host ever re-enumerates GPUs, the index check must refuse to start."""
        swapped = VERIFIED_INVENTORY.replace("0, ", "X, ").replace("1, ", "0, ").replace("X, ", "1, ")
        problems = inv.check_inventory(inv.parse_nvidia_smi_csv(swapped), VERIFIED_POLICY)
        assert problems and "host index 1" in problems[0]

    def test_ollama_and_comfyui_pins_are_byte_for_byte_untouched(self):
        for path in (DEPLOY_COMPOSE, REPO_COMPOSE):
            text = path.read_text(encoding="utf-8")
            for service in ("orbaagent-comfyui", "orbaagent-ollama"):
                start = text.index(f"  {service}:")
                end = text.find("\n  orbaagent-", start + 1)
                block = text[start:end if end != -1 else text.index("\nsecrets:")]
                assert block.count(VERIFIED_GPU1) == 2, f"{path.name}:{service} pin changed"
                assert "${" not in "\n".join(l.split("#", 1)[0] for l in block.splitlines() if "NVIDIA" in l or "device_ids" in l)
