"""Real SQLite/photo recovery with all network access forbidden."""
import base64
from contextlib import closing
import hashlib
import io
import json
from pathlib import Path
import socket
import sqlite3
from types import SimpleNamespace

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
import pytest

from btco_ebay import recovery as r
from btco_ebay.photos import PhotoStore
from btco_ebay.receipts import ReceiptSigner
from btco_ebay.store import Store, digest


@pytest.fixture
def recovery_source(tmp_path, monkeypatch):
    def denied(*args, **kwargs):
        raise AssertionError('Recovery must not use network access')
    monkeypatch.setattr(socket, 'create_connection', denied)
    monkeypatch.setattr(socket.socket, 'connect', denied)
    tmp_path.chmod(0o700)
    live = tmp_path / 'live'
    live.mkdir(mode=0o700)
    key = Fernet.generate_key().decode()
    store = Store(str(live / 'live.sqlite3'), key)
    photos = PhotoStore(store)
    output = io.BytesIO()
    Image.new('RGB', (600, 800), 'blue').save(output, format='JPEG')
    raw = output.getvalue()
    photo = photos.put('synthetic-seller', raw, hashlib.sha256(raw).hexdigest(), 'front')
    signer = ReceiptSigner(store)
    store.put('publication', 'synthetic-seller:123456789012', {'seller_id':'synthetic-seller', 'item_id':'123456789012'})
    signed = signer.export('synthetic-seller', '123456789012')
    store.put('batch', 'saved-batch', {'seller':'synthetic-seller', 'entries':[{'photo':photo.model_dump()}], 'state':'partial'})
    store.put('publication-job', 'uncertain-job', {'seller':'synthetic-seller','state':'outcome_unknown','offer_id':'123','draft_id':'saved-draft'})
    store.put('draft', 'saved-draft', {'sku':'CDP-EXACT-SKU','state':'approved','revision':4,'photos':[photo.model_dump()]})
    store.put('grant', 'family', {'user_id':'synthetic-seller','refresh_token':'synthetic-secret'})
    # Expired rows and unrelated tables must survive untouched. Store's normal
    # constructor/transactions would delete the former, so recovery avoids it.
    with closing(sqlite3.connect(store.path)) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE extra_ledger (id TEXT PRIMARY KEY, value TEXT)')
        db.execute("INSERT INTO extra_ledger VALUES ('1','retained')")
        db.execute('INSERT INTO records VALUES (?,?,?,?,?)', ('expired',digest('old'),store.cipher.encrypt(b'{"retained":true}'),1,None))
        db.commit()
    credentials={'TOKEN_ENCRYPTION_KEY':key,'EBAY_CLIENT_ID':'synthetic-id','EBAY_CLIENT_SECRET':'synthetic-secret',
                 'EBAY_RUNAME':'synthetic-runame','PUBLIC_URL':'https://example.invalid','BTCO_PUBLICATION_ENABLED':'true',
                 'OPENAI_API_KEY':'must-not-copy','BTCO_WORKER_ARCHIVE_KEY':Fernet.generate_key().decode()}
    return SimpleNamespace(root=tmp_path, live=live, store=store, photos=photos, photo=photo,
                           raw=raw, signed=signed, signer=signer, credentials=credentials,
                           package=tmp_path/'package', keys=tmp_path/'keys.json')


def capture(s):
    return r.capture(s.store.path,s.photos.root,s.package,s.keys,s.credentials)


def rows(path, table='records'):
    with closing(sqlite3.connect(Path(path).as_uri()+'?mode=ro',uri=True)) as db:
        return db.execute('SELECT * FROM '+table+' ORDER BY 1,2').fetchall()


def test_round_trip_preserves_every_record_original_and_signing_identity(recovery_source):
    s=recovery_source
    before=rows(s.store.path)
    receipt=capture(s)
    assert not receipt['offsite_verified']
    assert rows(s.store.path)==before
    result=r.restore(s.package,s.keys,s.root/'restored')
    assert result['offline_only'] and not result['server_started'] and not result['publication_enabled']
    restored=s.root/'restored'
    assert rows(restored/'state.sqlite3')==before
    assert rows(restored/'state.sqlite3','extra_ledger')==[('1','retained')]
    assert s.store.cipher.decrypt((restored/'listing-objects'/s.photo.object_key).read_bytes())==s.raw
    signing=next(json.loads(s.store.cipher.decrypt(row[2])) for row in before if row[0]=='signing-key')
    key=Ed25519PrivateKey.from_private_bytes(base64.b64decode(signing['private_key']))
    assert hashlib.sha256(key.public_key().public_bytes_raw()).hexdigest()==s.signer.descriptor['key_id']
    from btco_ebay.receipts import DOMAIN
    key.public_key().verify(base64.b64decode(s.signed['signature_b64']),DOMAIN+base64.b64decode(s.signed['payload_b64']))
    secrets=json.loads(s.keys.read_text())['configuration']
    assert 'OPENAI_API_KEY' not in secrets and 'BTCO_PUBLICATION_ENABLED' not in secrets
    defaults=json.loads((restored/'recovery-defaults.json').read_text())
    assert defaults['BTCO_PUBLICATION_ENABLED']=='false' and defaults['BTCO_AI_BUDGET_USD']=='0'
    assert s.keys.stat().st_mode & 0o077 == 0
    with pytest.raises(r.RecoveryError): r.restore(s.package,s.keys,restored)
    with pytest.raises(r.RecoveryError): capture(s)


