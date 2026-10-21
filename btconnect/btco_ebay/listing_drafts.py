"""Complete, revision-bound listing contracts. No marketplace side effects."""

from __future__ import annotations
from decimal import Decimal, InvalidOperation
from enum import Enum
from hashlib import sha256
import json
import re
from urllib.parse import urlsplit
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# Inventory API enums differ from the human-readable condition labels.
CONDITION_IDS = {
    "LIKE_NEW": "2750",
    "USED_EXCELLENT": "3000",
    "USED_VERY_GOOD": "4000",
    "USED_GOOD": "5000",
    "USED_ACCEPTABLE": "6000",
}

UNINSPECTED_INTERIOR_DISCLOSURE = (
    "Interior pages have not been inspected; interior condition and completeness are unverified."
)


def fingerprint(value) -> str:
    return sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def whole_dollars(value: str) -> str:
    try:
        number = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError("Invalid price") from None
    if (
        not number.is_finite()
        or not 0 < number <= 1_000_000
        or number != number.to_integral_value()
    ):
        raise ValueError("BTCo prices must be positive whole dollars")
    return str(int(number))


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class DraftState(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    PUBLISHED = "published"


class Photo(Contract):
    object_key: str = Field(pattern=r"^photos/[0-9a-f]{64}/[0-9a-f]{64}\.(jpeg|png)$")
    sha256_hex: str = Field(pattern=r"^[0-9a-f]{64}$")
    role: str = Field(pattern=r"^(front|back|detail)$")


class ComicIdentity(Contract):
    series: str = Field(min_length=1, max_length=120)
    issue: str = Field(min_length=1, max_length=20)
    year: int = Field(ge=1900, le=2100)
    publisher: str = Field(min_length=1, max_length=80)
    printing: str | None = Field(default=None, min_length=1, max_length=80)
    variant: str | None = Field(default=None, min_length=1, max_length=120)
    evidence: str = Field(min_length=10, max_length=2000)
    verified: bool = False
    verification_scope: Literal["full_identity", "cover_identity"] = "full_identity"

    @model_validator(mode="after")
    def known_identity(self):
        if self.verification_scope == "full_identity" and (
            self.printing is None or self.variant is None
        ):
            raise ValueError("Full identity verification requires known printing and variant")
        if self.verification_scope == "cover_identity" and (
            self.printing is not None or self.variant is not None
        ):
            raise ValueError("Cover identity verification leaves printing and variant unspecified")
        for value in (self.series, self.issue, self.publisher, self.evidence, self.printing, self.variant):
            if value is not None and not value.strip():
                raise ValueError("Identity evidence and known values cannot be blank")
        return self

    def exact_key(self):
        return fingerprint(
            {
                k: str(v).strip().casefold()
                for k, v in self.model_dump().items()
                if k not in ("evidence", "verified", "verification_scope")
            }
        )


class Inspection(Contract):
    scope: Literal["exterior_only", "interior_inspected"]
    evidence: str = Field(min_length=10, max_length=2000)

    @field_validator("evidence")
    @classmethod
    def evidence_not_blank(cls, value):
        if len(value.strip()) < 10:
            raise ValueError("Record what was actually inspected")
        return value


class PolicySelection(Contract):
    fulfillment_policy_id: str = Field(pattern=r"^[0-9]{1,30}$")
    payment_policy_id: str = Field(pattern=r"^[0-9]{1,30}$")
    return_policy_id: str = Field(pattern=r"^[0-9]{1,30}$")
    # Hashes of the actual API-returned policies, not a caller's summary.
    snapshots_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    buyer_paid_shipping: bool = True
    combined_shipping_confirmed: bool = False
    combined_shipping_evidence: str = Field(min_length=1, max_length=1000)


class BestOffer(Contract):
    enabled: bool = False
    minimum_offer_usd: str | None = None

    @field_validator("minimum_offer_usd")
    @classmethod
    def minimum_whole_dollars(cls, value):
        return None if value is None else whole_dollars(value)

    @model_validator(mode="after")
    def complete(self):
        if self.enabled != (self.minimum_offer_usd is not None):
            raise ValueError("Best Offer needs an explicit minimum only when enabled")
        return self

    def ebay_terms(self):
        terms = {"bestOfferEnabled": self.enabled}
        if self.enabled:
            terms["autoDeclinePrice"] = {
                "value": self.minimum_offer_usd + ".00", "currency": "USD"
            }
        # No autoAcceptPrice: minimum offers require the seller's decision.
        return terms


class ParcelEstimate(Contract):
    owner_authorization: str = Field(min_length=10, max_length=2000)
    source_urls: list[str] = Field(min_length=1, max_length=10)

    @field_validator("owner_authorization")
    @classmethod
    def explicit_authorization(cls, value):
        if len(value.strip()) < 10:
            raise ValueError("Record the owner's explicit authorization to estimate shipping")
        return value

    @field_validator("source_urls")
    @classmethod
    def public_sources(cls, values):
        for value in values:
            url = urlsplit(value)
            if (len(value) > 2000 or url.scheme != "https" or not url.hostname
                    or url.username or url.password):
                raise ValueError("Shipping estimates require public HTTPS source references")
        return values


class PackedParcel(Contract):
    """Regular comic parcel with explicit measured or authorized-estimate provenance."""

    weight_oz: str = Field(min_length=1, max_length=12)
    length_in: str = Field(min_length=1, max_length=12)
    width_in: str = Field(min_length=1, max_length=12)
    height_in: str = Field(min_length=1, max_length=12)
    verified: bool
    evidence: str = Field(min_length=10, max_length=1000)
    basis: str = Field(default="measured", pattern=r"^(measured|owner_authorized_estimate)$")
    estimate: ParcelEstimate | None = None

    @field_validator("weight_oz", "length_in", "width_in", "height_in")
    @classmethod
    def measurement(cls, value, info):
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,3})?", value):
            raise ValueError("Use a positive decimal, at most three decimal places")
        number = Decimal(value)
        maximum = 1120 if info.field_name == "weight_oz" else 120
        if not 0 < number <= maximum:
            raise ValueError("Packed parcel measurement is outside the supported range")
        return format(number.normalize(), "f")

    @model_validator(mode="after")
    def provenance(self):
        if not self.evidence.strip():
            raise ValueError("Provide the source and calculation or measurement evidence")
        if self.basis == "measured":
            if not self.verified or self.estimate is not None:
                raise ValueError("Measured parcels require actual verified measurements")
        elif self.verified or self.estimate is None:
            raise ValueError("Estimated parcels need source references and explicit owner authorization, with verified=false")
        return self

    def ebay_payload(self):
        return {
            "weight": {"unit": "OUNCE", "value": float(self.weight_oz)},
            "dimensions": {
                "unit": "INCH",
                "length": float(self.length_in),
                "width": float(self.width_in),
                "height": float(self.height_in),
            },
            "packageType": "PACKAGE_THICK_ENVELOPE",
            "shippingIrregular": False,
        }


