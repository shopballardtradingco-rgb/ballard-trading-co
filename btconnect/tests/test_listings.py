"""Synthetic originals and simulated Sell API outcomes; never touches live eBay."""

import asyncio
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from cryptography.fernet import Fernet
from PIL import Image
import pytest

from btco_ebay.listing_drafts import ListingDraft
from btco_ebay.listing_store import ListingStore
from btco_ebay.photos import PhotoStore
from btco_ebay.publishing import Publisher, offer_matches
from btco_ebay.selling import SellingError
from btco_ebay.store import Store


def original(color):
    image = Image.new("RGB", (600, 800), color)
    output = BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


@pytest.fixture
def bundle(tmp_path):
    store = Store(str(tmp_path / "private.sqlite3"), Fernet.generate_key().decode())
    photos = PhotoStore(store)
    repo = ListingStore(store, photos)
    images = [original("red"), original("blue")]
    refs = [
        photos.put("seller", data, sha256(data).hexdigest(), role).model_dump()
        for data, role in zip(images, ["front", "back"])
    ]
    data = {
        "draft_id": "btco-comic-synthetic",
        "physical_item_id": "vault-copy-1",
        "master_sku": " CDP-Master-1 ",
        "title": "Synthetic Comic #1 1986 Test Publisher",
        "description": "Synthetic fixture only. Front and back show the same test copy.",
        "price_usd": "8",
        "photos": refs,
        "promotion_unavailable_reason": "Synthetic ineligible listing fixture.",
        "identity": {
            "series": "Synthetic Comic",
            "issue": "1",
            "year": 1986,
            "publisher": "Test Publisher",
            "printing": "First printing",
            "variant": "Standard",
            "verified": True,
            "evidence": "Synthetic indicia fixture, not a real item.",
        },
        "condition": "USED_GOOD",
        "inspection": {"scope": "interior_inspected", "evidence": "Synthetic inspected interior fixture only."},
        "condition_description": "Synthetic condition fixture.",
        "item_specifics": {
            "Series Title": ["Synthetic Comic"],
            "Issue Number": ["1"],
            "Publication Year": ["1986"],
            "Publisher": ["Test Publisher"],
        },
        "category_id": "259104",
        "merchant_location_key": "test-location",
        "policies": {
            "fulfillment_policy_id": "11",
            "payment_policy_id": "22",
            "return_policy_id": "33",
            "snapshots_sha256": "a" * 64,
            "combined_shipping_confirmed": True,
            "combined_shipping_evidence": "Synthetic reviewed shipping rules",
        },
    }
    return repo, data, images


def approve(repo, data):
    row = repo.save("seller", data)
    return repo.approve(
        "seller",
        data["draft_id"],
        row["revision"],
        "Owner explicitly approved this synthetic test revision.",
    )


@pytest.mark.parametrize(
    "price", ["7.99", "0", "-1", "NaN", "Infinity", "1.1", "1000001"]
)
def test_reject_non_whole_or_invalid_prices(bundle, price):
    _, data, _ = bundle
    data["price_usd"] = price
    with pytest.raises(ValueError):
        ListingDraft.model_validate(data)


def test_master_sku_and_original_bytes_are_preserved(bundle):
    repo, data, images = bundle
    draft = ListingDraft.model_validate(data)
    assert draft.listing_sku == " CDP-Master-1 "
    assert draft.offer_payload()["pricingSummary"]["price"]["value"] == "8.00"
    for photo, raw in zip(draft.photos, images):
        assert repo.photos.get("seller", photo) == raw
        encrypted = (repo.photos.root / photo.object_key).read_bytes()
        assert raw not in encrypted and encrypted != raw
        assert repo.photos.put("seller", raw, photo.sha256_hex, photo.role) == photo
        with pytest.raises(ValueError):
            repo.photos.get("other-seller", photo)
    data["master_sku"] = None
    assert ListingDraft.model_validate(data).listing_sku.startswith("BTCO-COMIC-")
    assert ListingDraft.model_validate(data).master_sku is None


