"""Offline deployment safety checks using synthetic records only."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from cryptography.fernet import Fernet

SOURCE = Path(__file__).resolve().parent

class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        shutil.copy(SOURCE / 'initialize.py', self.root)
    def tearDown(self):
        self.temp.cleanup()
    def initialize(self, *hosts):
        return subprocess.run([sys.executable, str(self.root/'initialize.py'), *hosts], capture_output=True)
    def test_private_setup_never_replaces_existing_secrets(self):
        self.assertEqual(self.initialize('core.example.test','connect.example.test').returncode, 0)
        before = (self.root/'.env').read_bytes()
        self.assertEqual((self.root/'.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root/'private').stat().st_mode & 0o777, 0o700)
        self.assertNotEqual(self.initialize('core.example.test','connect.example.test').returncode, 0)
        self.assertEqual(before, (self.root/'.env').read_bytes())
        self.assertIn('BTCO_PUBLICATION_ENABLED=false', (self.root/'private/connector.env').read_text())
    def test_hostname_cannot_inject_compose_configuration(self):
        for host in ['https://example.com','bad\nPASSWORD=oops','${SECRET}.com','same.example.com']:
            self.assertNotEqual(self.initialize(host,'same.example.com').returncode, 0)
        self.assertFalse((self.root/'.env').exists())
    def journal(self, *, wrong_key=False, missing_photo=False, enabled=False, empty=False):
        key = Fernet.generate_key()
        cipher = Fernet(key)
        objects = self.root/'listing-objects'
        objects.mkdir()
        raw = b'synthetic original, not a production photo'
        photo = {'object_key':'photos/synthetic.png','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        (objects/'photos').mkdir()
        if not missing_photo: (objects/'photos/synthetic.png').write_bytes(cipher.encrypt(raw))
        path = self.root/'btco.sqlite3'
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE records(kind TEXT, data BLOB)')
            if not empty: db.execute('INSERT INTO records VALUES(?,?)', ('photo',cipher.encrypt(json.dumps(photo).encode())))
        before = path.read_bytes()
        env = {**os.environ,'BTCO_DB_PATH':str(path),'TOKEN_ENCRYPTION_KEY':(Fernet.generate_key() if wrong_key else key).decode(),
               'EBAY_CLIENT_ID':'synthetic','EBAY_CLIENT_SECRET':'synthetic','EBAY_RUNAME':'synthetic',
               'BTCO_PUBLICATION_ENABLED':'true' if enabled else 'false'}
        result = subprocess.run([sys.executable,str(SOURCE/'verify-journal.py')],env=env,capture_output=True)
        self.assertEqual(before,path.read_bytes())
        self.assertNotIn(key,result.stdout+result.stderr)
        return result
    def test_recovered_records_and_originals_verify_read_only(self):
        result=self.journal()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout)['originals_decrypted'],1)
    def test_wrong_key_fails_closed(self): self.assertNotEqual(self.journal(wrong_key=True).returncode,0)
    def test_missing_original_fails_closed(self): self.assertNotEqual(self.journal(missing_photo=True).returncode,0)
    def test_publication_switch_fails_closed(self): self.assertNotEqual(self.journal(enabled=True).returncode,0)
    def test_empty_journal_fails_closed(self): self.assertNotEqual(self.journal(empty=True).returncode,0)

if __name__ == '__main__': unittest.main()
