"""Exercise permission and byte-upload boundaries through the actual ASGI app."""

import asyncio
from hashlib import sha256
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from PIL import Image
from io import BytesIO

from test_connector import connect, rpc, tool, register, CALLBACK, CHALLENGE
from test_connector import env as env  # Re-export the shared pytest fixture.
from btco_ebay.config import SCOPE, WRITE_SCOPE, LISTING_EBAY_SCOPES
from btco_ebay.selling import Selling, SellingError, MEDIA
from btco_ebay.photos import PhotoStore


def test_read_connection_cannot_upload_approve_or_publish_and_refresh_cannot_escalate(
    env,
):
    client, provider, _, state = env
    identity, tokens = connect(env)
    readiness = tool(client, tokens["access_token"], "get_listing_readiness")
    assert (
        readiness["publication_enabled"] is False
        and readiness["connector_listing_scope"] is False
    )
    for name, args in [
        (
            "begin_photo_upload",
            {"sha256_hex": "a" * 64, "size_bytes": 1000, "role": "front"},
        ),
        (
            "approve_listing_draft",
            {
                "draft_id": "btco-comic-test",
                "revision": "a" * 64,
                "owner_approval_evidence": "Owner approved test",
            },
        ),
        (
            "publish_approved_listing",
            {"draft_id": "btco-comic-test", "revision": "a" * 64},
        ),
    ]:
        response = rpc(
            client,
            tokens["access_token"],
            "tools/call",
            {"name": name, "arguments": args},
        )
        assert response.json()["result"]["isError"] and "btco:listings" in response.text
        challenge = response.json()["result"]["_meta"]["mcp/www_authenticate"][0]
        assert 'scope="btco:read btco:listings"' in challenge
        assert 'error="insufficient_scope"' in challenge
        assert 'error_description=' in challenge
    response = client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": identity["client_id"],
            "scope": SCOPE + " " + WRITE_SCOPE,
        },
    )
    assert response.status_code == 400 and response.json()["error"] == "invalid_scope"
    assert all(
        request.method == "GET" or "oauth2/token" in str(request.url)
        for request in state["requests"]
    )


def test_explicit_listing_oauth_adds_only_declared_new_permissions(env):
    client, provider, settings, _ = env
    resource = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert resource["scopes_supported"] == [SCOPE, WRITE_SCOPE]
    identity = register(client, scope=SCOPE + " " + WRITE_SCOPE).json()
    response = client.get(
        "/authorize",
        params={
            "client_id": identity["client_id"],
            "response_type": "code",
            "redirect_uri": CALLBACK,
            "scope": SCOPE + " " + WRITE_SCOPE,
            "state": "test",
            "code_challenge": CHALLENGE,
            "code_challenge_method": "S256",
            "resource": settings.resource,
        },
    )
    flow = parse_qs(urlsplit(response.headers["location"]).query)["flow"][0]
    page = client.get(response.headers["location"])
    assert "Listing permission requested" in page.text
    from btco_ebay.server import COOKIE

    consent = client.post(
        "/consent", data={"flow": flow, "csrf": client.cookies.get(COOKIE)}
    )
    scopes = parse_qs(urlsplit(consent.headers["location"]).query)["scope"][0].split()
    assert set(LISTING_EBAY_SCOPES) <= set(scopes)


