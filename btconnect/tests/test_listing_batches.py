"""Interrupted multi-comic workflows against synthetic originals and fake eBay."""
import asyncio
from copy import deepcopy
from hashlib import sha256
import time

import pytest
from btco_ebay.listing_batches import ListingBatches, BatchInput
from btco_ebay.listing_drafts import ListingDraft, UNINSPECTED_INTERIOR_DISCLOSURE
from btco_ebay.listing_store import ListingStore
from btco_ebay.listing_validation import NEW_INTERIOR_DISCLOSURE
from btco_ebay.publishing import Publisher
from btco_ebay.selling import SellingError
from test_listings import bundle as bundle, original, FakeSelling


class MultiSelling(FakeSelling):
    def __init__(self, images):
        super().__init__(images)
        self.items, self.saved_offers = {}, {}
        self.failures = {}
        self.policy_reads = []
        self.upload_failure = False

    async def validate_policies(self, family, draft):
        self.policy_reads.append((draft.condition, draft.merchant_location_key))
        if self.bad_policy or draft.merchant_location_key == "invalid-location":
            raise ValueError("Policy changed")

    async def upload(self, family, photo, data):
        if self.upload_failure:
            self.upload_failure = False
            self.calls.append("invalid_image_reference")
            raise ValueError("eBay did not provide a valid image resource reference")
        return await super().upload(family, photo, data)

    async def get_item(self, family, sku):
        return deepcopy(self.items.get(sku))

    async def put_item(self, family, draft, urls):
        self.calls.append("put")
        self.items[draft.listing_sku] = draft.inventory_payload(urls)

    async def offers(self, family, sku):
        return [deepcopy(o) for o in self.saved_offers.values() if o["sku"] == sku]

    async def get_offer(self, family, identifier):
        return deepcopy(self.saved_offers[identifier])

    async def create_offer(self, family, draft):
        self.calls.append("create")
        identifier = str(100 + len(self.saved_offers))
        self.saved_offers[identifier] = {**draft.offer_payload(), "offerId": identifier, "status": "UNPUBLISHED"}
        return {"offerId": identifier}

    async def publish(self, family, identifier):
        self.calls.append("publish")
        offer = self.saved_offers[identifier]
        failure = self.failures.pop(offer["sku"], None)
        if failure in ("rejected", "uncertain"):
            raise SellingError(400 if failure == "rejected" else None, ["25604"])
        item_id = str(123456780000 + int(identifier))
        offer.update(status="PUBLISHED", listing={"listingId": item_id})
        if failure == "lost_success":
            raise SellingError()
        return {"listingId": item_id}

    async def collect(self, ebay, family, page):
        records = [{"item_id": o["listing"]["listingId"], "sku": o["sku"],
                    "title": self.items[o["sku"]]["product"]["title"], "price": o["pricingSummary"]["price"]}
                   for o in self.saved_offers.values() if o["status"] == "PUBLISHED"]
        return {"records": records, "page": 1, "total_matching": len(records), "next_page": None}


def setup(bundle, count=3, retry_limit=0):
    repo, source, images = bundle
    repo.store.put("grant", "family", {"user_id": "seller"}, family="family")
    images = list(images)
    entries = []
    for i in range(count):
        data = deepcopy(source)
        data.update(draft_id=f"btco-comic-batch-test-{i}", physical_item_id=f"copy-{i}",
                    master_sku=f"SKU-{i}", title=f"Synthetic Comic #{i} Test Publisher",
                    best_offer={"enabled": True, "minimum_offer_usd": "6"},
                    packed_parcel={"weight_oz": "12", "length_in": "13", "width_in": "8", "height_in": "2",
                                   "verified": True, "evidence": "Synthetic scale measurements, not inventory."},
                    inspection={"scope": "exterior_only", "evidence": "Synthetic exterior-only test photographs."})
        data["photos"] = []
        for j, role in enumerate(("front", "back")):
            raw = original((20 + i * 5, 20 + j * 80, 50))
            images.append(raw)
            data["photos"].append(repo.photos.put("seller", raw, sha256(raw).hexdigest(), role).model_dump())
        entries.append({"item_key": str(i), "label": f"Synthetic #{i}", "draft": data})
    fake = MultiSelling(images)
    pub = Publisher(repo, fake, enabled=True, collector=fake.collect)
    batches = ListingBatches(repo, pub)
    payload = {"batch_id": "btco-batch-test", "inventory_location": "SIMPLE-TRUTH-SEC3-2",
               "items": entries, "confirmed_rejection_retry_limit": retry_limit}
    return batches, fake, payload


def prepare(batches, payload):
    batches.submit("seller", payload)
    return asyncio.run(batches.prepare("seller", "family", payload["batch_id"]))


