"""Worker-only controls. Stdlib only; no server action at import time.

Validate parsed Docker Compose JSON (never regex/YAML fragments), live host
inventory and a local immutable image BEFORE mutation. All subprocess arguments,
paths and service targets are fixed; no shell, build, pull, exec or project down.
Root-controlled approval reference is an operator attestation, not an ownership detector.
"""
from __future__ import annotations

import csv
import fcntl
import io
import json
import os
import re
import socket
import stat
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path('/etc/orbaagent/gpu-worker')
DIR = ROOT / 'worker-only'
SERVICE = 'orbaagent-gpu-worker'
PROJECT = 'orbaagent-gpu'
IP = '10.77.0.2'
HOST = 'migrol-ag-gpu-worker01'
DOCKER = '/usr/bin/docker'
SMI = '/usr/bin/nvidia-smi'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C'}
UUID = re.compile(r'GPU-[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z')
IMAGE = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[0-9a-f]{64}\Z')
POLICY_KEYS = {'ORBA_WORKER_GPU_UUID', 'ORBA_MOVA_GPU_UUID', 'ORBA_WORKER_IMAGE',
               'ORBA_MEDIA_NETWORK', 'ORBA_GPU_OWNERSHIP_APPROVAL'}
VOLUMES = {'orbaagent_models': '/models', 'orbaagent_output': '/output', 'orbaagent_data': '/data'}
SECRETS = {'media_worker_token', 'media_ingest_token'}
ENV_KEYS = {'NVIDIA_VISIBLE_DEVICES', 'CUDA_VISIBLE_DEVICES', 'MEDIA_WORKER_GPU_UUID',
            'MEDIA_WORKER_PORT', 'MEDIA_GENERATION_BACKEND', 'MEDIA_GENERATION_IMAGE_MODEL',
            'MEDIA_GENERATION_VIDEO_MODEL', 'MEDIA_MAX_CONCURRENT_GENERATIONS',
            'MEDIA_MODELS_DIR', 'MEDIA_OUTPUT_DIR', 'MEDIA_WORKER_TOKEN_FILE',
            'MEDIA_INGEST_TOKEN_FILE', 'MEDIA_INGEST_URL', 'ORBA_TENANT_ID'}
SERVICE_KEYS = {'container_name', 'image', 'pull_policy', 'restart', 'ports', 'environment',
                'secrets', 'volumes', 'networks', 'extra_hosts', 'cap_drop', 'security_opt', 'deploy'}


