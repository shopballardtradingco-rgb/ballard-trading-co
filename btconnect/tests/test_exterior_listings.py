"""Exterior-only disclosures, unknown editions, and read-only automatic promotion."""

import asyncio
from copy import deepcopy

import httpx
import pytest

from test_connector import env as env
from test_listing_http import selling_adapter
from test_listings import bundle as bundle, approve, FakeSelling, run
from btco_ebay.listing_drafts import ListingDraft, UNINSPECTED_INTERIOR_DISCLOSURE
from btco_ebay.publishing import Publisher, inventory_matches
from btco_ebay.selling import Selling


def exterior(data):
    data["identity"].update(verification_scope="cover_identity", printing=None, variant=None,
                            evidence="Synthetic cover and reference evidence; no indicia inspection.")
    data["inspection"] = {"scope": "exterior_only", "evidence": "Synthetic front and back photographs only."}
    data["condition"] = None
    data["description"] += "\n\n" + UNINSPECTED_INTERIOR_DISCLOSURE
    data["condition_description"] += " " + UNINSPECTED_INTERIOR_DISCLOSURE
    return data


def automatic_campaign():
    return {"campaignId": "444", "marketplaceId": "EBAY_US", "campaignStatus": "RUNNING",
            "fundingStrategy": {"fundingModel": "COST_PER_SALE", "adRateStrategy": "FIXED", "bidPercentage": "5.0"},
            "campaignCriterion": {"autoSelectFutureInventory": True, "criterionType": "INVENTORY_PARTITION",
                                  "selectionRules": [{"categoryScope": "MARKETPLACE"}]}}


def test_exterior_only_publication_preserves_unknowns_and_disclosure(bundle):
    repo, data, images = bundle
    exterior(data)
    row = approve(repo, data)
    assert row["draft"]["identity"]["printing"] is None
    fake = FakeSelling(images)
    pub = Publisher(repo, fake, True, collector=fake.collect)
    receipt = run(pub, row)["receipt"]
    assert run(pub, row)["receipt"] == receipt
    assert fake.calls.count("publish") == 1
    assert "condition" not in fake.item
    assert "conditionDescription" not in fake.item
    assert UNINSPECTED_INTERIOR_DISCLOSURE in fake.item["product"]["description"]
    assert "Printing" not in fake.item["product"]["aspects"]


@pytest.mark.parametrize("change", [
    lambda d: d.update(description="No inspection disclosure supplied."),
    lambda d: d.update(condition_description="Exterior wear only."),
    lambda d: d.update(condition="USED_VERY_GOOD"),
    lambda d: d["identity"].update(printing="First printing"),
    lambda d: d["identity"].update(verification_scope="full_identity"),
    lambda d: d["identity"].update(verified=False),
    lambda d: d["item_specifics"].update({"Variant Type": ["Standard"]}),
    lambda d: d["inspection"].update(evidence=" " * 30),
])
def test_unknown_identity_and_inspection_are_never_silently_verified(bundle, change):
    _, data, _ = bundle
    exterior(data)
    change(data)
    with pytest.raises(ValueError):
        ListingDraft.model_validate(data)


def test_inspection_evidence_change_requires_new_approval(bundle):
    repo, data, _ = bundle
    exterior(data)
    row = approve(repo, data)
    data["inspection"]["evidence"] = "Changed synthetic evidence for this physical copy."
    changed = repo.save("seller", data, row["revision"])
    assert changed["approval"] is None and changed["revision"] != row["revision"]


@pytest.mark.parametrize("required", [False, True, None, "false"])
def test_omitted_grade_requires_explicit_live_category_permission(env, bundle, required):
    _, data, _ = bundle
    exterior(data)
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith("get_item_condition_policies"):
            return httpx.Response(200, json={"itemConditionPolicies": [{
                "categoryId": "259104", "itemConditionRequired": required, "itemConditions": []}]})
        return httpx.Response(200, json={"negotiatedPricePolicies": [{
            "categoryId": "259104", "bestOfferAutoDeclineEnabled": True}]})

    selling, family = selling_adapter(env, handler)
    draft = ListingDraft.model_validate(data)
    if required is False:
        asyncio.run(selling.validate_category(family, draft))
    else:
        with pytest.raises(ValueError, match="explicitly permit"):
            asyncio.run(selling.validate_category(family, draft))
    assert all(r.method == "GET" for r in seen)


