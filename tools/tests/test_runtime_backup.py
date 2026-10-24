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
import unittest
from unittest.mock import patch

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

    def get(self, relative, local):
        self.calls.append(('get', relative))
        if self.fail == 'download':
            raise RuntimeError('SENSITIVE provider error')
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
        readback = self.root / 'immutable-readback'
        store.get('immutable-test', readback)
        self.assertEqual(readback.read_text(), 'A')
        with self.assertRaises(b.BackupError):
            store.get('immutable-test', a)


if __name__ == '__main__':
    unittest.main()
