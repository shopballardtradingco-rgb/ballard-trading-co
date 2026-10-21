"""eBay's inactive defaults are equivalent; new economic terms are not."""
from copy import deepcopy
import pytest
from test_listings import bundle as bundle
from btco_ebay.listing_drafts import ListingDraft
from btco_ebay.publishing import offer_matches


def test_inactive_ebay_offer_defaults_preserve_approved_terms(bundle):
    _, data, _ = bundle
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    expected = ListingDraft.model_validate(data).offer_payload()
    actual = deepcopy(expected)
    actual.update(tax={"applyTax": False}, hideBuyerDetails=False)
    actual["listingPolicies"]["eBayPlusIfEligible"] = False
    actual["pricingSummary"]["price"]["value"] = "8.0"
    actual["listingPolicies"]["bestOfferTerms"]["autoDeclinePrice"]["value"] = "6.0"
    assert offer_matches(actual, expected)


@pytest.mark.parametrize("patch", [
    {"tax": {"applyTax": True}}, {"tax": {"applyTax": 0}},
    {"tax": {"applyTax": False, "vatPercentage": 5}},
    {"hideBuyerDetails": True},
])
def test_unapproved_offer_terms_still_fail(bundle, patch):
    _, data, _ = bundle
    expected = ListingDraft.model_validate(data).offer_payload()
    actual = deepcopy(expected)
    actual.update(patch)
    assert not offer_matches(actual, expected)


@pytest.mark.parametrize("key,value", [("eBayPlusIfEligible", True), ("eBayPlusIfEligible", 0), ("unknownTerm", False)])
def test_only_explicit_inactive_plus_default_is_equivalent(bundle, key, value):
    _, data, _ = bundle
    expected = ListingDraft.model_validate(data).offer_payload()
    actual = deepcopy(expected)
    actual["listingPolicies"][key] = value
    assert not offer_matches(actual, expected)
