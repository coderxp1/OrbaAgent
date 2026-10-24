"""Executable stdlib tests: no pytest shim, daemon, host connection or inference.
Run: python3 -m unittest discover -s infra/orbaagent-gpu/deploy/worker-only -p 'test_*.py' -v
The Compose fixture models normalized JSON, NOT evidence of a Docker render.
"""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import unittest
from unittest.mock import patch, Mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('worker_control', HERE / 'control.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
A = 'GPU-00000000-0000-0000-0000-00000000000a'
B = 'GPU-00000000-0000-0000-0000-00000000000b'
C = 'GPU-00000000-0000-0000-0000-00000000000c'
IMG = 'registry.example/orba/worker@sha256:' + 'a' * 64
IMAGE_ID = 'sha256:' + 'b' * 64
# Explicit keys keep the synthetic fixture understandable independent of ordering.
P = {'ORBA_WORKER_GPU_UUID': A, 'ORBA_MOVA_GPU_UUID': B, 'ORBA_WORKER_IMAGE': IMG,
     'ORBA_MEDIA_NETWORK': 'existing_private_bridge', 'ORBA_GPU_OWNERSHIP_APPROVAL': 'review-approval-123'}
CSV = f'0, {A}, Synthetic GPU A\n1, {B}, Synthetic GPU B\n'


def text(p=None):
    return '\n'.join(k + '=' + v for k, v in (P if p is None else p).items())


def document():
    return {'name': c.PROJECT, 'services': {c.SERVICE: {
        'container_name': c.SERVICE, 'image': IMG, 'pull_policy': 'never', 'restart': 'no',
        'ports': [{'mode': 'ingress', 'host_ip': c.IP, 'target': 8190, 'published': '8190', 'protocol': 'tcp'}],
        'environment': {'NVIDIA_VISIBLE_DEVICES': A, 'CUDA_VISIBLE_DEVICES': '0', 'MEDIA_WORKER_GPU_UUID': A,
            'MEDIA_WORKER_PORT': '8190', 'MEDIA_GENERATION_BACKEND': 'diffusers',
            'MEDIA_GENERATION_IMAGE_MODEL': 'black-forest-labs/FLUX.1-schnell',
            'MEDIA_GENERATION_VIDEO_MODEL': 'approved-existing-video-model', 'MEDIA_MAX_CONCURRENT_GENERATIONS': '1',
            'MEDIA_MODELS_DIR': '/models', 'MEDIA_OUTPUT_DIR': '/output',
            'MEDIA_WORKER_TOKEN_FILE': '/run/secrets/media_worker_token',
            'MEDIA_INGEST_TOKEN_FILE': '/run/secrets/media_ingest_token',
            'MEDIA_INGEST_URL': 'http://10.77.0.1/api/internal/media/ingest', 'ORBA_TENANT_ID': 'test-workspace'},
        'secrets': [{'source': k, 'target': k} for k in sorted(c.SECRETS)],
        'volumes': [{'type': 'volume', 'source': k, 'target': v, 'volume': {}} for k, v in c.VOLUMES.items()],
        'networks': {'orbaagent_media_net': None}, 'extra_hosts': {'orbaagent.dev': '10.77.0.1'},
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'deploy': {'resources': {'reservations': {'devices': [{'driver': 'nvidia', 'device_ids': [A], 'capabilities': ['gpu']}]}}}}},
        'networks': {'orbaagent_media_net': {'name': P['ORBA_MEDIA_NETWORK'], 'external': True}},
        'volumes': {k: {'name': k, 'external': True} for k in c.VOLUMES},
        'secrets': {k: {'name': c.PROJECT + '_' + k, 'file': str(c.ROOT / 'secrets' / k)} for k in c.SECRETS}}


def running():
    s = document()['services'][c.SERVICE]
    return {'Name': '/' + c.SERVICE, 'Id': 'container-a', 'Image': IMAGE_ID, 'State': {'Running': True},
        'Config': {'Env': [k + '=' + v for k, v in s['environment'].items()],
            'Labels': {'com.docker.compose.project': c.PROJECT, 'com.docker.compose.service': c.SERVICE}},
        'HostConfig': {'Privileged': False, 'Devices': [], 'CapAdd': [], 'CapDrop': ['ALL'],
            'SecurityOpt': ['no-new-privileges:true'], 'ExtraHosts': ['orbaagent.dev:10.77.0.1'],
            'NetworkMode': P['ORBA_MEDIA_NETWORK'], 'RestartPolicy': {'Name': 'no'},
            'DeviceRequests': [{'Driver': 'nvidia', 'DeviceIDs': [A], 'Count': 0, 'Capabilities': [['gpu']], 'Options': {}}],
            'PortBindings': {'8190/tcp': [{'HostIp': c.IP, 'HostPort': '8190'}]}},
        'NetworkSettings': {'Networks': {P['ORBA_MEDIA_NETWORK']: {}}},
        'Mounts': [{'Type': 'volume', 'Name': k, 'Destination': v, 'RW': True} for k, v in c.VOLUMES.items()] +
                  [{'Type': 'bind', 'Destination': '/run/secrets/' + k, 'Source': str(c.ROOT / 'secrets' / k), 'RW': False} for k in sorted(c.SECRETS)]}


class PolicyTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(c.policy(text()), P)

    def test_empty_example_fails(self):
        with self.assertRaises(c.Refusal): c.policy((HERE / 'allocation.env.example').read_text())

    def test_bad_worker_uuids(self):
        for value in ['', '0', 'all', A + ',' + B, A + ' ', '$(touch /tmp/no)', 'GPU-abc', B]:
            with self.subTest(value=value), self.assertRaises(c.Refusal):
                c.policy(text(dict(P, ORBA_WORKER_GPU_UUID=value)))

    def test_bad_images(self):
        for value in ['worker:latest', 'worker:v1', 'sha256:' + 'a'*64, IMG[:-1], IMG + 'x', '-bad@sha256:' + 'a'*64]:
            with self.subTest(value=value), self.assertRaises(c.Refusal):
                c.policy(text(dict(P, ORBA_WORKER_IMAGE=value)))

    def test_missing_approval(self):
        p = dict(P); p.pop('ORBA_GPU_OWNERSHIP_APPROVAL')
        with self.assertRaises(c.Refusal): c.policy(text(p))

    def test_duplicate_and_unknown_keys(self):
        for tail in ['\nORBA_WORKER_GPU_UUID=' + A, '\nUNKNOWN=x']:
            with self.subTest(tail=tail), self.assertRaises(c.Refusal): c.policy(text() + tail)

    def test_no_quotes_expansion_or_comments(self):
        for value in ['"approved"', "'approved'", '${X}', 'approved #maybe', '`command`']:
            with self.subTest(value=value), self.assertRaises(c.Refusal):
                c.policy(text(dict(P, ORBA_GPU_OWNERSHIP_APPROVAL=value)))

    def test_mapping_not_row_order(self):
        c.inventory(CSV, P)
        c.inventory('\n'.join(reversed(CSV.strip().splitlines())), P)

    def test_inventory_refusals(self):
        for value in ['', CSV.replace(A, C), CSV.replace('0,', '2,'), CSV.replace('1,', '0,'),
                      CSV.replace(B, A), CSV.splitlines()[0], 'NVIDIA error', CSV.replace('0,', 'x,'),
                      CSV.replace(A, '0'), CSV.replace(A, B).replace('1, ' + B, '1, ' + A)]:
            with self.subTest(value=value), self.assertRaises(c.Refusal): c.inventory(value, P)


class ComposeTests(unittest.TestCase):
    def setUp(self):
        self.d = document(); self.s = self.d['services'][c.SERVICE]

    def rejects(self):
        with self.assertRaises((c.Refusal, TypeError, KeyError)): c.validate(self.d, P)

    def test_valid_normalized_json(self):
        self.assertEqual(c.validate(c.load_json(json.dumps(self.d)), P), self.s)

    def test_template_consistency_offline_not_docker(self):
        try:
            import yaml
        except ImportError:
            self.skipTest('Optional PyYAML is not installed; no Docker render is claimed')
        variables = {**P, **self.s['environment']}
        raw = (HERE / 'compose.yaml').read_text()
        rendered = re.sub(r'\$\{([A-Z_]+):\?[^}]+\}', lambda m: variables[m[1]], raw)
        d = yaml.safe_load(rendered); d['name'] = c.PROJECT
        s = d['services'][c.SERVICE]
        s['networks'] = {k: None for k in s['networks']}
        s['secrets'] = [{'source': x, 'target': x} for x in sorted(s['secrets'])]
        s['volumes'] = [{'type': 'volume', 'source': x.split(':')[0], 'target': x.split(':')[1], 'volume': {}} for x in s['volumes']]
        ip, published, target = s['ports'][0].split(':')
        s['ports'] = [{'mode': 'ingress', 'host_ip': ip, 'published': published, 'target': int(target), 'protocol': 'tcp'}]
        for k, v in d['secrets'].items(): v['name'] = c.PROJECT + '_' + k
        c.validate(d, P)
        self.assertEqual(d, document())

    def test_duplicate_json(self):
        for value in ['{"services":{},"services":{}}', 'not-json', '{"a":{"b":1,"b":2}}']:
            with self.subTest(value=value), self.assertRaises(c.Refusal): c.load_json(value)

    def test_fragments_rejected(self):
        self.d = {'device_ids': [A], 'NVIDIA_VISIBLE_DEVICES': A}; self.rejects()

    def test_extra_services_rejected(self):
        for name in ['orbaagent-ollama', 'orbaagent-comfyui', 'orbaagent-mova', 'web', 'api']:
            with self.subTest(service=name):
                self.d = document(); self.d['services'][name] = {}; self.rejects()

    def test_missing_service(self):
        self.d['services'] = {}; self.rejects()

    def test_disallowed_keys(self):
        for key, value in {'build': '.', 'depends_on': ['orbaagent-comfyui'], 'gpus': 'all', 'privileged': True,
                           'devices': ['/dev/nvidia0'], 'device_cgroup_rules': ['c *:* rwm'], 'network_mode': 'host',
                           'pid': 'host', 'ipc': 'host', 'cap_add': ['SYS_ADMIN'], 'volumes_from': ['other'],
                           'command': 'unsafe', 'entrypoint': 'unsafe', 'env_file': 'unsafe', 'profiles': ['extra']}.items():
            with self.subTest(key=key):
                self.d = document(); self.d['services'][c.SERVICE][key] = value; self.rejects()

    def test_gpu_pins_and_cuda(self):
        for key in ['NVIDIA_VISIBLE_DEVICES', 'MEDIA_WORKER_GPU_UUID', 'CUDA_VISIBLE_DEVICES']:
            for value in ['all', '0,1', B, '1', '']:
                with self.subTest(key=key, value=value):
                    self.d = document(); self.d['services'][c.SERVICE]['environment'][key] = value; self.rejects()

    def test_gpu_reservations(self):
        for value in [[], [{'driver': 'nvidia', 'count': 'all', 'capabilities': ['gpu']}],
                      [{'driver': 'nvidia', 'device_ids': [A, B], 'capabilities': ['gpu']}],
                      [{'driver': 'nvidia', 'device_ids': [B], 'capabilities': ['gpu']}]]:
            with self.subTest(value=value):
                self.d = document(); self.d['services'][c.SERVICE]['deploy']['resources']['reservations']['devices'] = value; self.rejects()

    def test_unsafe_ports(self):
        for ip in ['0.0.0.0', '::', '', '127.0.0.1']:
            with self.subTest(ip=ip):
                self.d = document(); self.d['services'][c.SERVICE]['ports'][0]['host_ip'] = ip; self.rejects()

    def test_missing_binding(self):
        self.s['ports'][0].pop('host_ip'); self.rejects()

    def test_added_port(self):
        self.s['ports'].append(dict(self.s['ports'][0])); self.rejects()

    def test_bind_mounts(self):
        self.s['volumes'][0] = {'type': 'bind', 'source': '/dev', 'target': '/models'}; self.rejects()

    def test_nonexternal_resources(self):
        for kind, name in [('networks', 'orbaagent_media_net'), ('volumes', 'orbaagent_models')]:
            with self.subTest(kind=kind):
                self.d = document(); self.d[kind][name]['external'] = False; self.rejects()

    def test_changed_secrets(self):
        self.d['secrets']['media_worker_token']['file'] = '/etc/shadow'; self.rejects()

    def test_changed_secret_target(self):
        self.s['secrets'][0]['target'] = '/etc/passwd'; self.rejects()

    def test_wrong_backend(self):
        self.s['environment']['MEDIA_GENERATION_BACKEND'] = 'comfyui'; self.rejects()

    def test_wrong_ingest(self):
        self.s['environment']['MEDIA_INGEST_URL'] = 'https://other.example/upload'; self.rejects()

    def test_private_https_ingest(self):
        self.s['environment']['MEDIA_INGEST_URL'] = 'https://orbaagent.dev/api/internal/media/ingest'
        self.s['extra_hosts'] = {'orbaagent.dev': ['10.77.0.1']}
        c.validate(self.d, P)

    def test_automatic_restart_and_pull(self):
        for key, value in [('restart', 'unless-stopped'), ('pull_policy', 'always'), ('image', 'worker:latest')]:
            with self.subTest(key=key):
                self.d = document(); self.d['services'][c.SERVICE][key] = value; self.rejects()


class RuntimeTests(unittest.TestCase):
    def test_safe_running_container(self):
        c.running_safe(running(), document()['services'][c.SERVICE], P, IMAGE_ID)

    def test_actual_isolation_refusals(self):
        for key, value in [('Privileged', True), ('Devices', ['/dev/nvidia1']), ('DeviceRequests', []),
                           ('DeviceCgroupRules', ['c *:* rwm']), ('CapAdd', ['SYS_ADMIN']), ('PidMode', 'host'),
                           ('IpcMode', 'host'), ('NetworkMode', 'host'), ('SecurityOpt', ['no-new-privileges:true', 'apparmor=unconfined']),
                           ('Sysctls', {'kernel.shmmax': '1'}), ('PortBindings', {})]:
            obj = running(); obj['HostConfig'][key] = value
            with self.subTest(key=key), self.assertRaises(c.Refusal):
                c.running_safe(obj, document()['services'][c.SERVICE], P, IMAGE_ID)

    def test_actual_gpu_and_env_drift(self):
        obj = running(); obj['HostConfig']['DeviceRequests'][0]['DeviceIDs'] = [B]
        with self.assertRaises(c.Refusal): c.running_safe(obj, document()['services'][c.SERVICE], P, IMAGE_ID)
        obj = running(); obj['Config']['Env'].append('CUDA_VISIBLE_DEVICES=1')
        with self.assertRaises(c.Refusal): c.running_safe(obj, document()['services'][c.SERVICE], P, IMAGE_ID)

    def test_absent_stopped_and_wrong_image(self):
        stopped = running(); stopped['State']['Running'] = False
        wrong = running(); wrong['Image'] = 'sha256:' + 'c'*64
        for obj in [None, stopped, wrong]:
            with self.subTest(obj=bool(obj)), self.assertRaises(c.Refusal):
                c.running_safe(obj, document()['services'][c.SERVICE], P, IMAGE_ID)

    def test_unexpected_runtime_mount(self):
        obj = running(); obj['Mounts'][0] = {'Type': 'bind', 'Destination': '/models', 'Source': '/', 'RW': True}
        with self.assertRaises(c.Refusal): c.running_safe(obj, document()['services'][c.SERVICE], P, IMAGE_ID)

    def test_no_mutation_if_preflight_fails(self):
        for action in ['deploy-worker', 'restart-worker']:
            with self.subTest(action=action), patch.object(c, 'preflight', side_effect=c.Refusal('blocked')), patch.object(c, 'command') as run:
                with self.assertRaises(c.Refusal): c.execute(action)
                run.assert_not_called()

    def test_restart_rejects_unsafe_existing_before_mutation(self):
        obj = running(); obj['HostConfig']['Privileged'] = True
        with patch.object(c, 'preflight', return_value=(P, document()['services'][c.SERVICE], IMAGE_ID)), patch.object(c, 'existing', return_value=obj), patch.object(c, 'command') as run:
            with self.assertRaises(c.Refusal): c.execute('restart-worker')
            run.assert_not_called()

    def test_deploy_absent_worker_no_deps_no_build_no_pull(self):
        events = []
        def pf(): events.append('validated'); return P, document()['services'][c.SERVICE], IMAGE_ID
        def cmd(argv, timeout): events.append(argv); return ''
        with patch.object(c, 'preflight', side_effect=pf), patch.object(c, 'existing', side_effect=[None, running()]), patch.object(c, 'command', side_effect=cmd), patch('sys.stdout', new=io.StringIO()):
            c.execute('deploy-worker')
        self.assertEqual(events[0], 'validated')
        self.assertEqual(events[1], c.compose('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', c.SERVICE))

    def test_restart_order_and_scope(self):
        events = []
        with patch.object(c, 'preflight', side_effect=lambda: (events.append('validated') or (P, document()['services'][c.SERVICE], IMAGE_ID))), patch.object(c, 'existing', return_value=running()), patch.object(c, 'command', side_effect=lambda argv, timeout: events.append(argv) or ''), patch('sys.stdout', new=io.StringIO()):
            c.execute('restart-worker')
        self.assertEqual(events, ['validated', c.compose('restart', '--no-deps', c.SERVICE)])

    def test_deploy_postcheck_failure_does_not_claim_success(self):
        with patch.object(c, 'preflight', return_value=(P, document()['services'][c.SERVICE], IMAGE_ID)), patch.object(c, 'existing', side_effect=[None, None]), patch.object(c, 'command', return_value=''), patch('sys.stdout', new=io.StringIO()) as out:
            with self.assertRaises(c.Refusal): c.execute('deploy-worker')
            self.assertEqual(out.getvalue(), '')

    def test_wrong_container_owner_refused(self):
        obj = running(); obj['Config']['Labels']['com.docker.compose.project'] = 'other'
        with patch.object(c, 'command', side_effect=['abc', json.dumps([obj])]):
            with self.assertRaises(c.Refusal): c.existing()

    def test_legacy_and_injected_commands_disabled(self):
        for args in [['up'], ['down'], ['restart'], ['build'], ['deploy-worker', 'ollama'], ['logs', '-1'], ['logs', '0'], ['logs', '2001'], ['logs', '1;sh'], ['logs', '1', 'other'], []]:
            with self.subTest(args=args), self.assertRaises(c.Refusal): c.arguments(args)

    def test_accepted_arguments(self):
        for args in [['help'], ['validate'], ['deploy-worker'], ['restart-worker'], ['logs', '2000'], ['logs']]:
            with self.subTest(args=args): self.assertTrue(c.arguments(args))

    def test_clean_subprocess_environment(self):
        with patch.object(c.subprocess, 'run', return_value=Mock(returncode=0, stdout='ok')) as run:
            self.assertEqual(c.command(['/usr/bin/docker', 'version']), 'ok')
            self.assertEqual(run.call_args.kwargs['env'], c.ENV)
            self.assertEqual(run.call_args.kwargs['cwd'], '/')
            self.assertNotIn('shell', run.call_args.kwargs)

    def test_nonzero_subprocess_status_is_not_masked(self):
        with patch.object(c.subprocess, 'run', return_value=Mock(returncode=1, stdout='partial', stderr='SECRET')):
            with self.assertRaises(c.Refusal) as err: c.command([c.SMI])
            self.assertNotIn('SECRET', str(err.exception))

    def test_secure_file_guards(self):
        def info(mode, uid=0, gid=0): return Mock(st_mode=mode, st_uid=uid, st_gid=gid)
        directory = info(stat.S_IFDIR | 0o755)
        for fileinfo in [info(stat.S_IFLNK | 0o777), info(stat.S_IFREG | 0o666), info(stat.S_IFREG | 0o600, 1000), info(stat.S_IFREG | 0o644)]:
            with self.subTest(mode=fileinfo.st_mode), patch.object(Path, 'lstat', side_effect=[directory, directory, fileinfo]):
                with self.assertRaises(c.Refusal): c.secure(Path('/safe/file'), 0o600)

    def test_preflight_inventory_failure_blocks_deploy(self):
        fixture = document()
        def read(path, *args, **kwargs):
            return text() if path.name == 'allocation.env' else 'x' * 40
        # Real preflight code: valid config is followed by wrong live inventory.
        with patch.object(c.socket, 'gethostname', return_value=c.HOST), patch.object(c, 'secure'), patch.object(Path, 'read_text', read), patch.object(c, 'command', side_effect=[json.dumps(fixture), CSV.replace(A, C)]) as run:
            with self.assertRaises(c.Refusal): c.execute('deploy-worker')
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[-1].args[0][0], c.SMI)

    def test_preflight_compose_failure_blocks_inventory_and_mutation(self):
        fixture = document(); fixture['services'][c.SERVICE]['privileged'] = True
        def read(path, *args, **kwargs):
            return text() if path.name == 'allocation.env' else 'x' * 40
        with patch.object(c.socket, 'gethostname', return_value=c.HOST), patch.object(c, 'secure'), patch.object(Path, 'read_text', read), patch.object(c, 'command', return_value=json.dumps(fixture)) as run:
            with self.assertRaises(c.Refusal): c.execute('restart-worker')
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][-3:], ['config', '--format', 'json'])

    def test_preflight_wrong_host_fails_without_commands(self):
        with patch.object(c.socket, 'gethostname', return_value='other-host'), patch.object(c, 'command') as run:
            with self.assertRaises(c.Refusal): c.execute('deploy-worker')
            run.assert_not_called()

    def test_health_redirect_refused_without_token_leak(self):
        class RedirectProbe:
            def __init__(self, handlers): self.handlers = handlers
            def open(self, *args, **kwargs):
                self.handlers[1].redirect_request(None, None, 302, '', {}, 'https://evil.example')
        def opener(*handlers): return RedirectProbe(handlers)
        with patch.object(c, 'preflight', return_value=(P, document()['services'][c.SERVICE], IMAGE_ID)), patch.object(c, 'existing', return_value=running()), patch.object(Path, 'read_text', return_value='x' * 40), patch.object(c.urllib.request, 'build_opener', side_effect=opener):
            with self.assertRaisesRegex(c.Refusal, 'redirect'): c.execute('health')

    def test_no_server_side_build_commands_or_shared_manifest(self):
        source = (HERE / 'control.py').read_text()
        self.assertNotIn("compose('build'", source)
        self.assertNotIn("compose('down'", source)
        self.assertNotIn('--remove-orphans', source)
        self.assertIn("str(DIR / 'compose.yaml')", source)
        self.assertIn('--no-build', source)
        self.assertIn('--no-deps', source)

    def test_wrapper_syntax_and_isolation(self):
        path = HERE / 'orbaagent-gpu'
        subprocess.run(['/bin/sh', '-n', str(path)], check=True)
        source = path.read_text()
        self.assertIn('/usr/bin/env -i', source)
        self.assertIn('/usr/bin/python3 -I', source)
        self.assertNotRegex(source, r'GPU-[0-9a-f]{8}-')


if __name__ == '__main__':
    unittest.main(verbosity=2)
