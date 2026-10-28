#!/usr/bin/env python3
"""Real Linux/Docker/Nginx TLS rotation and recovery; synthetic private CA only."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import time

assert sys.platform == 'linux' and os.geteuid() == 0, 'Requires isolated Linux Docker operator'
ROOT = Path(os.environ['ODDPATH_TLS_TEST_DIRECTORY']).resolve()
assert ROOT.is_absolute() and not ROOT.exists(), 'Use a new isolated test directory'
ROOT.mkdir(mode=0o700, parents=True)
TOOL = Path(os.environ['ODDPATH_TLS_TOOL']).resolve()
PRIVATE = ROOT / 'private'
PRIVATE.mkdir(mode=0o700, exist_ok=True)
HOSTS = ['staging-oddpath.eluthira.com', 'api-staging-oddpath.eluthira.com', 'browser-staging-oddpath.eluthira.com']
NAME = 'oddpath-tls-acceptance-20261028'
PORT = 28443
IMAGE = 'nginx@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951'
RESULTS = {'status': 'RUNNING', 'checks': [], 'publicPortsOpened': False, 'publicCaContacted': False}


def run(args, *, ok=True, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=75)
    if ok and result.returncode:
        raise AssertionError(str(args[:3]) + ': ' + result.stderr[-2000:])
    return result


def record(name, condition):
    RESULTS['checks'].append({'name': name, 'status': 'PASS' if condition else 'FAIL'})
    (ROOT / 'verification.json').write_text(json.dumps(RESULTS, indent=2) + '\n')
    print(name + ': ' + ('PASS' if condition else 'FAIL'), flush=True)
    assert condition, name


def certificate(name, serial, *, hosts=HOSTS, days=30):
    path = PRIVATE / name
    path.mkdir()
    run(['openssl', 'req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=' + hosts[0], '-keyout', str(path / 'privkey.pem'), '-out', str(path / 'request.pem')])
    ext = path / 'extensions.cnf'
    ext.write_text('subjectAltName=' + ','.join('DNS:' + host for host in hosts) + '\nextendedKeyUsage=serverAuth\n')
    run(['openssl', 'x509', '-req', '-in', str(path / 'request.pem'), '-CA', str(PRIVATE / 'ca.pem'), '-CAkey', str(PRIVATE / 'ca.key'), '-set_serial', str(serial), '-days', str(days), '-extfile', str(ext), '-out', str(path / 'fullchain.pem')])
    return path


def invoke(action, config, *, expected=0, environment=None):
    result = subprocess.run(['python3', str(TOOL), action, '--config', str(config)], capture_output=True, text=True, timeout=75, env=environment)
    assert result.returncode == expected, result.stdout + result.stderr
    return json.loads(result.stdout)


def status(config):
    return json.loads((Path(json.loads(config.read_text())['directory']) / 'status.json').read_text())


try:
    run(['openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '365', '-subj', '/CN=Oddpath isolated TLS review CA', '-keyout', str(PRIVATE / 'ca.key'), '-out', str(PRIVATE / 'ca.pem')])
    first = certificate('first', 1)
    second = certificate('second', 2)
    wrong = certificate('wrong-host', 3, hosts=['unrelated.oddpath.test'])
    short = certificate('short-lived', 4, days=1)
    config = PRIVATE / 'config.json'
    value = {'directory': str(ROOT / 'served'), 'lineage': str(first), 'container': NAME, 'hosts': HOSTS, 'port': PORT, 'caFile': str(PRIVATE / 'ca.pem')}
    config.write_text(json.dumps(value))
    config.chmod(0o600)
    staged = invoke('stage', config)
    record('bootstrap-is-staged-not-confirmed', staged['outcome'] == 'STAGED' and staged['failurePending'])
    invoke('health', config, expected=1)
    nginx = PRIVATE / 'nginx.conf'
    nginx.write_text('pid /tmp/nginx.pid; events {} http { access_log off; ssl_certificate /run/secrets/ingress_tls_chain; ssl_certificate_key /run/secrets/ingress_tls_key; server { listen 8443 ssl; server_name ' + ' '.join(HOSTS) + '; location / { return 503; } } }')
    run(['docker', 'run', '-d', '--pull=never', '--name', NAME, '--user', '101:101', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp', '--tmpfs', '/var/cache/nginx:uid=101,gid=101', '--mount', 'type=bind,src=' + str(nginx) + ',dst=/etc/nginx/nginx.conf,readonly', '--mount', 'type=bind,src=' + value['directory'] + ',dst=/run/secrets,readonly', '-p', '127.0.0.1:' + str(PORT) + ':8443', '--entrypoint', 'nginx', IMAGE, '-g', 'daemon off;'])
    first_status = invoke('apply', config)
    invoke('health', config)
    record('all-three-SNI-hosts-serve-validated-initial-certificate', first_status['outcome'] == 'CONFIRMED')
    value['lineage'] = str(second)
    config.write_text(json.dumps(value))
    second_status = invoke('apply', config)
    record('real-nginx-directory-mount-reloads-new-certificate', first_status['fingerprint'] != second_status['fingerprint'])
    invoke('health', config)
    duplicate = invoke('apply', config)
    record('repeated-deploy-and-fresh-process-health-remain-consistent', duplicate['fingerprint'] == second_status['fingerprint'])
    value['lineage'] = str(wrong)
    config.write_text(json.dumps(value))
    invoke('apply', config, expected=1)
    record('wrong-SAN-rejected-with-durable-failure', status(config)['outcome'] == 'FAIL' and status(config)['failurePending'])
    invoke('health', config, expected=1)
    record('prior-success-does-not-hide-current-deployment-failure', True)
    value['lineage'] = str(short)
    config.write_text(json.dumps(value))
    invoke('apply', config, expected=1)
    record('certificate-near-expiry-rejected', status(config)['outcome'] == 'FAIL')
    value['lineage'] = str(second)
    config.write_text(json.dumps(value))
    (second / 'privkey.pem').write_bytes((first / 'privkey.pem').read_bytes())
    invoke('apply', config, expected=1)
    record('mismatched-private-key-rejected', status(config)['reason'] == 'TLS_KEY_MISMATCH')
    # Restore from a fresh synthetic issuance; never modify an original key.
    third = certificate('third', 5)
    value['lineage'] = str(third)
    config.write_text(json.dumps(value))
    lock_path = ROOT / 'served/.deploy.lock'
    before = (ROOT / 'served/status.json').read_bytes()
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        invoke('apply', config, expected=1)
        invoke('health', config, expected=1)
        record('lock-loser-never-overwrites-state-or-reports-health', before == (ROOT / 'served/status.json').read_bytes())
    recovered = invoke('apply', config)
    invoke('health', config)
    record('restart-retry-recovers-failure-only-after-actual-TLS-confirmation', recovered['outcome'] == 'CONFIRMED' and not recovered['failurePending'])
    # A failed gateway reload must preserve the prior live certificate and FAIL.
    value['container'] = NAME + '-absent'
    value['lineage'] = str(first)
    config.write_text(json.dumps(value))
    invoke('apply', config, expected=1)
    record('failed-reload-does-not-confirm-new-generation', status(config)['failurePending'] and status(config)['outcome'] == 'FAIL')
    value['container'] = NAME
    config.write_text(json.dumps(value))
    invoke('apply', config)
    invoke('health', config)
    record('subsequent-process-recovers-after-failed-reload', True)
    # SIGKILL immediately after durable current switch, before nginx reload.
    value['lineage'] = str(third)
    config.write_text(json.dumps(value))
    fault = ROOT / 'fault.py'
    fault.write_text("import importlib.util,os\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('deploy'," + repr(str(TOOL)) + ")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.reload_gateway=lambda c:os.kill(os.getpid(),9)\nm.apply(m.configuration(Path(" + repr(str(config)) + ")))\n")
    result = run(['python3', str(fault)], ok=False)
    invoke('health', config, expected=1)
    record('SIGKILL-between-switch-and-reload-remains-unhealthy', result.returncode == -9 and status(config)['outcome'] == 'RUNNING')
    invoke('apply', config)
    invoke('health', config)
    record('fresh-process-reconciles-SIGKILL-without-false-success', True)
    key = ROOT / 'served/current/ingress_tls_key'
    record('private-key-readable-only-by-ingress-UID', key.stat().st_uid == 101 and key.stat().st_mode & 0o777 == 0o600)
    inspect = json.loads(run(['docker', 'inspect', NAME]).stdout)[0]
    record('test-listener-loopback-only-nonroot-readonly-capdropped', inspect['HostConfig']['PortBindings']['8443/tcp'][0]['HostIp'] == '127.0.0.1' and inspect['Config']['User'] == '101:101' and inspect['HostConfig']['ReadonlyRootfs'] and inspect['HostConfig']['CapDrop'] == ['ALL'])
    RESULTS['status'] = 'PASS'
except Exception as error:
    RESULTS['status'] = 'FAIL'
    RESULTS['error'] = str(error)
    raise
finally:
    container_log = run(['docker', 'logs', NAME], ok=False)
    (ROOT / 'gateway.log').write_text(container_log.stdout + container_log.stderr)
    run(['docker', 'rm', '-f', NAME], ok=False)
    RESULTS['cleanup'] = not bool(run(['docker', 'ps', '-aq', '--filter', 'name=^/' + NAME + '$']).stdout.strip())
    (ROOT / 'verification.json').write_text(json.dumps(RESULTS, indent=2) + '\n')