def approve(batches, review):
    return batches.approve("seller", review["batch_id"], review["review_revision"],
                           "Owner explicitly approved all displayed revisions, original photos and retry policy.")


def publish(batches, review, **kwargs):
    return asyncio.run(batches.publish("seller", "family", review["batch_id"], review["review_revision"], **kwargs))


def make_due(batches, key):
    row = batches.get("seller", "btco-batch-test")
    row["publication_results"][key]["retry_after"] = 0
    batches.write(row)


def test_full_batch_one_approval_persistent_resume_and_no_duplicate_writes(bundle):
    batches, fake, payload = setup(bundle)
    review = prepare(batches, payload)
    assert len(review["listings"]) == 3 and review["asking_total_usd"] == "24"
    assert len(fake.policy_reads) == 1  # identical requirements share only this call's read
    for item in review["listings"]:
        assert item["inventory_location"] == "SIMPLE-TRUTH-SEC3-2"
        assert UNINSPECTED_INTERIOR_DISCLOSURE in item["draft"]["condition_description"]
        assert NEW_INTERIOR_DISCLOSURE in item["draft"]["description"]
        assert item["text_additions"]
    approve(batches, review)
    first = publish(batches, review, max_items=1)
    assert first["verified_count"] == 1 and first["continue_automatically"]
    restarted = ListingBatches(ListingStore(batches.store, batches.repo.photos), batches.publisher)
    assert restarted.submit("seller", payload)["approval"]  # lost submit response doesn't reset approval
    final = publish(restarted, review)
    assert final["complete"] and final["verified_count"] == 3
    before = list(fake.calls)
    assert publish(restarted, review)["complete"] and fake.calls == before
    assert fake.calls.count("create") == fake.calls.count("publish") == 3
    assert len({i["publication"]["item_id"] for i in final["listings"]}) == 3


def test_bad_identity_and_explicit_unresolved_do_not_block_good_drafts(bundle):
    batches, fake, payload = setup(bundle)
    payload["items"][1]["draft"]["identity"]["verified"] = False
    payload["items"][2] = {"item_key": "2", "label": "Unidentified comic",
                            "unresolved_reason": "Issue number not visible; need original cover inspection."}
    review = prepare(batches, payload)
    assert len(review["listings"]) == 1 and len(review["exceptions"]) == 2
    approve(batches, review)
    result = publish(batches, review)
    assert result["verified_count"] == 1 and not result["complete"]
    assert not result["continue_automatically"]


@pytest.mark.parametrize("field", ["price_usd", "photos"])
def test_changed_saved_draft_invalidates_entire_review_before_publication(bundle, field):
    batches, fake, payload = setup(bundle, count=1)
    review = prepare(batches, payload)
    approve(batches, review)
    item = review["listings"][0]
    changed = deepcopy(item["draft"])
    if field == "price_usd":
        changed[field] = "9"
    else:
        changed[field].reverse()
        changed[field][0]["role"] = "front"
        changed[field][1]["role"] = "back"
    batches.repo.save("seller", changed, item["revision"])
    with pytest.raises(ValueError, match="approved"):
        publish(batches, review)
    assert not fake.calls


def test_batch_location_retry_policy_and_cas_are_bound(bundle):
    batches, fake, payload = setup(bundle, count=1)
    review = prepare(batches, payload)
    approve(batches, review)
    changed = deepcopy(payload)
    changed.update(inventory_location="NEW-PHYSICAL-LOCATION", confirmed_rejection_retry_limit=1)
    with pytest.raises(ValueError, match="revision"):
        batches.submit("seller", changed)
    batches.submit("seller", changed, review["batch_revision"])
    with pytest.raises(ValueError, match="approved"):
        publish(batches, review)
    fresh = asyncio.run(batches.prepare("seller", "family", payload["batch_id"]))
    assert fresh["review_revision"] != review["review_revision"]
    assert not fresh["approval_current"]


def test_atomic_approval_rolls_back_if_any_original_corrupted(bundle):
    batches, fake, payload = setup(bundle)
    review = prepare(batches, payload)
    bad = review["listings"][-1]["draft"]["photos"][0]
    (batches.repo.photos.root / bad["object_key"]).write_bytes(b"corrupted")
    with pytest.raises(ValueError, match="integrity"):
        approve(batches, review)
    assert all(batches.repo.get("seller", i["draft_id"])["approval"] is None for i in review["listings"])
    assert batches.get("seller", payload["batch_id"])["approval"] is None


def test_photo_failure_retries_only_missing_uploads_and_processes_rest(bundle):
    batches, fake, payload = setup(bundle)
    review = prepare(batches, payload)
    approve(batches, review)
    fake.upload_failure = True
    result = publish(batches, review)
    assert result["verified_count"] == 2
    assert result["listings"][0]["last_attempt"]["disposition"] == "retry_later"
    make_due(batches, "0")
    final = publish(batches, review)
    assert final["complete"] and fake.calls.count("upload") == 6
    assert fake.calls.count("create") == fake.calls.count("publish") == 3


