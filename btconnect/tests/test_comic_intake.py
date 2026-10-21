"""Synthetic inputs only: no real comics, credentials, paid AI or eBay writes."""
import asyncio
from copy import deepcopy

import pytest
from btco_ebay.comic_intake import ComicIntake, compile_intake
from btco_ebay.listing_drafts import ListingDraft, PolicySelection, UNINSPECTED_INTERIOR_DISCLOSURE
from btco_ebay.listing_validation import NEW_INTERIOR_DISCLOSURE
from test_listings import bundle as bundle
from test_listing_batches import setup, approve, publish
from test_connector import env as env, connect, rpc, tool
from test_listing_contract import new_draft
from btco_ebay.config import SCOPE, WRITE_SCOPE


def intake_from_drafts(drafts, batch_id="btco-batch-intake"):
    first = drafts[0]
    fields = ("policies", "packed_parcel", "merchant_location_key", "category_id",
              "promotion_campaign_id", "promotion_mode", "promotion_campaign_sha256",
              "promotion_unavailable_reason")
    return {"batch_id": batch_id, "inventory_location": "TEST-BOX-01",
            "defaults": {key: first[key] for key in fields if key in first},
            "items": [{"item_key": str(i), "label": f"Synthetic copy {i}", "observations": {
                "photos": d["photos"], "identity": d["identity"], "inspection": d["inspection"],
                "condition": d["condition"], "condition_notes": "Synthetic spine wear on copy " + str(i),
                "price_usd": d["price_usd"],
                "minimum_offer_usd": d["best_offer"]["minimum_offer_usd"],
                "research": {"basis": "asking_only", "rationale": "Synthetic asking evidence, not a sold comp.",
                             "sources": [{"kind": "asking", "url": "https://example.test/comic",
                                          "checked_on": "2026-10-15", "item_price_usd": "8",
                                          "exact_identity_match": True, "condition_comparable": True,
                                          "evidence": "Synthetic asking-price observation only."}]},
            }} for i, d in enumerate(drafts)]}


def assembled(bundle, count=3):
    batches, fake, payload = setup(bundle, count=count)
    source = intake_from_drafts([e["draft"] for e in payload["items"]])
    batch, issues = compile_intake(ComicIntake.model_validate(source))
    assert not issues
    batches.submit("seller", batch.model_dump(mode="json"))
    return batches, fake, source, batch


def test_assembly_retains_evidence_locations_photos_and_explicit_terms(bundle):
    batches, fake, source, batch = assembled(bundle)
    result = asyncio.run(batches.prepare("seller", "family", batch.batch_id))
    assert len(result["listings"]) == 3 and not fake.calls
    assert len({i["listing_sku"] for i in result["listings"]}) == 3
    for i, item in enumerate(result["listings"]):
        draft = item["draft"]
        assert draft["photos"] == source["items"][i]["observations"]["photos"]
        assert draft["policies"] == PolicySelection.model_validate(source["defaults"]["policies"]).model_dump()
        assert draft["price_usd"] == "8" and draft["best_offer"]["minimum_offer_usd"] == "6"
        assert item["inventory_location"] == "TEST-BOX-01"
        assert item["preparation_evidence"]["research"]["basis"] == "asking_only"
        assert "example.test" not in draft["description"]  # internal research is not buyer copy
        assert f"copy {i}" in draft["description"]
        assert NEW_INTERIOR_DISCLOSURE in draft["description"]
        assert UNINSPECTED_INTERIOR_DISCLOSURE in draft["condition_description"]
        assert batches.repo.get("seller", draft["draft_id"])["approval"] is None
    with pytest.raises(ValueError):
        publish(batches, result)
    assert not fake.calls


@pytest.mark.parametrize("change", [
    {"identity": {"verified": False}},
    {"price_usd": "7.99"}, {"minimum_offer_usd": None},
    {"price_usd": "5", "minimum_offer_usd": "3"},
    {"condition": "LIKE_NEW"}, {"condition_notes": ""},
    {"condition_notes": " " * 30},
    {"research": {"rationale": " " * 30}},
    {"research": {"basis": "sold_comps"}},
    {"research": {"basis": "owner_price"}},
    {"inspection": {"scope": "invented"}},
    {"identity": {"series": "A" * 120}},
])
def test_one_bad_book_does_not_block_others_or_invent_details(bundle, change):
    _, _, payload = setup(bundle, count=2)
    source = intake_from_drafts([e["draft"] for e in payload["items"]])
    target = source["items"][0]["observations"]
    for key, value in change.items():
        if isinstance(value, dict):
            target[key].update(value)
        else:
            target[key] = value
    batch, issues = compile_intake(ComicIntake.model_validate(source))
    assert len(issues) == 1 and batch.items[0].draft is None
    assert batch.items[1].draft is not None