def test_photo_corruption_checksum_and_quota(bundle):
    repo, data, images = bundle
    with pytest.raises(ValueError, match="checksum"):
        repo.photos.put("seller", images[0], "0" * 64, "front")
    with pytest.raises(ValueError):
        repo.photos.put(
            "seller", b"not a photo", sha256(b"not a photo").hexdigest(), "front"
        )
    repo.photos.quota = 1
    raw = original("green")
    with pytest.raises(ValueError, match="capacity"):
        repo.photos.put("seller", raw, sha256(raw).hexdigest(), "detail")
    photo = data["photos"][0]
    (repo.photos.root / photo["object_key"]).write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="integrity"):
        repo.photos.get("seller", photo)


@pytest.mark.parametrize(
    "field,value",
    [
        ("price_usd", "9"),
        ("title", "Changed title"),
        ("description", "Changed description"),
        ("condition", "USED_ACCEPTABLE"),
        ("condition_description", "New condition evidence"),
        ("merchant_location_key", "new-location"),
        ("category_id", "123"),
        ("promotion_unavailable_reason", "New documented eligibility evidence"),
        ("physical_item_id", "other-copy"),
    ],
)
def test_every_material_revision_clears_approval(bundle, field, value):
    repo, data, _ = bundle
    old = approve(repo, data)
    data[field] = value
    changed = repo.save("seller", data, old["revision"])
    assert changed["revision"] != old["revision"] and changed["approval"] is None
    with pytest.raises(ValueError, match="not been approved"):
        repo.approved(changed, "seller")
    with pytest.raises(ValueError, match="stale"):
        repo.approve(
            "seller", data["draft_id"], old["revision"], "Owner approved prior revision"
        )


def test_approval_hash_covers_nested_photos_identity_specifics_and_policies(bundle):
    repo, data, _ = bundle
    row = approve(repo, data)
    for mutate in [
        lambda d: d["photos"].reverse(),
        lambda d: d["identity"].update(printing="Second printing"),
        lambda d: d["item_specifics"].update(Language=["English"]),
        lambda d: d["policies"].update(snapshots_sha256="b" * 64),
    ]:
        changed = deepcopy(row)
        mutate(changed["draft"])
        with pytest.raises(ValueError):
            repo.approved(changed, "seller")


def test_duplicate_claims_and_seller_locks_survive_restarts(bundle):
    repo, data, _ = bundle
    old = approve(repo, data)
    other = deepcopy(data)
    other["draft_id"] = "btco-comic-other"
    other["physical_item_id"] = "another-copy"
    other["master_sku"] = "OTHER"
    restarted = ListingStore(repo.store, PhotoStore(repo.store))
    with pytest.raises(ValueError, match="already assigned"):
        restarted.save("seller", other)
    with repo.lock("seller"):
        with pytest.raises(ValueError, match="already running"):
            with restarted.lock("seller"):
                pass
    data["master_sku"] = "replacement"
    with pytest.raises(ValueError, match="master SKU"):
        repo.save("seller", data, old["revision"])
    with pytest.raises(ValueError):
        repo.get("another-seller", data["draft_id"])
    assert b"Synthetic Comic" not in Path(repo.store.path).read_bytes()


