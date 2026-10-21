"""Exercise HTTP OAuth/MCP boundaries with synthetic eBay responses; no live credentials."""
import asyncio
import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import time
from urllib.parse import parse_qs, urlsplit
import httpx
import pytest
from cryptography.fernet import Fernet
from starlette.testclient import TestClient
from btco_ebay.config import Settings, SCOPE
from btco_ebay.ebay import TOKEN_URL, IDENTITY_URL, ORDER_URL, TRANSACTION_URL, PAYOUT_URL, date_filter, EbayError
from btco_ebay.server import build_app, COOKIE

CALLBACK = "https://chatgpt.com/connector/oauth/test-connector"
VERIFIER = "test-verifier-" + "a" * 50
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip("=")


@pytest.fixture
def env(tmp_path):
    state = {"requests": [], "username": "ballardtradingco", "data_status": 200}
    def upstream(request):
        state["requests"].append(request)
        url = str(request.url).split("?")[0]
        if url == TOKEN_URL:
            assert request.method == "POST"
            assert request.headers["authorization"].startswith("Basic ")
            return httpx.Response(200, json={"access_token": "upstream-access-sensitive", "refresh_token": "upstream-refresh-sensitive", "expires_in": 7200, "refresh_token_expires_in": 60*86400})
        assert request.method == "GET"
        assert request.headers["authorization"] == "Bearer upstream-access-sensitive"
        if url == IDENTITY_URL:
            return httpx.Response(200, json={"username": state["username"], "userId": "seller-123"})
        if state["data_status"] != 200:
            return httpx.Response(state["data_status"], json={"private": "upstream-error-secret"})
        order = {"orderId": "12-345-678", "creationDate": "2026-09-22T15:00:00Z", "orderFulfillmentStatus": "NOT_STARTED", "orderPaymentStatus": "PAID", "buyer": {"username": "cardbuyer", "email": "private@example.test", "registrationAddress": {"fullName": "Private Buyer"}}, "fulfillmentStartInstructions": [{"shippingStep": {"shipTo": {"addressLine1": "Private Street"}}}], "pricingSummary": {"total": {"value": "12.00", "currency": "USD"}}, "lineItems": [{"lineItemId": "line-1", "sku": "CARD-1", "title": "Sample card", "quantity": 1, "total": {"value": "12.00", "currency": "USD"}}]}
        if url == ORDER_URL:
            offset = int(request.url.params.get("offset", "0"))
            return httpx.Response(200, json={"orders": [order], "total": 2, **({"next": "https://untrusted.invalid/leak"} if offset == 0 else {})})
        if url == ORDER_URL + "/12-345-678":
            return httpx.Response(200, json=order)
        if url == TRANSACTION_URL:
            return httpx.Response(200, json={"total": 1, "transactions": [{"transactionId": "tx-1", "transactionType": "SALE", "bookingEntry": "CREDIT", "amount": {"value": "10.00", "currency": "USD"}, "totalFeeAmount": {"value": "2.00", "currency": "USD"}, "buyer": {"fullName": "Private Buyer"}, "orderLineItems": [{"lineItemId": "line-1", "marketplaceFees": [{"feeType": "FINAL_VALUE_FEE", "amount": {"value": "2.00", "currency": "USD"}}]}]}]})
        if url == PAYOUT_URL:
            return httpx.Response(200, json={"total": 1, "payouts": [{"payoutId": "pay-1", "payoutStatus": "SUCCEEDED", "amount": {"value": "10.00", "currency": "USD"}, "payoutInstrument": {"accountLastFourDigits": "9876"}}]})
        raise AssertionError("Unexpected upstream endpoint")
    settings = Settings("https://connector.example", "test-client", "test-secret", "test-runame", Fernet.generate_key().decode(), str(tmp_path / "tokens.sqlite3"))
    app, provider, mcp = build_app(settings, httpx.MockTransport(upstream))
    with TestClient(app, base_url=settings.origin, follow_redirects=False) as client:
        yield client, provider, settings, state


