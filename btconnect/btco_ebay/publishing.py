"""Durable publication with read-back verification and fail-closed retries."""

from datetime import datetime, timezone
from decimal import Decimal
import asyncio
import re
import time
from .inventory import PAGE_SIZE, active_listings
from .selling import SellingError
from .listing_drafts import parse_listing, ListingDraft
from copy import deepcopy


def package_matches(actual, expected):
    if expected is None:
        return actual in (None, {})
    if not isinstance(actual, dict) or set(actual) - set(expected):
        return False
    if actual.get("packageType") != expected["packageType"]:
        return False
    if actual.get("shippingIrregular", False) is not False:
        return False
    # eBay may normalize measurement units. Compare physical quantities using
    # exact decimal conversions rather than accepting a changed parcel.
    # Compare in SI units for exact conversion factors (no rounding tolerance).
    factors = {
        "weight": {"OUNCE": "28.349523125", "POUND": "453.59237", "GRAM": "1", "KILOGRAM": "1000"},
        "dimensions": {"INCH": "2.54", "FEET": "30.48", "CENTIMETER": "1", "METER": "100"},
    }
    for field, names in (("weight", ("value",)), ("dimensions", ("length", "width", "height"))):
        values = actual.get(field)
        if not isinstance(values, dict) or set(values) != {"unit", *names}:
            return False
        if not isinstance(values["unit"], str) or values["unit"] not in factors[field]:
            return False
        for name in names:
            if isinstance(values[name], bool) or not isinstance(values[name], (int, float, str)):
                return False
            try:
                number = Decimal(str(values[name]))
                target = Decimal(str(expected[field][name]))
                if not number.is_finite() or number * Decimal(factors[field][values["unit"]]) != target * Decimal(factors[field][expected[field]["unit"]]):
                    return False
            except Exception:
                return False
    return True


def inventory_matches(actual, expected):
    if not isinstance(actual, dict):
        return False
    return (
        actual.get("condition") == expected.get("condition")
        and actual.get("conditionDescription", "") == expected.get("conditionDescription", "")
        and sorted(actual.get("conditionDescriptors", []), key=lambda d: d.get("name", "")) == sorted(expected.get("conditionDescriptors", []), key=lambda d: d.get("name", ""))
        and actual.get("availability", {})
        .get("shipToLocationAvailability", {})
        .get("quantity")
        == expected["availability"]["shipToLocationAvailability"]["quantity"]
        and all(
            actual.get("product", {}).get(k) == v
            for k, v in expected["product"].items()
        )
        and package_matches(actual.get("packageWeightAndSize"), expected.get("packageWeightAndSize"))
    )


def best_offer_matches(actual, expected):
    if actual is None:
        actual = {}
    if not isinstance(actual, dict):
        return False
    if set(actual) - {"bestOfferEnabled", "autoDeclinePrice", "autoAcceptPrice"}:
        return False
    # Even an unexpected auto-accept threshold above the minimum changes the
    # owner's terms. Never accept it as an equivalent configuration.
    if actual.get("autoAcceptPrice") is not None:
        return False
    enabled = expected.get("bestOfferEnabled", False)
    if actual.get("bestOfferEnabled", False) is not enabled:
        return False
    if not enabled:
        return actual.get("autoDeclinePrice") is None
    minimum = actual.get("autoDeclinePrice")
    if not isinstance(minimum, dict) or set(minimum) != {"value", "currency"}:
        return False
    if minimum["currency"] != "USD" or not isinstance(minimum["value"], str):
        return False
    try:
        number = Decimal(minimum["value"])
        return number.is_finite() and number == Decimal(
            expected["autoDeclinePrice"]["value"]
        )
    except Exception:
        return False


