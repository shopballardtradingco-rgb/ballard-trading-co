"""Seed the private GitHub journal from an independently recovered, frozen copy.

Never contacts Railway, eBay or any live database. Existing publisher-state refs
cannot be replaced. Keep the original recovery copy and keys independently.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

from cryptography.fernet import Fernet
from btco_ebay.github_journal import GitHubAPI, GitHubJournal, PHOTO, JournalUnavailable


def seed(api, database, objects, archive_key, store_key, frozen):
    if frozen != "github-only":
        raise ValueError("A confirmed single-writer handoff is required before seeding")
    if not Path(database).is_file() or Path(database).is_symlink():
        raise ValueError("An existing recovered SQLite journal is required")
    cipher = Fernet(store_key.encode())
    with tempfile.TemporaryDirectory(prefix="btco-private-seed-") as root:
        root = Path(root)
        with sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True) as src:
            if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Recovered database failed integrity verification")
            # Fail if this is not the existing connector journal or its key is wrong.
            if not src.execute("SELECT 1 FROM sqlite_master WHERE name='records'").fetchone():
                raise ValueError("This is not a connector recovery journal")
            for (blob,) in src.execute("SELECT data FROM records"):
                cipher.decrypt(blob)
            with sqlite3.connect(root / "state.sqlite3") as dst:
                src.backup(dst)
        source = Path(objects)
        if not source.is_dir() or source.is_symlink():
            raise ValueError("Recovered original-photo directory is required")
        count = 0
        for path in source.rglob("*"):
            if path.is_symlink():
                raise ValueError("Recovery originals cannot contain symlinks")
            if not path.is_file():
                continue
            relative = path.relative_to(source)
            if not PHOTO.fullmatch("objects/" + relative.as_posix()):
                raise ValueError("Unexpected original-photo recovery path")
            raw = cipher.decrypt(path.read_bytes())
            if hashlib.sha256(raw).hexdigest() != path.stem:
                raise ValueError("Recovered original checksum mismatch")
            target = root / "listing-objects" / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(path, target)
            target.chmod(0o600)
            count += 1
        journal = GitHubJournal(api, root, archive_key)
        journal.checkpoint(seed=True)
        with tempfile.TemporaryDirectory(prefix="btco-private-readback-") as recovered:
            check = GitHubJournal(api, recovered, archive_key)
            check.restore()
            if check.entries != journal.entries:
                raise JournalUnavailable("Seeded journal did not match its read-back")
        return {"journal_commit": journal.head, "verified_originals": count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--originals", required=True)
    args = parser.parse_args()
    api = None
    try:
        api = GitHubAPI(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"])
        result = seed(api, args.database, args.originals, os.environ["BTCO_WORKER_ARCHIVE_KEY"],
                      os.environ["TOKEN_ENCRYPTION_KEY"], os.environ.get("BTCO_WORKER_HANDOFF"))
        import json
        print(json.dumps(result))
        return 0
    except (Exception, JournalUnavailable):
        print("Seed refused or unconfirmed. Keep the existing recovery copy; inspect configuration and private journal state before retrying.", file=sys.stderr)
        return 1
    finally:
        if api:
            api.close()


if __name__ == "__main__":
    raise SystemExit(main())