def register(client, callback=CALLBACK, method="none",scope=SCOPE):
    return client.post("/register", json={"redirect_uris": [callback], "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"], "token_endpoint_auth_method": method, "scope": scope})


def start_flow(env, method="none",scope=SCOPE):
    client, provider, settings, state = env
    response = register(client, method=method,scope=scope)
    assert response.status_code == 201, response.text
    identity = response.json()
    response = client.get("/authorize", params={"client_id": identity["client_id"], "response_type": "code", "redirect_uri": CALLBACK, "scope": scope, "state": "chat-state", "code_challenge": CHALLENGE, "code_challenge_method": "S256", "resource": settings.resource})
    assert response.status_code in (302, 303), response.text
    flow = parse_qs(urlsplit(response.headers["location"]).query)["flow"][0]
    response = client.get(response.headers["location"])
    assert response.status_code == 200
    nonce = client.cookies.get(COOKIE)
    response = client.post("/consent", data={"flow": flow, "csrf": nonce})
    assert response.status_code == 303, response.text
    assert response.headers["location"].startswith("https://auth.ebay.com/oauth2/authorize?")
    return identity, flow


def issue_code(env, method="none",scope=SCOPE):
    client, _, _, _ = env
    identity, flow = start_flow(env, method,scope)
    response = client.get("/ebay/callback", params={"state": flow, "code": "synthetic-upstream-code"})
    assert response.status_code == 303, response.text
    params = parse_qs(urlsplit(response.headers["location"]).query)
    assert params["state"] == ["chat-state"]
    return identity, params["code"][0]


def token_form(identity, code, **overrides):
    return {"grant_type": "authorization_code", "client_id": identity["client_id"], **({"client_secret": identity["client_secret"]} if identity.get("client_secret") else {}), "code": code, "redirect_uri": CALLBACK, "code_verifier": VERIFIER, **overrides}


def connect(env, method="none",scope=SCOPE):
    client, _, _, _ = env
    identity, code = issue_code(env, method,scope)
    form = token_form(identity, code)
    auth = None
    if method == "client_secret_basic":
        form.pop("client_secret")
        auth = (identity["client_id"], identity["client_secret"])
    response = client.post("/token", data=form, auth=auth)
    assert response.status_code == 200, response.text
    return identity, response.json()


def rpc(client, token, method, params=None):
    return client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": method, **({"params": params} if params is not None else {})}, headers={"Authorization": "Bearer " + token, "Accept": "application/json, text/event-stream"})


def tool(client, token, name, arguments=None):
    response = rpc(client, token, "tools/call", {"name": name, "arguments": arguments or {}})
    assert response.status_code == 200, response.text
    body = response.json()["result"]
    assert not body.get("isError"), body
    return body.get("structuredContent") or json.loads(body["content"][0]["text"])


def test_discovery_and_unauthorized_access(env):
    client, _, settings, _ = env
    response = client.post("/mcp", json={})
    assert response.status_code == 401
    assert "oauth-protected-resource/mcp" in response.headers["www-authenticate"]
    metadata = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert metadata["resource"] == settings.resource
    metadata = client.get("/.well-known/oauth-authorization-server").json()
    assert metadata["code_challenge_methods_supported"] == ["S256"]
    assert "none" in metadata["token_endpoint_auth_methods_supported"]
    assert client.get("/health").json()["status"] == "ready"


@pytest.mark.parametrize("uri", ["https://chatgpt.com.evil.test/connector/oauth/x", "https://evil.test/cb", "http://chatgpt.com/connector/oauth/x", "https://chatgpt.com/connector/oauth/x?next=evil", "https://chatgpt.com/anything"])
def test_callback_registration_restriction(env, uri):
    assert register(env[0], uri).status_code == 400