def offer_matches(actual, expected):
    if not isinstance(actual, dict):
        return False
    keys = (
        "sku",
        "marketplaceId",
        "format",
        "categoryId",
        "merchantLocationKey",
        "listingDescription",
        "availableQuantity",
        "listingDuration",
    )
    if any(actual.get(k) != expected[k] for k in keys):
        return False
    price = actual.get("pricingSummary", {}).get("price", {})
    try:
        prices_equal = price.get("currency") == "USD" and Decimal(
            price.get("value", "-1")
        ) == Decimal(expected["pricingSummary"]["price"]["value"])
    except Exception:
        return False
    if not prices_equal:
        return False
    if actual.get("includeCatalogProductDetails", False) is not False:
        return False
    if actual.get("hideBuyerDetails", False) is not False:
        return False
    tax = actual.get("tax")
    if tax not in (None, {}) and not (
        isinstance(tax, dict) and set(tax) == {"applyTax"} and tax["applyTax"] is False
    ):
        return False
    if any(
        actual.get(k)
        for k in (
            "listingStartDate",
            "charity",
            "extendedProducerResponsibility",
        )
    ):
        return False
    if any(
        k != "price" and v not in (None, {}, [])
        for k, v in actual.get("pricingSummary", {}).items()
    ):
        return False
    policies = actual.get("listingPolicies", {})
    if not isinstance(policies, dict) or not best_offer_matches(
        policies.get("bestOfferTerms"),
        expected["listingPolicies"].get("bestOfferTerms", {}),
    ):
        return False
    return all(
        policies.get(k) == v
        for k, v in expected["listingPolicies"].items()
        if k != "bestOfferTerms"
    ) and all(
        k in expected["listingPolicies"] or v in (None, {}, [])
        or (k == "eBayPlusIfEligible" and v is False)
        for k, v in policies.items()
    )


def publication_outcome(row, error=None):
    """Durable outcome, separate from completion of all listing checks."""
    job = row.get("job", {})
    item_id = job.get("listing_id") or row.get("receipt", {}).get("item_id")
    verified = row.get("state") == "published" and bool(row.get("receipt"))
    stage = job.get("phase", "preflight")
    status = ("verified" if verified else "published_verification_pending" if item_id
              else "publication_outcome_unknown" if job.get("publish_attempted")
              else "incomplete")
    return {
        "status": status, "stage": stage, "durable_state": row.get("state"),
        "item_id": item_id, "url": "https://www.ebay.com/itm/" + item_id if item_id else None,
        "offer_id": job.get("offer_id"), "all_checks_verified": verified,
        "receipt_available": verified, "vault_reconciliation": "pending",
        "error": error or job.get("last_error"),
        "publish_failure": job.get("publish_failure"),
        "recovery_authorized": bool(job.get("publish_recovery") and
                                    not job["publish_recovery"].get("consumed") and
                                    job["publish_recovery"].get("expires_at", 0) > time.time()),
        "recovery_action": ("Reconcile the signed receipt into Vault" if verified
                            else "Read the saved draft and existing offer; do not create another listing"),
    }