class ListingDraft(Contract):
    draft_id: str = Field(pattern=r"^btco-comic-[a-z0-9-]{1,80}$")
    physical_item_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=20000)
    price_usd: str
    best_offer: BestOffer = Field(default_factory=BestOffer)
    photos: list[Photo] = Field(min_length=2, max_length=24)
    identity: ComicIdentity
    inspection: Inspection
    condition: str | None = Field(
        default=None,
        pattern=r"^(USED_GOOD|USED_ACCEPTABLE)$"
    )
    condition_description: str = Field(min_length=1, max_length=1000)
    item_specifics: dict[str, list[str]]
    category_id: str = Field(pattern=r"^[0-9]{1,10}$")
    merchant_location_key: str = Field(min_length=1, max_length=36)
    policies: PolicySelection
    packed_parcel: PackedParcel | None = None
    master_sku: str | None = Field(default=None, min_length=1, max_length=50)
    # A marketplace alias is distinct from a CDP identity. None means eBay-only.
    promotion_percent: int = Field(default=5, ge=5, le=5)
    promotion_campaign_id: str | None = Field(default=None, pattern=r"^[0-9]{1,30}$")
    promotion_mode: Literal["manual", "automatic_existing"] = "manual"
    promotion_campaign_sha256: str | None = Field(
        default=None, pattern=r"^[0-9a-f]{64}$"
    )
    promotion_unavailable_reason: str | None = Field(
        default=None, min_length=10, max_length=1000
    )
    quantity: int = Field(default=1, ge=1, le=1)
    marketplace_id: str = Field(default="EBAY_US", pattern=r"^EBAY_US$")
    currency: str = Field(default="USD", pattern=r"^USD$")

    @field_validator("price_usd")
    @classmethod
    def whole_dollars(cls, value):
        return whole_dollars(value)

    @model_validator(mode="after")
    def complete(self):
        if self.best_offer.enabled and Decimal(
            self.best_offer.minimum_offer_usd
        ) >= Decimal(self.price_usd):
            raise ValueError("Best Offer minimum must be below the asking price")
        if (
            not self.title.strip()
            or not self.description.strip()
            or not self.condition_description.strip()
        ):
            raise ValueError("Listing text cannot be blank")
        if re.search(r"<[^>]*>", self.description):
            raise ValueError(
                "Use plain text descriptions; HTML is escaped at publication"
            )
        if not self.identity.verified:
            raise ValueError(
                "Verify series, issue, year and publisher from source evidence first"
            )
        if self.inspection.scope == "exterior_only":
            if any(UNINSPECTED_INTERIOR_DISCLOSURE not in text for text in (
                self.description, self.condition_description
            )):
                raise ValueError("Include the uninspected interior disclosure in both descriptions")
        if self.identity.verification_scope == "cover_identity":
            for name in self.item_specifics:
                if re.sub(r"[^a-z]", "", name.lower()) in {
                    "printing", "printingnumber", "variant", "varianttype"
                }:
                    raise ValueError("Do not populate unknown printing or variant item specifics")
        if (
            not self.policies.buyer_paid_shipping
            or not self.policies.combined_shipping_confirmed
        ):
            raise ValueError(
                "Confirm buyer-paid and combined shipping before saving a reviewable draft"
            )
        if self.promotion_campaign_id:
            if not self.promotion_campaign_sha256 or self.promotion_unavailable_reason:
                raise ValueError(
                    "Bind the reviewed promotion campaign snapshot to this draft"
                )
        elif not self.promotion_unavailable_reason or self.promotion_campaign_sha256:
            raise ValueError(
                "Select an existing 5% campaign, or document why promotion is unsupported for this listing"
            )
        if self.promotion_mode == "automatic_existing" and not self.promotion_campaign_id:
            raise ValueError("Automatic promotion requires an existing reviewed campaign")
        if (
            sum(p.role == "front" for p in self.photos) != 1
            or sum(p.role == "back" for p in self.photos) != 1
        ):
            raise ValueError(
                "Exactly one original front and back photograph is required"
            )
        if len({p.sha256_hex for p in self.photos}) != len(self.photos):
            raise ValueError("Duplicate photo content")
        if self.photos[0].role != "front":
            raise ValueError("The front photograph must be first")
        if not 1 <= len(self.item_specifics) <= 50:
            raise ValueError("Item specifics are required")
        for name, values in self.item_specifics.items():
            if (
                not name.strip()
                or len(name) > 65
                or not 1 <= len(values) <= 30
                or any(not v.strip() or len(v) > 65 for v in values)
            ):
                raise ValueError("Invalid item specifics")
        expected = {
            "Series Title": self.identity.series,
            "Issue Number": self.identity.issue,
            "Publication Year": str(self.identity.year),
            "Publisher": self.identity.publisher,
        }
        if any(self.item_specifics.get(k) != [v] for k, v in expected.items()):
            raise ValueError("Item specifics must match the verified comic identity")
        return self

    @property
    def listing_sku(self):
        return (
            self.master_sku
            if self.master_sku is not None
            else "BTCO-COMIC-" + sha256(self.physical_item_id.encode()).hexdigest()[:24]
        )

    def revision(self):
        # All material fields are included. There is no client-supplied approval flag.
        return fingerprint(self.model_dump(mode="json"))

    def inventory_payload(self, image_urls):
        payload = {
            "availability": {"shipToLocationAvailability": {"quantity": self.quantity}},
            "product": {
                "title": self.title,
                "description": self.description,
                "aspects": self.item_specifics,
                "imageUrls": image_urls,
            },
        }
        if self.condition is not None:
            payload["condition"] = self.condition
            payload["conditionDescription"] = self.condition_description
        # eBay omits the standalone condition description when condition is
        # unspecified. The exact approved product/listing description remains
        # mandatory, including the exterior-only disclosure.
        if self.packed_parcel is not None:
            payload["packageWeightAndSize"] = self.packed_parcel.ebay_payload()
        return payload

    def offer_payload(self):
        import html

        return {
            "sku": self.listing_sku,
            "marketplaceId": self.marketplace_id,
            "format": "FIXED_PRICE",
            "availableQuantity": self.quantity,
            "categoryId": self.category_id,
            "merchantLocationKey": self.merchant_location_key,
            "listingDuration": "GTC",
            "includeCatalogProductDetails": False,
            "listingDescription": "<p>"
            + html.escape(self.description).replace("\n", "<br>")
            + "</p>",
            "pricingSummary": {
                "price": {"value": self.price_usd + ".00", "currency": self.currency}
            },
            "listingPolicies": {
                "bestOfferTerms": self.best_offer.ebay_terms(),
                "fulfillmentPolicyId": self.policies.fulfillment_policy_id,
                "paymentPolicyId": self.policies.payment_policy_id,
                "returnPolicyId": self.policies.return_policy_id,
            },
        }



