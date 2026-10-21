"""Synthetic originals only; no production files, credentials or eBay writes."""

import asyncio
from hashlib import sha256

import httpx
import pytest

from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.photo_transfer import OpenAIFile, download_original, validate_download_url
from btco_ebay.photos import PhotoStore
from test_connector import env as env, connect, rpc, tool
from test_listings import original

URL = "https://files.oaiusercontent.com/original?sig=PRIVATE-SIGNED-URL"


@pytest.mark.parametrize("url", [
    "http://files.oaiusercontent.com/a", "https://127.0.0.1/a", "https://[::1]/a",
    "https://169.254.169.254/a", "https://localhost/a", "https://evil.test/a",
    "https://files.oaiusercontent.com.evil.test/a", "https://oaiusercontent.com@evil.test/a",
    "https://user:secret@files.oaiusercontent.com/a", "https://files.oaiusercontent.com:8443/a",
    "https://files.oaiusercontent.com/a#secret", "https://files.oaiusercontent.com./a",
    "https://files.oaiusercontent.com/\na", "https://files.oaiusercontent.com\\evil/a",
    "https://arbitrary.blob.core.windows.net/a",
])
def test_only_host_owned_https_downloads(url):
    with pytest.raises(ValueError) as caught:
        validate_download_url(url)
    assert url not in str(caught.value)


@pytest.mark.parametrize("url", [URL,
    "https://oaisdsorprwestus.blob.core.windows.net/private/original?sig=secret",
    "https://oaisdmntprwestus.blob.core.windows.net/private/original?sig=secret",
    "https://oaisdmntprwestusaws.s3.us-west-2.amazonaws.com/private/original?sig=secret",
])
def test_supported_host_file_sources(url):
    assert validate_download_url(url) == url


def test_download_preserves_original_and_never_sends_seller_auth(caplog):
    data = original("red")
    def handler(request):
        assert request.method == "GET" and str(request.url) == URL
        assert "authorization" not in request.headers and "cookie" not in request.headers
        return httpx.Response(200, content=data, headers={"Content-Type": "image/jpeg"})
    file = OpenAIFile(download_url=URL, file_id="file-test", mime_type="image/jpeg")
    assert asyncio.run(download_original(file, len(data), transport=httpx.MockTransport(handler))) == data
    assert "PRIVATE-SIGNED-URL" not in caplog.text
    assert "PRIVATE-SIGNED-URL" not in repr(file)


@pytest.mark.parametrize("response", [
    httpx.Response(302, headers={"Location": "http://169.254.169.254/private"}),
    httpx.Response(403, text="PRIVATE-SIGNED-URL"),
    httpx.Response(200, content=b"1234", headers={"Content-Type": "text/html"}),
    httpx.Response(200, content=b"1234", headers={"Content-Type": "image/png", "Content-Length": "100"}),
    httpx.Response(200, content=b"12345", headers={"Content-Type": "image/png", "Content-Length": "4"}),
    httpx.Response(200, content=b"123", headers={"Content-Type": "image/png", "Content-Length": "4"}),
])
def test_download_failures_are_bounded_and_redacted(response):
    calls = []
    def handler(request):
        calls.append(request)
        return response
    with pytest.raises(ValueError) as caught:
        asyncio.run(download_original(OpenAIFile(download_url=URL, file_id="file-test"), 4,
                                      transport=httpx.MockTransport(handler)))
    assert len(calls) == 1 and "PRIVATE-SIGNED-URL" not in str(caught.value)


def test_transport_error_redacts_url():
    def handler(request):
        raise httpx.ConnectError("PRIVATE-SIGNED-URL", request=request)
    with pytest.raises(ValueError, match="interrupted") as caught:
        asyncio.run(download_original(OpenAIFile(download_url=URL, file_id="file-test"), 4,
                                      transport=httpx.MockTransport(handler)))
    assert "PRIVATE-SIGNED-URL" not in str(caught.value)


def test_native_file_tool_schema_permissions_storage_and_replay(env, monkeypatch):
    client, provider, _, state = env
    _, read_tokens = connect(env)
    args = {"file": {"download_url": URL, "file_id": "file-test"},
            "sha256_hex": sha256(original("red")).hexdigest(),
            "size_bytes": len(original("red")), "role": "front"}
    denied = rpc(client, read_tokens["access_token"], "tools/call",
                 {"name": "ingest_original_photo", "arguments": args}).json()["result"]
    assert denied["isError"] and "btco:listings" in str(denied)
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    schema = rpc(client, tokens["access_token"], "tools/list", {}).json()["result"]["tools"]
    native = next(t for t in schema if t["name"] == "ingest_original_photo")
    assert native["_meta"]["openai/fileParams"] == ["file"]
    definition = native["inputSchema"]["$defs"]["OpenAIFile"]
    assert set(definition["required"]) == {"download_url", "file_id"}
    assert set(definition["properties"]) == {"download_url", "file_id", "mime_type", "file_name"}
    assert all(definition["properties"][k]["type"] == "string" for k in definition["properties"])
    data = original("red")
    async def fetch(file, size_bytes):
        assert file.file_id == "file-test" and size_bytes == len(data)
        return data
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    result = tool(client, tokens["access_token"], "ingest_original_photo", args)
    assert result["original_bytes_verified"] and result["size_bytes"] == len(data)
    assert PhotoStore(provider.store).get("seller-123", result["photo"]) == data
    assert tool(client, tokens["access_token"], "ingest_original_photo", args) == result
    assert "PRIVATE-SIGNED-URL" not in str(result)
    with provider.store.tx() as db:
        records = db.execute("SELECT data FROM records").fetchall()
    assert all(b"PRIVATE-SIGNED-URL" not in provider.store.cipher.decrypt(r[0]) for r in records)
    assert all(r.method == "GET" or "oauth2/token" in str(r.url) for r in state["requests"])
    bad = rpc(client, tokens["access_token"], "tools/call",
              {"name": "ingest_original_photo", "arguments": {**args, "sha256_hex": "0" * 64}}).json()["result"]
    assert bad["isError"] and "checksum mismatch" in str(bad)


def test_revocation_during_download_rejects_storage(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    family = asyncio.run(provider.load_access_token(tokens["access_token"])).family
    data = original("red")
    async def revoke(file, size_bytes):
        provider.store.delete_family(family)
        return data
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", revoke)
    result = rpc(client, tokens["access_token"], "tools/call", {"name": "ingest_original_photo", "arguments": {
        "file": {"download_url": URL, "file_id": "file-test"}, "sha256_hex": sha256(data).hexdigest(),
        "size_bytes": len(data), "role": "front"}}).json()["result"]
    assert result["isError"] and "expired" in str(result)
    assert not list(PhotoStore(provider.store).root.rglob("*.jpeg"))
