"""Seller-owned active listings, including listings created through CDP.

Only the fixed GetMyeBaySelling read operation is sent to Trading API.
No caller-supplied URL, XML, header, token, seller, or call name is accepted.
"""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re
from xml.etree import ElementTree as ET
import httpx
from .config import TRADING_SCOPE
from .ebay import EbayError

TRADING_URL = "https://api.ebay.com/ws/api.dll"
TRADING_VERSION = "1487"
NS = "urn:ebay:apis:eBLBaseComponents"
PAGE_SIZE = 200
MAX_RESPONSE_BYTES = 4_000_000


def _path(path):
    return "/".join("{" + NS + "}" + part for part in path.split("/"))


def _text(node, path):
    return node.findtext(_path(path))


def _integer(value, *, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,9}", value):
        raise EbayError("eBay returned invalid inventory counts. No inventory was changed.")
    return int(value)


def _price(node, path):
    element = node.find(_path(path))
    if element is None:
        return None
    raw, currency = element.text or "", element.get("currencyID", "")
    try:
        value = Decimal(raw)
        if not value.is_finite() or value < 0 or value > 1_000_000_000 or not re.fullmatch(r"[A-Z]{3}", currency):
            raise ValueError()
    except (InvalidOperation, ValueError):
        raise EbayError("eBay returned an invalid listing price.") from None
    return {"value": raw, "currency": currency}


def _quantities(node):
    quantity = _integer(_text(node, "Quantity"))
    sold = _integer(_text(node, "SellingStatus/QuantitySold"))
    available = _integer(_text(node, "QuantityAvailable"))
    if available is None and quantity is not None and sold is not None:
        if sold > quantity:
            raise EbayError("eBay returned inconsistent inventory quantities.")
        available = quantity - sold
    return {"quantity_available": available, "quantity_listed": quantity, "quantity_sold": sold}


def _listing(node):
    item_id = _text(node, "ItemID") or ""
    title = _text(node, "Title") or ""
    if not re.fullmatch(r"[0-9]{9,20}", item_id) or not title or len(title) > 1000:
        raise EbayError("eBay returned an invalid listing identity.")
    variants = []
    for variant in node.findall(_path("Variations/Variation")):
        variants.append({"sku": _text(variant, "SKU"), **_quantities(variant),
                         "price": _price(variant, "StartPrice"),
                         "specifics": [{"name": _text(pair, "Name"),
                                        "values": [v.text for v in pair.findall(_path("Value"))]}
                                       for pair in variant.findall(_path("VariationSpecifics/NameValueList"))]})
    return {"item_id": item_id, "sku": _text(node, "SKU"), "title": title,
            "listing_type": _text(node, "ListingType"), **_quantities(node),
            "price": _price(node, "SellingStatus/CurrentPrice"),
            "started_at": _text(node, "ListingDetails/StartTime"),
            "variations": variants,
            "requires_variation_review": bool(variants)}