class Refusal(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refusal(message)


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def load_json(text):
    try:
        return json.loads(text, object_pairs_hook=object_pairs)
    except (ValueError, TypeError) as exc:
        raise Refusal('invalid or duplicate-key JSON') from exc


def policy(text):
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, value = line.partition('=')
        require(sep and key in POLICY_KEYS and key not in values, 'unknown/duplicate allocation key')
        require(value and not re.search(r'[\s\x00-\x1f\x7f\"\'`$]', value), 'blank or unsafe allocation value')
        values[key] = value
    require(set(values) == POLICY_KEYS, 'incomplete allocation policy')
    a, b = values['ORBA_WORKER_GPU_UUID'], values['ORBA_MOVA_GPU_UUID']
    require(UUID.fullmatch(a) and UUID.fullmatch(b) and a.lower() != b.lower(), 'distinct full GPU UUIDs required')
    require(IMAGE.fullmatch(values['ORBA_WORKER_IMAGE']), 'immutable repository image digest required')
    require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', values['ORBA_MEDIA_NETWORK']), 'invalid network name')
    return values


def inventory(text, p):
    rows, uuids = {}, set()
    for row in csv.reader(io.StringIO(text)):
        if not row:
            continue
        require(len(row) == 3, 'expected index,uuid,name inventory')
        index, uuid, name = (x.strip() for x in row)
        require(index.isascii() and index.isdigit() and UUID.fullmatch(uuid) and name, 'invalid GPU row')
        require(int(index) not in rows and uuid.lower() not in uuids, 'duplicate GPU identity')
        rows[int(index)] = uuid.lower()
        uuids.add(uuid.lower())
    require(rows.get(0) == p['ORBA_WORKER_GPU_UUID'].lower(), 'worker UUID is not live host GPU 0')
    require(rows.get(1) == p['ORBA_MOVA_GPU_UUID'].lower(), 'MOVA UUID is not live host GPU 1')


def validate(doc, p):
    require(isinstance(doc, dict) and set(doc) <= {'name', 'services', 'networks', 'volumes', 'secrets'}, 'unexpected Compose root')
    require(doc.get('name') == PROJECT, 'unexpected project')
    require(set(doc.get('services', {})) == {SERVICE}, 'manifest must contain ONLY the worker service')
    s = doc['services'][SERVICE]
    require(isinstance(s, dict) and set(s) == SERVICE_KEYS, 'unexpected/missing worker settings')
    require(s['container_name'] == SERVICE and s['image'] == p['ORBA_WORKER_IMAGE'], 'worker identity/image mismatch')
    require(s['pull_policy'] == 'never' and s['restart'] == 'no', 'pull or automatic restart forbidden')
    require(s['cap_drop'] == ['ALL'] and s['security_opt'] == ['no-new-privileges:true'], 'security boundary changed')
    devices = [{'driver': 'nvidia', 'device_ids': [p['ORBA_WORKER_GPU_UUID']], 'capabilities': ['gpu']}]
    require(s['deploy'] == {'resources': {'reservations': {'devices': devices}}}, 'single policy GPU reservation required')
    e = s['environment']
    require(isinstance(e, dict) and set(e) == ENV_KEYS and all(isinstance(v, str) for v in e.values()), 'unexpected environment')
    expected = {'NVIDIA_VISIBLE_DEVICES': p['ORBA_WORKER_GPU_UUID'], 'MEDIA_WORKER_GPU_UUID': p['ORBA_WORKER_GPU_UUID'],
                'CUDA_VISIBLE_DEVICES': '0', 'MEDIA_WORKER_PORT': '8190', 'MEDIA_MAX_CONCURRENT_GENERATIONS': '1',
                'MEDIA_MODELS_DIR': '/models', 'MEDIA_OUTPUT_DIR': '/output', 'MEDIA_GENERATION_BACKEND': 'diffusers',
                'MEDIA_WORKER_TOKEN_FILE': '/run/secrets/media_worker_token', 'MEDIA_INGEST_TOKEN_FILE': '/run/secrets/media_ingest_token'}
    require(all(e.get(k) == v for k, v in expected.items()), 'worker GPU/runtime settings differ from reviewed policy')
    require(e['MEDIA_GENERATION_IMAGE_MODEL'] == 'black-forest-labs/FLUX.1-schnell', 'FLUX acceptance requires the approved FLUX model')
    require(bool(e['MEDIA_GENERATION_VIDEO_MODEL']) and bool(e['ORBA_TENANT_ID']), 'preserve explicit model/workspace settings')
    require(e['MEDIA_INGEST_URL'] in {'http://10.77.0.1/api/internal/media/ingest',
                                     'https://orbaagent.dev/api/internal/media/ingest'}, 'unreviewed ingest destination')
    require(s['extra_hosts'] in ({'orbaagent.dev': '10.77.0.1'}, {'orbaagent.dev': ['10.77.0.1']}), 'private ingest hostname routing changed')
    require(s['networks'] == {'orbaagent_media_net': None}, 'unexpected worker networks')
    require(doc['networks'] == {'orbaagent_media_net': {'name': p['ORBA_MEDIA_NETWORK'], 'external': True}}, 'network creation forbidden')
    require(doc['volumes'] == {k: {'name': k, 'external': True} for k in VOLUMES}, 'volume creation forbidden')
    require(len(s['volumes']) == 3, 'unexpected mounts')
    require({(v.get('type'), v.get('source'), v.get('target')) for v in s['volumes']} ==
            {('volume', k, v) for k, v in VOLUMES.items()}, 'host/device mount forbidden')
    for v in s['volumes']:
        require(set(v) <= {'type', 'source', 'target', 'volume', 'read_only'} and
                v.get('volume', {}) in ({}, {'nocopy': True}, {'nocopy': False}) and
                v.get('read_only', False) is False, 'unexpected mount options')
    require(doc['secrets'] == {k: {'name': PROJECT + '_' + k, 'file': str(ROOT / 'secrets' / k)} for k in SECRETS}, 'secret paths changed')
    require(len(s['secrets']) == 2 and {v.get('source') for v in s['secrets']} == SECRETS, 'unexpected secrets')
    for secret in s['secrets']:
        require(secret == {'source': secret['source'], 'target': secret['source']}, 'secret target changed')
    require(len(s['ports']) == 1, 'unexpected published ports')
    port = s['ports'][0]
    require(port.get('host_ip') == IP and str(port.get('published')) == '8190' and port.get('target') == 8190
            and port.get('protocol') == 'tcp' and port.get('mode', 'ingress') == 'ingress'
            and set(port) <= {'host_ip', 'published', 'target', 'protocol', 'mode'}, 'worker must bind WireGuard only')
    return s


def secure(path, mode=None, directory=False):
    path = Path(path)
    for parent in reversed(path.parents):
        st = parent.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022, 'unsafe parent directory')
    st = path.lstat()
    require(st.st_uid == 0 and st.st_gid == 0 and not st.st_mode & 0o022, 'path must be root-owned, not writable by others')
    require(stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode), 'symlinks/special paths forbidden')
    require(mode is None or stat.S_IMODE(st.st_mode) == mode, 'incorrect protected file mode')


