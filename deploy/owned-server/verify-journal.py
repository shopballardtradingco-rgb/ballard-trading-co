"""Read-only connector recovery gate. Never initialize an empty journal."""
import json
import hashlib
import os
from pathlib import Path
import sqlite3
from cryptography.fernet import Fernet

path = Path(os.environ.get('BTCO_DB_PATH', '/data/btco.sqlite3'))
objects = path.parent / 'listing-objects'
if path.is_symlink() or objects.is_symlink() or not path.is_file() or not objects.is_dir():
    raise SystemExit('Missing recovered connector database or original directory.')
if os.environ.get('BTCO_PUBLICATION_ENABLED') != 'false':
    raise SystemExit('Keep publication disabled throughout recovery acceptance.')
for name in ('TOKEN_ENCRYPTION_KEY','EBAY_CLIENT_ID','EBAY_CLIENT_SECRET','EBAY_RUNAME'):
    if not os.environ.get(name): raise SystemExit('Missing '+name)
key = Fernet(os.environ['TOKEN_ENCRYPTION_KEY'].encode())
db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
try:
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Connector database integrity check failed.')
    # The deployed journal schema and encrypted originals are checked below.
    rows = db.execute('SELECT kind,data FROM records').fetchall()
    if not rows: raise SystemExit('Empty connector journal is not a recovery source.')
    for kind, value in rows:
        record = json.loads(key.decrypt(value))
        if kind == 'photo':
            relative = Path(record['object_key'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Invalid photo reference')
            original = objects / relative
            if any(p.is_symlink() for p in (original, *original.parents)):
                raise ValueError('Symlink in photo reference')
            raw = key.decrypt(original.read_bytes())
            if hashlib.sha256(raw).hexdigest() != record['sha256'] or len(raw) != record['bytes']:
                raise ValueError('Photo integrity mismatch')
    count = 0
    for file in objects.rglob('*'):
        if file.is_symlink(): raise SystemExit('Unexpected symlink in recovered originals.')
        if file.is_file(): key.decrypt(file.read_bytes()); count += 1
    print(json.dumps({'records_decrypted':len(rows),'originals_decrypted':count,'publication_enabled':False}))
except Exception:
    raise SystemExit('Journal verification failed. Preserve the database and matching key; do not reset either.') from None
finally:
    db.close()