def parse_active_listings(payload, page):
    # Reject declarations/entities before parsing; never expand external content.
    if len(payload) > MAX_RESPONSE_BYTES or b"\x00" in payload or b"<!DOCTYPE" in payload.upper() or b"<!ENTITY" in payload.upper():
        raise EbayError("eBay returned an unsupported inventory response.")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        raise EbayError("eBay returned invalid inventory XML.") from None
    if root.tag != "{" + NS + "}GetMyeBaySellingResponse":
        raise EbayError("eBay returned an unexpected inventory response.")
    ack = _text(root, "Ack")
    warnings = []
    for error in root.findall(_path("Errors")):
        code = _text(error, "ErrorCode") or ""
        warnings.append({"code": code if code.isdigit() else "unknown",
                         "severity": "warning" if _text(error, "SeverityCode") == "Warning" else "error"})
    if ack != "Success" or warnings:
        # A warning/partial failure cannot establish a trustworthy complete page.
        codes = ", ".join(w["code"] for w in warnings[:5]) or "unknown"
        raise EbayError("eBay inventory read was not complete (code " + codes + "). Reconnect if authorization has expired; no inventory was changed.")
    total = _integer(_text(root, "ActiveList/PaginationResult/TotalNumberOfEntries"), required=True)
    pages = _integer(_text(root, "ActiveList/PaginationResult/TotalNumberOfPages"), required=True)
    if total >= 25000:
        raise EbayError("eBay's active-listing read limit is 25,000 listings. Use a full inventory report; this result is not complete.")
    if pages != (total + PAGE_SIZE - 1) // PAGE_SIZE or page > max(1, pages):
        raise EbayError("eBay inventory pagination changed. Restart from page 1.")
    rows = [_listing(node) for node in root.findall(_path("ActiveList/ItemArray/Item"))]
    expected = min(PAGE_SIZE, max(0, total - (page - 1) * PAGE_SIZE))
    if len(rows) != expected or len({row["item_id"] for row in rows}) != len(rows):
        raise EbayError("eBay returned an incomplete or duplicate inventory page. Restart from page 1.")
    return {"source": "ebay_trading_active_listings", "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
            "provider_timestamp": _text(root, "Timestamp"), "page": page, "page_size": PAGE_SIZE,
            "returned": len(rows), "total_matching": total, "total_pages": pages,
            "has_more": page < pages, "next_page": page + 1 if page < pages else None,
            "records": rows, "complete_snapshot": False,
            "note": "One page of current eBay listings. Collect every page, checking unchanged totals and unique item IDs. Live pagination is not an atomic snapshot: never treat absence as a sale or delete inventory. Preserve CDP master SKUs and physical quantities; variations require separate review."}


async def active_listings(ebay, family, page):
    if type(page) is not int or not 1 <= page <= 125:
        raise ValueError("Page must be 1–125.")
    grant = ebay.store.get("grant", family)
    if not grant or TRADING_SCOPE not in grant.get("consented_scopes", []):
        raise EbayError("Reconnect BTCo eBay Connector to approve active-listing reads. Your existing orders and payments connection is unchanged.")
    token = await ebay.access(family)
    request = (f'<?xml version="1.0" encoding="utf-8"?>'
               f'<GetMyeBaySellingRequest xmlns="{NS}">'
               '<ActiveList><Include>true</Include><IncludeNotes>false</IncludeNotes>'
               f'<Pagination><EntriesPerPage>{PAGE_SIZE}</EntriesPerPage><PageNumber>{page}</PageNumber></Pagination>'
               '<Sort>TimeLeft</Sort></ActiveList><HideVariations>false</HideVariations>'
               '<SoldList><Include>false</Include></SoldList><UnsoldList><Include>false</Include></UnsoldList>'
               '<ScheduledList><Include>false</Include></ScheduledList><SellingSummary><Include>false</Include></SellingSummary>'
               '</GetMyeBaySellingRequest>')
    headers = {"X-EBAY-API-CALL-NAME": "GetMyeBaySelling", "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_VERSION,
               "X-EBAY-API-SITEID": "0", "X-EBAY-API-IAF-TOKEN": token, "Content-Type": "text/xml; charset=utf-8"}
    try:
        async with ebay.http.client() as client:
            async with client.stream("POST", TRADING_URL, timeout=30, content=request.encode(), headers=headers) as response:
                if response.status_code in (401, 403):
                    raise EbayError("eBay denied active-listing access. Reconnect BTCo eBay Connector and check its approved scopes.")
                if response.status_code == 429:
                    raise EbayError("eBay inventory rate limit reached. Try again later.")
                if response.status_code != 200:
                    raise EbayError(f"eBay inventory returned HTTP {response.status_code}; no inventory was changed.")
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > MAX_RESPONSE_BYTES:
                        raise EbayError("eBay inventory response exceeded the read limit.")
    except httpx.HTTPError:
        raise EbayError("eBay inventory could not be reached. Try again shortly.") from None
    result = parse_active_listings(bytes(payload), page)
    if not ebay.store.get("grant", family):
        raise EbayError("This connection was revoked. Reconnect the plugin.")
    return {"seller": grant["username"], "seller_id": grant["user_id"], **result}

