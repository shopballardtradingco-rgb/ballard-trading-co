import asyncio
import json
import time
from urllib.parse import parse_qs
import httpx
import pytest
from btco_ebay.config import EBAY_SCOPES, LEGACY_EBAY_SCOPES, TRADING_SCOPE
from btco_ebay.ebay import EbayError, TOKEN_URL
from btco_ebay.inventory import NS, TRADING_URL, parse_active_listings
from test_connector import env, connect, tool, rpc


def listing(item_id=123456789012, extra=""):
    return f'''<Item><ItemID>{item_id}</ItemID><Title>Card &amp; insert</Title>
      <SKU>001-CDP-A</SKU><ListingType>FixedPriceItem</ListingType>
      <Quantity>5</Quantity><SellingStatus><QuantitySold>2</QuantitySold>
      <CurrentPrice currencyID="USD">4.99</CurrentPrice></SellingStatus>
      <PrivateNotes>private-listing-note</PrivateNotes><Buyer><Email>private-email</Email></Buyer>{extra}</Item>'''


def response(rows=None, total=1, pages=1, ack="Success", extra=""):
    rows = [listing()] if rows is None else rows
    return (f'<GetMyeBaySellingResponse xmlns="{NS}"><Ack>{ack}</Ack>'
            '<Timestamp>2026-10-12T02:00:00Z</Timestamp>'
            f'<ActiveList><PaginationResult><TotalNumberOfEntries>{total}</TotalNumberOfEntries>'
            f'<TotalNumberOfPages>{pages}</TotalNumberOfPages></PaginationResult>'
            f'<ItemArray>{"".join(rows)}</ItemArray></ActiveList>{extra}</GetMyeBaySellingResponse>').encode()


def test_inventory_mcp_roundtrip_filters_private_fields(env):
    client, provider, _, _ = env
    _, tokens = connect(env)
    seen = []
    def upstream(request):
        seen.append(request)
        assert request.method == "POST" and str(request.url) == TRADING_URL
        assert request.headers["X-EBAY-API-CALL-NAME"] == "GetMyeBaySelling"
        assert request.headers["X-EBAY-API-IAF-TOKEN"] == "upstream-access-sensitive"
        assert b"<EntriesPerPage>200</EntriesPerPage>" in request.content
        assert b"<PageNumber>1</PageNumber>" in request.content
        assert b"<IncludeNotes>false</IncludeNotes>" in request.content
        assert b"<HideVariations>false</HideVariations>" in request.content
        return httpx.Response(200, content=response())
    provider.ebay.transport = httpx.MockTransport(upstream)
    result = tool(client, tokens["access_token"], "get_active_listings")
    assert result["seller"] == "ballardtradingco"
    assert result["records"][0]["sku"] == "001-CDP-A"
    assert result["records"][0]["quantity_available"] == 3
    assert result["records"][0]["price"] == {"value": "4.99", "currency": "USD"}
    assert result["next_page"] is None and result["complete_snapshot"] is False
    assert len(seen) == 1
    for private in ["private-listing-note", "private-email", "upstream-access-sensitive"]:
        assert private not in json.dumps(result)


def test_page_progression_empty_and_variants():
    first = parse_active_listings(response([listing(123456789000 + n) for n in range(200)], total=201, pages=2), 1)
    assert first["next_page"] == 2
    last = parse_active_listings(response(total=201, pages=2), 2)
    assert last["next_page"] is None
    empty = parse_active_listings(response([], total=0, pages=0), 1)
    assert empty["records"] == [] and not empty["has_more"]
    variant = '<Variations><Variation><SKU>CDP-V-001</SKU><Quantity>3</Quantity><SellingStatus><QuantitySold>1</QuantitySold></SellingStatus><StartPrice currencyID="CAD">8.50</StartPrice><VariationSpecifics><NameValueList><Name>Parallel</Name><Value>Gold</Value></NameValueList></VariationSpecifics></Variation></Variations>'
    row = parse_active_listings(response([listing(extra=variant)]), 1)["records"][0]
    assert row["requires_variation_review"] is True
    assert row["variations"][0]["quantity_available"] == 2
    assert row["variations"][0]["price"]["currency"] == "CAD"
    assert row["variations"][0]["specifics"] == [{"name": "Parallel", "values": ["Gold"]}]


