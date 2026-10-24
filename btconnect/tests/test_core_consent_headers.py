"""Core OAuth must survive the form redirect chain back to its configured host."""
from dataclasses import replace
from urllib.parse import parse_qs, urlsplit

import httpx
import html
import re
import pytest
from starlette.testclient import TestClient
from btco_ebay.server import build_app, COOKIE, SECURE_HEADERS
from test_connector import env, register, CHALLENGE


def destinations(response):
    directives = dict(part.strip().split(" ", 1) for part in
                      response.headers["content-security-policy"].split(";"))
    return set(directives["form-action"].split())


@pytest.mark.parametrize("browser", [False, True])
def test_configured_core_callback_survives_consent_post_and_redirects(env, tmp_path, browser):
    _, _, original, _ = env
    callback = "https://core.example:8443/api/ebay/callback"
    settings = replace(original, core_callback_url=callback,
                       db_path=str(tmp_path / "core-oauth.sqlite3"))
    def upstream(request):
        raise AssertionError("Consent must not call eBay or publish anything")
    app, provider, _ = build_app(settings, httpx.MockTransport(upstream))
    with TestClient(app, base_url=settings.origin, follow_redirects=False) as client:
        identity = register(client, callback=callback).json()
        response = client.get("/authorize", params={
            "client_id": identity["client_id"], "response_type": "code",
            "redirect_uri": callback, "scope": "btco:read", "state": "core-state",
            "code_challenge": CHALLENGE, "code_challenge_method": "S256",
            "resource": settings.resource,
        })
        page = client.get(response.headers["location"])
        assert "Connect BTCo eBay to BTCore" in page.text
        expected = {"'self'", "https://auth.ebay.com", "https://signin.ebay.com",
                    "https://chatgpt.com", "https://core.example:8443"}
        assert destinations(page) == expected
        assert page.headers["referrer-policy"] == "same-origin"
        flow = parse_qs(urlsplit(response.headers["location"]).query)["flow"][0]
        response = client.post("/consent", data={"flow": flow, "csrf": client.cookies.get(COOKIE)},
                               headers={"Origin": settings.origin, "Accept": "text/html" if browser else "*/*"})
        if browser:
            assert response.status_code == 200
            assert "Open eBay sign-in" in response.text
            assert "does not publish any listings" in response.text
            target = html.unescape(re.search("href='([^']+)'", response.text)[1])
            assert "location" not in response.headers
        else:
            assert response.status_code == 303
            target = response.headers["location"]
        assert urlsplit(target).netloc == "auth.ebay.com"
        assert parse_qs(urlsplit(target).query)["state"] == [flow]
        assert destinations(response) == expected
        assert response.headers["referrer-policy"] == "no-referrer"
        assert provider.store.get("flow", flow)["stage"] == "ebay"
        assert register(client, callback="https://unconfigured.example/api/ebay/callback").status_code == 400
        assert client.get("/privacy").headers["content-security-policy"] == SECURE_HEADERS["Content-Security-Policy"]


def test_chatgpt_only_consent_does_not_add_a_core_host(env):
    from btco_ebay.server import consent_headers
    _, _, settings, _ = env
    for method in ("GET", "POST"):
        policy = consent_headers(settings, method)["Content-Security-Policy"]
        assert "core.example" not in policy
        assert "*" not in policy
