import contextlib
from datetime import timedelta
import gzip
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('runtime_backup', ROOT / 'tools/runtime_backup.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class LocalStore:
    def __init__(self, root, fail=None):
        self.root, self.fail = root, fail
        self.calls = []

    def put(self, local, relative):
        self.calls.append(('put', relative))
        if self.fail == 'upload' or self.fail == 'receipt' and relative.endswith('receipt.json'):
            raise RuntimeError('SENSITIVE provider error must not escape')
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as out, Path(local).open('rb') as src:
            shutil.copyfileobj(src, out)

    def get(self, relative, local, maximum=None):
        self.calls.append(('get', relative))
        if self.fail == 'download':
            raise RuntimeError('SENSITIVE provider error')
        if maximum is not None and (self.root / relative).stat().st_size > maximum:
            raise RuntimeError('Readback exceeds expected bytes')
        shutil.copyfile(self.root / relative, local)
        if self.fail == 'corrupt' or self.fail == 'receipt-corrupt' and relative.endswith('receipt.json'):
            with Path(local).open('ab') as out:
                out.write(b'changed')


class BackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.fixture = Path(cls.temp.name) / 'fixture.ndjson'
        subprocess.run(['node', str(ROOT / 'tools/tests/runtime-backup-fixture.mjs'), str(cls.fixture)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.remote = LocalStore(self.root / 'remote')
        self.cfg = {'state_dir': str(self.state)}

    def run_backup(self, remote=None, drill=b.restore_drill, source=None):
        return b.run_backup(self.cfg, source or self.fixture,
                            store_factory=lambda cfg, work: remote or self.remote, drill=drill)

    def test_full_round_trip_restores_current_and_retired_originals(self):
        receipt = self.run_backup()
        self.assertEqual(receipt['restore']['photos'], 2)
        self.assertTrue(receipt['restore']['nonEmptyRestoreRejected'])
        self.assertEqual(receipt['scope'], 'core-logical-only')
        self.assertTrue(b.check_status(self.state, fingerprint=b.configuration_fingerprint(self.cfg))['healthy'])
        with self.assertRaises(b.BackupError):
            b.check_status(self.state, fingerprint=b.configuration_fingerprint({**self.cfg, 'remote': 'different:destination'}))
        self.assertEqual([x[0] for x in self.remote.calls], ['put', 'get', 'put', 'get'])
        self.assertFalse(list(self.state.glob('capture-*')), 'restore and working data must be cleaned')
        first = receipt['archive']
        second = self.run_backup()['archive']
        self.assertNotEqual(first, second)
        self.assertTrue((self.remote.root / first).is_file(), 'old backup is retained')

    def test_transfer_or_receipt_failure_never_replaces_last_success(self):
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        for failure in ['upload', 'download', 'corrupt', 'receipt', 'receipt-corrupt']:
            with self.subTest(failure=failure):
                remote = LocalStore(self.remote.root, failure)
                with self.assertRaises(b.BackupError) as error:
                    self.run_backup(remote=remote)
                self.assertNotIn('SENSITIVE', str(error.exception))
                self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
                with self.assertRaises(b.BackupError):
                    b.check_status(self.state)
                self.assertFalse(list(self.state.glob('capture-*')))

    def test_truncated_or_corrupt_source_is_rejected_before_any_upload(self):
        original = self.fixture.read_text().splitlines(True)
        for records in [original[:-1], original + [original[1]], original[:1] + [original[1].replace('synthetic-0', 'different')] + original[2:]]:
            corrupt = self.root / 'bad.ndjson'
            corrupt.write_text(''.join(records))
            with self.assertRaises(b.BackupError):
                self.run_backup(source=corrupt)
            self.assertEqual(self.remote.calls, [])
            self.assertFalse((self.state / 'last-success.json').exists())

    def test_remote_restore_failure_is_not_success(self):
        count = 0
        def drill(path, work):
            nonlocal count
            count += 1
            if count == 2:
                raise RuntimeError('restore unavailable')
            return b.restore_drill(path, work)
        with self.assertRaises(b.BackupError):
            self.run_backup(drill=drill)
        self.assertFalse((self.state / 'last-success.json').exists())
        self.assertEqual(len(self.remote.calls), 2)

    def test_missing_stale_failed_and_future_status_are_not_healthy(self):
        with self.assertRaises(b.BackupError):
            b.check_status(self.state)
        receipt = self.run_backup()
        attempt = json.loads((self.state / 'last-attempt.json').read_text())
        b.atomic_json(self.state / 'last-attempt.json', {**attempt, 'status': 'running'})
        with self.assertRaises(b.BackupError):
            b.check_status(self.state)
        b.atomic_json(self.state / 'last-attempt.json', attempt)
        now = b.utcnow()
        with self.assertRaises(b.BackupError):
            b.check_status(self.state, now=now + timedelta(hours=27))
        with self.assertRaises(b.BackupError):
            b.check_status(self.state, now=now - timedelta(hours=1))
        # Re-uploading an old source cannot reset the source freshness clock.
        receipt['source_created_at'] = (now - timedelta(hours=27)).isoformat()
        b.atomic_json(self.state / 'last-success.json', receipt)
        with self.assertRaises(b.BackupError):
            b.check_status(self.state)

    def test_capture_rejects_unconfigured_source_http_and_redirects(self):
        for source in [{}, {'mode': 'existing-open-core', 'origin': 'http://example.invalid'},
                       {'mode': 'existing-open-core', 'origin': 'https://user:secret@example.invalid'}]:
            with self.assertRaises(b.BackupError):
                b.capture_core({'source': source}, self.root / 'out')
        with self.assertRaises(b.BackupError):
            b.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.invalid')

    def test_capture_uses_only_session_and_backup_reads_and_requires_open_access(self):
        from io import BytesIO
        from email.message import Message
        class Response(BytesIO):
            def __init__(self, data, content_type='application/json'):
                super().__init__(data)
                self.headers = Message()
                self.headers['Content-Type'] = content_type
        class Opener:
            def __init__(self, authenticated=True, open_access=True, mime='application/x-ndjson'):
                self.calls = []
                self.authenticated, self.open_access, self.mime = authenticated, open_access, mime
            def open(inner, url, timeout):
                inner.calls.append(url)
                if url.endswith('/api/session'):
                    return Response(json.dumps({'authenticated': inner.authenticated, 'loginRequired': not inner.open_access, 'version': 'synthetic'}).encode())
                return Response(self.fixture.read_bytes(), inner.mime)
        config = {'source': {'mode': 'existing-open-core', 'origin': 'https://synthetic.example.invalid'}}
        opener = Opener()
        with patch.object(b, 'build_opener', return_value=opener):
            self.assertEqual(b.capture_core(config, self.root / 'captured.ndjson'), 'synthetic')
        self.assertEqual(opener.calls, ['https://synthetic.example.invalid/api/session', 'https://synthetic.example.invalid/api/backup'])
        self.assertEqual((self.root / 'captured.ndjson').read_bytes(), self.fixture.read_bytes())
        for opener in [Opener(authenticated=False), Opener(open_access=False), Opener(mime='text/html')]:
            with patch.object(b, 'build_opener', return_value=opener), self.assertRaises(b.BackupError):
                b.capture_core(config, self.root / 'rejected.ndjson')

    def test_stale_source_never_uploads(self):
        rows = self.fixture.read_text().splitlines()
        manifest = json.loads(rows[0])
        manifest['createdAt'] = (b.utcnow() - timedelta(days=2)).isoformat()
        rows[0] = json.dumps(manifest)
        old = self.root / 'old.ndjson'
        old.write_text('\n'.join(rows) + '\n')
        with self.assertRaises(b.BackupError):
            self.run_backup(source=old)
        self.assertEqual(self.remote.calls, [])

    def test_preflight_failures_have_no_capture_restore_or_transfer_side_effects(self):
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        rows = self.fixture.read_text().splitlines()
        manifest = json.loads(rows[0])
        manifest['createdAt'] = (b.utcnow() - timedelta(hours=25)).isoformat()
        rows[0] = json.dumps(manifest)
        stale = self.root / 'SENSITIVE-stale.ndjson'
        stale.write_text('\n'.join(rows) + '\n')
        oversized = self.root / 'SENSITIVE-oversized.ndjson'
        with oversized.open('wb') as output:
            output.truncate(b.MAX_BYTES + 1)  # Sparse synthetic file, not a large export.
        required = b.gzip_bound(self.fixture.stat().st_size) + b.MAX_BYTES + b.DISK_RESERVE_BYTES
        cases = [
            (stale, None, 'source_stale_or_invalid_clock'),
            (oversized, None, 'input_size_out_of_bounds'),
            (self.fixture, OSError('SENSITIVE disk path/provider detail'), 'disk_unavailable'),
            (self.fixture, SimpleNamespace(free=required - 1), 'disk_insufficient'),
            (None, SimpleNamespace(free=0), 'disk_insufficient'),
        ]
        for source, disk, code in cases:
            with self.subTest(code=code, manual=source is not None):
                with patch.object(b.shutil, 'disk_usage') as usage, \
                        patch.object(b, 'bounded_copy') as copy, \
                        patch.object(b, 'capture_core') as capture, \
                        patch.object(b, 'restore_drill') as drill, \
                        patch.object(b, 'RcloneStore') as factory:
                    if isinstance(disk, Exception):
                        usage.side_effect = disk
                    else:
                        usage.return_value = disk
                    with self.assertRaises(b.BackupError) as error:
                        b.run_backup(self.cfg, source, store_factory=factory, drill=drill)
                    for operation in (copy, capture, drill, factory):
                        operation.assert_not_called()
                    if source in (stale, oversized):
                        usage.assert_not_called()
                attempt = json.loads((self.state / 'last-attempt.json').read_text())
                self.assertEqual(attempt['failure_code'], code)
                self.assertEqual(attempt['phase'], 'preflight')
                self.assertEqual(attempt['status'], 'failed')
                self.assertNotIn('SENSITIVE', json.dumps(attempt) + str(error.exception))
                self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
                self.assertFalse(list(self.state.glob('capture-*')))
                with self.assertRaises(b.BackupError):
                    b.check_status(self.state)

    def test_disk_preflight_boundary_and_receipt_are_explicit(self):
        size = self.fixture.stat().st_size
        required = b.gzip_bound(size) + b.MAX_BYTES + b.DISK_RESERVE_BYTES
        with patch.object(b.shutil, 'disk_usage', return_value=SimpleNamespace(free=required)):
            receipt = self.run_backup()
        self.assertEqual(receipt['preflight'], {'archive_budget_bytes': b.gzip_bound(size),
                         'restore_budget_bytes': b.MAX_BYTES,
                         'required_free_bytes': required, 'available_free_bytes': required,
                         'space_reserved': False})
        self.assertEqual(receipt['max_age_hours'], 24)
        self.assertFalse(receipt['rpo_guaranteed'])

    def test_24_hour_boundary_and_explicit_relaxed_policy_do_not_claim_rpo(self):
        receipt = self.run_backup()
        created = b.datetime.fromisoformat(receipt['source_created_at'])
        self.assertTrue(b.check_status(self.state, now=created + timedelta(hours=24))['within_24_hour_target'])
        with self.assertRaises(b.BackupError):
            b.check_status(self.state, now=created + timedelta(hours=24, microseconds=1))
        relaxed = b.check_status(self.state, now=created + timedelta(hours=25), max_age_hours=26)
        self.assertTrue(relaxed['healthy'])
        self.assertEqual(relaxed['max_age_hours'], 26)
        self.assertFalse(relaxed['within_24_hour_target'])
        self.assertFalse(relaxed['rpo_guaranteed'])
        b.source_time(self.fixture, now=created + timedelta(hours=24))
        with self.assertRaises(b.BackupError):
            b.source_time(self.fixture, now=created + timedelta(hours=24, microseconds=1))
        b.source_time(self.fixture, now=created + timedelta(hours=25), max_age_hours=26)
        for value in [0, -1, True, '24', float('inf'), float('nan')]:
            with self.subTest(value=value), self.assertRaises(b.BackupError):
                b.max_age_hours({'max_age_hours': value})

    def test_source_expiring_during_restore_never_uploads_or_replaces_success(self):
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        self.remote.calls.clear()
        created = b.datetime.fromisoformat(b.source_time(self.fixture))
        clock = [created + timedelta(hours=23)]
        def drill(source, work):
            proof = b.restore_drill(source, work)
            clock[0] = created + timedelta(hours=25)
            return proof
        with patch.object(b, 'utcnow', side_effect=lambda: clock[0]), self.assertRaises(b.BackupError):
            self.run_backup(drill=drill)
        self.assertEqual(self.remote.calls, [])
        self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)

    def test_compressed_logical_export_over_512_mib_is_bounded_and_verified(self):
        # 513 MiB of legal bounded whitespace records exercises logical growth
        # without allocating or writing a 513 MiB source/restore staging file.
        large = self.root / 'large.ndjson.gz'
        rows = self.fixture.read_bytes().splitlines(keepends=True)
        padding = b' ' * (1024 * 1024 - 1) + b'\n'
        with gzip.open(large, 'wb') as out:
            out.write(b''.join(rows[:-1]))
            for _ in range(513):
                out.write(padding)
            out.write(rows[-1])
        logical_bytes = len(self.fixture.read_bytes()) + 513 * len(padding)
        self.assertLess(large.stat().st_size, 2 * 1024 * 1024)
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        self.remote.calls.clear()
        with self.assertRaises(b.BackupError):
            b.run_backup(self.cfg, large, input_gzip=True,
                         store_factory=lambda cfg, work: self.remote)
        self.assertEqual(self.remote.calls, [])
        self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
        cfg = {**self.cfg, 'max_export_bytes': logical_bytes, 'max_restore_bytes': 128 * 1024 * 1024}
        actual_run = subprocess.run
        resources = []
        def bounded_node(command, **kwargs):
            if command[0] == 'node':
                command = [command[0], '--max-old-space-size=96', *command[1:]]
            result = actual_run(command, **kwargs)
            if command[0] == 'node' and result.returncode == 0:
                resources.append(json.loads(result.stdout))
            return result
        with patch.object(b.subprocess, 'run', side_effect=bounded_node):
            receipt = b.run_backup(cfg, large, input_gzip=True,
                                   store_factory=lambda cfg, work: self.remote)
        self.assertEqual(len(resources), 2)
        self.assertTrue(receipt['remote_readback_verified'])
        self.assertEqual(receipt['restore']['photos'], 2)
        self.assertLess(receipt['preflight']['required_free_bytes'], 150 * 1024 * 1024)
        self.assertEqual(receipt['max_export_bytes'], logical_bytes)
        print(json.dumps({'syntheticLogicalBytes': logical_bytes, 'compressedBytes': large.stat().st_size,
                          'requiredFreeBytes': receipt['preflight']['required_free_bytes'],
                          'nodeHeapLimitMiB': 96, 'restoreMaxRssKiB': [r['maxRssKiB'] for r in resources],
                          'restoredFileBytes': [r['restoredFileBytes'] for r in resources],
                          'restoredAllocatedBytes': [r['restoredAllocatedBytes'] for r in resources]}))
        self.assertFalse(list(self.state.glob('capture-*')))

    def test_restore_budget_failure_and_invalid_resource_policies_keep_last_success(self):
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        self.remote.calls.clear()
        with self.assertRaises(b.BackupError):
            b.run_backup({**self.cfg, 'max_restore_bytes': 1}, self.fixture,
                         store_factory=lambda cfg, work: self.remote)
        self.assertEqual(self.remote.calls, [])
        self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
        for value in [0, -1, True, '1024', 2**53, 1.5]:
            with self.subTest(value=value), self.assertRaises(b.BackupError):
                b.resource_limits({'max_export_bytes': value})

    def test_hardlink_mutation_during_upload_preserves_previous_good(self):
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        for mutate_back in (False, True):
            observed = []
            class MutatingStore(b.RcloneStore):
                def transfer(inner, directory, destination, **kwargs):
                    staged = next(Path(directory).iterdir())
                    source = Path(inner.work) / 'core.ndjson.gz'
                    self.assertEqual(source.stat().st_ino, staged.stat().st_ino)
                    original = staged.read_bytes()
                    staged.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
                    if mutate_back:
                        staged.write_bytes(original)
                    observed.append(True)
            with self.subTest(mutate_back=mutate_back), self.assertRaises(b.BackupError):
                b.run_backup({**self.cfg, 'remote': 'synthetic:unused'}, self.fixture,
                             store_factory=MutatingStore)
            self.assertEqual(observed, [True])
            self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
            self.assertEqual(json.loads((self.state / 'last-attempt.json').read_text())['phase'], 'upload')
            self.assertFalse(list(self.state.glob('capture-*')))

    def test_actual_workspace_overrun_is_rejected_and_hardlinks_count_once(self):
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        cfg = {**self.cfg, 'max_restore_bytes': 2 * 1024 * 1024}
        class ExcessWork(LocalStore):
            def put(inner, local, relative):
                # Simulate an unexpected allocated scratch file, not a sparse file.
                with (Path(local).parent / 'unexpected').open('wb') as out:
                    for _ in range(21):
                        out.write(b'x' * 1024 * 1024)
        with self.assertRaises(b.BackupError):
            b.run_backup(cfg, self.fixture, store_factory=lambda cfg, work: ExcessWork(self.remote.root))
        self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
        attempt = json.loads((self.state / 'last-attempt.json').read_text())
        self.assertEqual(attempt['failure_code'], 'workspace_budget_exceeded')
        self.assertFalse(list(self.state.glob('capture-*')))
        links = self.root / 'links'; links.mkdir()
        (links / 'first').write_bytes(b'x' * 8192)
        before = b.allocated_bytes(links)
        os.link(links / 'first', links / 'second')
        self.assertEqual(b.allocated_bytes(links), before)

    def test_incompressible_photos_workspace_peak_disk_and_rss(self):
        if not shutil.which('rclone'):
            if os.environ.get('BTCO_REQUIRE_RCLONE_TEST') == '1':
                self.fail('Representative acceptance requires real rclone')
            self.skipTest('rclone not installed locally; required in CI')
        source = self.root / 'representative.ndjson'
        subprocess.run(['node', str(ROOT / 'tools/tests/runtime-backup-fixture.mjs'),
                        str(source), '--representative'], check=True, capture_output=True)
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        self.remote.calls.clear()
        # A genuine growing-object budget failure must occur before any upload.
        with self.assertRaises(b.BackupError):
            b.run_backup({**self.cfg, 'max_restore_bytes': 8 * 1024 * 1024}, source,
                         store_factory=lambda cfg, work: self.remote)
        self.assertEqual(self.remote.calls, [])
        self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
        self.assertFalse(list(self.state.glob('capture-*')))
        cfg = {**self.cfg, 'max_export_bytes': source.stat().st_size,
               'max_restore_bytes': 64 * 1024 * 1024}
        rclone = self.root / 'representative-rclone.conf'
        rclone.write_text('[synthetic]\ntype = local\n'); rclone.chmod(0o600)
        cfg.update(remote='synthetic:' + str(self.root / 'representative-remote'), rclone_config=str(rclone))
        resources, samples = [], []
        stop = threading.Event()
        def sample():
            while not stop.is_set():
                for directory in self.state.glob('capture-*'):
                    try:
                        samples.append(b.allocated_bytes(directory))
                    except FileNotFoundError:
                        pass  # Successful drill cleanup races this external sampler.
                stop.wait(0.005)
        actual_run = subprocess.run
        def bounded_node(command, **kwargs):
            if command[0] == 'node':
                command = ['node', '--max-old-space-size=96', *command[1:]]
            result = actual_run(command, **kwargs)
            if command[0] == 'node' and result.returncode == 0:
                resources.append(json.loads(result.stdout))
            return result
        monitor = threading.Thread(target=sample, daemon=True); monitor.start()
        try:
            with patch.object(b.subprocess, 'run', side_effect=bounded_node):
                receipt = b.run_backup(cfg, source)
        finally:
            stop.set(); monitor.join()
        self.assertEqual(len(resources), 2)
        self.assertEqual(receipt['restore']['photos'], 12)
        self.assertEqual(receipt['restore']['drafts'], 300)
        self.assertGreater(receipt['bytes'], 27 * 1024 * 1024)
        self.assertGreater(receipt['bytes'] / source.stat().st_size, 0.70)
        self.assertGreater(max(samples), receipt['bytes'] + 28 * 1024 * 1024)
        self.assertLess(max(samples), receipt['preflight']['required_free_bytes'])
        for resource in resources:
            self.assertGreaterEqual(resource['peakAllocatedBytes'], resource['restoredAllocatedBytes'])
            self.assertLessEqual(resource['peakAllocatedBytes'], cfg['max_restore_bytes'])
        print(json.dumps({'fixture': '12 unique noisy PNGs and 300 random-note drafts',
                          'transport': 'real rclone local backend',
                          'logicalBytes': source.stat().st_size, 'compressedBytes': receipt['bytes'],
                          'runnerPeakAllocatedBytesSampled5ms': max(samples),
                          'restorePeakAllocatedBytesAtWriteBoundaries': [r['peakAllocatedBytes'] for r in resources],
                          'restoreMaxRssKiB': [r['maxRssKiB'] for r in resources],
                          'nodeHeapLimitMiB': 96, 'requiredFreeBytes': receipt['preflight']['required_free_bytes']}))
        self.assertFalse(list(self.state.glob('capture-*')))

    def test_compressed_corruption_and_staging_never_replace_last_good_copy(self):
        self.run_backup()
        prior = (self.state / 'last-success.json').read_bytes()
        self.remote.calls.clear()
        path = self.root / 'truncated.gz'
        path.write_bytes(gzip.compress(self.fixture.read_bytes())[:-8])
        with self.assertRaises(b.BackupError):
            b.run_backup(self.cfg, path, input_gzip=True, store_factory=lambda cfg, work: self.remote)
        self.assertEqual(self.remote.calls, [])
        self.assertEqual((self.state / 'last-success.json').read_bytes(), prior)
        inner = self.remote
        class InspectStore:
            def __init__(self, work):
                self.work = work
            def put(self, local, relative):
                self_files = list(self.work.glob('*.gz'))
                assert len(self_files) == 1
                assert not list(self.work.glob('*.ndjson')), 'no uncompressed payload staging'
                inner.put(local, relative)
            def get(self, relative, local, maximum=None):
                if relative.endswith('.gz'):
                    assert not list(self.work.glob('*.gz')), 'source archive must be removed before readback'
                assert isinstance(maximum, int) and maximum > 0
                inner.get(relative, local, maximum=maximum)
        b.run_backup(self.cfg, self.fixture, store_factory=lambda cfg, work: InspectStore(work))

    def test_overlap_and_bounds_are_rejected(self):
        with b.run_lock(self.state):
            with self.assertRaisesRegex(b.BackupError, 'already running'):
                self.run_backup()
        import io
        with self.assertRaises(b.BackupError):
            b.bounded_copy(io.BytesIO(b'12345'), io.BytesIO(), maximum=4)
        self.assertEqual(self.remote.calls, [])

    def test_restore_environment_excludes_live_credentials(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'secret', 'OPENAI_API_KEY': 'secret', 'EBAY_CLIENT_SECRET': 'secret'}):
            env = b.clean_environment(self.root)
        self.assertEqual(set(env), {'PATH', 'TMPDIR', 'LANG'})

    def test_config_must_name_remote_and_owner_only_files(self):
        config = self.root / 'config.json'
        rclone = self.root / 'rclone.conf'
        rclone.write_text('[synthetic]\ntype=local\n')
        rclone.chmod(0o600)
        cfg = {'schema': 1, 'state_dir': str(self.state), 'remote': 'synthetic:backups', 'rclone_config': str(rclone)}
        config.write_text(json.dumps(cfg))
        config.chmod(0o600)
        self.assertEqual(b.load_config(config), cfg)
        config.chmod(0o644)
        with self.assertRaises(b.BackupError):
            b.load_config(config)
        config.chmod(0o600)
        cfg['remote'] = '/local/path'
        config.write_text(json.dumps(cfg))
        with self.assertRaises(b.BackupError):
            b.load_config(config)

    def test_real_rclone_round_trip_when_installed(self):
        if not shutil.which('rclone'):
            if os.environ.get('BTCO_REQUIRE_RCLONE_TEST') == '1':
                self.fail('rclone acceptance requires the real executable')
            self.skipTest('rclone not installed locally; required in CI')
        config = self.root / 'rclone.conf'
        config.write_text('[synthetic]\ntype = local\n')
        config.chmod(0o600)
        cfg = {**self.cfg, 'remote': 'synthetic:' + str(self.root / 'offsite'), 'rclone_config': str(config)}
        proof = b.run_backup(cfg, self.fixture)
        self.assertTrue(proof['remote_readback_verified'])
        self.assertTrue(b.check_status(self.state)['healthy'])
        # The same transport must refuse to replace a different existing object.
        a, z = self.root / 'a', self.root / 'z'
        a.write_text('A'); z.write_text('different bytes')
        store = b.RcloneStore(cfg, self.root)
        store.put(a, 'immutable-test')
        with self.assertRaises(b.BackupError):
            store.put(z, 'immutable-test')
        z.write_text('B')
        with self.assertRaises(b.BackupError):
            store.put(z, 'immutable-test')
        store.put(a, 'immutable-test')  # Identical retries remain safe.
        big = self.root / 'synthetic-larger'
        big.write_bytes(b'x' * 1024 * 1024)
        store.put(big, 'readback-limit')
        limited = self.root / 'bounded-readback'
        with self.assertRaises(b.BackupError):
            store.get('readback-limit', limited, maximum=16)
        if limited.exists():
            self.assertLessEqual(limited.stat().st_size, 17)
        readback = self.root / 'immutable-readback'
        store.get('immutable-test', readback)
        self.assertEqual(readback.read_text(), 'A')
        with self.assertRaises(b.BackupError):
            store.get('immutable-test', a)


if __name__ == '__main__':
    unittest.main()
