"""Synthetic independent-runner recovery: no GitHub or marketplace requests."""
import asyncio
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3

from cryptography.fernet import Fernet
import pytest

from btco_ebay.github_journal import GitHubJournal, CheckpointStore, JournalUnavailable, blob_sha, DATABASE
from btco_ebay.github_worker import preflight, run_batch, require_verified_source
from btco_ebay.listing_batches import ListingBatches
from btco_ebay.listing_store import ListingStore
from btco_ebay.photos import PhotoStore
from btco_ebay.publishing import Publisher
from btco_ebay.store import Store
from test_listings import bundle as bundle
from test_listing_batches import setup
from test_cards import card


class FakeGitHub:
    def __init__(self):
        self.private = True
        self.head = None
        self.blobs, self.trees, self.commits = {}, {}, {}
        self.fail_patch = self.lose_patch_reply = False

    def __call__(self, method, path, body=None):
        if path == "":
            return {"private": self.private}
        if method == "GET" and path.startswith("/git/ref/heads/"):
            if not self.head:
                raise JournalUnavailable("missing ref")
            return {"object": {"sha": self.head}}
        if method == "POST" and path == "/git/blobs":
            data = base64.b64decode(body["content"])
            sha = blob_sha(data)
            self.blobs[sha] = data
            return {"sha": sha}
        if method == "GET" and path.startswith("/git/blobs/"):
            return {"content": base64.b64encode(self.blobs[path.split("/")[-1]]).decode()}
        if method == "POST" and path == "/git/trees":
            entries = deepcopy(self.trees.get(body.get("base_tree"), {}))
            for item in body["tree"]:
                entries[item["path"]] = {**item, "size": len(self.blobs[item["sha"]])}
            sha = hashlib.sha1(json.dumps(entries, sort_keys=True).encode()).hexdigest()
            self.trees[sha] = entries
            return {"sha": sha}
        if method == "GET" and path.startswith("/git/trees/"):
            sha = path.split("/")[-1].split("?")[0]
            return {"tree": deepcopy(list(self.trees[sha].values())), "truncated": False}
        if method == "POST" and path == "/git/commits":
            sha = hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()
            self.commits[sha] = deepcopy(body)
            return {"sha": sha}
        if method == "GET" and path.startswith("/git/commits/"):
            return {"tree": {"sha": self.commits[path.split("/")[-1]]["tree"]}}
        if method == "POST" and path == "/git/refs":
            if self.head:
                raise JournalUnavailable("ref exists")
            self.head = body["sha"]
            return {"object": {"sha": self.head}}
        if method == "PATCH" and path.startswith("/git/refs/heads/"):
            if self.fail_patch or self.commits[body["sha"]]["parents"] != [self.head] or body["force"]:
                raise JournalUnavailable("checkpoint refused")
            self.head = body["sha"]
            if self.lose_patch_reply:
                raise JournalUnavailable("lost checkpoint response")
            return {"object": {"sha": self.head}}
        raise AssertionError((method, path))


def seed(root, source=None):
    root.mkdir(exist_ok=True)
    key, archive = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    if source:
        key = source.store.cipher._signing_key + source.store.cipher._encryption_key
        key = base64.urlsafe_b64encode(key).decode()
        with sqlite3.connect(source.store.path) as src, sqlite3.connect(root / "state.sqlite3") as dst:
            src.backup(dst)
    else:
        Store(str(root / "state.sqlite3"), key)
    api = FakeGitHub()
    journal = GitHubJournal(api, root, archive)
    journal.checkpoint(seed=True)
    return api, journal, key, archive


def restore(api, root, key, archive):
    journal = GitHubJournal(api, root, archive)
    journal.restore()
    return journal, CheckpointStore(journal, key)


def test_encrypted_checkpoint_restores_and_missing_state_never_starts_fresh(tmp_path):
    api, journal, key, archive = seed(tmp_path / "first")
    store = CheckpointStore(journal, key)
    store.put("test", "private", {"secret": "synthetic-private-value"})
    assert all(b"synthetic-private-value" not in data and not data.startswith(b"SQLite") for data in api.blobs.values())
    _, recovered = restore(api, tmp_path / "second", key, archive)
    assert recovered.get("test", "private") == {"secret": "synthetic-private-value"}
    with pytest.raises(JournalUnavailable):
        GitHubJournal(FakeGitHub(), tmp_path / "empty", archive).restore()


