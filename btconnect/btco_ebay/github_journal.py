"""Write-through recovery journal for a bounded GitHub-hosted publisher.

This is the existing connector SQLite journal, not another inventory database.
Every committed transaction must reach the private Git branch before the caller
can make its next eBay request. A failed checkpoint terminates the entire worker.
"""
import base64
from contextlib import contextmanager
import hashlib
from pathlib import Path
import re
import sqlite3

from cryptography.fernet import Fernet
import httpx

from .store import Store

BRANCH = "publisher-state"
DATABASE = "state.sqlite3.fernet"
PHOTO = re.compile(r"objects/photos/[0-9a-f]{64}/[0-9a-f]{64}\.(?:jpeg|png)$")
MAX_BLOB = 20_000_000
MAX_TOTAL = 450_000_000


class JournalUnavailable(BaseException):
    """Intentionally escapes per-listing Exception handlers: stop all writes."""


def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


class GitHubAPI:
    def __init__(self, repository, token, transport=None):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) or not token:
            raise ValueError("Private repository and GitHub token are required")
        self.root = "https://api.github.com/repos/" + repository
        self.client = httpx.Client(transport=transport, follow_redirects=False,
            timeout=30, headers={"Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})

    def __call__(self, method, path, body=None):
        try:
            response = self.client.request(method, self.root + path, json=body)
            if response.status_code < 200 or response.status_code >= 300:
                raise JournalUnavailable("GitHub journal request failed (HTTP %d); worker stopped" % response.status_code)
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise JournalUnavailable("GitHub journal response unavailable; worker stopped") from None

    def close(self):
        self.client.close()


class GitHubJournal:
    def __init__(self, api, root, archive_key):
        self.api, self.root, self.cipher = api, Path(root), Fernet(archive_key.encode())
        self.head = self.tree = self.database_digest = None
        self.entries = {}
        self.poisoned = False
        if api("GET", "").get("private") is not True:
            raise JournalUnavailable("Publisher state requires a private repository")

    def current_head(self):
        return self.api("GET", "/git/ref/heads/" + BRANCH)["object"]["sha"]

    def restore(self):
        if self.root.exists() and any(self.root.iterdir()):
            raise JournalUnavailable("Restore requires an empty private directory")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root.chmod(0o700)
        self.head = self.current_head()  # Missing state never silently starts fresh.
        self.tree = self.api("GET", "/git/commits/" + self.head)["tree"]["sha"]
        result = self.api("GET", "/git/trees/" + self.tree + "?recursive=1")
        if result.get("truncated"):
            raise JournalUnavailable("Journal tree is incomplete")
        total = 0
        for item in result["tree"]:
            if item["type"] == "tree":
                continue
            path = item["path"]
            if item.get("mode") != "100644" or not (path == DATABASE or PHOTO.fullmatch(path)):
                raise JournalUnavailable("Unexpected path or file type in publisher journal")
            if not 0 < item.get("size", 0) <= MAX_BLOB:
                raise JournalUnavailable("Journal object exceeds the recovery limit")
            total += item["size"]
            if total > MAX_TOTAL:
                raise JournalUnavailable("Journal exceeds the recovery limit")
            result = self.api("GET", "/git/blobs/" + item["sha"])
            data = base64.b64decode(result["content"].replace("\n", ""), validate=True)
            if blob_sha(data) != item["sha"]:
                raise JournalUnavailable("Journal object checksum mismatch")
            if path == DATABASE:
                data = self.cipher.decrypt(data)
                self.database_digest = hashlib.sha256(data).hexdigest()
                target = self.root / "state.sqlite3"
            else:
                target = self.root / "listing-objects" / path.removeprefix("objects/")
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(data)
            target.chmod(0o600)
            self.entries[path] = item["sha"]
        if DATABASE not in self.entries:
            raise JournalUnavailable("Existing publication journal is required")
        with sqlite3.connect(self.root / "state.sqlite3") as db:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise JournalUnavailable("Restored journal failed integrity verification")

    def checkpoint(self, *, seed=False):
        if self.poisoned:
            raise JournalUnavailable("Publisher journal stopped after an unconfirmed checkpoint")
        try:
            if not seed and self.current_head() != self.head:
                raise JournalUnavailable("Journal changed in another worker; stop and restore")
            with sqlite3.connect(self.root / "state.sqlite3") as db:
                database = db.serialize()
            digest = hashlib.sha256(database).hexdigest()
            files = {}
            if digest != self.database_digest:
                files[DATABASE] = self.cipher.encrypt(database)
            photo_root = self.root / "listing-objects"
            total = len(database)
            for path in photo_root.rglob("*"):
                if path.is_symlink():
                    raise JournalUnavailable("Symlinks are not allowed in publisher originals")
                if not path.is_file():
                    continue
                name = "objects/" + path.relative_to(photo_root).as_posix()
                if not PHOTO.fullmatch(name):
                    raise JournalUnavailable("Unexpected original-photo path")
                data = path.read_bytes()  # Existing connector objects are already encrypted.
                total += len(data)
                if len(data) > MAX_BLOB or total > MAX_TOTAL:
                    raise JournalUnavailable("Publisher checkpoint exceeds the recovery limit")
                sha = blob_sha(data)
                if name in self.entries and sha != self.entries[name]:
                    raise JournalUnavailable("An immutable original changed")
                if name not in self.entries:
                    files[name] = data
            if not files:
                return
            tree = []
            for name, data in files.items():
                if len(data) > MAX_BLOB:
                    raise JournalUnavailable("Journal object exceeds the recovery limit")
                result = self.api("POST", "/git/blobs", {
                    "content": base64.b64encode(data).decode(), "encoding": "base64"})
                if result["sha"] != blob_sha(data):
                    raise JournalUnavailable("GitHub did not confirm the journal bytes")
                tree.append({"path": name, "mode": "100644", "type": "blob", "sha": result["sha"]})
            body = {"tree": tree}
            if self.tree:
                body["base_tree"] = self.tree
            tree_sha = self.api("POST", "/git/trees", body)["sha"]
            commit = self.api("POST", "/git/commits", {
                "message": "Checkpoint encrypted publisher journal", "tree": tree_sha,
                "parents": [self.head] if self.head else []})["sha"]
            if seed:
                result = self.api("POST", "/git/refs", {"ref": "refs/heads/" + BRANCH, "sha": commit})
            else:
                result = self.api("PATCH", "/git/refs/heads/" + BRANCH, {"sha": commit, "force": False})
            if result["object"]["sha"] != commit or self.current_head() != commit:
                raise JournalUnavailable("GitHub did not confirm the checkpoint ref")
            self.head, self.tree, self.database_digest = commit, tree_sha, digest
            self.entries.update({item["path"]: item["sha"] for item in tree})
        except BaseException:
            self.poisoned = True
            raise


class CheckpointStore(Store):
    def __init__(self, journal, store_key):
        self.journal = journal
        super().__init__(str(journal.root / "state.sqlite3"), store_key)

    @contextmanager
    def tx(self):
        if self.journal.poisoned:
            raise JournalUnavailable("Publisher journal is unavailable")
        with super().tx() as db:
            yield db
        try:
            self.journal.checkpoint()
        except BaseException:
            self.journal.poisoned = True
            raise JournalUnavailable("Publication journal was not confirmed; stop and restore before retrying") from None