@pytest.mark.parametrize('change',['db','photo','missing','extra','manifest','keys','wrong_key','symlink','temporary'])
def test_bad_package_never_creates_restore_target(recovery_source,change):
    s=recovery_source
    capture(s)
    photo=s.package/'listing-objects'/s.photo.object_key
    if change=='db': (s.package/'state.sqlite3').write_bytes(b'bad')
    elif change=='photo': photo.write_bytes(b'bad')
    elif change=='missing': photo.unlink()
    elif change=='extra': (s.package/'extra').write_text('bad')
    elif change=='temporary': (photo.parent/'.upload-untracked').write_text('bad')
    elif change=='manifest':
        m=json.loads((s.package/'manifest.json').read_text());m['manifest']['objects']={}
        (s.package/'manifest.json').write_text(json.dumps(m))
    elif change in ('keys','wrong_key'):
        m=json.loads(s.keys.read_text());m['configuration']['TOKEN_ENCRYPTION_KEY' if change=='wrong_key' else 'EBAY_CLIENT_SECRET']=Fernet.generate_key().decode()
        s.keys.write_text(json.dumps(m))
    else:
        photo.unlink();photo.symlink_to(s.photos.root/s.photo.object_key)
    target=s.root/'restored'
    with pytest.raises(Exception):r.restore(s.package,s.keys,target)
    assert not target.exists()


def test_missing_referenced_original_rejected_before_key_export(recovery_source):
    s=recovery_source
    (s.photos.root/s.photo.object_key).unlink()
    with pytest.raises(r.RecoveryError):capture(s)
    assert not s.keys.exists() and not s.package.exists()


def test_retired_unindexed_original_and_legacy_catalog_preserved(recovery_source):
    s=recovery_source
    key=s.photos.root/s.photo.object_key
    extra=b'original-retained-history'
    retired=key.with_name(hashlib.sha256(extra).hexdigest()+'.jpeg')
    retired.write_bytes(s.store.cipher.encrypt(extra))
    row=s.store.get('photo',s.photo.object_key);row.pop('object_key')
    s.store.put('photo',s.photo.object_key,row)
    (key.parent/'.upload-inflight').write_bytes(b'not yet committed')
    assert capture(s)['originals']==2
    assert r.verify(s.package,s.keys)['objects'][retired.relative_to(s.photos.root).as_posix()]


def test_wrong_source_key_and_missing_configuration_never_create_output(recovery_source):
    s=recovery_source
    for config in [{**s.credentials,'TOKEN_ENCRYPTION_KEY':Fernet.generate_key().decode()},
                   {**s.credentials,'EBAY_CLIENT_SECRET':''}]:
        with pytest.raises(Exception):r.capture(s.store.path,s.photos.root,s.package,s.keys,config)
        assert not s.keys.exists() and not s.package.exists()


def test_low_space_refuses_capture_and_restore(recovery_source,monkeypatch):
    s=recovery_source
    real=r.shutil.disk_usage
    monkeypatch.setattr(r.shutil,'disk_usage',lambda p:SimpleNamespace(free=1))
    with pytest.raises(r.RecoveryError):capture(s)
    assert not s.keys.exists()
    monkeypatch.setattr(r.shutil,'disk_usage',real)
    capture(s)
    monkeypatch.setattr(r.shutil,'disk_usage',lambda p:SimpleNamespace(free=1))
    with pytest.raises(r.RecoveryError):r.restore(s.package,s.keys,s.root/'restored')
    assert not (s.root/'restored').exists()


def test_sqlite_snapshot_excludes_uncommitted_wal_changes(recovery_source):
    s=recovery_source
    with closing(sqlite3.connect(s.store.path)) as writer:
        writer.execute("INSERT INTO extra_ledger VALUES ('2','uncommitted')")
        capture(s)
        assert rows(s.package/'state.sqlite3','extra_ledger')==[('1','retained')]
        writer.rollback()


def test_cli_redacts_errors_and_never_prints_credentials(recovery_source,monkeypatch,capsys):
    s=recovery_source
    monkeypatch.setattr('sys.argv',['recovery','capture','--database',str(s.store.path),'--originals',str(s.photos.root),
                                   '--output',str(s.package),'--keys-out',str(s.keys)])
    monkeypatch.delenv('TOKEN_ENCRYPTION_KEY',raising=False)
    assert r.main()==1
    output=capsys.readouterr()
    assert not output.out and str(s.root) not in output.err and 'synthetic-secret' not in output.err
