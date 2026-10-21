"""Parcel provenance, approval, transport, recovery and live metadata boundaries."""

import asyncio
from copy import deepcopy
import json

import httpx
import pytest

from test_connector import env as env, connect, tool
from test_listing_http import selling_adapter
from test_listings import bundle as bundle, approve, FakeSelling, run
from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.listing_drafts import ListingDraft, PackedParcel, fingerprint
from btco_ebay.publishing import Publisher, inventory_matches
from btco_ebay.selling import ACCOUNT, MARKETING, METADATA, Selling
from btco_ebay.shipping_profiles import authorized_gemini_parcel


def parcel():
    # Synthetic test data only. Never use these values for production comics.
    return {"weight_oz": "16", "length_in": "12", "width_in": "9", "height_in": "1",
            "verified": True, "evidence": "Synthetic packed parcel measured for this test."}


@pytest.mark.parametrize("field,value", [
    ("weight_oz", "0"), ("weight_oz", "-1"), ("weight_oz", "NaN"),
    ("weight_oz", "Infinity"), ("weight_oz", "1121"), ("length_in", "121"),
    ("height_in", "0"), ("height_in", "1e2"), ("width_in", "9.0001"),
    ("weight_oz", True), ("weight_oz", 16), ("verified", False), ("evidence", " " * 20),
])
def test_unmeasured_and_invalid_parcels_are_rejected(field, value):
    data = parcel()
    data[field] = value
    with pytest.raises(ValueError):
        PackedParcel.model_validate(data)


@pytest.mark.parametrize("field", ["weight_oz", "length_in", "width_in", "height_in", "evidence"])
def test_package_changes_clear_approval(bundle, field):
    repo, data, _ = bundle
    data["packed_parcel"] = parcel()
    row = approve(repo, data)
    data["packed_parcel"][field] = "Changed synthetic source evidence" if field == "evidence" else "2"
    updated = repo.save("seller", data, row["revision"])
    assert updated["revision"] != row["revision"] and updated["approval"] is None


def test_payload_and_numeric_normalization_are_consistent(bundle):
    _, data, _ = bundle
    assert "packageWeightAndSize" not in ListingDraft.model_validate(data).inventory_payload([])
    data["packed_parcel"] = parcel()
    draft = ListingDraft.model_validate(data)
    expected = draft.inventory_payload([])
    package = expected["packageWeightAndSize"]
    assert package == {"weight": {"unit": "OUNCE", "value": 16.0},
                       "dimensions": {"unit": "INCH", "length": 12.0, "width": 9.0, "height": 1.0},
                       "packageType": "PACKAGE_THICK_ENVELOPE", "shippingIrregular": False}
    data["packed_parcel"]["weight_oz"] = "16.000"
    assert ListingDraft.model_validate(data).revision() == draft.revision()
    actual = deepcopy(expected)
    actual["packageWeightAndSize"]["weight"] = {"unit": "POUND", "value": 1}
    actual["packageWeightAndSize"]["dimensions"] = {"unit": "CENTIMETER", "length": 30.48, "width": 22.86, "height": 2.54}
    actual["packageWeightAndSize"].pop("shippingIrregular")
    assert inventory_matches(actual, expected)


@pytest.mark.parametrize("change", [
    {"weight": {"unit": "POUND", "value": 16}},
    {"weight": {"unit": "OUNCE", "value": "NaN"}},
    {"weight": {"unit": "OUNCE", "value": True}},
    {"dimensions": {"unit": "INCH", "length": 12, "width": 9, "height": 2}},
    {"packageType": "USPS_FLAT_RATE_ENVELOPE"}, {"shippingIrregular": True},
])
def test_inventory_readback_rejects_changed_parcel(bundle, change):
    _, data, _ = bundle
    data["packed_parcel"] = parcel()
    expected = ListingDraft.model_validate(data).inventory_payload([])
    actual = deepcopy(expected)
    actual["packageWeightAndSize"].update(change)
    assert not inventory_matches(actual, expected)
    actual.pop("packageWeightAndSize")
    assert not inventory_matches(actual, expected)


