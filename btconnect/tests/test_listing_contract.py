from copy import deepcopy
from hashlib import sha256

from test_connector import env as env, connect, rpc, tool
from test_listings import bundle as bundle
from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.listing_tools import NEW_INTERIOR_DISCLOSURE
from btco_ebay.listing_drafts import UNINSPECTED_INTERIOR_DISCLOSURE
from btco_ebay.photos import PhotoStore
from btco_ebay.listing_drafts import ListingDraft


def new_draft(env, bundle):
    _, provider, _, _ = env
    _, source, images = bundle
    data = deepcopy(source)
    data["photos"] = [PhotoStore(provider.store).put("seller-123", raw, sha256(raw).hexdigest(), role).model_dump()
                      for raw, role in zip(images, ["front", "back"])]
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    data["packed_parcel"] = {"weight_oz": "12", "length_in": "13", "width_in": "8", "height_in": "2",
                             "verified": True, "evidence": "Synthetic measured parcel only."}
    data["inspection"] = {"scope": "exterior_only", "evidence": "Only synthetic exterior inspected."}
    data["description"] += " " + UNINSPECTED_INTERIOR_DISCLOSURE + " " + NEW_INTERIOR_DISCLOSURE
    data["condition_description"] += " " + UNINSPECTED_INTERIOR_DISCLOSURE
    return data


def test_complete_schema_is_exposed_and_invalid_flattened_input_is_actionable(env, bundle):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    contract = tool(client, tokens["access_token"], "get_listing_contract")
    assert "BestOffer" in contract["schema"]["$defs"] and "Photo" in contract["schema"]["$defs"]
    schema = rpc(client, tokens["access_token"], "tools/list", {}).json()["result"]["tools"]
    save = next(t for t in schema if t["name"] == "save_listing_draft")
    assert "ListingDraft" in save["inputSchema"]["$defs"]
    invalid = tool(client, tokens["access_token"], "validate_listing_draft",
                   {"draft": {"title": "PRIVATE-TEXT", "minimum_offer": 6, "photos": ["/private/local.jpg"]}})
    assert not invalid["valid"] and any(e["path"] == ["draft_id"] for e in invalid["errors"])
    assert "PRIVATE-TEXT" not in str(invalid) and "/private/local.jpg" not in str(invalid)
    data = new_draft(env, bundle)
    valid = tool(client, tokens["access_token"], "validate_listing_draft", {"draft": data})
    assert valid["valid"]
    saved = tool(client, tokens["access_token"], "save_listing_draft", {"draft": data})
    assert saved["revision"] == valid["revision"] and saved["approval"] is None
    assert saved["draft"]["master_sku"] == " CDP-Master-1 "


def test_current_standards_fail_before_draft_save(env, bundle):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    data = new_draft(env, bundle)
    for changes in [{"condition": None}, {"best_offer": {"enabled": False}}, {"packed_parcel": None},
                    {"description": UNINSPECTED_INTERIOR_DISCLOSURE}]:
        changed = {**data, **changes}
        result = tool(client, tokens["access_token"], "validate_listing_draft", {"draft": changed})
        assert not result["valid"]
        saved = rpc(client, tokens["access_token"], "tools/call",
                    {"name": "save_listing_draft", "arguments": {"draft": changed}}).json()["result"]
        assert saved["isError"]


def test_five_dollar_draft_saves_with_offers_off_and_no_offer_floor(env, bundle):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    data = new_draft(env, bundle)
    data.update(price_usd="5", best_offer={"enabled": False, "minimum_offer_usd": None})
    valid = tool(client, tokens["access_token"], "validate_listing_draft", {"draft": data})
    assert valid["valid"]
    saved = tool(client, tokens["access_token"], "save_listing_draft", {"draft": data})
    assert saved["revision"] == valid["revision"] and saved["approval"] is None
    assert ListingDraft.model_validate(saved["draft"]).offer_payload()["listingPolicies"]["bestOfferTerms"] == {"bestOfferEnabled": False}
    rules = tool(client, tokens["access_token"], "get_listing_contract")["standards"]["best_offer"]
    assert rules["five_dollar_listings"] == {"enabled": False, "minimum_offer_usd": None}


def test_five_dollar_draft_rejects_enabled_offers_or_residual_floor(env, bundle):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    data = new_draft(env, bundle)
    for terms in [{"enabled": True, "minimum_offer_usd": "3"},
                  {"enabled": False, "minimum_offer_usd": "3"}]:
        changed = {**data, "price_usd": "5", "best_offer": terms}
        valid = tool(client, tokens["access_token"], "validate_listing_draft", {"draft": changed})
        assert not valid["valid"]
        saved = rpc(client, tokens["access_token"], "tools/call",
                    {"name": "save_listing_draft", "arguments": {"draft": changed}}).json()["result"]
        assert saved["isError"]