class FakeSelling:
    def __init__(self, images):
        self.ebay = self
        self.images = images
        self.calls = []
        self.item = None
        self.offer = None
        self.failure = None
        self.duplicate = False
        self.bad_policy = False
        self.visibility = True

    def require(self, family):
        return {"user_id": "seller"}

    async def validate_policies(self, family, draft):
        if self.bad_policy:
            raise ValueError("Policy changed")

    async def validate_promotion(self, family, draft):
        pass

    async def upload(self, family, photo, data):
        assert data in self.images
        self.calls.append("upload")
        return {
            "image_url": "https://i.ebayimg.com/" + photo.sha256_hex,
            "resource": "synthetic",
            "expires_at": "2099-01-01T00:00:00Z",
            "sha256": photo.sha256_hex,
        }

    async def get_item(self, family, sku):
        return deepcopy(self.item)

    async def put_item(self, family, draft, urls):
        self.calls.append("put")
        self.item = draft.inventory_payload(urls)
        if self.failure == "put":
            raise SellingError()

    async def offers(self, family, sku):
        return [deepcopy(self.offer)] if self.offer else []

    async def get_offer(self, family, identifier):
        return deepcopy(self.offer)

    async def create_offer(self, family, draft):
        self.calls.append("create")
        if self.failure == "create-not-sent":
            raise SellingError()
        self.offer = {
            **draft.offer_payload(),
            "offerId": "123",
            "status": "UNPUBLISHED",
        }
        if self.failure == "create":
            raise SellingError()
        return {"offerId": "123"}

    async def publish(self, family, identifier):
        self.calls.append("publish")
        if self.failure == "publish-not-sent":
            raise SellingError()
        self.offer.update(status="PUBLISHED", listing={"listingId": "123456789123"})
        if self.failure == "publish":
            raise SellingError()
        return {"listingId": "123456789123"}

    async def collect(self, ebay, family, page):
        rows = []
        if self.duplicate:
            rows = [
                {
                    "item_id": "987654321987",
                    "sku": " CDP-Master-1 ",
                    "title": "Another title",
                }
            ]
        if self.offer and self.offer["status"] == "PUBLISHED" and self.visibility:
            rows.append(
                {
                    "item_id": "123456789123",
                    "sku": self.offer["sku"],
                    "title": self.item["product"]["title"],
                    "price": self.offer["pricingSummary"]["price"],
                }
            )
        return {
            "records": rows,
            "page": 1,
            "total_matching": len(rows),
            "next_page": None,
        }


def publisher(bundle, approved=True, enabled=True):
    repo, data, images = bundle
    row = approve(repo, data) if approved else repo.save("seller", data)
    fake = FakeSelling(images)
    pub = Publisher(repo, fake, enabled, collector=fake.collect)
    return pub, fake, row


def run(pub, row):
    return asyncio.run(
        pub.run("seller", "family", row["draft"]["draft_id"], row["revision"])
    )


def test_full_pipeline_and_repeat_publish_use_same_verified_item(bundle):
    pub, fake, row = publisher(bundle)
    result = run(pub, row)
    receipt = result["receipt"]
    assert receipt["url"] == "https://www.ebay.com/itm/123456789123"
    assert receipt["master_sku"] == " CDP-Master-1 " and receipt["price_usd"] == "8"
    assert receipt["vault_reconciliation"] == "pending"
    assert receipt["promotion"]["status"] == "unsupported"
    assert fake.calls == ["upload", "upload", "put", "create", "publish"]
    assert run(pub, row) == result and fake.calls == [
        "upload",
        "upload",
        "put",
        "create",
        "publish",
    ]


@pytest.mark.parametrize("failure", ["put", "create", "publish"])
def test_lost_success_response_recovers_by_readback_without_duplicate_writes(
    bundle, failure
):
    pub, fake, row = publisher(bundle)
    fake.failure = failure
    with pytest.raises(SellingError):
        run(pub, row)
    fake.failure = None
    recovered = Publisher(
        ListingStore(pub.repo.store, PhotoStore(pub.repo.store)),
        fake,
        True,
        collector=fake.collect,
    )
    assert run(recovered, row)["state"] == "published"
    assert (
        fake.calls.count("put")
        == fake.calls.count("create")
        == fake.calls.count("publish")
        == 1
    )