def test_post_publish_package_drift_keeps_same_offer_without_receipt(bundle):
    repo, data, images = bundle
    data["packed_parcel"] = parcel()
    row = approve(repo, data)
    fake = FakeSelling(images)
    original_publish = fake.publish

    async def changed_publish(family, identifier):
        result = await original_publish(family, identifier)
        fake.item["packageWeightAndSize"]["weight"]["value"] = 99
        return result

    fake.publish = changed_publish
    pub = Publisher(repo, fake, True, collector=fake.collect)
    with pytest.raises(ValueError, match="Published inventory or package"):
        run(pub, row)
    with pytest.raises(ValueError, match="Inventory content changed"):
        run(pub, row)
    assert fake.calls.count("publish") == 1
    assert repo.store.get("publication", "seller:123456789123") is None


def policy_fixture():
    return {
        "fulfillment_policy": {"marketplaceId": "EBAY_US", "shippingOptions": [
            {"optionType": "DOMESTIC", "costType": "CALCULATED", "shippingServices": [
                {"shippingServiceCode": "USPSParcel", "freeShipping": False}]}]},
        "payment_policy": {"marketplaceId": "EBAY_US"},
        "return_policy": {"marketplaceId": "EBAY_US"},
    }


def metadata_response(request, condition="5000", best_offer=True):
    if request.url.path.endswith("get_item_condition_policies"):
        return {"itemConditionPolicies": [{"categoryId": "259104", "itemConditions": [
            {"conditionId": condition, "conditionDescription": "Synthetic condition"}]}]}
    return {"negotiatedPricePolicies": [{"categoryId": "259104", "bestOfferAutoDeclineEnabled": best_offer}]}


@pytest.mark.parametrize("basis", [None, "measured", "estimate"])
def test_calculated_shipping_requires_parcel_provenance_and_sends_it_to_ebay(env, bundle, basis):
    _, data, _ = bundle
    policies, seen = policy_fixture(), []
    data["policies"]["snapshots_sha256"] = fingerprint(policies)
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    if basis == "measured":
        data["packed_parcel"] = parcel()
    elif basis == "estimate":
        data["packed_parcel"] = authorized_gemini_parcel(
            "Synthetic owner explicitly authorizes a sourced shipping estimate."
        ).model_dump()
    draft = ListingDraft.model_validate(data)

    def handler(request):
        seen.append(request)
        if str(request.url).startswith(ACCOUNT):
            return httpx.Response(200, json=policies[request.url.path.split("/")[-2]])
        if str(request.url).startswith(METADATA):
            assert request.method == "GET" and request.url.params["filter"] == "categoryIds:{259104}"
            return httpx.Response(200, json=metadata_response(request))
        if request.method == "PUT":
            assert json.loads(request.content)["packageWeightAndSize"]["weight"] == {
                "unit": "OUNCE", "value": 12 if basis == "estimate" else 16
            }
            return httpx.Response(204)
        return httpx.Response(200, json={"merchantLocationStatus": "ENABLED"})

    selling, family = selling_adapter(env, handler)
    if basis:
        asyncio.run(selling.validate_policies(family, draft))
        asyncio.run(selling.put_item(family, draft, []))
        assert sum(r.method == "PUT" for r in seen) == 1
    else:
        with pytest.raises(ValueError, match="verified packed"):
            asyncio.run(selling.validate_policies(family, draft))
        assert all(r.method == "GET" for r in seen)


@pytest.mark.parametrize("condition,best_offer", [("3000", True), ("5000", False)])
def test_category_rejects_unsupported_condition_or_offer_floor(env, bundle, condition, best_offer):
    _, data, _ = bundle
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=metadata_response(request, condition, best_offer))

    selling, family = selling_adapter(env, handler)
    with pytest.raises(ValueError, match="not supported|Best Offer"):
        asyncio.run(selling.validate_category(family, ListingDraft.model_validate(data)))
    assert all(r.method == "GET" for r in seen)


