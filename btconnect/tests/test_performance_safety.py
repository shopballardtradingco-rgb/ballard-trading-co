"""Performance changes preserve expiry, atomic consumption and fresh validation."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import sqlite3
import time
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from btco_ebay.store import Store, digest
from btco_ebay.selling import Selling, SellingError
from test_listings import bundle as bundle
from test_listing_batches import setup, prepare


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "records.sqlite3"), Fernet.generate_key().decode())


def test_read_does_not_wait_for_reserved_writer_or_see_uncommitted_data(store, monkeypatch):
    store.put("test", "one", {"value": "committed"})
    connect = sqlite3.connect
    def short_timeout(*a, **kw):
        kw["timeout"] = 0.05
        return connect(*a, **kw)
    monkeypatch.setattr(sqlite3, "connect", short_timeout)
    with store.tx() as db:
        store.put("test", "one", {"value": "uncommitted"}, db=db)
        assert store.get("test", "one") == {"value": "committed"}
        assert store.get("test", "one", db=db) == {"value": "uncommitted"}
    assert store.get("test", "one") == {"value": "uncommitted"}


def test_expired_records_hidden_without_cleanup_or_losing_pagination(store):
    with store.tx() as db:
        for name, expiry, seller in (("expired", time.time()-1, "owner"),
                ("other", 0, "someone-else"), ("first", 0, "owner"),
                ("last", time.time()+60, "owner")):
            store.put("catalog", name, {"seller": seller, "name": name}, expires=expiry, db=db)
    assert store.get("catalog", "expired") is None
    first = store.list_owned("catalog", "owner", limit=1)
    last = store.list_owned("catalog", "owner", after=first["next_cursor"], limit=1)
    assert {r["name"] for r in first["records"]+last["records"]} == {"first", "last"}
    assert last["next_cursor"] is None
    with store.read() as db:
        assert db.execute("SELECT 1 FROM records WHERE id=?", (digest("expired"),)).fetchone()
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            db.execute("DELETE FROM records")
    # A subsequent real write still performs secure physical expiry cleanup.
    store.put("test", "cleanup", {})
    with store.read() as db:
        assert not db.execute("SELECT 1 FROM records WHERE id=?", (digest("expired"),)).fetchone()


def test_single_use_consumption_stays_atomic_and_revocation_is_fresh(store):
    store.put("token", "ticket", {"value": "once"}, family="grant")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: store.get("token", "ticket", consume=True), range(2)))
    assert results.count({"value": "once"}) == 1 and results.count(None) == 1
    store.put("token", "access", {"value": "allowed"}, family="grant")
    assert store.get("token", "access")
    store.delete_family("grant")
    assert store.get("token", "access") is None


def test_batch_review_uses_one_snapshot_and_next_review_observes_change(bundle, monkeypatch):
    batches, _, payload = setup(bundle, count=2)
    expected = prepare(batches, payload)
    # WAL only in this fixture permits a writer to commit during the read snapshot.
    with sqlite3.connect(batches.store.path) as db:
        db.execute("PRAGMA journal_mode=WAL")
    get = batches.repo.get
    changed = False
    def concurrent_update(seller, draft_id, db=None):
        nonlocal changed
        if not changed:
            changed = True
            current = get(seller, draft_id)
            data = deepcopy(current["draft"])
            data["price_usd"] = "9"
            batches.repo.save(seller, data, current["revision"])
        return get(seller, draft_id, db)
    monkeypatch.setattr(batches.repo, "get", concurrent_update)
    assert batches.review("seller", payload["batch_id"]) == expected
    fresh = batches.review("seller", payload["batch_id"])
    assert len(fresh["exceptions"]) == 1 and fresh["exceptions"][0]["status"] == "stale"
    assert fresh["review_revision"] != expected["review_revision"]


@pytest.mark.parametrize("operation,expected_peak", [("policies", 3), ("category", 2)])
def test_independent_reads_overlap_but_errors_are_drained_and_never_cached(operation, expected_peak):
    async def run():
        selling = Selling(None)
        running, peak, reads, fail = 0, 0, 0, True
        async def request(*a, **kw):
            nonlocal running, peak, reads
            assert a[1] == "GET"
            running += 1
            peak, reads = max(peak, running), reads+1
            try:
                await asyncio.sleep(0.01)
                if fail and ("fulfillment_policy" in a[2] or "get_item_condition" in a[2]):
                    raise SellingError(429)
                return {"marketplaceId": "EBAY_US", "itemConditionPolicies": [], "negotiatedPricePolicies": []}, {}
            finally:
                running -= 1
        selling._request = request
        async def invoke():
            if operation == "category":
                return await selling.category_policies("family", "259104")
            return await selling.policies("family", SimpleNamespace(fulfillment_policy_id="11",
                payment_policy_id="22", return_policy_id="33"))
        with pytest.raises(SellingError) as error:
            await invoke()
        assert error.value.status == 429 and running == 0 and peak == expected_peak
        assert reads == expected_peak
        fail = False
        await invoke()
        assert reads == 2 * expected_peak and running == 0  # no cached failure/success
        await invoke()
        assert reads == 3 * expected_peak
    asyncio.run(run())


def test_cancelled_policy_group_finishes_children_before_returning():
    async def run():
        selling = Selling(None)
        all_started = asyncio.Event()
        running = 0
        async def request(*a, **kw):
            nonlocal running
            running += 1
            if running == 3:
                all_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                running -= 1
        selling._request = request
        task = asyncio.create_task(selling.policies("family", SimpleNamespace(
            fulfillment_policy_id="11", payment_policy_id="22", return_policy_id="33")))
        await all_started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert running == 0
    asyncio.run(run())