def test_unknown_variant_and_printing_remain_unknown(bundle):
    _, _, payload = setup(bundle, count=1)
    source = intake_from_drafts([payload["items"][0]["draft"]])
    obs = source["items"][0]["observations"]
    obs["identity"].update(verification_scope="cover_identity", printing=None, variant=None)
    obs.update(price_usd="5", minimum_offer_usd=None)
    batch, issues = compile_intake(ComicIntake.model_validate(source))
    assert not issues
    draft = batch.items[0].draft
    assert draft["identity"]["printing"] is None and draft["identity"]["variant"] is None
    assert "Printing:" not in draft["description"] and "Variant" not in draft["item_specifics"]
    assert draft["best_offer"] == {"enabled": False, "minimum_offer_usd": None}


@pytest.mark.parametrize("source_change", [
    {"kind": "sold", "sold_on": None},
    {"kind": "sold", "sold_on": "2026-10-14", "exact_identity_match": False},
    {"kind": "sold", "sold_on": "2026-10-14", "condition_comparable": False},
    {"kind": "sold", "sold_on": "2026-10-16"},
    {"url": "https://user:secret@example.test/item"},
    {"item_price_usd": "NaN"}, {"evidence": " " * 20},
])
def test_no_false_sold_comps_or_invalid_sources(bundle, source_change):
    _, _, payload = setup(bundle, count=1)
    source = intake_from_drafts([payload["items"][0]["draft"]])
    research = source["items"][0]["observations"]["research"]
    research["basis"] = "sold_comps"
    research["sources"][0].update(source_change)
    batch, issues = compile_intake(ComicIntake.model_validate(source))
    assert issues and batch.items[0].draft is None


def test_exact_sold_evidence_is_kept_and_unresolved_input_is_recoverable(bundle):
    batches, _, payload = setup(bundle, count=2)
    source = intake_from_drafts([e["draft"] for e in payload["items"]])
    research = source["items"][0]["observations"]["research"]
    research["basis"] = "sold_comps"
    research["sources"][0].update(kind="sold", sold_on="2026-10-14")
    source["items"][1]["observations"]["identity"]["verified"] = False
    batch, issues = compile_intake(ComicIntake.model_validate(source))
    assert len(issues) == 1
    batches.submit("seller", batch.model_dump())
    review = asyncio.run(batches.prepare("seller", "family", batch.batch_id))
    assert review["listings"][0]["preparation_evidence"]["research"]["basis"] == "sold_comps"
    held = review["exceptions"][0]["preparation_evidence"]["observations_needing_review"]
    assert held == source["items"][1]["observations"]


def test_optional_evidence_preserves_historical_batch_serialization(bundle):
    from btco_ebay.listing_batches import BatchInput
    from btco_ebay.listing_drafts import fingerprint
    batches, _, payload = setup(bundle, count=1)
    historical = BatchInput.model_validate(payload).model_dump(mode="json")
    for item in historical["items"]:
        item.pop("preparation_evidence")
    row = batches.submit("seller", payload)
    assert row["revision"] == fingerprint(historical) and row["input"] == historical


def test_unresolved_and_card_input_are_held_without_guessing(bundle):
    _, _, payload = setup(bundle, count=1)
    source = intake_from_drafts([payload["items"][0]["draft"]])
    source["items"] += [{"item_key": "unknown", "label": "Unknown book",
                         "unresolved_reason": "Need indicia photo to distinguish editions."},
                        {"item_key": "card", "label": "Card not supported",
                         "observations": {"player": "Synthetic Player", "year": 2026}}]
    batch, issues = compile_intake(ComicIntake.model_validate(source))
    assert len(issues) == 1 and len(batch.items) == 3
    assert batch.items[1].draft is None and batch.items[2].draft is None


def test_saved_ids_stable_retry_and_exact_cdp_sku_preservation(bundle):
    _, _, payload = setup(bundle, count=1)
    source = intake_from_drafts([payload["items"][0]["draft"]])
    obs = source["items"][0]["observations"]
    obs.update(master_sku=" CDP-Exact-01 ", physical_item_id="recorded-copy")
    one, _ = compile_intake(ComicIntake.model_validate(source))
    source["batch_id"] = "btco-batch-another-chat"
    two, _ = compile_intake(ComicIntake.model_validate(source))
    assert one.items[0].draft == two.items[0].draft
    assert ListingDraft.model_validate(one.items[0].draft).listing_sku == " CDP-Exact-01 "