@pytest.mark.parametrize("old_label", ["GOOD", "VERY_GOOD", "ACCEPTABLE"])
def test_display_labels_are_not_valid_inventory_api_codes(bundle, old_label):
    _, data, _ = bundle
    data["condition"] = old_label
    with pytest.raises(ValueError):
        ListingDraft.model_validate(data)


def campaign(identifier):
    return {"campaignId": str(identifier), "campaignName": "Synthetic existing campaign",
            "marketplaceId": "EBAY_US", "campaignStatus": "RUNNING",
            "fundingStrategy": {"fundingModel": "COST_PER_SALE", "adRateStrategy": "FIXED"}}


@pytest.mark.parametrize("patch", [
    {"channels": ["OFF_SITE"]}, {"budget": {"daily": {"value": "10", "currency": "USD"}}},
    {"campaignCriterion": {"autoSelectFutureInventory": True}},
    {"fundingStrategy": {"fundingModel": "COST_PER_SALE", "adRateStrategy": "DYNAMIC"}},
])
def test_campaign_discovery_does_not_qualify_other_cost_or_selection_models(patch):
    candidate = campaign(1)
    candidate.update(patch)
    assert not Selling.fixed_campaign(candidate)


def test_campaign_discovery_paginates_gets_without_following_response_urls(env):
    seen = []

    def handler(request):
        seen.append(request)
        assert request.method == "GET" and str(request.url).startswith(MARKETING + "/ad_campaign?")
        offset = int(request.url.params["offset"])
        rows = [campaign(i) for i in range(offset + 1, min(offset + 101, 102))]
        return httpx.Response(200, json={"campaigns": rows, "offset": offset, "limit": 100,
                                       "total": 101, **({"next": "https://evil.test/"} if offset == 0 else {})})

    selling, family = selling_adapter(env, handler)
    result = asyncio.run(selling.campaign_options(family))
    assert result["complete"] and result["total_matching"] == 101 and len(seen) == 2
    assert all(row["fixed_rate_eligible"] for row in result["campaigns"])


@pytest.mark.parametrize("patch", [
    {"total": 2}, {"total": "1"}, {"offset": 100}, {"limit": 1},
    {"next": "https://api.ebay.com/next"}, {"campaigns": [campaign(1), campaign(1)], "total": 2},
])
def test_incomplete_or_duplicate_campaign_collection_is_not_eligible_evidence(env, patch):
    response = {"campaigns": [campaign(1)], "offset": 0, "limit": 100, "total": 1}
    response.update(patch)
    selling, family = selling_adapter(env, lambda r: httpx.Response(200, json=response))
    with pytest.raises(ValueError):
        asyncio.run(selling.campaign_options(family))


def test_policy_options_exposes_read_only_metadata_without_hiding_optional_failure(env):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    seen = []

    def handler(request):
        seen.append(request)
        if str(request.url).startswith(METADATA):
            return httpx.Response(200, json=metadata_response(request))
        if str(request.url).startswith(MARKETING):
            return httpx.Response(409, json={"errors": [{"errorId": 35077, "message": "Do not expose remote text"}]})
        return httpx.Response(200, json={"fixture": "business policy or location"})

    provider.ebay.transport = httpx.MockTransport(handler)
    result = tool(client, tokens["access_token"], "get_listing_policy_options")
    assert result["comic_category"]["category_id"] == "259104"
    assert result["promotion_campaigns"]["status"] == "unavailable"
    assert "35077" in result["promotion_campaigns"]["error"]
    assert "Do not expose" not in str(result)
    assert all(r.method == "GET" for r in seen)


def test_health_and_authenticated_status_have_same_release(env):
    from pathlib import Path
    import tomllib
    client, _, _, _ = env
    _, tokens = connect(env)
    version = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())["project"]["version"]
    assert client.get("/health").json()["version"] == tool(client, tokens["access_token"], "get_connection_status")["version"] == version

