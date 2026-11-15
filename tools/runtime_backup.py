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
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, HTTPRedirectHandler
import uuid

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 512 * 1024 * 1024
DEFAULT_MAX_AGE_HOURS = 24
DISK_RESERVE_BYTES = 16 * 1024 * 1024


class BackupError(Exception):
    pass


class PreflightError(BackupError):
    def __init__(self, code):
        self.code = code
        super().__init__('Backup preflight failed: ' + code)


def max_age_hours(cfg):
    return valid_age_hours(cfg.get('max_age_hours', DEFAULT_MAX_AGE_HOURS))


def valid_age_hours(value):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value <= 0):
        raise PreflightError('invalid_age_policy')
    return value


def gzip_bound(size):
    # Conservative allowance for incompressible deflate blocks and headers.
    return size + size // 100 + 1024 * 1024


def resource_limits(cfg):
    export = cfg.get('max_export_bytes', MAX_BYTES)
    restore = cfg.get('max_restore_bytes', MAX_BYTES)
    for value in (export, restore):
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2**53 - 1:
            raise PreflightError('invalid_resource_policy')
    return export, gzip_bound(export), restore


def disk_preflight(work, archive_bytes, restore_bytes):
    # One compressed archive plus one bounded restore. Upload staging is linked,
    # and the source archive is removed before the downloaded copy is created.
    required = archive_bytes + restore_bytes + DISK_RESERVE_BYTES
    try:
        free = shutil.disk_usage(work).free
        if not isinstance(free, int) or free < 0:
            raise OSError()
    except OSError:
        raise PreflightError('disk_unavailable') from None
    if free < required:
        raise PreflightError('disk_insufficient')
    return {'archive_budget_bytes': archive_bytes, 'restore_budget_bytes': restore_bytes,
            'required_free_bytes': required,
            'available_free_bytes': free, 'space_reserved': False}


def utcnow():
    return datetime.now(timezone.utc)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def file_identity(path):
    info = Path(path).lstat()
    if not stat.S_ISREG(info.st_mode):
        raise BackupError('Upload source must remain a regular file')
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def allocated_bytes(path):
    """Allocated blocks, counting each hard-linked inode only once."""
    seen = set()
    def visit(item):
        info = item.lstat()
        identity = (info.st_dev, info.st_ino)
        if identity in seen:
            return 0
        seen.add(identity)
        if stat.S_ISLNK(info.st_mode):
            raise BackupError('Unexpected symlink in backup workspace')
        return info.st_blocks * 512 + (sum(visit(child) for child in item.iterdir())
                                      if stat.S_ISDIR(info.st_mode) else 0)
    return visit(Path(path))


def bounded_copy(source, target, maximum=MAX_BYTES):
    size = 0
    started = time.monotonic()
    while chunk := source.read(1024 * 1024):
        size += len(chunk)
        if size > maximum or time.monotonic() - started > 900:
            raise BackupError('Source exceeds the backup bounds')
        target.write(chunk)
    return size


def compress_copy(source, path, maximum, archive_maximum):
    class BoundedOutput:
        def __init__(self, output):
            self.output, self.bytes = output, 0

        def write(self, data):
            self.bytes += len(data)
            if self.bytes > archive_maximum:
                raise BackupError('Compressed archive exceeds its budget')
            return self.output.write(data)

        def flush(self):
            self.output.flush()

    with path.open('xb') as output:
        with gzip.GzipFile(filename='', mode='wb', fileobj=BoundedOutput(output), mtime=0) as compressed:
            return bounded_copy(source, compressed, maximum)


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
    max_age_hours(cfg)
    resource_limits(cfg)
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


def capture_core(cfg, path, compressed=False):
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
    with opener.open(origin + '/api/backup', timeout=90) as response:
        if response.headers.get_content_type() != 'application/x-ndjson':
            raise BackupError('Core did not return an NDJSON backup')
        maximum, archive_maximum, _ = resource_limits(cfg)
        if compressed:
            compress_copy(response, path, maximum, archive_maximum)
        else:
            with path.open('xb') as output:
                bounded_copy(response, output, maximum)
    return session.get('version')


def source_time(path, now=None, max_age_hours=DEFAULT_MAX_AGE_HOURS, compressed=False):
    valid_age_hours(max_age_hours)
    with (gzip.open(path, 'rb') if compressed else Path(path).open('rb')) as stream:
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
    if age < -300 or age > max_age_hours * 3600:
        raise PreflightError('source_stale_or_invalid_clock')
    return created.isoformat()