def test_preparation_is_bounded_resumes_pending_and_keeps_successes(bundle):
    batches, fake, _, batch = assembled(bundle, count=5)
    first = asyncio.run(batches.prepare("seller", "family", batch.batch_id, max_items=2))
    assert len(first["listings"]) == 2 and first["continue_preparation"]
    second = asyncio.run(batches.prepare("seller", "family", batch.batch_id, max_items=2))
    assert len(second["listings"]) == 4
    third = asyncio.run(batches.prepare("seller", "family", batch.batch_id, max_items=2))
    assert len(third["listings"]) == 5 and not third["continue_preparation"]
    assert third["preparation_metrics"]["attempts"] == 5
    reads = len(fake.policy_reads)
    final = asyncio.run(batches.prepare("seller", "family", batch.batch_id))
    assert len(fake.policy_reads) == reads and final["review_revision"] == third["review_revision"]
    assert final["preparation_metrics"]["calls"] == 4
    assert not fake.calls


def test_persistent_failure_does_not_starve_new_items(bundle):
    batches, fake, payload = setup(bundle, count=5)
    payload["items"][0]["draft"]["price_usd"] = "7.99"
    batches.submit("seller", payload)
    for _ in range(5):
        result = asyncio.run(batches.prepare("seller", "family", payload["batch_id"], max_items=1))
    assert len(result["listings"]) == 4 and len(result["exceptions"]) == 1
    assert result["preparation_metrics"]["attempts"] == 5


def test_timeout_persists_partial_progress_and_retries_only_failed_item(bundle):
    batches, fake, payload = setup(bundle, count=2)
    payload["items"][1]["draft"]["condition"] = "USED_ACCEPTABLE"
    batches.submit("seller", payload)
    normal = fake.validate_policies
    async def slow(family, draft):
        if draft.condition == "USED_ACCEPTABLE":
            await asyncio.sleep(2)
        await normal(family, draft)
    fake.validate_policies = slow
    result = asyncio.run(batches.prepare("seller", "family", payload["batch_id"], timeout=0.1))
    assert len(result["listings"]) == len(result["exceptions"]) == 1
    fake.validate_policies = normal
    final = asyncio.run(batches.prepare("seller", "family", payload["batch_id"]))
    assert len(final["listings"]) == 2
    assert final["preparation_metrics"]["per_item"]["0"]["attempts"] == 1
    assert final["preparation_metrics"]["per_item"]["1"]["attempts"] == 2


def test_research_changes_invalidate_batch_approval_even_if_buyer_text_is_same(bundle):
    batches, _, source, batch = assembled(bundle, count=1)
    review = asyncio.run(batches.prepare("seller", "family", batch.batch_id))
    approve(batches, review)
    source["items"][0]["observations"]["research"]["rationale"] = "Corrected source interpretation for review."
    changed, _ = compile_intake(ComicIntake.model_validate(source))
    with pytest.raises(ValueError, match="Batch changed"):
        batches.submit("seller", changed.model_dump())
    batches.submit("seller", changed.model_dump(), review["batch_revision"])
    fresh = asyncio.run(batches.prepare("seller", "family", batch.batch_id))
    assert fresh["review_revision"] != review["review_revision"] and not fresh["approval_current"]
    with pytest.raises(ValueError):
        publish(batches, review)


def test_mcp_intake_permissions_complete_review_and_zero_ebay_writes(env, bundle, monkeypatch):
    client, _, _, _ = env
    async def nothing(*args):
        pass
    async def active(*args):
        return []
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_policies", nothing)
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_promotion", nothing)
    monkeypatch.setattr("btco_ebay.publishing.Publisher.active", active)
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    source = intake_from_drafts([new_draft(env, bundle)])
    result = tool(client, token, "prepare_comic_intake", {"intake": source})
    assert len(result["listings"]) == 1 and not result["approval_current"]
    assert result["listings"][0]["research_basis"] == "asking_only"
    full = tool(client, token, "get_listing_batch_review", {"batch_id": source["batch_id"]})
    assert full["listings"][0]["preparation_evidence"]["research"]["sources"]
    contract = tool(client, token, "get_comic_intake_contract")
    assert "research" in contract["observations_schema"]["properties"]
    _, read = connect(env)
    denied = rpc(client, read["access_token"], "tools/call", {
        "name": "prepare_comic_intake", "arguments": {"intake": source}}).json()["result"]
    assert denied["isError"] and "mcp/www_authenticate" in denied["_meta"]