class CardIdentity(Contract):
    subject: str = Field(min_length=1, max_length=65)
    set_name: str = Field(min_length=1, max_length=65)
    year: int = Field(ge=1800, le=2100)
    number: str = Field(default="", max_length=65)
    evidence: str = Field(min_length=10, max_length=2000)
    verified: bool = False


class ConditionDescriptor(Contract):
    name: str = Field(pattern=r"^[0-9]{1,10}$")
    values: list[str] = Field(default_factory=list, max_length=1)
    additionalInfo: str | None = Field(default=None, min_length=1, max_length=30)

    @model_validator(mode="after")
    def complete(self):
        if self.name == "27503":
            if self.values or not self.additionalInfo or not self.additionalInfo.strip():
                raise ValueError("Certification requires an actual certificate number")
        elif len(self.values) != 1 or not re.fullmatch(r"[0-9]{1,12}", self.values[0]) or self.additionalInfo:
            raise ValueError("Select one current eBay descriptor value")
        return self


class CardListingDraft(ListingDraft):
    """Cards reuse the publication journal without changing historical comic revisions."""
    product_type: Literal["card"] = "card"
    draft_id: str = Field(pattern=r"^btco-card-[a-z0-9-]{1,80}$")
    identity: CardIdentity
    inspection: None = None
    photos: list[Photo] = Field(min_length=1, max_length=24)
    condition: Literal["LIKE_NEW", "USED_VERY_GOOD"]
    condition_descriptors: list[ConditionDescriptor] = Field(min_length=1, max_length=3)
    category_id: Literal["261328", "183050", "183454"]

    @model_validator(mode="after")
    def complete(self):
        if not self.identity.verified or any(not v.strip() for v in
                [self.title, self.description, self.condition_description, self.identity.subject,
                 self.identity.set_name, self.identity.evidence]):
            raise ValueError("Reviewed card identity and condition text are required")
        if re.search(r"<[^>]*>", self.description):
            raise ValueError("Use plain text descriptions")
        if not self.master_sku:
            raise ValueError("Preserve the exact Core or existing master SKU")
        if self.best_offer.enabled and Decimal(self.best_offer.minimum_offer_usd) >= Decimal(self.price_usd):
            raise ValueError("Best Offer minimum must be below the asking price")
        if self.photos[0].role != "front" or sum(p.role == "front" for p in self.photos) != 1 or sum(p.role == "back" for p in self.photos) > 1:
            raise ValueError("One original front photo must be first; a back photo is optional")
        if len({p.sha256_hex for p in self.photos}) != len(self.photos):
            raise ValueError("Duplicate photo content")
        names = [d.name for d in self.condition_descriptors]
        required = {"40001"} if self.condition == "USED_VERY_GOOD" else {"27501", "27502"}
        if len(set(names)) != len(names) or not required <= set(names) or set(names) - required - ({"27503"} if self.condition == "LIKE_NEW" else set()):
            raise ValueError("Provide the descriptors for this graded or ungraded card")
        if not self.policies.buyer_paid_shipping or not self.policies.combined_shipping_confirmed:
            raise ValueError("Confirm buyer-paid and combined shipping")
        if self.promotion_campaign_id:
            if not self.promotion_campaign_sha256 or self.promotion_unavailable_reason:
                raise ValueError("Bind the reviewed promotion campaign")
        elif not self.promotion_unavailable_reason or self.promotion_campaign_sha256 or self.promotion_mode == "automatic_existing":
            raise ValueError("Select a reviewed 5% campaign or explain its unavailability")
        if not 1 <= len(self.item_specifics) <= 50 or any(not k.strip() or len(k)>65 or not 1<=len(v)<=30 or any(not x.strip() or len(x)>65 for x in v) for k,v in self.item_specifics.items()):
            raise ValueError("Valid card item specifics are required")
        expected = {"Set": self.identity.set_name, "Year Manufactured": str(self.identity.year)}
        if self.category_id == "261328": expected["Player/Athlete"] = self.identity.subject
        if self.identity.number: expected["Card Number"] = self.identity.number
        if any(self.item_specifics.get(k) != [v] for k,v in expected.items()):
            raise ValueError("Item specifics must match the reviewed card identity")
        return self

    def inventory_payload(self, image_urls):
        payload = super().inventory_payload(image_urls)
        payload["conditionDescriptors"] = [d.model_dump(exclude_none=True, exclude_defaults=True) for d in self.condition_descriptors]
        return payload


def parse_listing(data):
    return (CardListingDraft if isinstance(data, dict) and data.get("product_type") == "card" else ListingDraft).model_validate(data)