@pytest.mark.parametrize("payload", [
    response([], total=1),
    response([listing(), listing()], total=2),
    response(total=25000, pages=125),
    response(total=1, pages=2),
    response(ack="PartialFailure"),
    response(ack="Warning", extra='<Errors><ErrorCode>219</ErrorCode><SeverityCode>Warning</SeverityCode><LongMessage>secret</LongMessage></Errors>'),
    b"not xml",
    b'<WrongResponse/>',
    b'<!DOCTYPE test [<!ENTITY external SYSTEM "file:///etc/passwd">]><test/>',
    '<!DOCTYPE test><test/>'.encode('utf-16'),
    response().replace(b'4.99', b'NaN'),
    response().replace(b'<Quantity>5</Quantity>', b'<Quantity>-1</Quantity>'),
])
def test_bad_partial_and_oversized_snapshots_fail_closed(payload):
    with pytest.raises(EbayError) as exc:
        parse_active_listings(payload, 1)
    assert "secret" not in str(exc.value)


@pytest.mark.parametrize("status", [302, 401, 403, 429, 500])
def test_transport_errors_do_not_leak_or_follow_redirects(env, status):
    client, provider, _, _ = env
    _, tokens = connect(env)
    seen = []
    def upstream(request):
        seen.append(str(request.url))
        return httpx.Response(status, headers={"Location": "https://untrusted.invalid"}, content=b"private-upstream-body")
    provider.ebay.transport = httpx.MockTransport(upstream)
    result = rpc(client, tokens["access_token"], "tools/call", {"name": "get_active_listings", "arguments": {}})
    assert result.json()["result"]["isError"]
    assert "private-upstream-body" not in result.text and seen == [TRADING_URL]


def test_old_grant_survives_refresh_without_silent_scope_escalation(env):
    client, provider, _, state = env
    _, tokens = connect(env)
    family = asyncio.run(provider.load_access_token(tokens["access_token"])).family
    grant = provider.store.get("grant", family)
    grant.pop("consented_scopes")
    grant["expires_at"] = time.time() - 1
    provider.store.put("grant", family, grant, grant["connection_expires_at"], family)
    status = tool(client, tokens["access_token"], "get_connection_status")
    assert status["active_listing_access"] == "reconnect_required"
    tool(client, tokens["access_token"], "get_orders", {"start_date": "2026-09-22", "end_date": "2026-09-22"})
    refresh = [r for r in state["requests"] if str(r.url) == TOKEN_URL and b"grant_type=refresh_token" in r.content][-1]
    assert parse_qs(refresh.content.decode())["scope"] == [" ".join(LEGACY_EBAY_SCOPES)]
    previous = len(state["requests"])
    failure = rpc(client, tokens["access_token"], "tools/call", {"name": "get_active_listings", "arguments": {}})
    assert failure.json()["result"]["isError"] and "Reconnect" in failure.text
    assert len(state["requests"]) == previous


def test_new_consent_includes_trading_and_grant_retains_scopes(env):
    client, provider, _, state = env
    _, tokens = connect(env)
    family = asyncio.run(provider.load_access_token(tokens["access_token"])).family
    grant = provider.store.get("grant", family)
    assert grant["consented_scopes"] == EBAY_SCOPES and TRADING_SCOPE in EBAY_SCOPES
    assert tool(client, tokens["access_token"], "get_connection_status")["active_listing_access"] == "consented_not_yet_tested"


def test_inventory_revocation_during_upstream_read_is_honored(env):
    client, provider, _, _ = env
    _, tokens = connect(env)
    family = asyncio.run(provider.load_access_token(tokens["access_token"])).family
    def upstream(request):
        provider.store.delete_family(family)
        return httpx.Response(200, content=response())
    provider.ebay.transport = httpx.MockTransport(upstream)
    failure = rpc(client, tokens["access_token"], "tools/call", {"name": "get_active_listings", "arguments": {}})
    assert failure.json()["result"]["isError"] and "revoked" in failure.text


def test_quantity_unknown_stays_unknown_and_explicit_available_wins():
    no_sold = listing().replace('<QuantitySold>2</QuantitySold>', '')
    assert parse_active_listings(response([no_sold]), 1)["records"][0]["quantity_available"] is None
    explicit = listing(extra='<QuantityAvailable>1</QuantityAvailable>')
    assert parse_active_listings(response([explicit]), 1)["records"][0]["quantity_available"] == 1