def restore_drill(path, work, max_export_bytes=MAX_BYTES, max_restore_bytes=MAX_BYTES):
    result = subprocess.run(['node', str(ROOT / 'tools/restore-drill.mjs'), str(path), '--cleanup',
                            '--max-export-bytes', str(max_export_bytes), '--max-work-bytes', str(max_restore_bytes),
                            *(['--gzip'] if str(path).endswith('.gz') else [])],
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

    def transfer(self, source, destination, command='copyto', maximum=None):
        maximum = resource_limits(self.cfg)[1] if maximum is None else maximum
        result = subprocess.run(['rclone', command, str(source), str(destination),
                                 '--config', self.cfg['rclone_config'], '--immutable', '--checksum',
                                 '--retries', '2', '--low-level-retries', '2',
                                 '--timeout', '90s', '--contimeout', '30s', '--stats', '0',
                                 # Do not allocate an untrusted remote size before
                                 # the byte cutoff or start parallel ranged reads.
                                 '--local-no-preallocate', '--multi-thread-streams', '0',
                                 '--buffer-size', '1Mi',
                                 # Explicit bytes (bare sizes can mean KiB). Allow
                                 # one byte at EOF; exact size/hash still bind readback.
                                 '--max-transfer', str(maximum + 1) + 'B', '--cutoff-mode', 'HARD',
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
            original = file_identity(local)
            os.link(local, staged)  # Same work filesystem; no second payload copy.
            linked = file_identity(local)  # Link creation changes ctime.
            if original[:4] != linked[:4] or linked != file_identity(staged):
                raise BackupError('Upload source changed during staging')
            checksum = digest(staged)
            if file_identity(staged) != linked:
                raise BackupError('Upload source changed during staging')
            self.transfer(directory, self.cfg['remote'].rstrip('/') + '/' + parent, command='copy')
            if (file_identity(local) != linked or file_identity(staged) != linked
                    or digest(staged) != checksum or file_identity(staged) != linked):
                raise BackupError('Upload source changed during transfer')

    def get(self, relative, local, maximum=None):
        if Path(local).exists():
            raise BackupError('Readback destination must be empty')
        self.transfer(self.cfg['remote'].rstrip('/') + '/' + relative, local, maximum=maximum)


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


def run_backup(cfg, input_path=None, store_factory=RcloneStore, drill=restore_drill, input_gzip=False):
    os.umask(0o077)
    state = Path(cfg['state_dir'])
    with run_lock(state), tempfile.TemporaryDirectory(prefix='capture-', dir=state) as directory:
        work = Path(directory)
        run_id = utcnow().strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:12]
        phase = 'preflight'
        atomic_json(state / 'last-attempt.json', {'at': utcnow().isoformat(), 'status': 'running', 'run_id': run_id})
        try:
            age_limit = max_age_hours(cfg)
            export_limit, archive_limit, restore_limit = resource_limits(cfg)
            archive = work / 'core.ndjson.gz'
            version = None
            if input_gzip and not input_path:
                raise PreflightError('compressed_input_required')
            if input_path:
                if Path(input_path).is_symlink() or not Path(input_path).is_file():
                    raise PreflightError('input_not_regular')
                size = Path(input_path).stat().st_size
                if size <= 0 or size > (archive_limit if input_gzip else export_limit):
                    raise PreflightError('input_size_out_of_bounds')
                source_time(input_path, max_age_hours=age_limit, compressed=input_gzip)
                archive_budget = size if input_gzip else gzip_bound(size)
            else:
                archive_budget = archive_limit
            preflight = disk_preflight(work, archive_budget, restore_limit)
            peak_allocated = 0
            def check_work():
                nonlocal peak_allocated
                allocated = allocated_bytes(work)
                peak_allocated = max(peak_allocated, allocated)
                if allocated > preflight['required_free_bytes']:
                    raise PreflightError('workspace_budget_exceeded')
                return allocated
            check_work()
            phase = 'capture'
            if input_path:
                with Path(input_path).open('rb') as src:
                    if input_gzip:
                        with archive.open('xb') as dst:
                            copied = bounded_copy(src, dst, archive_budget)
                    else:
                        copied = compress_copy(src, archive, size, archive_budget)
                if copied != size:
                    raise PreflightError('input_changed_size')
            else:
                version = capture_core(cfg, archive, compressed=True)
            created_at = source_time(archive, max_age_hours=age_limit, compressed=True)
            check_work()
            remote = store_factory(cfg, work)
            phase = 'source_restore'
            def verify(path):
                if drill is restore_drill:
                    return drill(path, work, max_export_bytes=export_limit, max_restore_bytes=restore_limit)
                return drill(path, work)
            before = verify(archive)
            check_work()
            checksum = digest(archive)
            archive_size = archive.stat().st_size
            relative = 'core-logical/' + run_id + '/core.ndjson.gz'
            phase = 'upload'
            source_time(archive, max_age_hours=age_limit, compressed=True)
            remote.put(archive, relative)
            check_work()
            archive.unlink()  # Last-success is separate; readback must earn a new success.
            phase = 'download'
            retrieved = work / 'readback.ndjson.gz'
            remote.get(relative, retrieved, maximum=archive_size)
            check_work()
            if retrieved.stat().st_size != archive_size or digest(retrieved) != checksum:
                raise BackupError('Off-site checksum differs')
            phase = 'remote_restore'
            after = verify(retrieved)
            check_work()
            if before != after:
                raise BackupError('Off-site restore differs from source')
            receipt = {'schema': 1, 'scope': 'core-logical-only', 'run_id': run_id,
                       'source_created_at': created_at, 'verified_at': utcnow().isoformat(),
                       'configuration_fingerprint': configuration_fingerprint(cfg),
                       'core_version': version, 'archive': relative, 'sha256': checksum,
                       'bytes': archive_size, 'remote_readback_verified': True,
                       'preflight': preflight,
                       'workspace_checkpoint_peak_bytes': peak_allocated,
                       'max_export_bytes': export_limit, 'max_restore_bytes': restore_limit,
                       'max_age_hours': age_limit, 'rpo_guaranteed': False,
                       'restore': after,
                       'not_included': ['connector database/originals/keys', 'Core sessions/credentials',
                                        'legacy D1', 'Git history', 'hosting configuration']}
            phase = 'receipt'
            receipt_path = work / 'receipt.json'
            atomic_json(receipt_path, receipt)
            receipt_relative = 'core-logical/' + run_id + '/receipt.json'
            remote.put(receipt_path, receipt_relative)
            check_work()
            receipt_readback = work / 'receipt-readback.json'
            remote.get(receipt_relative, receipt_readback, maximum=receipt_path.stat().st_size)
            check_work()
            if digest(receipt_path) != digest(receipt_readback):
                raise BackupError('Off-site receipt differs')
            source_time(retrieved, max_age_hours=age_limit, compressed=True)
            atomic_json(state / 'last-success.json', receipt)
            atomic_json(state / 'last-attempt.json', {'at': utcnow().isoformat(), 'status': 'verified', 'run_id': run_id})
            return receipt
        except Exception as error:
            code = error.code if isinstance(error, PreflightError) else 'operation_failed'
            atomic_json(state / 'last-attempt.json', {'at': utcnow().isoformat(), 'status': 'failed',
                        'run_id': run_id, 'phase': phase, 'failure_code': code})
            raise BackupError('Backup failed during ' + phase + '; last verified backup retained') from None


def check_status(state, now=None, fingerprint=None, max_age_hours=DEFAULT_MAX_AGE_HOURS):
    valid_age_hours(max_age_hours)
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
                or age < -300 or source_age < -300 or max(age, source_age) > max_age_hours * 3600):
            raise ValueError('Unverified, failed or stale')
        return {'healthy': True, 'scope': 'core-logical-only', 'verified_at': proof['verified_at'],
                'max_age_hours': max_age_hours, 'source_age_seconds': source_age,
                'verification_age_seconds': age, 'within_24_hour_target': max(age, source_age) <= 24 * 3600,
                'rpo_guaranteed': False}
    except (OSError, KeyError, ValueError, TypeError):
        raise BackupError('Core backup is missing, stale or the latest attempt failed') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'check'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--input', help='Fresh manually exported Core NDJSON; never used by the timer')
    parser.add_argument('--input-gzip', action='store_true', help='Input is a complete gzip-compressed Core NDJSON export')
    args = parser.parse_args()
    try:
        cfg = load_config(args.config)
        if args.action == 'check':
            result = check_status(cfg['state_dir'], fingerprint=configuration_fingerprint(cfg),
                                  max_age_hours=max_age_hours(cfg))
        else:
            proof = run_backup(cfg, args.input, input_gzip=args.input_gzip)
            result = {'verified': True, 'scope': proof['scope'], 'run_id': proof['run_id']}
        print(json.dumps(result))
        return 0
    except Exception as error:
        # No provider response, private URL, inventory text, token or subprocess log is printed.
        print(str(error) if isinstance(error, BackupError) else 'Backup configuration or operation failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