@pytest.mark.parametrize("failure", ["uncertain", "lost_success"])
def test_uncertain_publication_only_reconciles_same_offer(bundle, failure):
    batches, fake, payload = setup(bundle, count=2, retry_limit=1)
    review = prepare(batches, payload)
    approve(batches, review)
    fake.failures["SKU-0"] = failure
    first = publish(batches, review)
    assert first["verified_count"] == 1  # second comic continued
    make_due(batches, "0")
    final = publish(batches, review)
    assert fake.calls.count("publish") == 2 and fake.calls.count("create") == 2
    if failure == "lost_success":
        assert final["complete"]
    else:
        assert final["listings"][0]["last_attempt"]["disposition"] == "owner_action"
        assert final["listings"][0]["publication"]["status"] == "publication_outcome_unknown"


def test_explicit_batch_policy_permits_one_confirmed_rejection_retry(bundle):
    batches, fake, payload = setup(bundle, count=1, retry_limit=1)
    review = prepare(batches, payload)
    approve(batches, review)
    fake.failures["SKU-0"] = "rejected"
    first = publish(batches, review)
    assert first["verified_count"] == 0 and fake.calls.count("publish") == 1
    assert publish(batches, review)["processed_item_keys"] == []  # respects five-minute wait
    current = batches.repo.get("seller", review["listings"][0]["draft_id"])
    current["job"]["publish_requested_at"] = time.time() - 600
    batches.repo.write("seller", current)
    make_due(batches, "0")
    final = publish(batches, review)
    assert final["complete"] and fake.calls.count("publish") == 2
    assert fake.calls.count("create") == 1 and fake.calls.count("upload") == 2
    assert batches.repo.get("seller", review["listings"][0]["draft_id"])["job"]["publish_recovery"]["consumed"]


def test_no_recovery_policy_never_rearms_confirmed_rejection(bundle):
    batches, fake, payload = setup(bundle, count=1)
    review = prepare(batches, payload)
    approve(batches, review)
    fake.failures["SKU-0"] = "rejected"
    publish(batches, review)
    make_due(batches, "0")
    final = publish(batches, review)
    assert not final["complete"] and fake.calls.count("publish") == 1
    assert not batches.repo.get("seller", review["listings"][0]["draft_id"])["job"].get("publish_recovery")


def test_owner_exception_does_not_starve_later_items_in_one_item_chunks(bundle):
    batches, fake, payload = setup(bundle)
    review = prepare(batches, payload)
    approve(batches, review)
    row = batches.get("seller", "btco-batch-test")
    row["publication_results"]["0"] = {"disposition": "owner_action", "at": 0}
    batches.write(row)
    assert publish(batches, review, max_items=1)["verified_count"] == 1
    assert publish(batches, review, max_items=1)["verified_count"] == 2
    assert fake.calls.count("publish") == 2


def test_cancelled_preparation_resumes_saved_inputs(bundle):
    batches, fake, payload = setup(bundle)
    batches.submit("seller", payload)
    normal = fake.validate_policies
    async def cancel(*args):
        raise asyncio.CancelledError()
    fake.validate_policies = cancel
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(batches.prepare("seller", "family", payload["batch_id"]))
    assert len(batches.review("seller", payload["batch_id"])["preparation_pending"]) == 3
    fake.validate_policies = normal
    assert len(asyncio.run(batches.prepare("seller", "family", payload["batch_id"]))["listings"]) == 3


def test_policy_cache_does_not_skip_changed_condition_or_merchant_location(bundle):
    batches, fake, payload = setup(bundle)
    payload["items"][1]["draft"]["condition"] = "USED_ACCEPTABLE"
    payload["items"][2]["draft"]["merchant_location_key"] = "invalid-location"
    review = prepare(batches, payload)
    assert len(fake.policy_reads) == 3 and len(review["exceptions"]) == 1


def test_ownership_lock_and_duplicate_claims(bundle):
    batches, fake, payload = setup(bundle)
    review = prepare(batches, payload)
    with pytest.raises(ValueError, match="seller"):
        batches.get("other-seller", payload["batch_id"])
    assert batches.store.list_owned("listing-batch", "other-seller")["records"] == []
    with batches.lock("seller", payload["batch_id"]):
        with pytest.raises(ValueError, match="already running"):
            approve(batches, review)
    duplicate = deepcopy(payload)
    duplicate["batch_id"] = "btco-batch-duplicate"
    duplicate["items"][0]["draft"]["draft_id"] = "btco-comic-replacement"
    duplicate["items"][0]["draft"]["physical_item_id"] = "new-id-same-photo"
    duplicate["items"][0]["draft"]["master_sku"] = "new-sku"
    result = prepare(batches, duplicate)
    assert result["exceptions"][0]["status"] == "exception"