def test_readback_cannot_invent_an_omitted_grade(bundle):
    _, data, _ = bundle
    expected = ListingDraft.model_validate(exterior(data)).inventory_payload([])
    assert inventory_matches(deepcopy(expected), expected)
    changed = deepcopy(expected)
    changed["condition"] = "USED_GOOD"
    assert not inventory_matches(changed, expected)


def test_conditionless_ebay_readback_requires_full_approved_main_description(bundle):
    _, data, _ = bundle
    exterior(data)
    expected = ListingDraft.model_validate(data).inventory_payload([])
    assert "condition" not in expected and "conditionDescription" not in expected
    actual = deepcopy(expected)
    actual["sku"] = "synthetic-sku"
    actual["locale"] = "en_US"
    actual["availability"]["shipToLocationAvailability"]["allocationByFormat"] = {"auction": 0, "fixedPrice": 1}
    assert inventory_matches(actual, expected)
    actual["product"]["description"] = actual["product"]["description"].replace(UNINSPECTED_INTERIOR_DISCLOSURE, "")
    assert not inventory_matches(actual, expected)
    changed = deepcopy(expected)
    changed["conditionDescription"] = "Interior complete."
    assert not inventory_matches(changed, expected)


@pytest.mark.parametrize("rate", ["9", "DYNAMIC", "NaN", "Infinity", ""])
def test_automatic_campaign_rejects_unknown_or_changed_cost(rate):
    candidate = automatic_campaign()
    candidate["fundingStrategy"]["bidPercentage"] = rate
    assert not Selling.automatic_five_percent_campaign(candidate)


def test_automatic_promotion_waits_for_same_listing_without_ad_writes(bundle):
    repo, data, images = bundle
    exterior(data)
    data.update(promotion_campaign_id="444", promotion_campaign_sha256="c" * 64,
                promotion_mode="automatic_existing", promotion_unavailable_reason=None)
    row = approve(repo, data)
    fake = FakeSelling(images)
    ads = []

    async def get_ads(family, draft):
        return deepcopy(ads)

    async def forbidden_create(*args):
        pytest.fail("Automatic campaign must not receive manual ad creation")

    fake.ads, fake.create_ad = get_ads, forbidden_create
    pub = Publisher(repo, fake, True, collector=fake.collect)
    for _ in range(2):
        with pytest.raises(ValueError, match="existing automatic"):
            run(pub, row)
    assert fake.calls.count("publish") == 1
    ads.append({"adId": "555", "listingId": "123456789123", "bidPercentage": "9"})
    with pytest.raises(ValueError, match="5% promotion is not verified"):
        run(pub, row)
    ads[0]["bidPercentage"] = "5.0"
    assert run(pub, row)["receipt"]["promotion"]["status"] == "verified"
    assert fake.calls.count("publish") == 1


def test_automatic_campaign_adapter_never_creates_ads(env, bundle):
    _, data, _ = bundle
    from btco_ebay.listing_drafts import fingerprint
    campaign = automatic_campaign()
    data.update(promotion_campaign_id="444", promotion_campaign_sha256=fingerprint(campaign),
                promotion_mode="automatic_existing", promotion_unavailable_reason=None)
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=campaign)

    selling, family = selling_adapter(env, handler)
    draft = ListingDraft.model_validate(data)
    asyncio.run(selling.validate_promotion(family, draft))
    with pytest.raises(ValueError, match="read-only"):
        asyncio.run(selling.create_ad(family, draft))
    assert len(seen) == 1 and seen[0].method == "GET"
