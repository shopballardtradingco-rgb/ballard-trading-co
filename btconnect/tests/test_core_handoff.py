"""Core-to-GitHub handoff recovery; synthetic inventory and eBay only."""
import asyncio
import base64
from copy import deepcopy
import json
import os

import pytest

from btco_ebay.core_handoff import import_input, validate_input
from btco_ebay.github_journal import JournalUnavailable
from btco_ebay.github_worker import run_batch
from btco_ebay.listing_batches import ListingBatches
from btco_ebay.listing_store import ListingStore
from btco_ebay.photos import PhotoStore
from btco_ebay.publishing import Publisher
from test_cards import card
from test_github_worker import seed, restore
from test_listing_batches import MultiSelling
from test_listings import bundle


def handoff(bundle):
    repo, data, images = bundle
    draft = card(deepcopy(data))
    draft.update(physical_item_id="core:synthetic", best_offer={"enabled": True, "minimum_offer_usd": "6"})
    return {"format": "btcore-publisher-input-v1", "seller": "seller", "core_batch_id": "synthetic",
            "core_revision": 5, "core_state_sha256": "a" * 64,
            "batches": [{"batch_id": "btco-batch-synthetic-0", "inventory_location": "TEST",
                         "items": [{"item_key": "synthetic", "label": draft["title"], "draft": draft}],
                         "confirmed_rejection_retry_limit": 0}],
            "originals": [{"sha256_hex": draft["photos"][0]["sha256_hex"],
                           "original": base64.b64encode(images[0]).decode()}]}


def test_import_restores_publishes_once_and_reimport_preserves_receipt(bundle, tmp_path):
    payload = handoff(bundle)
    api, _, key, archive = seed(tmp_path / "seed")
    journal, store = restore(api, tmp_path / "first", key, archive)
    store.put("grant", "family", {"user_id": "seller"}, family="family")
    repo = ListingStore(store, PhotoStore(store))
    result = import_input(repo, "seller", payload)
    assert result["cards"] == result["originals"] == 1
    assert not result["approval_granted"] and not result["live_publication_attempted"]
    _, store = restore(api, tmp_path / "second", key, archive)
    repo = ListingStore(store, PhotoStore(store))
    fake = MultiSelling(bundle[2])
    engine = ListingBatches(repo, Publisher(repo, fake, True, collector=fake.collect))
    batch_id = result["batches"][0]["batch_id"]
    review = asyncio.run(run_batch(engine, "seller", "family", batch_id, "prepare"))
    assert len(review["listings"]) == 1, review["exceptions"]
    assert not review["approval_current"] and "publish" not in fake.calls
    with pytest.raises(ValueError, match="approval"):
        asyncio.run(run_batch(engine, "seller", "family", batch_id, "publish", review["review_revision"]))
    review = asyncio.run(run_batch(engine, "seller", "family", batch_id, "publish",
                        review["review_revision"], True, "synthetic-owner"))
    assert review["verified_count"] == 1
    saved = repo.get("seller", "btco-card-synthetic")
    _, store = restore(api, tmp_path / "third", key, archive)
    repo = ListingStore(store, PhotoStore(store))
    import_input(repo, "seller", payload)
    assert repo.get("seller", "btco-card-synthetic") == saved
    engine = ListingBatches(repo, Publisher(repo, fake, True, collector=fake.collect))
    asyncio.run(run_batch(engine, "seller", "family", batch_id, "publish", review["review_revision"]))
    assert fake.calls.count("create") == fake.calls.count("publish") == 1


def test_import_recovers_checkpoint_reply_lost_after_photo(bundle, tmp_path):
    payload = handoff(bundle)
    api, _, key, archive = seed(tmp_path / "seed")
    _, store = restore(api, tmp_path / "first", key, archive)
    repo = ListingStore(store, PhotoStore(store))
    api.lose_patch_reply = True
    with pytest.raises(JournalUnavailable):
        import_input(repo, "seller", payload)
    api.lose_patch_reply = False
    _, store = restore(api, tmp_path / "restart", key, archive)
    repo = ListingStore(store, PhotoStore(store))
    assert import_input(repo, "seller", payload)["cards"] == 1
    review = ListingBatches(repo, None).review("seller", "btco-batch-synthetic-0")
    assert not review["approval_current"] and review["preparation_pending"]
    assert len(list(repo.photos.root.rglob("*.jpeg"))) == 1


@pytest.mark.parametrize("case", ["seller", "checksum", "missing", "duplicate", "physical", "batch", "retry", "approval"])
def test_invalid_handoff_never_writes_a_batch(bundle, case):
    payload = handoff(bundle)
    if case == "seller": payload["seller"] = "other"
    if case == "checksum": payload["originals"][0]["original"] = base64.b64encode(b"changed").decode()
    if case == "missing": payload["originals"] = []
    if case == "duplicate": payload["batches"][0]["items"] *= 2
    if case == "physical": payload["batches"][0]["items"][0]["draft"]["physical_item_id"] = "another-copy"
    if case == "batch": payload["batches"][0]["batch_id"] = "btco-batch-another-0"
    if case == "retry": payload["batches"][0]["confirmed_rejection_retry_limit"] = 1
    if case == "approval": payload["approval"] = True
    with pytest.raises(ValueError): import_input(bundle[0], "seller", payload)
    assert bundle[0].store.get("listing-batch", "seller:btco-batch-synthetic-0") is None


def test_changed_input_cannot_replace_import_or_uncertain_publication(bundle):
    repo = bundle[0]
    payload = handoff(bundle)
    import_input(repo, "seller", payload)
    changed = deepcopy(payload)
    changed["batches"][0]["items"][0]["draft"]["price_usd"] = "9"
    before = ListingBatches(repo, None).get("seller", "btco-batch-synthetic-0")
    with pytest.raises(ValueError, match="different Core snapshot"):
        import_input(repo, "seller", changed)
    assert ListingBatches(repo, None).get("seller", "btco-batch-synthetic-0") == before
    old = card(bundle[1]);old["price_usd"] = "10"
    row = repo.save("seller", old)
    row["job"] = {"publish_attempted": True}
    repo.write("seller", row)
    with pytest.raises(ValueError, match="different content"):
        import_input(repo, "seller", payload)
    assert repo.get("seller", old["draft_id"])["job"] == {"publish_attempted": True}


@pytest.mark.skipif(not os.getenv("BTCO_CORE_HANDOFF_FILE"), reason="Cross-repository exporter runs in public source CI")
def test_actual_core_export_passes_connector_contract_and_prepare(bundle):
    with open(os.environ["BTCO_CORE_HANDOFF_FILE"]) as stream:
        payload = json.load(stream)
    repo = bundle[0]
    repo.store.put("grant", "family", {"user_id": "seller"}, family="family")
    result = import_input(repo, "seller", payload)
    assert result["cards"] == 1 and not result["approval_granted"]
    fake = MultiSelling([base64.b64decode(x["original"]) for x in payload["originals"]])
    # The synthetic exporter selects a fixed existing 5% campaign.
    fake.validate_promotion = fake_no_promotion_write
    engine = ListingBatches(repo, Publisher(repo, fake, True, collector=fake.collect))
    review = asyncio.run(run_batch(engine, "seller", "family", result["batches"][0]["batch_id"], "prepare"))
    assert len(review["listings"]) == 1, review["exceptions"]
    assert review["listings"][0]["draft"]["master_sku"] == "EXACT-SYNTHETIC-SKU"
    assert not review["approval_current"] and "publish" not in fake.calls


async def fake_no_promotion_write(*args):
    return {}