def command(argv, timeout=30):
    proc = subprocess.run(argv, env=ENV, cwd='/', capture_output=True, text=True, timeout=timeout, check=False)
    # Never expose Compose's rendered config, secret values, or raw subprocess diagnostics.
    require(proc.returncode == 0, 'approved command failed; administrator must inspect restricted diagnostics')
    return proc.stdout


def compose(*args):
    return [DOCKER, 'compose', '--project-name', PROJECT, '--env-file', str(ROOT / 'worker.env'),
            '--env-file', str(DIR / 'allocation.env'), '-f', str(DIR / 'compose.yaml'), *args]


def preflight():
    require(socket.gethostname().split('.')[0] == HOST, 'wrong host')
    secure(DIR, directory=True)
    for path, mode in [(DIR / 'control.py', 0o644), (DIR / 'compose.yaml', 0o644),
                       (DIR / 'allocation.env', 0o600), (ROOT / 'worker.env', 0o600),
                       (Path('/usr/local/sbin/orbaagent-gpu'), 0o755)]:
        secure(path, mode)
    for name in SECRETS:
        secure(ROOT / 'secrets' / name, 0o600)
        require(len((ROOT / 'secrets' / name).read_text().strip()) >= 32, 'missing/weak secret')
    p = policy((DIR / 'allocation.env').read_text())
    s = validate(load_json(command(compose('config', '--format', 'json'))), p)
    inventory(command([SMI, '--query-gpu=index,uuid,name', '--format=csv,noheader']), p)
    image = load_json(command([DOCKER, 'image', 'inspect', p['ORBA_WORKER_IMAGE']]))[0]
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', image['Id']), 'invalid local image identity')
    for name in VOLUMES:
        obj = load_json(command([DOCKER, 'volume', 'inspect', name]))[0]
        require(obj['Name'] == name and obj['Driver'] == 'local' and not obj.get('Options'), 'unreviewed volume driver/options')
    network = load_json(command([DOCKER, 'network', 'inspect', p['ORBA_MEDIA_NETWORK']]))[0]
    require(network['Name'] == p['ORBA_MEDIA_NETWORK'] and network['Driver'] == 'bridge', 'unreviewed existing network')
    return p, s, image['Id']


def existing():
    ids = command([DOCKER, 'container', 'ls', '-aq', '--filter', 'name=^/' + SERVICE + '$']).split()
    require(len(ids) <= 1, 'ambiguous worker container')
    if not ids:
        return None
    obj = load_json(command([DOCKER, 'container', 'inspect', ids[0]]))[0]
    require(obj['Name'] == '/' + SERVICE, 'container name mismatch')
    labels = obj['Config'].get('Labels') or {}
    require(labels.get('com.docker.compose.project') == PROJECT and
            labels.get('com.docker.compose.service') == SERVICE, 'container ownership labels mismatch')
    return obj


def running_safe(obj, s, p, image_id):
    require(obj is not None and obj['State']['Running'] is True, 'worker is absent/not running')
    require(obj['Image'] == image_id, 'running image differs from approved local digest')
    h = obj['HostConfig']
    require(not h.get('Privileged') and not h.get('Devices') and not h.get('DeviceCgroupRules') and
            not h.get('CapAdd') and not h.get('VolumesFrom') and
            h.get('PidMode', '') == '' and h.get('IpcMode', '') in ('private', '') and
            h.get('NetworkMode') == p['ORBA_MEDIA_NETWORK'] and
            h.get('RestartPolicy', {}).get('Name') == 'no', 'unsafe existing container isolation')
    require(h.get('CapDrop') == ['ALL'] and h.get('SecurityOpt') == ['no-new-privileges:true']
            and not h.get('Sysctls') and not h.get('CgroupParent') and not h.get('GroupAdd')
            and h.get('UTSMode', '') == '' and h.get('UsernsMode', '') == ''
            and h.get('ExtraHosts') == ['orbaagent.dev:10.77.0.1'], 'existing security controls differ')
    r = h.get('DeviceRequests') or []
    require(len(r) == 1 and r[0].get('Driver') == 'nvidia' and r[0].get('DeviceIDs') == [p['ORBA_WORKER_GPU_UUID']]
            and r[0].get('Count', 0) == 0 and r[0].get('Capabilities') == [['gpu']]
            and not r[0].get('Options'), 'unsafe existing GPU request')
    env = dict(x.split('=', 1) for x in obj['Config']['Env'])
    require(all(env.get(k) == v for k, v in s['environment'].items()), 'running environment differs')
    require(h.get('PortBindings') == {'8190/tcp': [{'HostIp': IP, 'HostPort': '8190'}]}, 'unsafe actual port binding')
    require(set(obj['NetworkSettings']['Networks']) == {p['ORBA_MEDIA_NETWORK']}, 'unexpected actual networks')
    mounts = obj.get('Mounts', [])
    require(len(mounts) == 5 and {m['Destination'] for m in mounts} ==
            set(VOLUMES.values()) | {'/run/secrets/' + k for k in SECRETS}, 'unexpected actual mounts')
    for m in mounts:
        if m['Type'] == 'volume':
            require(m.get('Name') in VOLUMES and m['Destination'] == VOLUMES[m['Name']], 'unexpected actual volume')
        else:
            name = Path(m['Destination']).name
            require(m['Type'] == 'bind' and name in SECRETS and m['Destination'] == '/run/secrets/' + name
                    and m['Source'] == str(ROOT / 'secrets' / name) and not m['RW'], 'unexpected actual host bind')


