#!/usr/bin/env python3
"""Portable Core backup runner. No marketplace writes and no chat dependency."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, HTTPRedirectHandler
import uuid

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 512 * 1024 * 1024


class BackupError(Exception):
    pass


def utcnow():
    return datetime.now(timezone.utc)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def bounded_copy(source, target, maximum=MAX_BYTES):
    size = 0
    started = time.monotonic()
    while chunk := source.read(1024 * 1024):
        size += len(chunk)
        if size > maximum or time.monotonic() - started > 900:
            raise BackupError('Source exceeds the backup bounds')
        target.write(chunk)
    return size


def private_file(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise BackupError('Use an owner-only regular configuration file')
    return path


def load_config(path):
    cfg = json.loads(private_file(path).read_text())
    if cfg.get('schema') != 1:
        raise BackupError('Unsupported backup configuration')
    state = Path(cfg['state_dir'])
    if not state.is_absolute() or state.is_symlink():
        raise BackupError('Use an absolute private state directory')
    remote = cfg.get('remote', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]+:[^\r\n\x00]*', remote) or '..' in remote.split('/'):
        raise BackupError('Configure a named rclone remote destination')
    if not Path(cfg['rclone_config']).is_absolute():
        raise BackupError('Use an absolute rclone configuration path')
    private_file(cfg['rclone_config'])
    return cfg


def configuration_fingerprint(cfg):
    identity = {'remote': cfg.get('remote'), 'source': cfg.get('source')}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def clean_environment(work):
    # Neither the restore process nor rclone inherit live DB/marketplace/AI keys.
    return {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'TMPDIR': str(work),
            'LANG': 'C.UTF-8'}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BackupError('The configured Core origin redirected')


def capture_core(cfg, path):
    source = cfg.get('source', {})
    if source.get('mode') != 'existing-open-core':
        raise BackupError('Source is unconfigured; use a reviewed manual export or configure the existing open Core source')
    origin = source.get('origin', '')
    parsed = urlsplit(origin)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise BackupError('Configure the exact HTTPS Core origin')
    origin = origin.rstrip('/')
    opener = build_opener(NoRedirect(), HTTPCookieProcessor(CookieJar()))
    with opener.open(origin + '/api/session', timeout=90) as response:
        session = json.loads(response.read(65536))
    if session.get('authenticated') is not True or session.get('loginRequired') is not False:
        raise BackupError('Existing open Core access is unavailable; no access setting was changed')
    with opener.open(origin + '/api/backup', timeout=90) as response, path.open('xb') as output:
        if response.headers.get_content_type() != 'application/x-ndjson':
            raise BackupError('Core did not return an NDJSON backup')
        bounded_copy(response, output)
    return session.get('version')


def source_time(path, now=None):
    with Path(path).open('rb') as stream:
        line = stream.readline(16 * 1024 * 1024 + 1)
    if len(line) > 16 * 1024 * 1024:
        raise BackupError('Manifest exceeds the supported bound')
    first = json.loads(line)
    if first.get('type') != 'manifest' or first.get('format') != 'btcore-backup-v2':
        raise BackupError('Use a complete current Core v2 export')
    created = datetime.fromisoformat(first['createdAt'].replace('Z', '+00:00'))
    if created.tzinfo is None:
        raise BackupError('Backup timestamp requires a timezone')
    age = ((now or utcnow()) - created).total_seconds()
    if age < -300 or age > 26 * 3600:
        raise BackupError('Source backup is stale or its clock is invalid')
    return created.isoformat()


def restore_drill(path, work):
    result = subprocess.run(['node', str(ROOT / 'tools/restore-drill.mjs'), str(path), '--cleanup'],
                            capture_output=True, text=True, timeout=900, env=clean_environment(work))
    if result.returncode:
        raise BackupError('Isolated Core restore failed')
    proof = json.loads(result.stdout)
    if not all(proof.get(k) is True for k in ('restored', 'originalHashesVerified',
                                            'nonEmptyRestoreRejected', 'offlineOnly')):
        raise BackupError('Restore proof is incomplete')
    return {k: proof[k] for k in ('restored', 'items', 'drafts', 'sales', 'photos',
                                 'originalHashesVerified', 'nonEmptyRestoreRejected', 'offlineOnly')}


class RcloneStore:
    def __init__(self, cfg, work):
        self.cfg, self.work = cfg, work

    def transfer(self, source, destination, command='copyto'):
        result = subprocess.run(['rclone', command, str(source), str(destination),
                                 '--config', self.cfg['rclone_config'], '--immutable', '--checksum',
                                 '--retries', '2', '--low-level-retries', '2',
                                 '--timeout', '90s', '--contimeout', '30s', '--stats', '0',
                                 '--max-transfer', str(MAX_BYTES + 16 * 1024 * 1024),
                                 '--log-level', 'ERROR'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=900, env=clean_environment(self.work))
        if result.returncode:
            raise BackupError('Off-site transfer failed')

    def put(self, local, relative):
        parent, _, name = relative.rpartition('/')
        if not name or name in ('.', '..') or '..' in parent.split('/'):
            raise BackupError('Invalid backup object name')
        # copyto in rclone 1.60 bypasses the immutable check for single files.
        # Stage the exact name and use directory copy's checked transfer path.
        with tempfile.TemporaryDirectory(prefix='upload-', dir=self.work) as directory:
            staged = Path(directory) / name
            shutil.copyfile(local, staged)
            self.transfer(directory, self.cfg['remote'].rstrip('/') + '/' + parent, command='copy')

    def get(self, relative, local):
        if Path(local).exists():
            raise BackupError('Readback destination must be empty')
        self.transfer(self.cfg['remote'].rstrip('/') + '/' + relative, local)


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x') as output:
            output.write(json.dumps(value, indent=2) + '\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def run_lock(state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    if state.is_symlink() or state.stat().st_mode & 0o077:
        raise BackupError('Use an owner-only state directory')
    descriptor = os.open(state / 'run.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError('A backup is already running') from None
        yield


def run_backup(cfg, input_path=None, store_factory=RcloneStore, drill=restore_drill):
    os.umask(0o077)
    state = Path(cfg['state_dir'])
    with run_lock(state), tempfile.TemporaryDirectory(prefix='capture-', dir=state) as directory:
        work = Path(directory)
        remote = store_factory(cfg, work)
        run_id = utcnow().strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:12]
        phase = 'capture'
        atomic_json(state / 'last-attempt.json', {'at': utcnow().isoformat(), 'status': 'running', 'run_id': run_id})
        try:
            source = work / 'core.ndjson'
            version = None
            if input_path:
                if Path(input_path).is_symlink() or not Path(input_path).is_file():
                    raise BackupError('Manual input must be a regular file')
                with Path(input_path).open('rb') as src, source.open('xb') as dst:
                    bounded_copy(src, dst)
            else:
                version = capture_core(cfg, source)
            created_at = source_time(source)
            phase = 'source_restore'
            before = drill(source, work)
            archive = work / 'core.ndjson.gz'
            with source.open('rb') as src, gzip.open(archive, 'wb', compresslevel=6) as dst:
                bounded_copy(src, dst)
            checksum = digest(archive)
            relative = 'core-logical/' + run_id + '/core.ndjson.gz'
            phase = 'upload'
            remote.put(archive, relative)
            phase = 'download'
            retrieved = work / 'readback.ndjson.gz'
            remote.get(relative, retrieved)
            if digest(retrieved) != checksum:
                raise BackupError('Off-site checksum differs')
            phase = 'remote_restore'
            recovered = work / 'readback.ndjson'
            with gzip.open(retrieved, 'rb') as src, recovered.open('xb') as dst:
                bounded_copy(src, dst)
            after = drill(recovered, work)
            if before != after:
                raise BackupError('Off-site restore differs from source')
            receipt = {'schema': 1, 'scope': 'core-logical-only', 'run_id': run_id,
                       'source_created_at': created_at, 'verified_at': utcnow().isoformat(),
                       'configuration_fingerprint': configuration_fingerprint(cfg),
                       'core_version': version, 'archive': relative, 'sha256': checksum,
                       'bytes': archive.stat().st_size, 'remote_readback_verified': True,
                       'restore': after,
                       'not_included': ['connector database/originals/keys', 'Core sessions/credentials',
                                        'legacy D1', 'Git history', 'hosting configuration']}
            phase = 'receipt'
            receipt_path = work / 'receipt.json'
            atomic_json(receipt_path, receipt)
            receipt_relative = 'core-logical/' + run_id + '/receipt.json'
            remote.put(receipt_path, receipt_relative)
            receipt_readback = work / 'receipt-readback.json'
            remote.get(receipt_relative, receipt_readback)
            if digest(receipt_path) != digest(receipt_readback):
                raise BackupError('Off-site receipt differs')
            atomic_json(state / 'last-success.json', receipt)
            atomic_json(state / 'last-attempt.json', {'at': utcnow().isoformat(), 'status': 'verified', 'run_id': run_id})
            return receipt
        except Exception:
            atomic_json(state / 'last-attempt.json', {'at': utcnow().isoformat(), 'status': 'failed', 'phase': phase})
            raise BackupError('Backup failed during ' + phase + '; last verified backup retained') from None


def check_status(state, now=None, fingerprint=None):
    state = Path(state)
    try:
        proof = json.loads((state / 'last-success.json').read_text())
        attempt = json.loads((state / 'last-attempt.json').read_text())
        age = ((now or utcnow()) - datetime.fromisoformat(proof['verified_at'])).total_seconds()
        source_age = ((now or utcnow()) - datetime.fromisoformat(proof['source_created_at'])).total_seconds()
        if (fingerprint is not None and proof.get('configuration_fingerprint') != fingerprint
                or proof.get('schema') != 1 or proof.get('scope') != 'core-logical-only'
                or attempt.get('status') != 'verified' or attempt.get('run_id') != proof.get('run_id')
                or not proof.get('remote_readback_verified')
                or not proof.get('restore', {}).get('originalHashesVerified')
                or age < -300 or source_age < -300 or max(age, source_age) > 26 * 3600):
            raise ValueError('Unverified, failed or stale')
        return {'healthy': True, 'scope': 'core-logical-only', 'verified_at': proof['verified_at']}
    except (OSError, KeyError, ValueError, TypeError):
        raise BackupError('Core backup is missing, stale or the latest attempt failed') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'check'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--input', help='Fresh manually exported Core NDJSON; never used by the timer')
    args = parser.parse_args()
    try:
        cfg = load_config(args.config)
        if args.action == 'check':
            result = check_status(cfg['state_dir'], fingerprint=configuration_fingerprint(cfg))
        else:
            proof = run_backup(cfg, args.input)
            result = {'verified': True, 'scope': proof['scope'], 'run_id': proof['run_id']}
        print(json.dumps(result))
        return 0
    except Exception as error:
        # No provider response, private URL, inventory text, token or subprocess log is printed.
        print(str(error) if isinstance(error, BackupError) else 'Backup configuration or operation failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