@pytest.mark.parametrize(
    "failure,action", [("create-not-sent", "create"), ("publish-not-sent", "publish")]
)
def test_unknown_write_outcome_stops_retry(bundle, failure, action):
    pub, fake, row = publisher(bundle)
    fake.failure = failure
    with pytest.raises(SellingError):
        run(pub, row)
    fake.failure = None
    with pytest.raises(ValueError, match="unknown|unresolved"):
        run(pub, row)
    assert fake.calls.count(action) == 1
    with pytest.raises(ValueError, match="started"):
        pub.repo.save("seller", row["draft"], row["revision"])


@pytest.mark.parametrize("approved,enabled", [(False, True), (True, False)])
def test_missing_approval_or_disabled_gate_causes_no_external_writes(
    bundle, approved, enabled
):
    pub, fake, row = publisher(bundle, approved, enabled)
    with pytest.raises(ValueError):
        run(pub, row)
    assert fake.calls == []


@pytest.mark.parametrize("conflict", ["duplicate", "existing-item", "policy"])
def test_preflight_conflicts_never_overwrite_inventory(bundle, conflict):
    pub, fake, row = publisher(bundle)
    if conflict == "duplicate":
        fake.duplicate = True
    elif conflict == "existing-item":
        fake.item = {"existing": "CDP-controlled"}
    else:
        fake.bad_policy = True
    with pytest.raises(ValueError):
        run(pub, row)
    assert fake.calls == []


def test_delayed_visibility_does_not_publish_twice(bundle):
    pub, fake, row = publisher(bundle)
    fake.visibility = False
    with pytest.raises(ValueError, match="not yet verified"):
        run(pub, row)
    fake.visibility = True
    assert run(pub, row)["state"] == "published"
    assert fake.calls.count("publish") == 1


@pytest.mark.parametrize(
    "patch",
    [
        {"availableQuantity": 2},
        {"listingDuration": "DAYS_7"},
        {"includeCatalogProductDetails": True},
        {"listingPolicies": {"bestOfferTerms": {"bestOfferEnabled": True}}},
        {
            "pricingSummary": {
                "price": {"value": "8", "currency": "USD"},
                "minimumAdvertisedPrice": {"value": "10", "currency": "USD"},
            }
        },
    ],
)
def test_offer_readback_rejects_material_changes(bundle, patch):
    _, data, _ = bundle
    expected = ListingDraft.model_validate(data).offer_payload()
    assert offer_matches(expected, expected)
    actual = deepcopy(expected)
    actual.update(patch)
    assert not offer_matches(actual, expected)


@pytest.mark.parametrize("lost_response", [False, True])
def test_fixed_promotion_readback_and_uncertain_retry_preserve_same_ad(
    bundle, lost_response
):
    repo, data, images = bundle
    data.update(
        promotion_campaign_id="444",
        promotion_campaign_sha256="c" * 64,
        promotion_unavailable_reason=None,
    )
    row = approve(repo, data)
    fake = FakeSelling(images)
    ads = []

    async def get_ads(family, draft):
        return deepcopy(ads)

    async def create_ad(family, draft):
        fake.calls.append("ad")
        ads.append({"adId": "555", "listingId": "123456789123", "bidPercentage": "5.0"})
        if lost_response:
            raise SellingError()

    fake.ads = get_ads
    fake.create_ad = create_ad
    pub = Publisher(repo, fake, True, collector=fake.collect)
    if lost_response:
        with pytest.raises(SellingError):
            run(pub, row)
    receipt = run(pub, row)["receipt"]
    assert receipt["promotion"]["status"] == "verified"
    assert fake.calls.count("ad") == fake.calls.count("publish") == 1


def test_missing_or_mismatched_promotion_evidence_is_rejected(bundle):
    _, data, _ = bundle
    data["promotion_unavailable_reason"] = None
    with pytest.raises(ValueError, match="campaign"):
        ListingDraft.model_validate(data)
    data["promotion_campaign_id"] = "123"
    with pytest.raises(ValueError, match="snapshot"):
        ListingDraft.model_validate(data)