@pytest.mark.parametrize("lost_reply", [False, True])
def test_failed_checkpoint_stops_process_and_restores_authoritative_journal(tmp_path, lost_reply):
    api, journal, key, archive = seed(tmp_path / "first")
    store = CheckpointStore(journal, key)
    api.fail_patch, api.lose_patch_reply = not lost_reply, lost_reply
    would_have_called_ebay = []
    with pytest.raises(JournalUnavailable):
        try:
            store.put("listing", "id", {"publish_attempted": True})
            would_have_called_ebay.append("publish")
        except Exception:
            would_have_called_ebay.append("incorrect-per-card-recovery")
    assert not would_have_called_ebay
    with pytest.raises(JournalUnavailable):
        store.put("listing", "id", {})
    api.fail_patch = api.lose_patch_reply = False
    _, recovered = restore(api, tmp_path / "second", key, archive)
    assert recovered.get("listing", "id") == ({"publish_attempted": True} if lost_reply else None)


def test_stale_runner_cannot_overwrite_newer_journal(tmp_path):
    api, first, key, archive = seed(tmp_path / "first")
    _, second = restore(api, tmp_path / "second", key, archive)
    store = CheckpointStore(first, key)
    store.put("test", "winner", {"winner": True})
    with pytest.raises(JournalUnavailable):
        second.put("test", "loser", {"winner": False})
    _, final = restore(api, tmp_path / "third", key, archive)
    assert final.get("test", "winner") and final.get("test", "loser") is None


def test_public_repository_and_unsafe_recovery_paths_are_rejected(tmp_path):
    api, journal, key, archive = seed(tmp_path / "first")
    api.private = False
    with pytest.raises(JournalUnavailable):
        GitHubJournal(api, tmp_path / "public", archive)
    api.private = True
    tree = api.trees[api.commits[api.head]["tree"]]
    tree["../outside"] = {**tree[DATABASE], "path": "../outside"}
    with pytest.raises(JournalUnavailable):
        GitHubJournal(api, tmp_path / "unsafe", archive).restore()
    assert not (tmp_path / "outside").exists()


def test_one_image_cards_continue_after_failure_and_survive_new_runner(bundle, tmp_path):
    old_repo, source, images = bundle
    api, journal, key, archive = seed(tmp_path, old_repo)
    store = CheckpointStore(journal, key)
    repo = ListingStore(store, PhotoStore(store))
    batches, fake, payload = setup((repo, source, images), count=2)
    for entry in payload["items"]:
        entry["draft"] = {**card(entry["draft"]), "draft_id": "btco-card-worker-" + entry["item_key"]}
    batches.submit("seller", payload)
    prepared = asyncio.run(run_batch(batches, "seller", "family", payload["batch_id"], "prepare"))
    revision = prepared["review_revision"]
    with pytest.raises(ValueError, match="no saved owner approval"):
        asyncio.run(run_batch(batches, "seller", "family", payload["batch_id"], "publish", revision))
    with pytest.raises(ValueError, match="exact complete reviewed"):
        asyncio.run(run_batch(batches, "seller", "family", payload["batch_id"], "publish", "a" * 64, True, "owner"))
    fake.failures[payload["items"][0]["draft"]["master_sku"]] = "rejected"
    final = asyncio.run(run_batch(batches, "seller", "family", payload["batch_id"], "publish", revision, True, "owner"))
    assert final["verified_count"] == 1
    assert final["listings"][0]["last_attempt"]["disposition"] == "retry_later"
    assert all(len(x["draft"]["photos"]) == 1 for x in final["listings"])
    _, recovered = restore(api, tmp_path / "new-runner", key, archive)
    recovered_repo = ListingStore(recovered, PhotoStore(recovered))
    recovered_batches = ListingBatches(recovered_repo, Publisher(recovered_repo, fake, True, collector=fake.collect))
    calls = list(fake.calls)
    again = asyncio.run(run_batch(recovered_batches, "seller", "family", payload["batch_id"], "publish", revision))
    assert again["verified_count"] == 1 and fake.calls == calls
    for listing in again["listings"]:
        recovered_repo.photos.verify("seller", listing["draft"]["photos"])