@pytest.mark.parametrize("method", ["none", "client_secret_post", "client_secret_basic"])
def test_oauth_pkce_single_use_and_encrypted_persistence(env, method):
    client, provider, settings, state = env
    identity, code = issue_code(env, method)
    form = token_form(identity, code)
    auth = None
    if method == "client_secret_basic":
        form.pop("client_secret")
        auth = (identity["client_id"], identity["client_secret"])
    response = client.post("/token", data={**form, "code_verifier": "wrong"}, auth=auth)
    assert response.status_code == 400
    response = client.post("/token", data={**form, "resource": "https://evil.test/mcp"}, auth=auth)
    assert response.status_code == 400
    response = client.post("/token", data=form, auth=auth)
    assert response.status_code == 200, response.text
    tokens = response.json()
    assert client.post("/token", data=form, auth=auth).status_code == 400
    assert tool(client, tokens["access_token"], "get_connection_status")["seller"] == "ballardtradingco"
    raw = Path(settings.db_path).read_bytes()
    for secret in ["upstream-access-sensitive", "upstream-refresh-sensitive", tokens["access_token"], tokens["refresh_token"], identity["client_id"], "ballardtradingco"]:
        assert secret.encode() not in raw
    # Recreate the app against the same volume to verify durable authorization.
    app2, provider2, _ = build_app(settings, provider.ebay.transport)
    assert asyncio.run(provider2.load_access_token(tokens["access_token"])) is not None


def test_seller_mismatch_and_callback_browser_binding(env):
    client, provider, _, state = env
    identity, flow = start_flow(env)
    nonce = client.cookies.get(COOKIE)
    client.cookies.clear()
    assert client.get("/ebay/callback", params={"state": flow, "code": "test"}).status_code == 400
    assert not state["requests"]
    client.cookies.set(COOKIE, nonce, domain="connector.example", path="/")
    state["username"] = "different-seller"
    response = client.get("/ebay/callback", params={"state": flow, "code": "test"})
    assert response.status_code == 400
    assert "configured BTCo seller" in response.text
    assert provider.store.get("flow", flow) is None
    with provider.store.tx() as db:
        assert db.execute("SELECT count(*) FROM records WHERE kind IN ('grant','code','access','refresh')").fetchone()[0] == 0