def execute(action, lines='100'):
    arguments([action, lines] if action == 'logs' else [action])
    p, s, image_id = preflight()  # Always BEFORE deployment/restart.
    obj = existing()
    if action in ('restart-worker', 'health'):
        running_safe(obj, s, p, image_id)  # Desired config cannot disguise unsafe RUNNING config.
    if action == 'deploy-worker':
        command(compose('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', SERVICE), 180)
        running_safe(existing(), s, p, image_id)
        print('worker-only replacement validated; inference/artifact acceptance is still required')
    elif action == 'restart-worker':
        command(compose('restart', '--no-deps', SERVICE), 90)
        running_safe(existing(), s, p, image_id)
        print('worker-only restart validated; health/acceptance still required')
    elif action == 'validate':
        print('desired worker-only config, live mapping and local resources validated; ownership reference: ' + p['ORBA_GPU_OWNERSHIP_APPROVAL'])
    elif action == 'status':
        print(command(compose('ps', SERVICE)))
    elif action == 'logs':
        print(command(compose('logs', '--tail', lines, SERVICE)))
    elif action == 'health':
        token = (ROOT / 'secrets' / 'media_worker_token').read_text().strip()
        require(not re.search(r'[\r\n]', token), 'invalid token')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise Refusal('health redirect refused')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        req = urllib.request.Request('http://' + IP + ':8190/health', headers={'Authorization': 'Bearer ' + token})
        with opener.open(req, timeout=5) as response:
            health = load_json(response.read(1024 * 1024))
        require(health.get('gpu', {}).get('device_uuid') == p['ORBA_WORKER_GPU_UUID'] and
                health.get('gpu', {}).get('available') is True, 'health GPU identity/unavailability failure')
        print(json.dumps(health).replace(token, '[REDACTED]'))


def arguments(args):
    require(args and args[0] in {'validate', 'deploy-worker', 'restart-worker', 'health', 'status', 'logs', 'help'},
            'allowed: validate, deploy-worker, restart-worker, health, status, logs [1..2000], help; build/up/down/restart disabled')
    require(len(args) == 1 or (args[0] == 'logs' and len(args) == 2), 'unexpected arguments')
    lines = args[1] if len(args) == 2 else '100'
    require(re.fullmatch(r'[0-9]{1,4}', lines) and 1 <= int(lines) <= 2000, 'logs must be 1..2000')
    return args[0], lines


def main(args=None):
    try:
        action, lines = arguments(sys.argv[1:] if args is None else args)
        if action == 'help':
            print('Worker only: validate | deploy-worker | restart-worker | health | status | logs [1..2000]. No build/pull or project-wide operations.')
            return 0
        require(os.geteuid() == 0, 'root wrapper required')
        # Existing administrator-created lock serializes actions; it is NOT an authorization token.
        lock_path = DIR / 'control.lock'
        secure(lock_path, 0o600)
        with lock_path.open('r') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            execute(action, lines)
        return 0
    except Refusal as exc:
        print('REFUSED/FAILED: ' + str(exc) + '. No success claimed; if mutation started, follow rollback.', file=sys.stderr)
        return 4
    except Exception:
        # Detailed exceptions may contain tokens in HTTP/server responses; never echo them here.
        print('REFUSED/FAILED: no success claimed. Check policy, permissions, live evidence and restricted diagnostics. If an action started, inspect the worker and follow rollback.', file=sys.stderr)
        return 4


if __name__ == '__main__':
    raise SystemExit(main())