def test_unknown_publication_is_not_reissued_after_runner_loss(bundle, tmp_path):
    old_repo, source, images = bundle
    api, journal, key, archive = seed(tmp_path, old_repo)
    store = CheckpointStore(journal, key)
    repo = ListingStore(store, PhotoStore(store))
    batches, fake, payload = setup((repo, source, images), count=1)
    payload["items"][0]["draft"] = card(payload["items"][0]["draft"])
    batches.submit("seller", payload)
    review = asyncio.run(run_batch(batches, "seller", "family", payload["batch_id"], "prepare"))
    fake.failures[payload["items"][0]["draft"]["master_sku"]] = "lost_success"
    asyncio.run(run_batch(batches, "seller", "family", payload["batch_id"], "publish", review["review_revision"], True, "owner"))
    _, recovered = restore(api, tmp_path / "new-runner", key, archive)
    repo = ListingStore(recovered, PhotoStore(recovered))
    engine = ListingBatches(repo, Publisher(repo, fake, True, collector=fake.collect))
    # Make the saved backoff due, as time would on a subsequent manual run.
    row = engine.get("seller", payload["batch_id"])
    for result in row["publication_results"].values():
        result["retry_after"] = 0
    engine.write(row)
    outcome = asyncio.run(run_batch(engine, "seller", "family", payload["batch_id"], "publish", review["review_revision"]))
    assert outcome["verified_count"] == 1
    assert fake.calls.count("publish") == fake.calls.count("create") == 1


def test_preflight_reports_names_only_and_requires_explicit_single_writer_handoff():
    env = {name: "synthetic-secret" for name in (
        "GITHUB_TOKEN", "GITHUB_REPOSITORY", "BTCO_WORKER_ARCHIVE_KEY", "TOKEN_ENCRYPTION_KEY",
        "BTCO_WORKER_SELLER_ID", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "BTCO_WORKER_GRANT_FAMILY", "GITHUB_SHA")}
    assert preflight(env, "publish") == ["BTCO_WORKER_HANDOFF=github-only"]
    env["BTCO_WORKER_HANDOFF"] = "github-only"
    assert preflight(env, "publish") == []
    assert "synthetic-secret" not in json.dumps(preflight({}, "publish"))


def test_recovery_seed_verifies_originals_and_refuses_replacing_state(bundle, tmp_path):
    from scripts.seed_github_publisher import seed as seed_recovery
    repo, _, _ = bundle
    key = base64.urlsafe_b64encode(repo.store.cipher._signing_key + repo.store.cipher._encryption_key).decode()
    archive = Fernet.generate_key().decode()
    api = FakeGitHub()
    with pytest.raises(ValueError, match="single-writer"):
        seed_recovery(api, repo.store.path, repo.photos.root, archive, key, None)
    result = seed_recovery(api, repo.store.path, repo.photos.root, archive, key, "github-only")
    assert result["verified_originals"] == 2 and api.head == result["journal_commit"]
    head = api.head
    with pytest.raises(JournalUnavailable):
        seed_recovery(api, repo.store.path, repo.photos.root, archive, key, "github-only")
    assert api.head == head


def test_corrupt_original_never_seeds_a_remote_journal(bundle):
    from scripts.seed_github_publisher import seed as seed_recovery
    repo, _, _ = bundle
    key = base64.urlsafe_b64encode(repo.store.cipher._signing_key + repo.store.cipher._encryption_key).decode()
    archive = Fernet.generate_key().decode()
    original = next(repo.photos.root.rglob("*.jpeg"))
    original.write_bytes(repo.store.cipher.encrypt(b"changed original"))
    api = FakeGitHub()
    with pytest.raises(ValueError, match="checksum"):
        seed_recovery(api, repo.store.path, repo.photos.root, archive, key, "github-only")
    assert api.head is None


def test_worker_requires_latest_successful_validation_of_exact_source():
    sha = "a" * 40
    rows = [{"id": 1, "head_sha": sha, "event": "push", "status": "completed", "conclusion": "success"}]
    api = lambda *args: {"workflow_runs": rows}
    require_verified_source(api, sha)
    rows.append({**rows[0], "id": 2, "conclusion": "failure"})
    with pytest.raises(ValueError, match="validation"):
        require_verified_source(api, sha)
    rows.pop()
    with pytest.raises(ValueError, match="validation"):
        require_verified_source(api, "b" * 40)
