"""Fixed eBay endpoints only. OAuth POSTs; seller data GETs. No mutation endpoints."""
import asyncio
from datetime import date, datetime, time as day_time, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.parse import quote
import time
import httpx
from .config import EBAY_SCOPES, LEGACY_EBAY_SCOPES
from .http_client import EbayHTTP

TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
IDENTITY_URL = "https://apiz.ebay.com/commerce/identity/v1/user/"
ORDER_URL = "https://api.ebay.com/sell/fulfillment/v1/order"
TRANSACTION_URL = "https://apiz.ebay.com/sell/finances/v1/transaction"
PAYOUT_URL = "https://apiz.ebay.com/sell/finances/v1/payout"
FUNDS_URL = "https://apiz.ebay.com/sell/finances/v1/seller_funds_summary"


class EbayError(Exception):
    """Safe user-visible failure, containing no upstream body or credentials."""


def date_filter(field, start_date, end_date, *, now=None):
    start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    if end < start or (end - start).days >= 90:
        raise ValueError("Use an inclusive date range of 1–90 days.")
    pacific = ZoneInfo("America/Los_Angeles")
    a = datetime.combine(start, day_time(), pacific).astimezone(timezone.utc)
    b = datetime.combine(end + timedelta(days=1), day_time(), pacific).astimezone(timezone.utc) - timedelta(milliseconds=1)
    # eBay Fulfillment rejects an upper bound in the future. Today's inclusive
    # Pacific range ends at retrieval time; completed days retain their full span.
    now = now if now is not None else datetime.now(timezone.utc)
    if a > now:
        raise ValueError("The start date must be today or earlier in Pacific time.")
    b = min(b, now)
    fmt = lambda d: d.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return f"{field}:[{fmt(a)}..{fmt(b)}]"


def pick(data, keys):
    return {k: data[k] for k in keys if k in data}


def money(data):
    return pick(data, ["value", "currency", "convertedFromValue", "convertedFromCurrency"]) if isinstance(data, dict) else None


def order_view(order):
    result = pick(order, ["orderId", "creationDate", "lastModifiedDate", "orderFulfillmentStatus", "orderPaymentStatus", "salesRecordReference"])
    if "cancelStatus" in order:
        result["cancelStatus"] = pick(order["cancelStatus"], ["cancelState"])
    result["buyer_username"] = order.get("buyer", {}).get("username")
    summary = order.get("pricingSummary", {})
    result["pricing"] = {key: money(summary[key]) for key in ["priceSubtotal", "deliveryCost", "tax", "total", "priceDiscount", "deliveryDiscount", "fee"] if key in summary}
    result["line_items"] = []
    for line in order.get("lineItems", []):
        item = pick(line, ["lineItemId", "legacyItemId", "sku", "title", "quantity", "lineItemFulfillmentStatus"])
        for key in ["lineItemCost", "total", "deliveryCost"]:
            if key in line: item[key] = money(line[key])
        result["line_items"].append(item)
    return result


def transaction_view(tx):
    result = pick(tx, ["transactionId", "transactionType", "transactionStatus", "transactionDate", "bookingEntry", "orderId", "payoutId", "feeType"])
    if "references" in tx:
        result["references"] = [pick(ref, ["referenceId", "referenceType"]) for ref in tx["references"]]
    for key in ["amount", "totalFeeAmount", "totalFeeBasisAmount", "ebayCollectedTaxAmount"]:
        if key in tx: result[key] = money(tx[key])
    result["orderLineItems"] = []
    for line in tx.get("orderLineItems", []):
        clean = pick(line, ["lineItemId", "itemId"])
        clean["marketplaceFees"] = [{**pick(fee, ["feeType", "feeJurisdiction"]), "amount": money(fee.get("amount"))} for fee in line.get("marketplaceFees", [])]
        result["orderLineItems"].append(clean)
    return result


def payout_view(row):
    clean = pick(row, ["payoutId", "payoutStatus", "payoutDate", "lastAttemptedPayoutDate", "transactionCount"])
    clean["amount"] = money(row.get("amount"))
    return clean


