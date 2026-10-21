"""Narrow Sell/Media adapter. Never retries a mutating request implicitly."""

import asyncio
import re
from urllib.parse import quote, urlsplit
import httpx
from .config import INVENTORY_SCOPE, ACCOUNT_SCOPE, MARKETING_SCOPE, TRADING_SCOPE
from .ebay import EbayError
from .listing_drafts import CONDITION_IDS, fingerprint

INVENTORY = "https://api.ebay.com/sell/inventory/v1"
ACCOUNT = "https://api.ebay.com/sell/account/v1"
MEDIA = "https://apim.ebay.com/commerce/media/v1_beta"
MARKETING = "https://api.ebay.com/sell/marketing/v1"
METADATA = "https://api.ebay.com/sell/metadata/v1"


class SellingError(EbayError):
    def __init__(self, status=None, codes=(), reasons=()):
        self.status, self.codes = status, codes
        self.uncertain = status is None or status >= 500
        self.reasons = list(reasons)
        label = (
            "eBay response was not confirmed"
            if self.uncertain
            else f"eBay returned HTTP {status}"
        )
        super().__init__(
            label
            + (" (codes " + ", ".join(codes) + ")" if codes else "")
            + ". Check the saved publication status before retrying."
        )

    def diagnostic(self):
        # Never persist or expose arbitrary upstream text, tokens or parameters.
        return {"http_status": self.status, "codes": list(self.codes),
                "uncertain": self.uncertain, "reasons": self.reasons}


