"""Offer floors are approved terms, never automatic acceptance authority."""
from copy import deepcopy

import pytest

from test_listings import bundle as bundle, approve, FakeSelling, run
from btco_ebay.listing_drafts import ListingDraft, fingerprint
from btco_ebay.publishing import Publisher, offer_matches
from btco_ebay.selling import SellingError


@pytest.mark.parametrize("price,minimum", [("8", "6"), ("7", "5"), ("10", "8")])
def test_whole_dollar_minimum_is_sent_without_automatic_acceptance(bundle, price, minimum):
    _, data, _ = bundle
    data.update(price_usd=price, best_offer={"enabled": True, "minimum_offer_usd": minimum})
    payload = ListingDraft.model_validate(data).offer_payload()
    assert payload["listingPolicies"]["bestOfferTerms"] == {
        "bestOfferEnabled": True,
        "autoDeclinePrice": {"value": minimum + ".00", "currency": "USD"},
    }


@pytest.mark.parametrize("terms", [
    {"enabled": True},
    {"enabled": False, "minimum_offer_usd": "6"},
    {"enabled": True, "minimum_offer_usd": "5.99"},
    {"enabled": True, "minimum_offer_usd": "0"},
    {"enabled": True, "minimum_offer_usd": "NaN"},
    {"enabled": True, "minimum_offer_usd": "Infinity"},
    {"enabled": True, "minimum_offer_usd": "8"},
    {"enabled": True, "minimum_offer_usd": "9"},
    {"enabled": True, "minimum_offer_usd": "6", "auto_accept_usd": "7"},
])
def test_ambiguous_invalid_and_unauthorized_offer_terms_are_rejected(bundle, terms):
    _, data, _ = bundle
    data["best_offer"] = terms
    with pytest.raises(ValueError):
        ListingDraft.model_validate(data)


def test_enabling_changing_and_disabling_offers_each_requires_fresh_approval(bundle):
    repo, data, _ = bundle
    row = approve(repo, data)
    for terms in [
        {"enabled": True, "minimum_offer_usd": "6"},
        {"enabled": True, "minimum_offer_usd": "5"},
        {"enabled": False},
    ]:
        data["best_offer"] = terms
        changed = repo.save("seller", data, row["revision"])
        assert changed["approval"] is None and changed["revision"] != row["revision"]
        with pytest.raises(ValueError, match="not been approved"):
            repo.approved(changed, "seller")
        row = repo.approve("seller", data["draft_id"], changed["revision"], "Owner approved changed synthetic offer terms")


def test_old_approval_does_not_silently_gain_new_offer_terms(bundle):
    repo, data, _ = bundle
    row = approve(repo, data)
    row["draft"].pop("best_offer")
    row["revision"] = fingerprint(row["draft"])
    row["approval"]["revision"] = row["revision"]
    with pytest.raises(ValueError, match="not been approved"):
        repo.approved(row, "seller")


@pytest.mark.parametrize("change", [
    {"bestOfferEnabled": False},
    {"autoDeclinePrice": {"value": "5.00", "currency": "USD"}},
    {"autoDeclinePrice": {"value": "6.00", "currency": "CAD"}},
    {"autoDeclinePrice": None},
    {"autoAcceptPrice": {"value": "7.00", "currency": "USD"}},
    {"autoDeclinePrice": {"value": "NaN", "currency": "USD"}},
])
def test_economic_readback_accepts_equivalent_money_and_rejects_term_drift(bundle, change):
    _, data, _ = bundle
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    expected = ListingDraft.model_validate(data).offer_payload()
    actual = deepcopy(expected)
    actual["listingPolicies"]["bestOfferTerms"]["autoDeclinePrice"]["value"] = "6.0"
    assert offer_matches(actual, expected)
    actual["listingPolicies"]["bestOfferTerms"].update(change)
    assert not offer_matches(actual, expected)


def test_disabled_offers_accept_omitted_response_but_reject_enabled_or_auto_accept(bundle):
    _, data, _ = bundle
    expected = ListingDraft.model_validate(data).offer_payload()
    assert expected["listingPolicies"]["bestOfferTerms"] == {"bestOfferEnabled": False}
    actual = deepcopy(expected)
    actual["listingPolicies"].pop("bestOfferTerms")
    assert offer_matches(actual, expected)
    actual["listingPolicies"]["bestOfferTerms"] = {"bestOfferEnabled": True}
    assert not offer_matches(actual, expected)


def test_offer_floor_survives_lost_publish_response_without_duplicate_publication(bundle):
    repo, data, images = bundle
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    row = approve(repo, data)
    fake = FakeSelling(images)
    fake.failure = "publish"
    pub = Publisher(repo, fake, True, collector=fake.collect)
    with pytest.raises(SellingError):
        run(pub, row)
    fake.failure = None
    assert run(pub, row)["state"] == "published"
    assert fake.offer["listingPolicies"]["bestOfferTerms"]["autoDeclinePrice"]["value"] == "6.00"
    assert fake.calls.count("create") == fake.calls.count("publish") == 1


def test_post_publish_term_drift_prevents_verified_receipt_and_does_not_republish(bundle):
    repo, data, images = bundle
    data["best_offer"] = {"enabled": True, "minimum_offer_usd": "6"}
    row = approve(repo, data)
    fake = FakeSelling(images)
    original_publish = fake.publish

    async def changed_publish(family, identifier):
        result = await original_publish(family, identifier)
        fake.offer["listingPolicies"]["bestOfferTerms"]["autoAcceptPrice"] = {"value": "7.00", "currency": "USD"}
        return result

    fake.publish = changed_publish
    pub = Publisher(repo, fake, True, collector=fake.collect)
    with pytest.raises(ValueError, match="Published offer terms"):
        run(pub, row)
    assert repo.store.get("publication", "seller:123456789123") is None
    with pytest.raises(ValueError, match="Existing offer differs"):
        run(pub, row)
    assert fake.calls.count("publish") == 1
