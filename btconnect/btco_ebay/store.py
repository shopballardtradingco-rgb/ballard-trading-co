"""Encrypted, durable records. Opaque credentials are looked up by SHA-256 digest."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
from cryptography.fernet import Fernet


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class Store:
    def __init__(self, path: str, key: str):
        self.path = path
        self.cipher = Fernet(key.encode())
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.tx() as db:
            db.execute("CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, data BLOB NOT NULL, expires REAL NOT NULL, family TEXT, PRIMARY KEY(kind,id))")
            db.execute("CREATE INDEX IF NOT EXISTS family_idx ON records(family)")
            db.execute("CREATE INDEX IF NOT EXISTS expiry_idx ON records(expires) WHERE expires>0")
        os.chmod(path, 0o600)

    @contextmanager
    def read(self):
        """One read-only snapshot; ordinary reads never reserve SQLite's writer lock.

        Expiry is checked by readers, while physical cleanup remains in write
        transactions. No connection or decrypted data is cached between requests.
        """
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN")
            yield db
        finally:
            db.rollback()
            db.close()

    @contextmanager
    def tx(self):
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.execute("PRAGMA secure_delete=ON")
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM records WHERE expires > 0 AND expires < ?", (time.time(),)) if self._has_table(db) else None
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _has_table(db):
        return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='records'").fetchone()

    def put(self, kind, identifier, data, expires=0, family=None, db=None):
        if db is None:
            with self.tx() as con:
                return self.put(kind, identifier, data, expires, family, con)
        blob = self.cipher.encrypt(json.dumps(data, separators=(",", ":")).encode())
        db.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?)", (kind, digest(identifier), blob, expires, family))

    def get(self, kind, identifier, *, consume=False, db=None):
        if db is None:
            # Single-use credentials still consume atomically under the write lock.
            with (self.tx() if consume else self.read()) as con:
                return self.get(kind, identifier, consume=consume, db=con)
        row = db.execute("SELECT data,expires FROM records WHERE kind=? AND id=?", (kind, digest(identifier))).fetchone()
        if not row or (row[1] and row[1] < time.time()):
            return None
        if consume:
            db.execute("DELETE FROM records WHERE kind=? AND id=?", (kind, digest(identifier)))
        return json.loads(self.cipher.decrypt(row[0]))

    def delete_family(self, family, db=None):
        if db is None:
            with self.tx() as con:
                return self.delete_family(family, con)
        db.execute("DELETE FROM records WHERE family=?", (family,))

    def list_owned(self, kind, seller, after="", limit=50):
        """Paginate encrypted records, filtering ownership before returning data."""
        if not 1 <= limit <= 100 or (after and (len(after) != 64 or
                any(c not in "0123456789abcdef" for c in after))):
            raise ValueError("Invalid catalog page")
        result = []
        with self.read() as db:
            for identifier, blob in db.execute(
                "SELECT id,data FROM records WHERE kind=? AND id>? AND (expires=0 OR expires>=?) ORDER BY id",
                (kind, after, time.time()),
            ):
                value = json.loads(self.cipher.decrypt(blob))
                if value.get("seller") == seller:
                    result.append((identifier, value))
                    if len(result) > limit:
                        break
        return {"records": [r[1] for r in result[:limit]],
                "next_cursor": result[limit - 1][0] if len(result) > limit else None}

