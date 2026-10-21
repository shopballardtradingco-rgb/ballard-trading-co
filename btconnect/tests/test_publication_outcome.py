import asyncio
from copy import deepcopy
from hashlib import sha256

import pytest

from test_listings import bundle as bundle, publisher, run
from test_connector import env as env, connect, rpc
from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.listing_store import ListingStore
from btco_ebay.photos import PhotoStore
from btco_ebay.publishing import publication_outcome, Publisher
from btco_ebay.selling import SellingError


def test_live_item_is_returned_when_promotion_read_fails(bundle):
    pub, fake, row = publisher(bundle)
    data = deepcopy(row["draft"])
    data.update(promotion_campaign_id="444", promotion_campaign_sha256="c"*64,
                promotion_unavailable_reason=None, promotion_mode="automatic_existing")
    row = pub.repo.save("seller", data, row["revision"])
    row = pub.repo.approve("seller", data["draft_id"], row["revision"], "Owner approved the full synthetic revision.")
    async def fail(family, draft):
        raise SellingError(409, ["35064"])
    fake.ads = fail
    with pytest.raises(SellingError):
        run(pub, row)
    saved = pub.repo.get("seller", data["draft_id"])
    outcome = publication_outcome(saved)
    assert outcome["stage"] == "promotion"
    assert outcome["status"] == "published_verification_pending"
    assert outcome["item_id"] == "123456789123" and outcome["url"].endswith("123456789123")
    assert not outcome["receipt_available"] and not outcome["all_checks_verified"]
    assert "do not create another listing" in outcome["recovery_action"]
    assert not pub.repo.store.get("publication", "seller:123456789123")
    assert fake.calls.count("publish") == 1


def test_lost_publish_response_is_distinct_from_verified_publication(bundle):
    pub, fake, row = publisher(bundle)
    fake.failure = "publish"
    with pytest.raises(SellingError):
        run(pub, row)
    status = publication_outcome(pub.repo.get("seller", row["draft"]["draft_id"]))
    assert status["status"] == "publication_outcome_unknown" and status["item_id"] is None
    fake.failure = None
    complete = run(pub, row)
    assert publication_outcome(complete)["all_checks_verified"]
    assert pub.repo.store.get("publication", "seller:123456789123") == complete["receipt"]
    assert fake.calls.count("publish") == 1


def test_journal_and_receipt_commit_roll_back_together(bundle, monkeypatch):
    pub, _, row = publisher(bundle)
    put = pub.repo.store.put
    def fail_receipt(kind, *args, **kwargs):
        if kind == "publication":
            raise RuntimeError("Synthetic database write interruption")
        return put(kind, *args, **kwargs)
    monkeypatch.setattr(pub.repo.store, "put", fail_receipt)
    with pytest.raises(RuntimeError):
        run(pub, row)
    # Failure reporting may preserve a job, but never a verified row without a receipt.
    saved = pub.repo.get("seller", row["draft"]["draft_id"])
    assert saved["state"] != "published"
    assert not pub.repo.store.get("publication", "seller:123456789123")


def test_mcp_error_preserves_live_item_and_durable_stage(env, bundle, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    _, source, images = bundle
    data = deepcopy(source)
    photos = PhotoStore(provider.store)
    repo = ListingStore(provider.store, photos)
    data["photos"] = [photos.put("seller-123", raw, sha256(raw).hexdigest(), role).model_dump()
                      for raw, role in zip(images, ["front", "back"])]
    row = repo.save("seller-123", data)
    row["job"] = {"phase": "promotion", "offer_id": "123", "listing_id": "123456789123"}
    repo.write("seller-123", row)
    async def fail(self, *args):
        raise SellingError(409, ["35064"])
    monkeypatch.setattr(Publisher, "run", fail)
    result = rpc(client, tokens["access_token"], "tools/call", {"name": "publish_approved_listing", "arguments": {
        "draft_id": data["draft_id"], "revision": row["revision"]}}).json()["result"]
    assert result["isError"]
    assert result["structuredContent"]["item_id"] == "123456789123"
    assert result["structuredContent"]["stage"] == "promotion"
