"""Offline connector recovery. Never starts a server or calls a marketplace."""
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
import time

from cryptography.fernet import Fernet

PHOTO = re.compile(r"photos/[0-9a-f]{64}/[0-9a-f]{64}\.(?:jpeg|png)$")
FORMAT = "btconnect-recovery-v1"
MAX_TOTAL = 2 * 1024**3
MAX_PHOTO = 17 * 1024**2
MAX_DB = 128 * 1024**2
CONFIG_KEYS = ("TOKEN_ENCRYPTION_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME",
               "PUBLIC_URL", "EBAY_ALLOWED_SELLER", "BTCORE_CALLBACK_URL", "BTCO_WORKER_ARCHIVE_KEY")
REQUIRED_KEYS = CONFIG_KEYS[:5]


class RecoveryError(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def regular(path, maximum=MAX_TOTAL):
    path = Path(path)
    if path.is_symlink() or any(p.is_symlink() for p in path.parents) or not path.is_file():
        raise RecoveryError("A regular file without symlink parents is required")
    if path.stat().st_size > maximum:
        raise RecoveryError("Recovery file exceeds the supported bound")
    return path


def private_root(path):
    path = Path(path).absolute()
    if not path.is_dir() or path.is_symlink() or any(p.is_symlink() for p in path.parents):
        raise RecoveryError("Use an existing private directory without symlinks")
    if path.stat().st_mode & 0o077:
        raise RecoveryError("Use an owner-only private directory")
    return path


def write_json(path, value):
    with Path(path).open("xb") as stream:
        stream.write(canonical(value) + b"\n")
        stream.flush()
        os.fsync(stream.fileno())
    Path(path).chmod(0o600)


def inspect_database(database, cipher):
    counts, references = Counter(), set()
    # Do not instantiate Store: its constructor starts a write transaction and
    # purges expired records. Recovery must retain every original row unchanged.
    with closing(sqlite3.connect(regular(database, MAX_DB).as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise RecoveryError("Database integrity verification failed")
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='records'").fetchone():
            raise RecoveryError("Not a connector database")
        def visit(value):
            if isinstance(value, dict):
                if "object_key" in value:
                    key = value["object_key"]
                    if not isinstance(key, str) or not PHOTO.fullmatch(key):
                        raise RecoveryError("Invalid original reference")
                    expected = value.get("sha256_hex", value.get("sha256"))
                    if expected and Path(key).stem != expected:
                        raise RecoveryError("Original reference checksum differs")
                    references.add(key)
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
        legacy = []
        for kind, blob in db.execute("SELECT kind,data FROM records"):
            value = json.loads(cipher.decrypt(blob))
            if not isinstance(value, dict):
                raise RecoveryError("Invalid encrypted record")
            counts[kind] += 1
            visit(value)
            if kind == "photo" and not value.get("object_key"):
                legacy.append(value)
    return dict(sorted(counts.items())), references, legacy


def inspect_objects(root, cipher, *, capture_in_progress=False):
    root = private_root(root)
    result, total = {}, 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise RecoveryError("Original directories cannot contain symlinks")
        if path.is_dir():
            continue
        # An in-flight ingestion is not in the committed database snapshot.
        if capture_in_progress and path.name.startswith(".upload-"):
            continue
        name = path.relative_to(root).as_posix()
        if not PHOTO.fullmatch(name):
            raise RecoveryError("Unexpected original object")
        regular(path, MAX_PHOTO)
        encrypted = path.read_bytes()
        raw = cipher.decrypt(encrypted)
        if hashlib.sha256(raw).hexdigest() != path.stem:
            raise RecoveryError("Original checksum verification failed")
        total += len(encrypted)
        if total > MAX_TOTAL:
            raise RecoveryError("Recovery originals exceed the supported bound")
        result[name] = {"bytes": len(encrypted), "sha256": hashlib.sha256(encrypted).hexdigest()}
    return result


def require_references(references, legacy, objects):
    for row in legacy:
        seller = hashlib.sha256(row["seller"].encode()).hexdigest()
        choices = [f"photos/{seller}/{row['sha256']}.{ext}" for ext in ("jpeg", "png")]
        matches = [p for p in choices if p in objects]
        if len(matches) != 1:
            raise RecoveryError("Legacy original is missing or ambiguous")
        references.add(matches[0])
    if not references.issubset(objects):
        raise RecoveryError("A database original is missing")


def sign(manifest, key):
    return hmac.new(key.encode(), b"BTCo recovery manifest v1\0" + canonical(manifest), hashlib.sha256).hexdigest()


def capture(database, originals, output, keys_out, credentials):
    """SQLite online snapshot plus immutable originals; no live state mutation."""
    os.umask(0o077)
    database = regular(Path(database).absolute(), MAX_DB)
    originals = private_root(originals)
    output, keys_out = Path(output).absolute(), Path(keys_out).absolute()
    private_root(output.parent)
    private_root(keys_out.parent)
    if output.exists() or output.is_symlink() or keys_out.exists() or keys_out.is_symlink():
        raise RecoveryError("Recovery output and key file must be new")
    if (output == keys_out or output in keys_out.parents or originals == output
            or originals in output.parents or originals in keys_out.parents):
        raise RecoveryError("Keep recovery output and keys separate from originals")
    secrets = {k: credentials[k] for k in CONFIG_KEYS if credentials.get(k)}
    if any(not secrets.get(k) for k in REQUIRED_KEYS):
        raise RecoveryError("Complete connector recovery configuration is required")
    cipher = Fernet(secrets["TOKEN_ENCRYPTION_KEY"].encode())
    # Preflight before copying. The live small volume is not a backup destination.
    estimate = sum(p.stat().st_size for p in originals.rglob("*") if p.is_file()) + database.stat().st_size * 3
    if shutil.disk_usage(output.parent).free < estimate + 50_000_000:
        raise RecoveryError("Insufficient recovery destination space; use separate storage")
    created = datetime.now(timezone.utc).isoformat()
    with tempfile.TemporaryDirectory(prefix=".btconnect-capture-", dir=output.parent) as temp:
        root = Path(temp)
        snapshot = root / "state.sqlite3"
        started = time.monotonic()
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as src, closing(sqlite3.connect(snapshot)) as dst:
            page_size = src.execute("PRAGMA page_size").fetchone()[0]
            def progress(status, remaining, total):
                if total * page_size > MAX_DB or time.monotonic() - started > 120:
                    raise RecoveryError("Database snapshot exceeded its bound")
            src.backup(dst, pages=256, progress=progress, sleep=0.05)
            # Make only the copied database self-contained. Never change the
            # source journal mode or omit committed source WAL transactions.
            if dst.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                raise RecoveryError("Snapshot journal could not be finalized")
        snapshot.chmod(0o600)
        counts, references, legacy = inspect_database(snapshot, cipher)
        objects = inspect_objects(originals, cipher, capture_in_progress=True)
        require_references(references, legacy, objects)
        destination = root / "listing-objects"
        destination.mkdir(mode=0o700)
        for name, expected in objects.items():
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(regular(originals / name, MAX_PHOTO), target)
            target.chmod(0o600)
            if sha(target) != expected["sha256"]:
                raise RecoveryError("Original changed during capture")
        key_data = {"format": FORMAT, "configuration": secrets}
        manifest = {"format": FORMAT, "created_at": created, "records": counts,
                    "database": {"bytes": snapshot.stat().st_size, "sha256": sha(snapshot)},
                    "objects": objects, "key_sha256": hashlib.sha256(canonical(key_data) + b"\n").hexdigest(),
                    "scope": "connector-database-and-local-originals",
                    "not_included": ["Core data", "separate R2 copies", "hosting/DNS/account recovery", "AI credentials"]}
        write_json(root / "manifest.json", {"manifest": manifest, "hmac_sha256": sign(manifest, secrets["TOKEN_ENCRYPTION_KEY"])})
        # Write the separate key file only after every source object is verified.
        write_json(keys_out, key_data)
        # No overwrite: mkdir reserves the final target. A failed capture is never
        # reported successful; an incomplete directory must be handled explicitly.
        output.mkdir(mode=0o700)
        for path in root.iterdir():
            path.rename(output / path.name)
    return {"captured": True, "records": sum(counts.values()), "originals": len(objects),
            "manifest_sha256": sha(output / "manifest.json"), "offsite_verified": False}


def verify(package, keys):
    package = private_root(package)
    keys = regular(Path(keys).absolute(), 65536)
    if keys.stat().st_mode & 0o077:
        raise RecoveryError("Recovery keys must be owner-only")
    key_data = json.loads(keys.read_bytes())
    credentials = key_data["configuration"]
    cipher = Fernet(credentials["TOKEN_ENCRYPTION_KEY"].encode())
    envelope = json.loads(regular(package / "manifest.json", 8 * 1024**2).read_bytes())
    manifest = envelope["manifest"]
    if (manifest["format"] != FORMAT or key_data["format"] != FORMAT
            or not hmac.compare_digest(sign(manifest, credentials["TOKEN_ENCRYPTION_KEY"]), envelope["hmac_sha256"])
            or sha(keys) != manifest["key_sha256"]):
        raise RecoveryError("Recovery manifest or keys differ")
    if any(not credentials.get(k) for k in REQUIRED_KEYS):
        raise RecoveryError("Recovery configuration is incomplete")
    db = regular(package / "state.sqlite3", MAX_DB)
    if {"bytes": db.stat().st_size, "sha256": sha(db)} != manifest["database"]:
        raise RecoveryError("Database checksum differs")
    counts, refs, legacy = inspect_database(db, cipher)
    objects = inspect_objects(package / "listing-objects", cipher)
    if objects != manifest["objects"] or counts != manifest["records"]:
        raise RecoveryError("Recovery inventory differs")
    require_references(refs, legacy, objects)
    expected = {"manifest.json", "state.sqlite3", "listing-objects"}
    if {p.name for p in package.iterdir()} != expected:
        raise RecoveryError("Unexpected recovery package entries")
    return manifest


def restore(package, keys, destination):
    """Restore only into a new directory. No app or marketplace is started."""
    os.umask(0o077)
    package, destination = Path(package).absolute(), Path(destination).absolute()
    private_root(destination.parent)
    if destination.exists() or destination.is_symlink():
        raise RecoveryError("Restore destination must not exist")
    manifest = verify(package, keys)
    required = manifest["database"]["bytes"] + sum(o["bytes"] for o in manifest["objects"].values())
    if shutil.disk_usage(destination.parent).free < required + 50_000_000:
        raise RecoveryError("Insufficient restore space")
    with tempfile.TemporaryDirectory(prefix=".btconnect-restore-", dir=destination.parent) as tmp:
        staged = Path(tmp) / "package"
        shutil.copytree(package, staged, symlinks=True)
        # Re-verify the actual copied bytes, including detection of source races.
        verify(staged, keys)
        defaults = {"BTCO_PUBLICATION_ENABLED": "false", "BTCO_AI_BUDGET_USD": "0",
                    "BTCO_DB_PATH": str(destination / "state.sqlite3"),
                    "activation": "manual-single-writer-handoff-required"}
        destination.mkdir(mode=0o700)
        for path in staged.iterdir():
            path.rename(destination / path.name)
        write_json(destination / "recovery-defaults.json", defaults)
    return {"restored": True, "records": sum(manifest["records"].values()),
            "originals": len(manifest["objects"]), "original_hashes_verified": True,
            "offline_only": True, "server_started": False, "publication_enabled": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    cap = sub.add_parser("capture")
    cap.add_argument("--database", required=True)
    cap.add_argument("--originals", required=True)
    cap.add_argument("--output", required=True)
    cap.add_argument("--keys-out", required=True)
    for action in ("verify", "restore"):
        p = sub.add_parser(action)
        p.add_argument("--package", required=True)
        p.add_argument("--keys", required=True)
        if action == "restore":
            p.add_argument("--destination", required=True)
    args = parser.parse_args()
    try:
        if args.action == "capture":
            result = capture(args.database, args.originals, args.output, args.keys_out, os.environ)
        elif args.action == "verify":
            m = verify(args.package, args.keys)
            result = {"verified": True, "records": sum(m["records"].values()), "originals": len(m["objects"])}
        else:
            result = restore(args.package, args.keys, args.destination)
        print(json.dumps(result))
        return 0
    except Exception:
        print("Connector recovery failed. No success recorded; check private inputs, space and the empty-destination requirement.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