class Publisher:
    def __init__(self, repo, selling, enabled=False, collector=active_listings):
        self.repo, self.selling, self.enabled, self.collector = (
            repo,
            selling,
            enabled,
            collector,
        )

    async def approve_recovery(self, seller, family, draft_id, revision, evidence):
        """Authorize one same-offer retry after fresh, fail-closed reconciliation.

        This records owner approval only. No eBay writes occur here. Legacy jobs
        lack typed failure journals, so explicit recovery approval plus two
        authoritative UNPUBLISHED reads is required; ordinary run stays blocked.
        New uncertain failures cannot be rearmed through this path.
        """
        if not isinstance(evidence, str) or not 10 <= len(evidence) <= 4000:
            raise ValueError("Record explicit owner approval for this exact recovery")
        if self.selling.require(family)["user_id"] != seller:
            raise ValueError("Seller identity mismatch")
        with self.repo.lock(seller):
            row = self.repo.get(seller, draft_id)
            draft = self.repo.approved(row, seller)
            job = row["job"]
            if revision != row["revision"] or revision != draft.revision():
                raise ValueError("Recovery approval revision is stale")
            if (row["state"] != "approved" or row.get("receipt") or
                    job.get("phase") != "publish" or not job.get("publish_attempted") or
                    not job.get("inventory_done") or not job.get("offer_id") or
                    job.get("listing_id")):
                raise ValueError("Only an unpublished saved offer can receive recovery approval")
            failure = job.get("publish_failure")
            if failure is None and "publish_requested_at" in job:
                raise ValueError("Uncertain publication remains blocked; reconcile read-back only")
            if failure and (failure.get("uncertain") is not False or
                            failure.get("http_status") != 400 or
                            failure.get("offer_id") != job["offer_id"] or
                            failure.get("revision") != revision):
                raise ValueError("Uncertain publication remains blocked; reconcile read-back only")
            previous = job.get("publish_recovery")
            if previous and previous.get("consumed") and not failure:
                raise ValueError("Recovery attempt is unresolved; reconcile read-back only")
            last_attempt = job.get("publish_requested_at", row["updated_at"])
            if not isinstance(last_attempt, (int, float)) or time.time() - last_attempt < 300:
                raise ValueError("Wait five minutes after the last publication attempt before recovery approval")
            if len(job.get("images", [])) != len(draft.photos):
                raise ValueError("Original image upload is incomplete")
            for photo, image in zip(draft.photos, job["images"]):
                self.repo.photos.get(seller, photo)
                if image.get("sha256") != photo.sha256_hex:
                    raise ValueError("Hosted image checksum binding differs from approval")
            expected = draft.inventory_payload([i["image_url"] for i in job["images"]])
            await self.selling.validate_policies(family, draft)
            await self.selling.validate_promotion(family, draft)

            def unpublished(offer):
                return (isinstance(offer, dict) and offer.get("offerId") == job["offer_id"] and
                        offer.get("status") == "UNPUBLISHED" and not offer.get("listing") and
                        offer_matches(offer, draft.offer_payload()))

            offers = await self.selling.offers(family, draft.listing_sku)
            if len(offers) != 1 or not unpublished(offers[0]):
                raise ValueError("Existing offer is not exactly one unchanged unpublished offer")
            if not inventory_matches(await self.selling.get_item(family, draft.listing_sku), expected):
                raise ValueError("Recovery inventory differs from the approved listing")
            active = await self.active(family)
            if any(item.get("sku") == draft.listing_sku or
                   item["title"].strip().casefold() == draft.title.strip().casefold()
                   for item in active):
                raise ValueError("Possible active duplicate; recovery approval refused")
            # Second authoritative read follows the complete active-feed check.
            if not unpublished(await self.selling.get_offer(family, job["offer_id"])):
                raise ValueError("Offer changed during recovery approval")
            now = time.time()
            recovery = {"seller": seller, "revision": revision, "offer_id": job["offer_id"],
                        "evidence": evidence, "authorized_at": now, "expires_at": now + 900,
                        "consumed": False, "observed_offer_status": "UNPUBLISHED",
                        "prior_failure": deepcopy(failure),
                        "legacy_failure_journal": failure is None,
                        "prior_error": job.get("last_error")}
            job.setdefault("recovery_history", []).append(deepcopy(recovery))
            job["publish_recovery"] = recovery
            row["updated_at"] = now
            self.repo.write(seller, row)
            return row

    async def revise_preoffer_condition(self, seller, family, data, expected_revision):
        """Stage a condition-only change; no eBay write until separately approved."""
        draft = parse_listing(data)
        if self.selling.require(family)["user_id"] != seller:
            raise ValueError("Seller identity mismatch")
        with self.repo.lock(seller):
            row = self.repo.get(seller, draft.draft_id)
            old = self.repo.approved(row, seller)
            job = row["job"]
            if row["revision"] != expected_revision:
                raise ValueError("Draft changed; reload before saving")
            if not job.get("inventory_attempted") or any(job.get(key) for key in (
                "offer_attempted", "offer_id", "publish_attempted", "listing_id", "condition_revision_from"
            )) or row["state"] == "published" or row.get("receipt"):
                raise ValueError("Only a saved inventory item before any offer attempt can be revised here")
            if old.model_dump(exclude={"condition"}) != draft.model_dump(exclude={"condition"}):
                raise ValueError("Only the condition label may change in this pre-offer revision")
            if old.condition == draft.condition or draft.condition is None:
                raise ValueError("Select a changed Good or Acceptable condition")
            if len(job.get("images", [])) != len(draft.photos):
                raise ValueError("Original photo upload is incomplete")
            for photo in draft.photos:
                self.repo.photos.get(seller, photo)
            urls = [image["image_url"] for image in job["images"]]
            expected = old.inventory_payload(urls)
            if await self.selling.offers(family, old.listing_sku):
                raise ValueError("An existing offer prevents a pre-offer revision")
            if not inventory_matches(await self.selling.get_item(family, old.listing_sku), expected):
                raise ValueError("Existing inventory differs from the prior approved revision")
            history = {key: deepcopy(row.get(key)) for key in ("draft", "revision", "approval", "job", "updated_at")}
            row.setdefault("revision_history", []).append(history)
            job.update(condition_revision_from={"revision": old.revision(), "inventory": expected},
                       condition_revision_attempted=False,
                       inventory_done=False, phase="condition_review", last_error=None)
            row.update(draft=draft.model_dump(mode="json"), revision=draft.revision(),
                       approval=None, state="draft", updated_at=time.time())
            self.repo.write(seller, row)
            return row

    async def active(self, family):
        # Page one establishes the current pagination bounds. Independent pages
        # can then be read four at a time; all consistency checks still run and
        # no snapshot is cached across publication attempts.
        first = await self.collector(self.selling.ebay, family, 1)
        total = first["total_matching"]
        if type(total) is not int or not 0 <= total < 25000:
            raise ValueError("Incomplete active listing feed")
        pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
        rows = []
        ids = set()

        def accept(result, page):
            if result["total_matching"] != total or result["page"] != page:
                raise ValueError(
                    "Active listings changed during collection; retry the read"
                )
            expected_next = page + 1 if page < pages else None
            expected_count = min(PAGE_SIZE, max(0, total - (page - 1) * PAGE_SIZE))
            if (result["next_page"] != expected_next
                    or len(result["records"]) != expected_count):
                raise ValueError("Incomplete active listing feed")
            for row in result["records"]:
                if row["item_id"] in ids:
                    raise ValueError(
                        "Duplicate item IDs in active feed; retry the read"
                    )
                ids.add(row["item_id"])
                rows.append(row)

        accept(first, 1)
        for start in range(2, pages + 1, 4):
            batch = range(start, min(start + 4, pages + 1))
            # Drain every read in this bounded batch, even if one fails. Never
            # leave background reads running when the publication lock exits.
            results = await asyncio.gather(
                *(self.collector(self.selling.ebay, family, page) for page in batch),
                return_exceptions=True,
            )
            for page, result in zip(batch, results):
                if isinstance(result, BaseException):
                    raise result
                accept(result, page)
        if len(rows) != total:
            raise ValueError("Incomplete active listing feed")
        return rows

    async def run(self, seller, family, draft_id, revision):
        if not self.enabled:
            raise ValueError(
                "Live publication is disabled until owner-approved eBay permissions and pilot readiness are complete"
            )
        grant = self.selling.require(family)
        if grant["user_id"] != seller:
            raise ValueError("Seller identity mismatch")
        with self.repo.lock(seller):
            row = self.repo.get(seller, draft_id)
            draft = self.repo.approved(row, seller)
            if revision != draft.revision():
                raise ValueError("Publish revision is stale")
            if row["state"] == "published":
                return row
            for photo in draft.photos:
                self.repo.photos.get(seller, photo)
            job = row["job"]

            def save(**changes):
                job.update(changes)
                row["updated_at"] = time.time()
                self.repo.write(seller, row)

            try:
                await self.selling.validate_policies(family, draft)
                await self.selling.validate_promotion(family, draft)
                active = await self.active(family)
                own_id = job.get("listing_id")
                # Existing active entries are never overwritten, including CDP listings.
                for listing in active:
                    if listing["item_id"] == own_id:
                        continue
                    if (
                        listing.get("sku") == draft.listing_sku
                        or listing["title"].strip().casefold()
                        == draft.title.strip().casefold()
                    ):
                        # During recovery we must first identify our exact existing offer.
                        if not job.get("offer_id"):
                            raise ValueError(
                                "Possible duplicate active listing requires review"
                            )
                        live = await self.selling.get_offer(family, job["offer_id"])
                        if (
                            live.get("listing", {}).get("listingId")
                            != listing["item_id"]
                        ):
                            raise ValueError(
                                "Possible duplicate active listing requires review"
                            )
                offers = await self.selling.offers(family, draft.listing_sku)
                if not job and (
                    offers or await self.selling.get_item(family, draft.listing_sku)
                ):
                    raise ValueError(
                        "An eBay inventory item or offer already uses this SKU; no existing inventory was overwritten"
                    )
                if not job:
                    save(started_at=time.time(), phase="images", images=[])
                if offers:
                    if len(offers) != 1 or not job.get("offer_attempted"):
                        raise ValueError("Unexpected existing offer requires review")
                    candidate = offers[0]
                    if not offer_matches(candidate, draft.offer_payload()):
                        raise ValueError(
                            "Existing offer differs from the approved listing"
                        )
                    if job.get("offer_id") and job["offer_id"] != candidate["offerId"]:
                        raise ValueError("Offer identity mismatch")
                    save(offer_id=candidate["offerId"])
                for index, photo in enumerate(draft.photos):
                    if index < len(job["images"]):
                        continue
                    image = await self.selling.upload(
                        family, photo, self.repo.photos.get(seller, photo)
                    )
                    save(images=[*job["images"], image])
                # Expired hosted media cannot be silently reused in an approved job.
                for image in job["images"]:
                    if (
                        datetime.fromisoformat(
                            image["expires_at"].replace("Z", "+00:00")
                        ).timestamp()
                        < time.time() + 3600
                    ):
                        raise ValueError(
                            "Hosted image expires too soon; repair media before publishing"
                        )
                urls = [i["image_url"] for i in job["images"]]
                expected = draft.inventory_payload(urls)
                if job.get("condition_revision_from"):
                    if not self.repo.condition_revision_pending(row):
                        raise ValueError("Invalid pending condition revision")
                    current = await self.selling.get_item(family, draft.listing_sku)
                    if not inventory_matches(current, expected):
                        if job.get("condition_revision_attempted"):
                            raise ValueError("Condition update outcome is unresolved; only read-back recovery is allowed")
                        if not inventory_matches(current, job["condition_revision_from"]["inventory"]):
                            raise ValueError("Inventory changed before the approved condition update")
                        if await self.selling.offers(family, draft.listing_sku):
                            raise ValueError("An offer appeared before the approved condition update")
                        save(condition_revision_attempted=True)
                        await self.selling.put_item(family, draft, urls)
                        current = await self.selling.get_item(family, draft.listing_sku)
                    if not inventory_matches(current, expected):
                        raise ValueError("Revised condition read-back differs from approval")
                    save(condition_revision_from=None, inventory_done=True, phase="inventory")
                if not job.get("inventory_done"):
                    current = await self.selling.get_item(family, draft.listing_sku)
                    if current and not job.get("inventory_attempted"):
                        raise ValueError(
                            "SKU was claimed elsewhere; publication stopped"
                        )
                    if current and not inventory_matches(current, expected):
                        raise ValueError(
                            "Existing inventory item differs; refusing overwrite"
                        )
                    if not current:
                        if job.get("inventory_attempted"):
                            raise ValueError(
                                "Prior inventory write is unresolved; inspect before retrying"
                            )
                        save(inventory_attempted=True, phase="inventory")
                        await self.selling.put_item(family, draft, urls)
                    current = await self.selling.get_item(family, draft.listing_sku)
                    if not inventory_matches(current, expected):
                        raise ValueError(
                            "Inventory read-back does not match approved content"
                        )
                    save(inventory_done=True)
                if not job.get("offer_id"):
                    if job.get("offer_attempted"):
                        raise ValueError(
                            "Offer creation outcome is unknown; do not create another offer"
                        )
                    save(offer_attempted=True, phase="offer")
                    result = await self.selling.create_offer(family, draft)
                    if not re.fullmatch(r"[0-9]{1,30}", str(result.get("offerId", ""))):
                        raise ValueError(
                            "Offer response lacks an ID; reconcile before retrying"
                        )
                    save(offer_id=result["offerId"])
                offer = await self.selling.get_offer(family, job["offer_id"])
                if not offer_matches(offer, draft.offer_payload()):
                    raise ValueError("Offer read-back differs from approval")
                current = await self.selling.get_item(family, draft.listing_sku)
                if not inventory_matches(current, expected):
                    raise ValueError("Inventory content changed after approval")
                await self.selling.validate_policies(family, draft)
                await self.selling.validate_promotion(family, draft)
                self.repo.approved(self.repo.get(seller, draft_id), seller)
                if offer.get("status") != "PUBLISHED":
                    if job.get("publish_attempted"):
                        recovery = job.get("publish_recovery") or {}
                        if (recovery.get("consumed") is not False or
                                recovery.get("seller") != seller or
                                recovery.get("revision") != revision or
                                recovery.get("offer_id") != job["offer_id"] or
                                recovery.get("expires_at", 0) < time.time() or
                                offer.get("status") != "UNPUBLISHED" or offer.get("listing") or
                                job.get("listing_id") or len(offers) != 1):
                            raise ValueError(
                                "Publication outcome is unresolved; only read-back recovery is allowed"
                            )
                        # Consume before the request. A crash/timeout never rearms it.
                        recovery.update(consumed=True, consumed_at=time.time())
                    save(publish_attempted=True, phase="publish", publish_failure=None,
                         publish_requested_at=time.time())
                    try:
                        result = await self.selling.publish(family, job["offer_id"])
                    except SellingError as exc:
                        failure = {**exc.diagnostic(), "offer_id": job["offer_id"],
                                   "revision": revision, "at": time.time()}
                        job.setdefault("publish_failures", []).append(deepcopy(failure))
                        save(publish_failure=failure)
                        raise
                    if not re.fullmatch(
                        r"[0-9]{9,20}", str(result.get("listingId", ""))
                    ):
                        raise ValueError(
                            "Publish response lacks an item ID; reconcile before retrying"
                        )
                    save(listing_id=result["listingId"])
                    offer = await self.selling.get_offer(family, job["offer_id"])
                item_id = offer.get("listing", {}).get("listingId")
                if offer.get("status") != "PUBLISHED" or not re.fullmatch(
                    r"[0-9]{9,20}", str(item_id or "")
                ):
                    raise ValueError("eBay has not verified the published offer")
                if job.get("listing_id") and item_id != job["listing_id"]:
                    raise ValueError("Published item ID mismatch")
                if not offer_matches(offer, draft.offer_payload()):
                    raise ValueError("Published offer terms differ from approval")
                current = await self.selling.get_item(family, draft.listing_sku)
                if not inventory_matches(current, expected):
                    raise ValueError("Published inventory or package differs from approval")
                save(listing_id=item_id, phase="verify")
                rows = await self.active(family)
                live = next((r for r in rows if r["item_id"] == item_id), None)
                if (
                    not live
                    or live.get("sku") != draft.listing_sku
                    or live["title"] != draft.title
                    or live["price"]["currency"] != "USD"
                    or Decimal(live["price"]["value"]) != Decimal(draft.price_usd)
                ):
                    raise ValueError(
                        "Live listing is not yet verified; retain this offer and retry read-back"
                    )
                promotion = {
                    "requested_percent": 5,
                    "status": "unsupported",
                    "reason": draft.promotion_unavailable_reason,
                }
                if draft.promotion_campaign_id:
                    save(phase="promotion")
                    ads = await self.selling.ads(family, draft)
                    if not ads:
                        if draft.promotion_mode == "automatic_existing":
                            save(phase="promotion")
                            raise ValueError(
                                "Waiting for the existing automatic 5% campaign; retry read-back of the same listing"
                            )
                        if job.get("promotion_attempted"):
                            raise ValueError(
                                "Promotion outcome is unresolved; only read-back recovery is allowed"
                            )
                        save(promotion_attempted=True, phase="promotion")
                        await self.selling.create_ad(family, draft)
                        ads = await self.selling.ads(family, draft)
                    if (
                        len(ads) != 1
                        or ads[0].get("listingId") != item_id
                        or Decimal(ads[0].get("bidPercentage", "-1")) != 5
                    ):
                        raise ValueError(
                            "5% promotion is not verified; retain the live listing and inspect this campaign"
                        )
                    promotion = {
                        "requested_percent": 5,
                        "status": "verified",
                        "campaign_id": draft.promotion_campaign_id,
                        "ad_id": ads[0].get("adId"),
                    }
                receipt = {
                    "schema": "btco.publication.v1",
                    "seller_id": seller,
                    "draft_id": draft_id,
                    "revision": revision,
                    "item_id": item_id,
                    "url": "https://www.ebay.com/itm/" + item_id,
                    "listing_sku": draft.listing_sku,
                    "master_sku": draft.master_sku,
                    "physical_item_id": draft.physical_item_id,
                    "price_usd": draft.price_usd,
                    "currency": "USD",
                    "title": draft.title,
                    "verified_at": datetime.now(timezone.utc).isoformat(),
                    "promotion": promotion,
                    "vault_reconciliation": "pending",
                }
                row.update(state="published", receipt=receipt)
                job.update(phase="verified", last_error=None)
                row["updated_at"] = time.time()
                # A crash cannot leave a verified journal without its receipt.
                with self.repo.store.tx() as db:
                    self.repo.write(seller, row, db)
                    self.repo.store.put("publication", seller + ":" + item_id, receipt, db=db)
                return row
            except Exception as exc:
                if job:
                    # The receipt transaction may have rolled back. Report from
                    # durable state, never re-save an uncommitted verified row.
                    row = self.repo.get(seller, draft_id)
                    job = row["job"]
                    save(
                        last_error=str(exc)
                        if isinstance(exc, (ValueError, SellingError))
                        else "Publication interrupted; inspect saved state"
                    )
                raise