def test_original_upload_is_bounded_private_single_use_and_revocable(env):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    # An image larger than the normal MCP request limit proves raw upload works.
    image = Image.effect_noise((700, 700), 80).convert("RGB")
    out = BytesIO()
    image.save(out, format="PNG")
    data = out.getvalue()
    assert len(data) > 262144
    args = {
        "sha256_hex": sha256(data).hexdigest(),
        "size_bytes": len(data),
        "role": "front",
    }
    ticket = tool(client, tokens["access_token"], "begin_photo_upload", args)
    headers = {
        "Authorization": "Bearer " + ticket["upload_token"],
        "Content-Type": "image/png",
    }
    assert (
        client.post(
            "/photos/upload", content=data, headers={"Content-Type": "image/png"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/photos/upload",
            content=data,
            headers={**headers, "Origin": "https://evil.test"},
        ).status_code
        == 403
    )
    response = client.post("/photos/upload", content=data, headers=headers)
    assert response.status_code == 201, response.text
    photo = response.json()["photo"]
    assert PhotoStore(provider.store).get("seller-123", photo) == data
    assert client.get("/" + photo["object_key"]).status_code == 404
    assert (
        client.post("/photos/upload", content=data, headers=headers).status_code == 401
    )
    ticket = tool(client, tokens["access_token"], "begin_photo_upload", args)
    headers["Authorization"] = "Bearer " + ticket["upload_token"]
    assert (
        client.post(
            "/photos/upload", content=data + b"bad", headers=headers
        ).status_code
        == 400
    )
    grant = asyncio.run(provider.load_access_token(tokens["access_token"]))
    provider.store.delete_family(grant.family)
    assert (
        client.post("/photos/upload", content=data, headers=headers).status_code == 401
    )


def test_expired_ticket_and_checksum_mismatch_fail_closed(env):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    args = {"sha256_hex": "a" * 64, "size_bytes": 4, "role": "front"}
    ticket = tool(client, tokens["access_token"], "begin_photo_upload", args)
    headers = {
        "Authorization": "Bearer " + ticket["upload_token"],
        "Content-Type": "image/jpeg",
    }
    assert (
        client.post("/photos/upload", content=b"fake", headers=headers).status_code
        == 400
    )
    ticket = tool(client, tokens["access_token"], "begin_photo_upload", args)
    record = provider.store.get("photo-upload", ticket["upload_token"])
    provider.store.put("photo-upload", ticket["upload_token"], record, time.time() - 1)
    headers["Authorization"] = "Bearer " + ticket["upload_token"]
    assert (
        client.post("/photos/upload", content=b"fake", headers=headers).status_code
        == 401
    )


def selling_adapter(env, handler):
    _, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    family = asyncio.run(provider.load_access_token(tokens["access_token"])).family
    provider.ebay.transport = httpx.MockTransport(handler)
    return Selling(provider.ebay), family


def test_media_adapter_sends_original_multipart_and_validates_resource(env):
    image = Image.new("RGB", (600, 800), "white")
    out = BytesIO()
    image.save(out, format="JPEG")
    data = out.getvalue()
    seen = []

    def handler(request):
        seen.append(request)
        assert str(request.url) == MEDIA + "/image/create_image_from_file"
        assert request.method == "POST" and data in request.content
        assert b'name="image"' in request.content
        return httpx.Response(
            201,
            json={
                "imageUrl": "https://i.ebayimg.com/example.jpg",
                "expirationDate": "2099-01-01T00:00:00Z",
            },
            headers={"Location": MEDIA + "/image/test-image-1"},
        )

    selling, family = selling_adapter(env, handler)
    photo = PhotoStore(env[1].store).put(
        "seller-123", data, sha256(data).hexdigest(), "front"
    )
    result = asyncio.run(selling.upload(family, photo, data))
    assert result["sha256"] == sha256(data).hexdigest() and len(seen) == 1


@pytest.mark.parametrize("status", [302, 400, 401, 429, 500])
def test_mutating_http_error_is_sanitized_and_never_retried(env, status):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(
            status,
            json={"errors": [{"errorId": 25001, "message": "PRIVATE-SECRET"}]},
            headers={"Location": "https://evil.test"},
        )

    selling, family = selling_adapter(env, handler)
    with pytest.raises(SellingError) as error:
        asyncio.run(selling.publish(family, "123"))
    assert len(seen) == 1 and "PRIVATE-SECRET" not in str(error.value)


def test_no_offer_error_is_narrowly_recognized(env):
    def handler(request):
        return httpx.Response(400, json={"errors": [{"errorId": 25713}]})

    selling, family = selling_adapter(env, handler)
    assert asyncio.run(selling.offers(family, "test")) == []


def test_adapter_rejects_external_url_without_network_request(env):
    seen = []
    selling, family = selling_adapter(env, lambda request: seen.append(request))
    with pytest.raises(ValueError):
        asyncio.run(selling._request(family, "POST", "https://evil.test/collect"))
    assert seen == []


@pytest.mark.parametrize(
    "strategy,status",
    [
        ({"fundingModel": "COST_PER_CLICK"}, "RUNNING"),
        ({"fundingModel": "COST_PER_SALE", "adRateStrategy": "DYNAMIC"}, "RUNNING"),
        ({"fundingModel": "COST_PER_SALE", "adRateStrategy": "FIXED"}, "PAUSED"),
    ],
)
def test_promotion_rejects_unapproved_cost_models(env, strategy, status):
    def handler(request):
        return httpx.Response(
            200,
            json={
                "marketplaceId": "EBAY_US",
                "campaignStatus": status,
                "fundingStrategy": strategy,
            },
        )

    selling, family = selling_adapter(env, handler)
    with pytest.raises(ValueError, match="fixed cost-per-sale"):
        asyncio.run(selling.campaign(family, "123"))