class Selling:
    def __init__(self, ebay):
        self.ebay = ebay

    def require(self, family, scope=INVENTORY_SCOPE):
        grant = self.ebay.store.get("grant", family)
        if not grant or scope not in grant.get("consented_scopes", []):
            raise ValueError(
                "New eBay listing permissions require explicit owner consent and reconnection"
            )
        return grant

    async def _request(self, family, method, url, *, scope=INVENTORY_SCOPE, **kwargs):
        self.require(family, scope)
        token = await self.ebay.access(family)
        # All callers below construct fixed endpoint paths; no user-supplied URLs.
        if not any(
            url.startswith(origin + "/")
            for origin in (INVENTORY, ACCOUNT, MEDIA, MARKETING, METADATA)
        ):
            raise ValueError("Unsupported seller endpoint")
        headers = {
            "Authorization": "Bearer " + token,
            "Content-Language": "en-US",
            "Accept": "application/json",
        }
        try:
            async with self.ebay.http.client() as client:
                response = await client.request(method, url, timeout=45, headers=headers, **kwargs)
        except httpx.HTTPError:
            raise SellingError() from None
        if not 200 <= response.status_code < 300:
            codes = []
            reasons = []
            try:
                errors = response.json().get("errors", [])[:5]
                codes = [
                    str(x.get("errorId"))
                    for x in errors
                    if str(x.get("errorId", "")).isdigit()
                ]
                for error in errors:
                    message = str(error.get("message", "")).casefold()
                    for phrase, reason in (
                        ("availability not found", "availability_not_found"),
                        ("additionalinformation not found", "additional_information_not_found"),
                        ("invalid value for `availability`", "invalid_availability"),
                    ):
                        if phrase in message and reason not in reasons:
                            reasons.append(reason)
            except (ValueError, AttributeError, TypeError):
                pass
            raise SellingError(response.status_code, codes, reasons)
        try:
            data = response.json() if response.content else {}
        except ValueError:
            raise SellingError() from None
        if not isinstance(data, dict):
            raise SellingError()
        return data, response.headers

    async def policies(self, family, selection):
        result = {}
        selections = (
            ("fulfillment_policy", selection.fulfillment_policy_id),
            ("payment_policy", selection.payment_policy_id),
            ("return_policy", selection.return_policy_id),
        )
        # Three independent GETs, no cached policy data and no automatic retry.
        # Drain the bounded group before surfacing an error, so no reads outlive
        # the enclosing publication/preparation operation. Cancellation propagates
        # to every request through gather.
        responses = await asyncio.gather(*(self._request(
                family,
                "GET",
                ACCOUNT + "/" + kind + "/" + identifier,
                scope=ACCOUNT_SCOPE,
            ) for kind, identifier in selections), return_exceptions=True)
        for (kind, _), response in zip(selections, responses):
            if isinstance(response, BaseException):
                raise response
            data, _ = response
            if data.get("marketplaceId") != "EBAY_US":
                raise ValueError("Policy marketplace mismatch")
            result[kind] = data
        return result

    async def policy_options(self, family):
        result = {}
        kinds = ("fulfillment_policy", "payment_policy", "return_policy")
        # Four independent required GETs. Drain this group before reporting any
        # failure; optional reads only start after all required reads succeed.
        responses = await asyncio.gather(*(
            self._request(
                family,
                "GET",
                ACCOUNT + "/" + kind,
                scope=ACCOUNT_SCOPE,
                params={"marketplace_id": "EBAY_US"},
            ) for kind in kinds
        ), self._request(
            family, "GET", INVENTORY + "/location", params={"limit": 100},
        ), return_exceptions=True)
        for key, response in zip((*kinds, "locations"), responses):
            if isinstance(response, BaseException):
                raise response
            result[key] = response[0]
        # Listing readiness includes category rules and existing campaigns. All
        # requests are GETs, independently reported so an optional read failure
        # cannot conceal otherwise available business-policy information. Two
        # category GETs plus one sequential campaign pager: at most three reads.
        responses = await asyncio.gather(
            self.category_policies(family, "259104"), self.campaign_options(family),
            return_exceptions=True,
        )
        for key, response in zip(("comic_category", "promotion_campaigns"), responses):
            if isinstance(response, (SellingError, ValueError)):
                result[key] = {"status": "unavailable", "error": str(response)}
            elif isinstance(response, BaseException):
                raise response
            else:
                result[key] = response
        return result

    async def category_policies(self, family, category_id):
        if not re.fullmatch(r"[0-9]{1,10}", category_id):
            raise ValueError("Invalid category ID")
        result = {"marketplace_id": "EBAY_US", "category_id": category_id}
        methods = (
            ("get_item_condition_policies", "itemConditionPolicies", INVENTORY_SCOPE),
            ("get_negotiated_price_policies", "negotiatedPricePolicies", TRADING_SCOPE),
        )
        responses = await asyncio.gather(*(self._request(
                family, "GET", METADATA + "/marketplace/EBAY_US/" + method,
                scope=scope, params={"filter": "categoryIds:{" + category_id + "}"},
            ) for method, _, scope in methods), return_exceptions=True)
        for (_, key, _), response in zip(methods, responses):
            if isinstance(response, BaseException):
                raise response
            data, _ = response
            rows = data.get(key, [])
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("Invalid category metadata response")
            matches = [row for row in rows if row.get("categoryId") == category_id]
            if len(matches) > 1 or data.get("warnings") or data.get("errors"):
                raise ValueError("Incomplete or ambiguous category metadata")
            result[key] = matches
        return result

    async def validate_category(self, family, draft):
        metadata = await self.category_policies(family, draft.category_id)
        policies = metadata["itemConditionPolicies"]
        if len(policies) != 1:
            raise ValueError("Category condition policy could not be verified")
        conditions = policies[0].get("itemConditions", [])
        if not isinstance(conditions, list):
            raise ValueError("Invalid category condition response")
        if draft.condition is None:
            if policies[0].get("itemConditionRequired") is not False:
                raise ValueError("Category does not explicitly permit omitting a condition grade")
        else:
            matches = [c for c in conditions if isinstance(c, dict)
                       and c.get("conditionId") == CONDITION_IDS[draft.condition]]
            if len(matches) != 1:
                raise ValueError("The approved condition is not supported in this category")
            condition = matches[0]
            if getattr(draft, "product_type", None) == "card":
                from .card_conditions import validate_descriptors
                validate_descriptors(condition, draft.condition_descriptors)
            elif condition.get("conditionDescriptors") or condition.get("usage"):
                raise ValueError("This condition requires a descriptor/eligibility workflow; review before publishing")
        if draft.best_offer.enabled:
            policies = metadata["negotiatedPricePolicies"]
            if len(policies) != 1 or policies[0].get("bestOfferAutoDeclineEnabled") is not True:
                raise ValueError("The category does not verify the approved Best Offer minimum")

    async def validate_policies(self, family, draft):
        policies = await self.policies(family, draft.policies)
        if fingerprint(policies) != draft.policies.snapshots_sha256:
            raise ValueError(
                "Shipping/payment/return policy changed; review and approve a new draft"
            )
        domestic = [
            o
            for o in policies["fulfillment_policy"].get("shippingOptions", [])
            if o.get("optionType") == "DOMESTIC"
        ]
        if not domestic:
            raise ValueError("A domestic buyer-paid shipping service is required")
        from decimal import Decimal, InvalidOperation

        for option in domestic:
            services = option.get("shippingServices", [])
            if not services:
                raise ValueError("Domestic shipping services are missing")
            for service in services:
                if service.get("freeShipping") is True:
                    raise ValueError("Selected policy offers free shipping")
                if option.get("costType") != "CALCULATED":
                    cost = service.get("shippingCost", {})
                    try:
                        valid = (
                            cost.get("currency") == "USD"
                            and Decimal(cost.get("value", "0")) > 0
                        )
                    except InvalidOperation:
                        valid = False
                    if not valid:
                        raise ValueError(
                            "Selected policy does not prove buyer-paid shipping"
                        )
        location, _ = await self._request(
            family,
            "GET",
            INVENTORY + "/location/" + quote(draft.merchant_location_key, safe=""),
        )
        if location.get("merchantLocationStatus") != "ENABLED":
            raise ValueError("Inventory location must be enabled")
        # Calculated services need a parcel with measured or explicitly
        # owner-authorized estimated provenance, bound to the approved revision.
        if draft.packed_parcel is None and any(
            o.get("costType") == "CALCULATED"
            for o in policies["fulfillment_policy"].get("shippingOptions", [])
        ):
            raise ValueError(
                "Calculated shipping needs verified packed measurements or an explicitly owner-authorized shipping estimate in the approved draft"
            )
        if getattr(draft, "product_type", None) == "card":
            from .card_conditions import validate_card_shipping
            validate_card_shipping(policies, draft)
        await self.validate_category(family, draft)

    async def campaign_options(self, family):
        rows, identifiers = [], set()
        total, offset, limit = None, 0, 100
        for _ in range(20):
            data, _ = await self._request(
                family, "GET", MARKETING + "/ad_campaign", scope=MARKETING_SCOPE,
                params={"campaign_status": "RUNNING", "funding_strategy": "COST_PER_SALE",
                        "limit": limit, "offset": offset},
            )
            page, count = data.get("campaigns", []), data.get("total")
            if (not isinstance(page, list) or type(count) is not int or count < 0
                    or data.get("offset") != offset or data.get("limit") != limit
                    or len(page) > limit or (total is not None and count != total)
                    or data.get("errors") or data.get("warnings")):
                raise ValueError("Incomplete or changing promotion campaign collection")
            total = count
            for campaign in page:
                identifier = campaign.get("campaignId") if isinstance(campaign, dict) else None
                if not isinstance(identifier, str) or not re.fullmatch(r"[0-9]{1,30}", identifier) or identifier in identifiers:
                    raise ValueError("Invalid or duplicate promotion campaign ID")
                identifiers.add(identifier)
                rows.append({"campaign": campaign, "fixed_rate_eligible": self.fixed_campaign(campaign),
                             "automatic_five_percent_eligible": self.automatic_five_percent_campaign(campaign)})
            if len(rows) > total:
                raise ValueError("Campaign count mismatch")
            if not data.get("next"):
                if len(rows) != total:
                    raise ValueError("Incomplete promotion campaign collection")
                return {"campaigns": rows, "total_matching": total, "complete": True}
            if len(page) != limit or len(rows) >= total:
                raise ValueError("Inconsistent promotion pagination")
            # Never follow a returned URL or forward credentials to another host.
            offset += limit
        raise ValueError("Promotion campaign collection exceeds the supported page bound")

    @staticmethod
    def fixed_campaign(data):
        strategy = data.get("fundingStrategy", {})
        return (
            isinstance(strategy, dict)
            and data.get("marketplaceId") == "EBAY_US"
            and data.get("campaignStatus") == "RUNNING"
            and strategy.get("fundingModel") == "COST_PER_SALE"
            and strategy.get("adRateStrategy", "FIXED") == "FIXED"
            and not strategy.get("dynamicAdRatePreferences")
            and data.get("channels", ["ON_SITE"]) == ["ON_SITE"]
            and not data.get("budget")
            and not data.get("campaignCriterion")
        )

    @classmethod
    def automatic_five_percent_campaign(cls, data):
        criterion = data.get("campaignCriterion")
        if not isinstance(criterion, dict) or not cls.fixed_campaign({
            **data, "campaignCriterion": None
        }):
            return False
        # Only observe an existing all-inventory, fixed 5% campaign. Do not
        # create ads, change selection rules, change rates or create campaigns.
        try:
            from decimal import Decimal
            rate = Decimal(str(data["fundingStrategy"].get("bidPercentage", "")))
            return (
                rate.is_finite() and rate == 5
                and criterion.get("autoSelectFutureInventory") is True
                and criterion.get("criterionType") == "INVENTORY_PARTITION"
                and criterion.get("selectionRules") == [{"categoryScope": "MARKETPLACE"}]
            )
        except (ValueError, ArithmeticError):
            return False

    async def get_item(self, family, sku):
        try:
            return (
                await self._request(
                    family, "GET", INVENTORY + "/inventory_item/" + quote(sku, safe="")
                )
            )[0]
        except SellingError as e:
            if e.status == 404:
                return None
            raise

    async def put_item(self, family, draft, image_urls):
        return (
            await self._request(
                family,
                "PUT",
                INVENTORY + "/inventory_item/" + quote(draft.listing_sku, safe=""),
                json=draft.inventory_payload(image_urls),
            )
        )[0]

    async def offers(self, family, sku):
        try:
            data, _ = await self._request(
                family,
                "GET",
                INVENTORY + "/offer",
                params={
                    "sku": sku,
                    "marketplace_id": "EBAY_US",
                    "format": "FIXED_PRICE",
                    "limit": 200,
                },
            )
        except SellingError as e:
            if e.status == 404 or (e.status == 400 and e.codes == ["25713"]):
                return []
            raise
        rows = data.get("offers", [])
        if (
            not isinstance(rows, list)
            or data.get("total", len(rows)) != len(rows)
            or data.get("next")
        ):
            raise ValueError(
                "Incomplete offer lookup; stop to avoid duplicate publication"
            )
        return rows

    async def get_offer(self, family, offer_id):
        if not re.fullmatch(r"[0-9]{1,30}", offer_id):
            raise ValueError("Invalid offer ID")
        return (await self._request(family, "GET", INVENTORY + "/offer/" + offer_id))[0]

    async def create_offer(self, family, draft):
        return (
            await self._request(
                family, "POST", INVENTORY + "/offer", json=draft.offer_payload()
            )
        )[0]

    async def publish(self, family, offer_id):
        if not re.fullmatch(r"[0-9]{1,30}", offer_id):
            raise ValueError("Invalid offer ID")
        return (
            await self._request(
                family, "POST", INVENTORY + "/offer/" + offer_id + "/publish"
            )
        )[0]

    async def upload(self, family, photo, data):
        mime = "image/jpeg" if photo.object_key.endswith(".jpeg") else "image/png"
        result, headers = await self._request(
            family,
            "POST",
            MEDIA + "/image/create_image_from_file",
            files={"image": (photo.object_key.rsplit("/", 1)[-1], data, mime)},
        )
        location = headers.get("location", "")
        if not re.fullmatch(re.escape(MEDIA) + r"/image/[A-Za-z0-9_-]+", location):
            raise ValueError("eBay did not provide a valid image resource reference")
        url = urlsplit(result.get("imageUrl", ""))
        if (
            url.scheme != "https"
            or not url.hostname
            or not url.hostname.endswith(".ebayimg.com")
            or url.username
            or url.password
        ):
            raise ValueError("eBay returned an unexpected hosted image URL")
        if not result.get("expirationDate"):
            raise ValueError("eBay did not provide image expiration")
        return {
            "resource": location,
            "image_url": result["imageUrl"],
            "expires_at": result["expirationDate"],
            "sha256": photo.sha256_hex,
        }

    async def campaign(self, family, campaign_id):
        if not re.fullmatch(r"[0-9]{1,30}", campaign_id):
            raise ValueError("Invalid campaign ID")
        data, _ = await self._request(
            family,
            "GET",
            MARKETING + "/ad_campaign/" + campaign_id,
            scope=MARKETING_SCOPE,
        )
        # Do not enter CPC, dynamically priced, paused or foreign-market campaigns.
        if not (self.fixed_campaign(data) or self.automatic_five_percent_campaign(data)):
            raise ValueError(
                "Promotion requires a running US fixed cost-per-sale manual campaign or existing automatic 5% campaign"
            )
        return data

    async def validate_promotion(self, family, draft):
        if draft.promotion_campaign_id:
            campaign = await self.campaign(family, draft.promotion_campaign_id)
            automatic = self.automatic_five_percent_campaign(campaign)
            if automatic != (draft.promotion_mode == "automatic_existing"):
                raise ValueError("Promotion selection mode changed; review the campaign")
            if fingerprint(campaign) != draft.promotion_campaign_sha256:
                raise ValueError(
                    "Promotion campaign changed; renewed approval is required"
                )

    async def ads(self, family, draft):
        if draft.promotion_mode == "automatic_existing":
            # The inventory-reference lookup returns 35064 for rule-based
            # campaigns. Resolve only this SKU's published offer, then query
            # active ads by its exact listing ID. No campaign/ad write occurs.
            offers = await self.offers(family, draft.listing_sku)
            if len(offers) != 1 or offers[0].get("status") != "PUBLISHED":
                raise ValueError("Promotion read-back needs the one published offer for this SKU")
            item_id = offers[0].get("listing", {}).get("listingId")
            if not isinstance(item_id, str) or not re.fullmatch(r"[0-9]{9,15}", item_id):
                raise ValueError("Promotion read-back needs a valid live item ID")
            data, _ = await self._request(
                family, "GET", MARKETING + "/ad_campaign/" + draft.promotion_campaign_id + "/ad",
                scope=MARKETING_SCOPE,
                params={"listing_ids": item_id, "limit": 100, "offset": 0},
            )
            rows = data.get("ads", [])
            if (not isinstance(rows, list) or data.get("next")
                    or type(data.get("total")) is not int or data["total"] != len(rows)
                    or any(not isinstance(ad, dict) or ad.get("listingId") != item_id for ad in rows)):
                raise ValueError("Incomplete or mismatched automatic promotion lookup")
            return rows
        data, _ = await self._request(
            family,
            "GET",
            MARKETING
            + "/ad_campaign/"
            + draft.promotion_campaign_id
            + "/get_ads_by_inventory_reference",
            scope=MARKETING_SCOPE,
            params={
                "inventory_reference_id": draft.listing_sku,
                "inventory_reference_type": "INVENTORY_ITEM",
            },
        )
        rows = data.get("ads", [])
        if not isinstance(rows, list) or data.get("next"):
            raise ValueError("Incomplete promotion lookup")
        return rows

    async def create_ad(self, family, draft):
        if draft.promotion_mode != "manual":
            raise ValueError("Existing automatic campaigns are read-only; wait for verified inclusion")
        data, _ = await self._request(
            family,
            "POST",
            MARKETING
            + "/ad_campaign/"
            + draft.promotion_campaign_id
            + "/bulk_create_ads_by_inventory_reference",
            scope=MARKETING_SCOPE,
            json={
                "requests": [
                    {
                        "inventoryReferenceId": draft.listing_sku,
                        "inventoryReferenceType": "INVENTORY_ITEM",
                        "bidPercentage": "5.0",
                    }
                ]
            },
        )
        return data