@pytest.mark.parametrize("method", ["none", "client_secret_post", "client_secret_basic"])
def test_refresh_client_binding_rotation_and_revocation(env, method):
    client, provider, _, _ = env
    identity, tokens = connect(env, method)
    other = register(client).json()
    form = {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": identity["client_id"]}
    assert client.post("/token", data={**form, "client_id": other["client_id"]}).status_code == 400
    auth = (identity["client_id"], identity["client_secret"]) if method == "client_secret_basic" else None
    extra = {"client_secret": identity["client_secret"]} if method == "client_secret_post" else {}
    form.update(extra)
    response = client.post("/token", data=form, auth=auth)
    assert response.status_code == 200
    new = response.json()
    assert client.post("/token", data=form, auth=auth).status_code == 400
    assert rpc(client, tokens["access_token"], "tools/list").status_code == 401
    assert rpc(client, new["access_token"], "tools/list").status_code == 200
    assert client.post("/revoke", data={"client_id": other["client_id"], "token": new["access_token"]}).status_code == 200
    assert rpc(client, new["access_token"], "tools/list").status_code == 200
    assert client.post("/revoke", data={"client_id": identity["client_id"], "token": new["refresh_token"], "token_type_hint": "refresh_token", **extra}, auth=auth).status_code == 200
    assert rpc(client, new["access_token"], "tools/list").status_code == 401
    with provider.store.tx() as db:
        assert db.execute("SELECT count(*) FROM records WHERE kind='grant'").fetchone()[0] == 0


def test_mcp_read_tools_pagination_and_privacy(env):
    client, provider, _, state = env
    _, tokens = connect(env)
    token = tokens["access_token"]
    init = rpc(client, token, "initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
    assert init.status_code == 200
    catalog = rpc(client, token, "tools/list").json()["result"]["tools"]
    baseline={"get_connection_status", "get_active_listings", "get_orders", "get_order", "get_transactions", "get_payouts"}
    assert baseline <= {t["name"] for t in catalog}
    assert all(t["annotations"]["readOnlyHint"] for t in catalog if t['name'] in baseline)
    for entry in catalog:
        if not entry['annotations']['readOnlyHint']:
            assert 'btco:listings' in entry['_meta']['securitySchemes'][0]['scopes']
    args = {"start_date": "2026-09-22", "end_date": "2026-09-22", "limit": 1}
    first = tool(client, token, "get_orders", {**args, "status": "unshipped"})
    assert first["has_more"] and first["next_offset"] == 1
    assert first["records"][0]["buyer_username"] == "cardbuyer"
    second = tool(client, token, "get_orders", {**args, "offset": first["next_offset"]})
    assert not second["has_more"] and second["next_offset"] is None
    order = tool(client, token, "get_order", {"order_id": "12-345-678"})
    tx = tool(client, token, "get_transactions", args)
    payout = tool(client, token, "get_payouts", args)
    serialized = json.dumps([first, second, order, tx, payout])
    for private in ["Private Buyer", "Private Street", "private@example.test", "9876", "upstream-access-sensitive"]:
        assert private not in serialized
    assert tx["records"][0]["amount"]["value"] == "10.00"
    assert tx["records"][0]["totalFeeAmount"]["value"] == "2.00"
    assert "profit" not in tx["records"][0]
    data_requests = [r for r in state["requests"] if str(r.url).split("?")[0] == ORDER_URL]
    assert "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}" in data_requests[0].url.params["filter"]
    assert all(r.url.host != "untrusted.invalid" for r in state["requests"])


@pytest.mark.parametrize("status", [204, 401, 403, 429, 500])
def test_empty_responses_and_sanitized_upstream_errors(env, status):
    client, provider, _, state = env
    _, tokens = connect(env)
    state["data_status"] = status
    response = rpc(client, tokens["access_token"], "tools/call", {"name": "get_orders", "arguments": {"start_date": "2026-09-22", "end_date": "2026-09-22"}})
    assert response.status_code == 200
    assert "upstream-error-secret" not in response.text
    result = response.json()["result"]
    if status == 204:
        content = result.get("structuredContent") or json.loads(result["content"][0]["text"])
        assert content["records"] == []
    else:
        assert result["isError"]


def test_transport_guards_and_fixed_upstream_routes(env):
    client, provider, _, _ = env
    assert client.get("/health", headers={"Host": "evil.test"}).status_code == 400
    assert client.get("/health", headers={"Host": "healthcheck.railway.app"}).status_code == 200
    assert client.get("/consent", headers={"Host": "healthcheck.railway.app"}).status_code == 400
    assert client.get("/health", headers={"Origin": "https://evil.test"}).status_code == 403
    assert client.post("/register", content="x" * 262145).status_code == 413
    for method, url in [("POST", ORDER_URL), ("GET", "https://evil.test/order"), ("DELETE", PAYOUT_URL)]:
        with pytest.raises(ValueError):
            asyncio.run(provider.ebay.request(method, url))


def test_pacific_date_boundaries_and_limits():
    now = datetime(2026, 12, 1, tzinfo=timezone.utc)
    assert date_filter("date", "2026-03-08", "2026-03-08", now=now) == "date:[2026-03-08T08:00:00.000Z..2026-03-09T06:59:59.999Z]"
    assert date_filter("date", "2026-11-01", "2026-11-01", now=now) == "date:[2026-11-01T07:00:00.000Z..2026-11-02T07:59:59.999Z]"
    with pytest.raises(ValueError): date_filter("date", "2026-04-01", "2026-03-01")
    with pytest.raises(ValueError): date_filter("date", "2026-01-01", "2026-04-01")


def test_current_pacific_day_does_not_send_future_timestamps():
    # UTC has advanced to Sep 23 while the seller's Pacific date is still Sep 22.
    now = datetime(2026, 9, 23, 4, 45, 0, 123000, tzinfo=timezone.utc)
    assert date_filter("creationdate", "2026-09-22", "2026-09-22", now=now) == "creationdate:[2026-09-22T07:00:00.000Z..2026-09-23T04:45:00.123Z]"
    assert date_filter("creationdate", "2026-09-16", "2026-09-21", now=now) == "creationdate:[2026-09-16T07:00:00.000Z..2026-09-22T06:59:59.999Z]"
    assert date_filter("creationdate", "2026-09-22", "2026-09-23", now=now) == "creationdate:[2026-09-22T07:00:00.000Z..2026-09-23T04:45:00.123Z]"
    with pytest.raises(ValueError, match="Pacific time"):
        date_filter("creationdate", "2026-09-23", "2026-09-23", now=now)


def test_upstream_refresh_and_revocation_during_refresh(env):
    client, provider, _, state = env
    _, tokens = connect(env)
    family = asyncio.run(provider.load_access_token(tokens["access_token"])).family
    grant = provider.store.get("grant", family)
    grant["expires_at"] = time.time() - 1
    provider.store.put("grant", family, grant, grant["connection_expires_at"], family)
    tool(client, tokens["access_token"], "get_orders", {"start_date": "2026-09-22", "end_date": "2026-09-22"})
    assert any(b"grant_type=refresh_token" in r.content for r in state["requests"])
    grant = provider.store.get("grant", family)
    assert grant["expires_at"] > time.time()
    grant["expires_at"] = time.time() - 1
    provider.store.put("grant", family, grant, grant["connection_expires_at"], family)
    def revoke_while_refreshing(request):
        assert str(request.url) == TOKEN_URL
        provider.store.delete_family(family)
        return httpx.Response(200, json={"access_token": "new-sensitive-token", "expires_in": 7200})
    provider.ebay.transport = httpx.MockTransport(revoke_while_refreshing)
    with pytest.raises(EbayError, match="revoked"):
        asyncio.run(provider.ebay.access(family))
    assert provider.store.get("grant", family) is None


def test_consent_csrf_and_denied_authorization(env):
    client, provider, _, state = env
    identity, flow = start_flow(env)
    assert client.post("/consent", data={"flow": flow, "csrf": "wrong"}).status_code == 400
    response = client.get("/ebay/callback", params={"state": flow, "error": "access_denied"})
    assert response.status_code == 303
    params = parse_qs(urlsplit(response.headers["location"]).query)
    assert params["error"] == ["access_denied"]
    assert params["state"] == ["chat-state"]
    assert not state["requests"]


def test_browser_consent_headers_preserve_origin_and_oauth_redirects(env):
    client, provider, settings, state = env
    identity = register(client).json()
    response = client.get("/authorize", params={
        "client_id": identity["client_id"], "response_type": "code",
        "redirect_uri": CALLBACK, "scope": SCOPE, "state": "chat-state",
        "code_challenge": CHALLENGE, "code_challenge_method": "S256",
        "resource": settings.resource,
    })
    flow = parse_qs(urlsplit(response.headers["location"]).query)["flow"][0]
    page = client.get(response.headers["location"])
    # no-referrer turns a native form POST's Origin into null in browsers.
    # same-origin preserves the consent POST origin without leaking flow URLs
    # to eBay or ChatGPT. Cross-origin form redirects must also pass CSP.
    assert page.headers["referrer-policy"] == "same-origin"
    directives = dict(part.strip().split(" ", 1)
                      for part in page.headers["content-security-policy"].split(";"))
    assert set(directives["form-action"].split()) == {
        "'self'", "https://auth.ebay.com", "https://signin.ebay.com", "https://chatgpt.com",
    }
    nonce = client.cookies.get(COOKIE)
    form = {"flow": flow, "csrf": nonce}
    for origin in ("null", "https://evil.test"):
        assert client.post("/consent", data=form, headers={"Origin": origin}).status_code == 403
    assert client.post("/consent", data={**form, "csrf": "wrong"},
                       headers={"Origin": settings.origin}).status_code == 400
    response = client.post("/consent", data=form, headers={"Origin": settings.origin})
    assert response.status_code == 303
    assert urlsplit(response.headers["location"]).netloc == "auth.ebay.com"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert provider.store.get("flow", flow)["stage"] == "ebay"
    assert not state["requests"]
    assert client.get("/privacy").headers["referrer-policy"] == "no-referrer"
    assert client.post("/mcp", headers={"Origin": "null"}).status_code == 403

