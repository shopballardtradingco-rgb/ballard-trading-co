"""Owner-authorized estimates stay distinguishable from actual measurements."""

from copy import deepcopy
from decimal import Decimal

import pytest

from test_listings import bundle as bundle, approve, FakeSelling, run
from btco_ebay.listing_drafts import ListingDraft, PackedParcel
from btco_ebay.publishing import Publisher
from btco_ebay.shipping_profiles import authorized_gemini_parcel, gemini_single_comic_profile


AUTHORIZATION = "Synthetic owner explicitly authorizes a sourced shipping estimate."


def test_profile_explains_arithmetic_without_implicitly_authorizing_any_listing():
    profile = gemini_single_comic_profile()
    assert sum(Decimal(v) for v in profile["components"].values()) == Decimal("9.1688")
    assert Decimal(profile["buffer_oz"]) + Decimal(profile["subtotal_oz"]) == Decimal("12")
    assert profile["requires_owner_estimate_authorization"] is True
    assert profile["verified"] is False
    assert "owner_authorization" not in profile
    assert "approval" not in profile
    parcel = authorized_gemini_parcel(AUTHORIZATION)
    assert parcel.estimate.owner_authorization == AUTHORIZATION
    assert parcel.basis == "owner_authorized_estimate" and parcel.verified is False
    assert parcel.ebay_payload()["weight"] == {"unit": "OUNCE", "value": 12}
    assert parcel.ebay_payload()["dimensions"] == {"unit": "INCH", "length": 13, "width": 8, "height": 2}


@pytest.mark.parametrize("patch", [
    {"verified": True},
    {"basis": "measured"},
    {"estimate": None},
    {"estimate": {"owner_authorization": " " * 20, "source_urls": ["https://example.test/source"]}},
    {"estimate": {"owner_authorization": AUTHORIZATION, "source_urls": []}},
    {"estimate": {"owner_authorization": AUTHORIZATION, "source_urls": ["http://example.test/source"]}},
    {"estimate": {"owner_authorization": AUTHORIZATION, "source_urls": ["https://user:secret@example.test/source"]}},
])
def test_estimate_cannot_masquerade_as_measurement_or_lack_permission_and_sources(patch):
    data = authorized_gemini_parcel(AUTHORIZATION).model_dump()
    data.update(patch)
    with pytest.raises(ValueError):
        PackedParcel.model_validate(data)


def test_estimate_permission_does_not_approve_or_publish_listing(bundle):
    repo, data, images = bundle
    data["packed_parcel"] = authorized_gemini_parcel(AUTHORIZATION).model_dump()
    row = repo.save("seller", data)
    assert row["approval"] is None
    fake = FakeSelling(images)
    pub = Publisher(repo, fake, True, collector=fake.collect)
    with pytest.raises(ValueError, match="not been approved"):
        run(pub, row)
    assert fake.calls == []


def test_approved_estimate_preserves_provenance_and_retries_same_listing(bundle):
    repo, data, images = bundle
    data["packed_parcel"] = authorized_gemini_parcel(AUTHORIZATION).model_dump()
    row = approve(repo, data)
    fake = FakeSelling(images)
    pub = Publisher(repo, fake, True, collector=fake.collect)
    assert run(pub, row)["state"] == "published"
    assert run(pub, row)["state"] == "published"
    assert fake.calls.count("publish") == 1
    saved = repo.get("seller", data["draft_id"])["draft"]["packed_parcel"]
    assert saved["verified"] is False and saved["basis"] == "owner_authorized_estimate"
    assert saved["estimate"]["owner_authorization"] == AUTHORIZATION


@pytest.mark.parametrize("change", ["authorization", "source", "weight", "measured"])
def test_estimate_changes_require_new_revision_approval(bundle, change):
    repo, data, _ = bundle
    data["packed_parcel"] = authorized_gemini_parcel(AUTHORIZATION).model_dump()
    row = approve(repo, data)
    data = deepcopy(data)
    parcel = data["packed_parcel"]
    if change == "authorization":
        parcel["estimate"]["owner_authorization"] = "A different synthetic estimate authorization."
    elif change == "source":
        parcel["estimate"]["source_urls"].append("https://example.test/new-source")
    elif change == "weight":
        parcel["weight_oz"] = "16"
    else:
        parcel.update(basis="measured", verified=True, estimate=None,
                      evidence="Actual synthetic measurements now confirmed.")
    changed = repo.save("seller", data, row["revision"])
    assert changed["revision"] != row["revision"] and changed["approval"] is None


def test_shipping_estimate_does_not_verify_unknown_comic_identity(bundle):
    _, data, _ = bundle
    data["packed_parcel"] = authorized_gemini_parcel(AUTHORIZATION).model_dump()
    data["identity"]["verified"] = False
    with pytest.raises(ValueError, match="series, issue, year and publisher"):
        ListingDraft.model_validate(data)
