"""Owner-directed conservative labels and safe pre-offer revision recovery."""
import asyncio
from copy import deepcopy

import pytest

from test_listings import bundle as bundle, approve, FakeSelling, run
from test_exterior_listings import exterior
from btco_ebay.listing_drafts import ListingDraft, UNINSPECTED_INTERIOR_DISCLOSURE
from btco_ebay.publishing import Publisher
from btco_ebay.selling import SellingError


@pytest.mark.parametrize("label", ["LIKE_NEW", "USED_EXCELLENT", "USED_VERY_GOOD", "NEW", "GOOD"])
def test_comic_labels_never_exceed_owner_cap(bundle, label):
    _, data, _ = bundle
    data["condition"] = label
    with pytest.raises(ValueError):
        ListingDraft.model_validate(data)


@pytest.mark.parametrize("label", ["USED_GOOD", "USED_ACCEPTABLE"])
def test_conservative_labels_retain_uninspected_disclosure(bundle, label):
    _, data, _ = bundle
    exterior(data)
    data["condition"] = label
    payload = ListingDraft.model_validate(data).inventory_payload([])
    assert payload["condition"] == label
    assert UNINSPECTED_INTERIOR_DISCLOSURE in payload["conditionDescription"]
    assert UNINSPECTED_INTERIOR_DISCLOSURE in payload["product"]["description"]


def started(bundle):
    repo, data, images = bundle
    exterior(data)
    row = approve(repo, data)
    fake = FakeSelling(images)
    fake.failure = "put"
    pub = Publisher(repo, fake, True, collector=fake.collect)
    with pytest.raises(SellingError):
        run(pub, row)
    fake.failure = None
    return repo, data, repo.get("seller", data["draft_id"]), fake, pub


@pytest.mark.parametrize("lost_response", [False, True])
def test_preoffer_condition_change_requires_new_approval_and_reuses_inventory(bundle, lost_response):
    repo, data, old, fake, pub = started(bundle)
    revised = deepcopy(data)
    revised["condition"] = "USED_GOOD"
    row = asyncio.run(pub.revise_preoffer_condition("seller", "family", revised, old["revision"]))
    assert row["approval"] is None and row["revision"] != old["revision"]
    assert row["revision_history"][0]["approval"] == old["approval"]
    assert fake.calls.count("put") == 1 and "create" not in fake.calls
    with pytest.raises(ValueError, match="not been approved"):
        run(pub, row)
    with pytest.raises(ValueError, match="stale"):
        repo.approve("seller", data["draft_id"], old["revision"], "Old approval must not authorize changes.")
    row = repo.approve("seller", data["draft_id"], row["revision"], "Owner explicitly changed the condition to Good.")
    if lost_response:
        fake.failure = "put"
        with pytest.raises(SellingError):
            run(pub, row)
        fake.failure = None
    result = run(pub, row)
    assert result["state"] == "published" and result["receipt"]["revision"] == row["revision"]
    assert fake.item["condition"] == "USED_GOOD"
    assert fake.calls.count("put") == 2 and fake.calls.count("upload") == 2
    assert fake.calls.count("create") == fake.calls.count("publish") == 1
    assert run(pub, row)["receipt"] == result["receipt"]


@pytest.mark.parametrize("risk", ["stale", "changed_inventory", "existing_offer", "offer_attempted", "different_price"])
def test_unsafe_preoffer_revision_is_rejected_without_mutation(bundle, risk):
    repo, data, old, fake, pub = started(bundle)
    revised = deepcopy(data)
    revised["condition"] = "USED_GOOD"
    expected = old["revision"]
    if risk == "stale": expected = "0" * 64
    if risk == "changed_inventory": fake.item["product"]["title"] = "Changed elsewhere"
    if risk == "existing_offer": fake.offer = {"offerId": "555", "status": "UNPUBLISHED"}
    if risk == "offer_attempted":
        old["job"]["offer_attempted"] = True
        repo.write("seller", old)
    if risk == "different_price": revised["price_usd"] = "9"
    before = repo.get("seller", data["draft_id"])
    with pytest.raises(ValueError):
        asyncio.run(pub.revise_preoffer_condition("seller", "family", revised, expected))
    assert repo.get("seller", data["draft_id"]) == before
    assert fake.calls.count("put") == 1 and "create" not in fake.calls


def test_drift_after_reapproval_is_not_overwritten(bundle):
    repo, data, old, fake, pub = started(bundle)
    revised = deepcopy(data)
    revised["condition"] = "USED_ACCEPTABLE"
    staged = asyncio.run(pub.revise_preoffer_condition("seller", "family", revised, old["revision"]))
    row = repo.approve("seller", data["draft_id"], staged["revision"], "Owner explicitly chose Acceptable.")
    fake.item["product"]["description"] = "Changed elsewhere after review."
    with pytest.raises(ValueError, match="Inventory changed"):
        run(pub, row)
    assert fake.calls.count("put") == 1 and "create" not in fake.calls
