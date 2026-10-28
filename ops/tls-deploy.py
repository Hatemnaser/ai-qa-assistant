#!/usr/bin/env python3
"""Linux TLS deploy hook. No CA enrollment, firewall edits, or application activation.

Mount config.directory read-only at /run/secrets in the gateway, with its Compose
TLS secrets removed. A directory mount sees atomic generation switches; mounting
individual certificate files would keep stale inodes after replacement.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time


class DeployError(Exception):
    pass


def command(args, *, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=20)
    if result.returncode:
        # Never print command output: it can contain credentials/private paths.
        raise DeployError('COMMAND_FAILED:' + Path(args[0]).name)
    return result.stdout


def atomic_json(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix='.status-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def private_file(path):
    info = path.stat()
    if info.st_uid != 0 or info.st_mode & 0o022:
        raise DeployError('UNTRUSTED_CONFIGURATION')


def configuration(path):
    if os.geteuid() != 0:
        raise DeployError('ROOT_REQUIRED')
    private_file(path)
    value = json.loads(path.read_text())
    if set(value) != {'directory', 'lineage', 'container', 'hosts', 'port', 'caFile'}:
        raise DeployError('CONFIGURATION_INVALID')
    for key in ['directory', 'lineage', 'caFile']:
        if not Path(value[key]).is_absolute() or '..' in Path(value[key]).parts:
            raise DeployError('CONFIGURATION_PATH_INVALID')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}', value['container']):
        raise DeployError('CONTAINER_INVALID')
    hosts = value['hosts']
    if not isinstance(hosts, list) or len(hosts) != 3 or len(set(hosts)) != 3 or any(
        not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)+', host) for host in hosts
    ):
        raise DeployError('HOSTS_INVALID')
    if not isinstance(value['port'], int) or not 1 <= value['port'] <= 65535:
        raise DeployError('PORT_INVALID')
    return value


def validate(config, chain, key):
    leaf = command(['openssl', 'x509', '-in', str(chain), '-outform', 'DER'])
    cert_key = command(['openssl', 'x509', '-in', str(chain), '-pubkey', '-noout'])
    private_key = command(['openssl', 'pkey', '-in', str(key), '-pubout'])
    if cert_key != private_key:
        raise DeployError('TLS_KEY_MISMATCH')
    command(['openssl', 'x509', '-in', str(chain), '-checkend', '604800', '-noout'])
    for host in config['hosts']:
        command(['openssl', 'verify', '-CAfile', config['caFile'], '-untrusted', str(chain),
                 '-purpose', 'sslserver', '-verify_hostname', host, str(chain)])
    return hashlib.sha256(leaf).hexdigest()


def switch(directory, generation):
    pending = directory / '.current-next'
    pending.unlink(missing_ok=True)
    pending.symlink_to(generation)
    os.replace(pending, directory / 'current')
    sync_directory(directory)


def reload_gateway(config):
    command(['docker', 'exec', config['container'], 'nginx', '-t'])
    command(['docker', 'exec', config['container'], 'nginx', '-s', 'reload'])


def served(config, expected):
    context = ssl.create_default_context(cafile=config['caFile'])
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    deadline = time.monotonic() + 15
    while True:
        try:
            for host in config['hosts']:
                with socket.create_connection(('127.0.0.1', config['port']), timeout=3) as raw:
                    with context.wrap_socket(raw, server_hostname=host) as connection:
                        actual = hashlib.sha256(connection.getpeercert(binary_form=True)).hexdigest()
                        if actual != expected:
                            raise DeployError('SERVED_CERTIFICATE_MISMATCH')
            return
        except (OSError, ssl.SSLError, DeployError):
            if time.monotonic() >= deadline:
                raise DeployError('SERVED_CERTIFICATE_NOT_CONFIRMED') from None
            time.sleep(0.2)


def apply(config, *, stage_only=False):
    directory = Path(config['directory'])
    directory.mkdir(mode=0o755, parents=True, exist_ok=True)
    private_file(directory)
    # Take the lock before reading state or altering current. A losing hook must
    # never overwrite the winning hook's success/failure state.
    with (directory / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if stage_only and (directory / 'current').exists():
            raise DeployError('BOOTSTRAP_ALREADY_STAGED')
        status_path = directory / 'status.json'
        prior = json.loads(status_path.read_text()) if status_path.exists() else {}
        status = {'schemaVersion': 1, 'outcome': 'RUNNING', 'failurePending': True,
                  'previousSuccessAt': prior.get('confirmedAt'), 'startedAt': time.time()}
        atomic_json(status_path, status)
        current = directory / 'current'
        previous = os.readlink(current) if current.is_symlink() else None
        switched = False
        try:
            lineage = Path(config['lineage'])
            if os.environ.get('RENEWED_LINEAGE') and Path(os.environ['RENEWED_LINEAGE']).resolve() != lineage.resolve():
                raise DeployError('UNEXPECTED_CERTIFICATE_LINEAGE')
            generation = Path(tempfile.mkdtemp(prefix='generation-', dir=directory))
            os.chmod(generation, 0o755)
            # Copy to an immutable generation BEFORE checking, avoiding a source
            # rotation between validation and activation. Keys never enter logs.
            for source, target in [('fullchain.pem', 'ingress_tls_chain'), ('privkey.pem', 'ingress_tls_key')]:
                destination = generation / target
                with destination.open('xb') as output:
                    os.chmod(destination, 0o600)
                    with (lineage / source).open('rb') as input_stream:
                        shutil.copyfileobj(input_stream, output)
                    output.flush()
                    os.fsync(output.fileno())
                os.chown(destination, 101, 101)
            fingerprint = validate(config, generation / 'ingress_tls_chain', generation / 'ingress_tls_key')
            sync_directory(generation)
            for name in ['ingress_tls_chain', 'ingress_tls_key']:
                link = directory / name
                if not link.is_symlink():
                    if link.exists():
                        raise DeployError('UNEXPECTED_TLS_LAYOUT')
                    link.symlink_to('current/' + name)
            switch(directory, generation.name)
            switched = True
            if stage_only:
                status.update(outcome='STAGED', failurePending=True, fingerprint=fingerprint,
                              generation=generation.name)
                atomic_json(status_path, status)
                return status
            reload_gateway(config)
            served(config, fingerprint)
            status.update(outcome='CONFIRMED', failurePending=False, confirmedAt=time.time(),
                          fingerprint=fingerprint, generation=generation.name)
            atomic_json(status_path, status)
            # Only now prune old managed generations; keep current + rollback.
            for old in directory.glob('generation-*'):
                if old.name not in {generation.name, previous} and old.is_dir() and not old.is_symlink():
                    shutil.rmtree(old)
            return status
        except Exception as error:
            rollback = 'NOT_NEEDED'
            if switched:
                rollback = 'FAILED'
                try:
                    if previous:
                        switch(directory, previous)
                        reload_gateway(config)
                        old_fingerprint = validate(config, current / 'ingress_tls_chain', current / 'ingress_tls_key')
                        served(config, old_fingerprint)
                        rollback = 'CONFIRMED_PREVIOUS_CERTIFICATE'
                    else:
                        current.unlink(missing_ok=True)
                        sync_directory(directory)
                except Exception:
                    pass
            status.update(outcome='FAIL', failurePending=True, failedAt=time.time(), rollback=rollback,
                          reason=str(error) if isinstance(error, DeployError) else type(error).__name__)
            atomic_json(status_path, status)
            raise DeployError(status['reason']) from None


def health(config):
    # Probe actual TLS, never infer health from a historical successful renewal.
    directory = Path(config['directory'])
    with (directory / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        status = json.loads((directory / 'status.json').read_text())
        if status.get('outcome') != 'CONFIRMED' or status.get('failurePending') is not False:
            raise DeployError('TLS_DEPLOYMENT_UNCONFIRMED')
        fingerprint = validate(config, directory / 'current/ingress_tls_chain', directory / 'current/ingress_tls_key')
        if fingerprint != status.get('fingerprint'):
            raise DeployError('TLS_STATUS_MISMATCH')
        served(config, fingerprint)
        return {'outcome': 'HEALTHY', 'fingerprint': fingerprint}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['stage', 'apply', 'health'])
    parser.add_argument('--config', type=Path, default=Path('/etc/oddpath/tls.json'))
    arguments = parser.parse_args()
    try:
        config = configuration(arguments.config)
        result = apply(config, stage_only=True) if arguments.action == 'stage' else globals()[arguments.action](config)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'outcome': 'FAIL', 'reason': str(error) if isinstance(error, DeployError) else type(error).__name__}))
        sys.exit(1)


if __name__ == '__main__':
    main()