def test_schema_rejects_duplicate_item_keys_and_draft_ids(bundle):
    _, _, payload = setup(bundle)
    payload["items"][1]["item_key"] = "0"
    with pytest.raises(ValueError):
        BatchInput.model_validate(payload)


def test_saved_draft_discovery_recovers_photo_pairs_and_is_seller_scoped(bundle):
    batches, _, payload = setup(bundle)
    review = prepare(batches, payload)
    first, cursor = batches.repo.list("seller", limit=1)
    assert len(first) == 1 and cursor
    rest, cursor2 = batches.repo.list("seller", after=cursor, limit=10)
    assert len(rest) == 2 and cursor2 is None
    assert batches.repo.list("other-seller") == ([], None)
    assert first[0]["draft"]["photos"] == review["listings"][0]["draft"]["photos"]


def test_rejected_retry_timeout_does_not_rearm_again(bundle):
    batches, fake, payload = setup(bundle, count=1, retry_limit=1)
    review = prepare(batches, payload)
    approve(batches, review)
    fake.failures["SKU-0"] = "rejected"
    publish(batches, review)
    current = batches.repo.get("seller", review["listings"][0]["draft_id"])
    current["job"]["publish_requested_at"] = time.time() - 600
    batches.repo.write("seller", current)
    make_due(batches, "0")
    fake.failures["SKU-0"] = "uncertain"
    publish(batches, review)
    make_due(batches, "0")
    result = publish(batches, review)
    assert not result["complete"]
    assert fake.calls.count("publish") == 2 and fake.calls.count("create") == 1
    assert result["listings"][0]["last_attempt"]["disposition"] == "owner_action"


def test_chunk_timeout_persists_result_and_does_not_repeat_uncertain_write(bundle):
    batches, fake, payload = setup(bundle, count=1)
    review = prepare(batches, payload)
    approve(batches, review)
    async def hanging_publish(family, identifier):
        fake.calls.append("publish")
        await asyncio.sleep(5)
    fake.publish = hanging_publish
    result = publish(batches, review, timeout=0.05)
    assert result["listings"][0]["publication"]["status"] == "publication_outcome_unknown"
    make_due(batches, "0")
    publish(batches, review, timeout=0.05)
    assert fake.calls.count("publish") == 1


def test_schema_does_not_add_fields_or_change_historical_draft_revision(bundle):
    repo, source, _ = bundle
    before = ListingDraft.model_validate(source)
    saved = repo.save("seller", source)
    data = deepcopy(saved["draft"])
    assert "inventory_location" not in data
    assert ListingDraft.model_validate(data).revision() == before.revision()


def test_policy_drift_after_review_stops_publication_without_writes(bundle):
    batches, fake, payload = setup(bundle, count=1)
    review = prepare(batches, payload)
    approve(batches, review)
    fake.bad_policy = True
    result = publish(batches, review)
    assert result["verified_count"] == 0 and not fake.calls
    assert result["listings"][0]["last_attempt"]["disposition"] == "owner_action"


def test_shared_failed_policy_read_is_not_repeated_for_every_comic(bundle):
    batches, fake, payload = setup(bundle)
    fake.bad_policy = True
    review = prepare(batches, payload)
    assert len(review["exceptions"]) == 3 and len(fake.policy_reads) == 1
    fake.bad_policy = False
    resumed = asyncio.run(batches.prepare("seller", "family", payload["batch_id"]))
    assert len(resumed["listings"]) == 3 and len(fake.policy_reads) == 2  # next call refreshes


def test_disabled_publication_cannot_lock_or_mutate_batch(bundle):
    batches, fake, payload = setup(bundle, count=1)
    review = prepare(batches, payload)
    approve(batches, review)
    batches.publisher.enabled = False
    before = batches.get("seller", payload["batch_id"])
    with pytest.raises(ValueError, match="disabled"):
        publish(batches, review)
    assert batches.get("seller", payload["batch_id"]) == before and not fake.calls


def test_preflight_only_failure_allows_corrected_batch_with_new_approval(bundle):
    batches, fake, payload = setup(bundle, count=1)
    review = prepare(batches, payload)
    approve(batches, review)
    fake.bad_policy = True
    publish(batches, review)
    payload["items"][0]["draft"]["price_usd"] = "9"
    payload["items"][0]["expected_draft_revision"] = review["listings"][0]["revision"]
    updated = batches.submit("seller", payload, review["batch_revision"])
    assert updated["approval"] is None and not updated["publication_started"] and not fake.calls
