"""Hosted, deterministic comic draft assembly from explicit caller evidence.

This module does not identify photographs, fetch comps, call an AI provider,
approve listings or write to eBay. Unverified facts remain exceptions.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from .listing_drafts import (
    Contract, ComicIdentity, Inspection, ListingDraft, PackedParcel, Photo,
    PolicySelection, whole_dollars,
)
from .listing_batches import BatchId, BatchInput
from .listing_validation import prepare_text, validate_new_standards, validation_errors


class PriceSource(Contract):
    kind: Literal["sold", "asking"]
    url: str = Field(min_length=1, max_length=2000)
    checked_on: str
    sold_on: str | None = None
    item_price_usd: str
    shipping_usd: str | None = None
    exact_identity_match: bool
    condition_comparable: bool
    evidence: str = Field(min_length=10, max_length=1000)

    @field_validator("url")
    @classmethod
    def source_url(cls, value):
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Record an HTTPS evidence URL without credentials")
        return value  # reference only; never fetched by this module

    @field_validator("checked_on", "sold_on")
    @classmethod
    def source_date(cls, value):
        if value is not None:
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError("Use a YYYY-MM-DD evidence date")
        return value

    @field_validator("evidence")
    @classmethod
    def real_evidence(cls, value):
        if len(value.strip()) < 10:
            raise ValueError("Describe the observed source evidence")
        return value

    @field_validator("item_price_usd", "shipping_usd")
    @classmethod
    def nonnegative_amount(cls, value):
        if value is None:
            return value
        try:
            number = Decimal(value)
        except InvalidOperation:
            raise ValueError("Invalid source price") from None
        if not number.is_finite() or not 0 <= number <= 1_000_000:
            raise ValueError("Invalid source price")
        return format(number, "f")

    @model_validator(mode="after")
    def sale_date(self):
        if self.kind == "sold" and self.sold_on is None:
            raise ValueError("Sold evidence requires an observed sale date")
        if self.kind == "asking" and self.sold_on is not None:
            raise ValueError("Asking prices are not sold evidence")
        if self.sold_on and self.sold_on > self.checked_on:
            raise ValueError("Sale date cannot follow the observation date")
        return self


class PriceResearch(Contract):
    basis: Literal["sold_comps", "asking_only", "owner_price"]
    rationale: str = Field(min_length=10, max_length=2000)
    sources: list[PriceSource] = Field(default_factory=list, max_length=20)
    owner_price_evidence: str | None = Field(default=None, min_length=10, max_length=2000)

    @field_validator("rationale", "owner_price_evidence")
    @classmethod
    def nonblank_evidence(cls, value):
        if value is not None and len(value.strip()) < 10:
            raise ValueError("Record actual pricing evidence, not blank text")
        return value

    @model_validator(mode="after")
    def evidence_matches_claim(self):
        exact_sales = [s for s in self.sources if s.kind == "sold"
                       and s.exact_identity_match and s.condition_comparable]
        if self.basis == "sold_comps" and not exact_sales:
            raise ValueError("Sold-comps pricing requires an exact, condition-comparable sold source")
        if self.basis == "asking_only" and not any(s.kind == "asking" for s in self.sources):
            raise ValueError("Asking-only pricing requires an observed asking-price source")
        if self.basis == "owner_price" and not self.owner_price_evidence:
            raise ValueError("Record the owner's proposed price; this is not publication approval")
        return self


class ComicObservations(Contract):
    photos: list[Photo] = Field(min_length=2, max_length=24)
    identity: ComicIdentity
    inspection: Inspection
    condition: Literal["USED_GOOD", "USED_ACCEPTABLE"]
    condition_notes: str = Field(min_length=10, max_length=700)
    price_usd: str
    minimum_offer_usd: str | None = None
    research: PriceResearch
    physical_item_id: str | None = Field(default=None, min_length=1, max_length=100)
    master_sku: str | None = Field(default=None, min_length=1, max_length=50)

    @field_validator("condition_notes")
    @classmethod
    def visible_condition(cls, value):
        if len(value.strip()) < 10:
            raise ValueError("Describe observed condition before adding disclosures")
        return value

    @field_validator("price_usd", "minimum_offer_usd")
    @classmethod
    def price(cls, value):
        return None if value is None else whole_dollars(value)


class IntakeDefaults(Contract):
    """Explicit settings for this batch, not implicit authorization for future ones."""
    policies: PolicySelection
    packed_parcel: PackedParcel
    merchant_location_key: str = Field(min_length=1, max_length=36)
    category_id: Literal["259104"] = "259104"
    promotion_campaign_id: str | None = None
    promotion_mode: Literal["manual", "automatic_existing"] = "manual"
    promotion_campaign_sha256: str | None = None
    promotion_unavailable_reason: str | None = None


class ComicIntakeEntry(Contract):
    item_key: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=160)
    # Per-item parsing isolates a bad/missing observation from other books.
    observations: dict | None = None
    unresolved_reason: str | None = Field(default=None, min_length=10, max_length=1500)
    expected_draft_revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class ComicIntake(Contract):
    batch_id: BatchId
    inventory_location: str = Field(min_length=1, max_length=100)
    defaults: IntakeDefaults
    items: list[ComicIntakeEntry] = Field(min_length=1, max_length=100)
    confirmed_rejection_retry_limit: int = Field(default=0, ge=0, le=1)


def compose_comic(observations: ComicObservations, defaults: IntakeDefaults):
    identity = observations.identity
    fronts = [p for p in observations.photos if p.role == "front"]
    if len(fronts) != 1:
        raise ValueError("Exactly one matched original front is required")
    front = fronts[0]
    # Stable across chats and batches; existing photo/copy/SKU reservations still apply.
    physical_id = observations.physical_item_id or "photo:" + front.sha256_hex
    title = f"{identity.series} #{identity.issue} ({identity.year}) {identity.publisher}"
    description = f"{identity.series} #{identity.issue} ({identity.year}), published by {identity.publisher}."
    if identity.verification_scope == "full_identity":
        title += f" - {identity.variant}"
        description += f"\nPrinting: {identity.printing}. Cover/variant: {identity.variant}."
    description += "\n\n" + observations.condition_notes + "\n\nThe photographs show the actual comic offered."
    if len(title) > 80:
        raise ValueError("Generated title exceeds 80 characters; use the complete-draft workflow with a reviewed shorter title")
    if observations.price_usd == "5":
        if observations.minimum_offer_usd is not None:
            raise ValueError("Five-dollar comics require no offer floor")
        offers = {"enabled": False, "minimum_offer_usd": None}
    else:
        if observations.minimum_offer_usd is None:
            raise ValueError("Provide an explicit whole-dollar offer floor; no minimum is guessed")
        offers = {"enabled": True, "minimum_offer_usd": observations.minimum_offer_usd}
    data = {
        **defaults.model_dump(mode="json"),
        "draft_id": "btco-comic-intake-" + front.sha256_hex[:32],
        "physical_item_id": physical_id, "master_sku": observations.master_sku,
        "title": title, "description": description,
        "photos": [p.model_dump() for p in observations.photos],
        "identity": identity.model_dump(), "inspection": observations.inspection.model_dump(),
        "condition": observations.condition, "condition_description": observations.condition_notes,
        "price_usd": observations.price_usd, "best_offer": offers,
        "item_specifics": {
            "Series Title": [identity.series], "Issue Number": [identity.issue],
            "Publication Year": [str(identity.year)], "Publisher": [identity.publisher],
        },
    }
    data, _ = prepare_text(data)
    draft = ListingDraft.model_validate(data)
    validate_new_standards(draft)
    return draft


def compile_intake(intake: ComicIntake):
    """Compile once, then use the existing durable preparation/approval journal."""
    entries, issues = [], []
    for entry in intake.items:
        item = {"item_key": entry.item_key, "label": entry.label,
                "expected_draft_revision": entry.expected_draft_revision}
        if entry.observations is not None:
            item["preparation_evidence"] = {"method": "deterministic_comic_intake_v1",
                                            "observations_needing_review": entry.observations}
        try:
            if entry.unresolved_reason is not None:
                if entry.observations is not None:
                    raise ValueError("Supply observations or an unresolved reason, not both")
                item["unresolved_reason"] = entry.unresolved_reason
            else:
                observations = ComicObservations.model_validate(entry.observations)
                draft = compose_comic(observations, intake.defaults)
                item["draft"] = draft.model_dump(mode="json")
                item["preparation_evidence"] = {
                    "method": "deterministic_comic_intake_v1",
                    "research": observations.research.model_dump(mode="json"),
                    "source_verification": "Caller-supplied evidence; not independently researched by the service",
                }
        except ValueError as error:
            errors = validation_errors(error)
            issues.append({"item_key": entry.item_key, "errors": errors})
            fields = [".".join(map(str, e.get("path", []))) for e in errors]
            item["unresolved_reason"] = "Intake needs correction: " + "; ".join(
                (f + ": " if f else "") + e["message"] for f, e in zip(fields, errors)
            )[:1800]
        entries.append(item)
    batch = BatchInput.model_validate({
        "batch_id": intake.batch_id, "inventory_location": intake.inventory_location,
        "items": entries, "confirmed_rejection_retry_limit": intake.confirmed_rejection_retry_limit,
    })
    return batch, issues