class Ebay:
    def __init__(self, settings, store, transport=None):
        self.settings, self.store, self.transport = settings, store, transport
        self.lock = asyncio.Lock()
        self.http = EbayHTTP(lambda: self.transport)

    async def request(self, method, url, **kwargs):
        # This client can only send credentials to the fixed production eBay hosts.
        permitted = [TOKEN_URL, IDENTITY_URL, ORDER_URL, TRANSACTION_URL, PAYOUT_URL, FUNDS_URL]
        if url not in permitted and not (method == "GET" and url.startswith(ORDER_URL + "/")):
            raise ValueError("Unsupported eBay endpoint.")
        if (url == TOKEN_URL and method != "POST") or (url != TOKEN_URL and method != "GET"):
            raise ValueError("Seller writes are not supported.")
        try:
            async with self.http.client() as client:
                response = await client.request(method, url, timeout=20, **kwargs)
        except httpx.HTTPError:
            raise EbayError("eBay could not be reached. Try again shortly.") from None
        if response.status_code in (401, 403):
            raise EbayError("eBay authorization failed. Reconnect and check the approved API scopes.")
        if response.status_code == 429:
            raise EbayError("eBay rate limit reached. Try again later.")
        if response.status_code == 204:
            return {}
        if response.status_code < 200 or response.status_code >= 300:
            # Numeric error IDs aid diagnosis without leaking upstream message bodies.
            codes = []
            try:
                errors = response.json().get("errors", [])
                codes = [str(e["errorId"]) for e in errors[:5]
                         if isinstance(e, dict) and str(e.get("errorId", "")).isdigit()]
            except (ValueError, AttributeError, TypeError):
                pass
            detail = " (eBay error " + ", ".join(codes) + ")" if codes else ""
            raise EbayError(f"eBay returned HTTP {response.status_code}{detail}; no data was changed.")
        try:
            return response.json()
        except ValueError:
            raise EbayError("eBay returned an unexpected response.") from None

    async def token(self, **form):
        return await self.request("POST", TOKEN_URL,
            auth=httpx.BasicAuth(self.settings.client_id, self.settings.client_secret), data=form)

    async def exchange(self, code, requested_scopes=None):
        grant = await self.token(grant_type="authorization_code", code=code, redirect_uri=self.settings.runame)
        if not grant.get("access_token") or not grant.get("refresh_token"):
            raise EbayError("eBay did not return a renewable seller authorization.")
        identity = await self.request("GET", IDENTITY_URL, headers={"Authorization": "Bearer " + grant["access_token"]})
        if identity.get("username", "").casefold() != self.settings.allowed_seller.casefold():
            raise EbayError("This private connector only accepts the configured BTCo seller account.")
        if not identity.get("userId"):
            raise EbayError("eBay did not return a stable seller identity.")
        grant.update(username=identity["username"], user_id=identity["userId"],
                     consented_scopes=grant.get("scope", " ".join(requested_scopes or EBAY_SCOPES)).split(),
                     expires_at=time.time() + int(grant.get("expires_in", 7200)),
                     refresh_expires_at=time.time() + int(grant.get("refresh_token_expires_in", 86400)))
        return grant

    async def access(self, family):
        async with self.lock:
            record = self.store.get("grant", family)
            if not record or record["refresh_expires_at"] <= time.time():
                raise EbayError("Seller authorization is missing or expired. Reconnect this plugin.")
            if record["expires_at"] <= time.time() + 90:
                # Existing grants cannot gain a new scope through refresh. Preserve
                # the old consent until the user reconnects through eBay's own flow.
                scopes = record.get("consented_scopes", LEGACY_EBAY_SCOPES)
                new = await self.token(grant_type="refresh_token", refresh_token=record["refresh_token"], scope=" ".join(scopes))
                if not new.get("access_token"):
                    raise EbayError("eBay did not refresh seller access. Reconnect this plugin.")
                record["access_token"] = new["access_token"]
                record["expires_at"] = time.time() + int(new.get("expires_in", 7200))
                if new.get("refresh_token"):
                    record["refresh_token"] = new["refresh_token"]
                    record["refresh_expires_at"] = time.time() + int(new.get("refresh_token_expires_in", 86400))
                # A revoked grant must never be recreated by an in-flight refresh.
                with self.store.tx() as db:
                    current = self.store.get("grant", family, db=db)
                    if not current:
                        raise EbayError("This connection was revoked. Reconnect the plugin.")
                    # A concurrent connector refresh can extend its grant lifetime.
                    record["connection_expires_at"] = current.get("connection_expires_at", record["refresh_expires_at"])
                    self.store.put("grant", family, record, min(record["connection_expires_at"], record["refresh_expires_at"]), family, db)
            return record["access_token"]

    async def get(self, family, url, params=None):
        access = await self.access(family)
        return await self.request("GET", url, params=params, headers={"Authorization": "Bearer " + access, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"})

    async def page(self, family, url, key, projection, filter_value, limit, offset):
        if not 1 <= limit <= 200 or not 0 <= offset <= 100000:
            raise ValueError("Limit must be 1–200; offset must be 0–100000.")
        data = await self.get(family, url, {"filter": filter_value, "limit": limit, "offset": offset})
        rows = data.get(key, [])
        total = data.get("total")
        more = bool(data.get("next")) or (isinstance(total, int) and offset + len(rows) < total)
        return {"retrieved_at_utc": datetime.now(timezone.utc).isoformat(), "date_timezone": "America/Los_Angeles",
                "offset": offset, "returned": len(rows), "total_matching": total,
                "has_more": more, "next_offset": offset + len(rows) if more and rows else None,
                "records": [projection(row) for row in rows],
                "warnings": [{"errorId": w.get("errorId"), "category": w.get("category")} for w in data.get("warnings", [])],
                "note": "One page of eBay records. Fetch remaining pages before stating totals. Proceeds and payouts are not profit; card costs, supplies, external postage and overhead are not included."}


