"""Host file transfer through approval/publication using simulated eBay only."""

import asyncio
from copy import deepcopy
from hashlib import sha256

import httpx
import pytest

from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.listing_store import ListingStore
from btco_ebay.photo_transfer import OpenAIFile, download_original
from btco_ebay.photos import PhotoStore
from btco_ebay.publishing import Publisher
from test_connector import env as env, connect, rpc, tool
from test_listing_contract import new_draft
from test_listings import bundle as bundle, original, FakeSelling

URL = "https://files.oaiusercontent.com/original?sig=PRIVATE"


def file(identifier):
    return {"download_url": URL, "file_id": identifier}


def call_error(client, token, name, args):
    result = rpc(client, token, "tools/call", {"name": name, "arguments": args}).json()["result"]
    assert result["isError"]
    return result


@pytest.mark.parametrize("with_length", [True, False])
def test_native_download_does_not_require_client_size(with_length):
    data = original("red")
    def handler(request):
        response = httpx.Response(200, content=data, headers={"Content-Type": "image/jpeg"})
        if not with_length:
            del response.headers["content-length"]
        return response
    assert asyncio.run(download_original(OpenAIFile(**file("a")),
                       transport=httpx.MockTransport(handler))) == data


@pytest.mark.parametrize("length,body", [("100", b"123"), ("0", b""), ("garbage", b"123"),
                                        ("12000001", b"x"), (None, b"12345")])
def test_unknown_size_remains_bounded(monkeypatch, length, body):
    monkeypatch.setattr("btco_ebay.photo_transfer.MAX_PHOTO_BYTES", 4)
    def handler(request):
        response = httpx.Response(200, content=body, headers={"Content-Type": "image/jpeg"})
        if length is None:
            del response.headers["content-length"]
        else:
            response.headers["content-length"] = length
        return response
    with pytest.raises(ValueError):
        asyncio.run(download_original(OpenAIFile(**file("a")), transport=httpx.MockTransport(handler)))


def test_native_ingest_calculates_checksum_and_distinguishes_source_verification(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    data = original("red")
    async def fetch(file, size_bytes):
        return data
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    args = {"file": file("a"), "role": "front"}
    stored = tool(client, token, "ingest_original_photo", args)
    assert stored["photo"]["sha256_hex"] == sha256(data).hexdigest()
    assert stored["storage_sha256_verified"] and not stored["source_sha256_verified"]
    assert PhotoStore(provider.store).get("seller-123", stored["photo"]) == data
    repeated = tool(client, token, "ingest_original_photo", {**args, "sha256_hex": sha256(data).hexdigest()})
    assert repeated["photo"] == stored["photo"] and repeated["source_sha256_verified"]
    assert "checksum mismatch" in str(call_error(client, token, "ingest_original_photo",
                                                 {**args, "sha256_hex": "0" * 64}))
    assert "size mismatch" in str(call_error(client, token, "ingest_original_photo",
                                              {**args, "size_bytes": len(data) + 1}))
    schema = rpc(client, token, "tools/list", {}).json()["result"]["tools"]
    single = next(t for t in schema if t["name"] == "ingest_original_photo")
    assert set(single["inputSchema"]["required"]) == {"file", "role"}
    batch = next(t for t in schema if t["name"] == "ingest_original_photos")
    assert batch["_meta"]["openai/fileParams"] == ["files"]
    assert batch["inputSchema"]["properties"]["files"]["maxItems"] == 10
    inputs = batch["inputSchema"]["$defs"]["PhotoTransferInput"]
    assert inputs["required"] == ["role"]
    assert "file_index" in inputs["properties"]


def test_batch_host_resolved_ids_use_explicit_indexes_with_correct_roles_and_hashes(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    front, back = original("red"), original("blue")
    resolved = [file("sediment://file_host_back"), file("sediment://file_host_front")]
    images = {"sediment://file_host_front": front, "sediment://file_host_back": back}
    calls = []
    async def fetch(file, size_bytes, **kwargs):
        calls.append(file.file_id)
        return images[file.file_id]
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    # Reproduce the old failure: model reference strings are not server file IDs.
    legacy = [{"file_id": "attachment_front", "role": "front"},
              {"file_id": "attachment_back", "role": "back"}]
    assert "file_index" in str(call_error(client, token, "ingest_original_photos",
                                          {"files": resolved, "photo_inputs": legacy}))
    assert calls == []
    metadata = [{"file_index": 1, "role": "front", "sha256_hex": sha256(front).hexdigest()},
                {"file_index": 0, "role": "back", "size_bytes": len(back)}]
    result = tool(client, token, "ingest_original_photos", {"files": resolved, "photo_inputs": metadata})
    assert result["complete"]
    assert [r["file_index"] for r in result["results"]] == [1, 0]
    assert [r["file_id"] for r in result["results"]] == ["sediment://file_host_front", "sediment://file_host_back"]
    for stored, data, role in zip(result["results"], [front, back], ["front", "back"]):
        assert stored["role"] == stored["photo"]["role"] == role
        assert stored["photo"]["sha256_hex"] == sha256(data).hexdigest()
        assert stored["storage_sha256_verified"]
        assert PhotoStore(provider.store).get("seller-123", stored["photo"]) == data
    assert result["results"][0]["source_sha256_verified"]
    assert not result["results"][1]["source_sha256_verified"]


@pytest.mark.parametrize("entries", [
    [{"file_index": 0, "role": "front"}],
    [{"file_index": 0, "role": "front"}, {"file_index": 0, "role": "back"}],
    [{"file_index": 0, "role": "front"}, {"file_index": 2, "role": "back"}],
    [{"file_index": -1, "role": "front"}, {"file_index": 1, "role": "back"}],
    [{"file_index": True, "role": "front"}, {"file_index": 1, "role": "back"}],
    [{"file_index": "0", "role": "front"}, {"file_index": 1, "role": "back"}],
    [{"role": "front"}, {"file_index": 1, "role": "back"}],
    [{"file_index": 0, "file_id": "a", "role": "front"}, {"file_index": 1, "role": "back"}],
    [{"file_id": "a", "role": "front"}, {"file_index": 0, "role": "back"}],
])
def test_invalid_positional_mapping_never_downloads_or_stores(env, monkeypatch, entries):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    async def never(*args, **kwargs):
        pytest.fail("Invalid mapping must not download")
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", never)
    call_error(client, tokens["access_token"], "ingest_original_photos",
               {"files": [file("a"), file("b")], "photo_inputs": entries})
    assert not list(PhotoStore(provider.store).root.rglob("*.jpeg"))


def test_batch_is_bounded_ordered_private_and_partial_retries_are_idempotent(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    active, peak, clients = 0, 0, set()
    failed = {"b"}
    images = {k: original(v) for k, v in zip("abcde", ["red", "blue", "green", "black", "white"])}
    async def fetch(file, size_bytes, *, client):
        nonlocal active, peak
        clients.add(id(client))
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.005 if file.file_id == "a" else 0)
        active -= 1
        if file.file_id in failed:
            raise ValueError("Original file download failed; request a fresh file reference")
        return images[file.file_id]
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    args = {"files": [file(k) for k in "edcba"],
            "photo_inputs": [{"file_index": i, "role": "detail"} for i in [4, 3, 2, 1, 0]]}
    result = tool(client, token, "ingest_original_photos", args)
    assert not result["complete"] and 1 < peak <= 3 and len(clients) == 1
    assert [r["file_id"] for r in result["results"]] == list("abcde")
    assert result["results"][1]["status"] == "failed" and "PRIVATE" not in str(result)
    for r in result["results"]:
        if r["status"] == "stored":
            assert PhotoStore(provider.store).get("seller-123", r["photo"]) == images[r["file_id"]]
    failed.clear()
    retry = tool(client, token, "ingest_original_photos", {"files": [file("b")],
                 "photo_inputs": [{"file_index": 0, "role": "detail"}]})
    assert retry["complete"] and retry["results"][0]["file_id"] == "b"
    repeat = tool(client, token, "ingest_original_photos", args)
    assert repeat["complete"]
    for old, new in zip(result["results"], repeat["results"]):
        if old["status"] == "stored":
            assert old == new
    assert len(list(PhotoStore(provider.store).root.rglob("*.jpeg"))) == 5
    with provider.store.tx() as db:
        records = db.execute("SELECT data FROM records").fetchall()
    assert all(b"?sig=PRIVATE" not in provider.store.cipher.decrypt(r[0]) for r in records)


def test_batch_rejects_ambiguous_mapping_before_download_and_requires_scope(env, monkeypatch):
    client, _, _, _ = env
    async def never(*args, **kwargs):
        pytest.fail("Invalid mapping must not download")
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", never)
    args = {"files": [file("a")], "photo_inputs": [{"file_id": "a", "role": "front"}]}
    _, read = connect(env)
    assert "btco:listings" in str(call_error(client, read["access_token"], "ingest_original_photos", args))
    _, write = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    for changes in [{"files": [file("a"), file("a")]},
                    {"photo_inputs": [{"file_id": "b", "role": "front"}]},
                    {"photo_inputs": args["photo_inputs"] * 2},
                    {"files": [file(str(n)) for n in range(11)]}]:
        call_error(client, write["access_token"], "ingest_original_photos", {**args, **changes})


def test_bad_photo_url_is_isolated_before_network_and_good_originals_survive(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    downloaded = []
    raw = original("blue")
    async def fetch(source, *args, **kwargs):
        downloaded.append(source.file_id)
        assert source.download_url == URL
        return raw
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    bad_url = "https://evil.test/private?sig=DO-NOT-ECHO"
    result = tool(client, tokens["access_token"], "ingest_original_photos", {
        "files": [file("good"), {**file("bad"), "download_url": bad_url}],
        "photo_inputs": [{"file_index": 0, "role": "front"}, {"file_index": 1, "role": "back"}]})
    assert not result["complete"]
    assert [r["status"] for r in result["results"]] == ["stored", "failed"]
    assert downloaded == ["good"]
    assert "DO-NOT-ECHO" not in str(result) and "evil.test" not in str(result)
    assert PhotoStore(provider.store).get("seller-123", result["results"][0]["photo"]) == raw


def test_batch_revocation_and_failed_durable_readback_never_report_success(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    family = asyncio.run(provider.load_access_token(token)).family
    async def fetch(file, size_bytes, **kwargs):
        provider.store.delete_family(family)
        return original("red")
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    args = {"files": [file("a")], "photo_inputs": [{"file_id": "a", "role": "front"}]}
    result = tool(client, token, "ingest_original_photos", args)
    assert not result["complete"] and "expired" in result["results"][0]["error"]
    assert not list(PhotoStore(provider.store).root.rglob("*.jpeg"))
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    async def fetch_ok(file, size_bytes, **kwargs):
        return original("red")
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch_ok)
    def corrupt(*args):
        raise ValueError("Stored original failed integrity verification")
    monkeypatch.setattr(PhotoStore, "get", corrupt)
    result = tool(client, tokens["access_token"], "ingest_original_photos", args)
    assert not result["complete"] and "integrity" in result["results"][0]["error"]


def test_batch_photos_bind_to_individual_drafts_and_changed_photos_clear_approval(env, bundle, monkeypatch):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    colors = {"a": "orange", "b": "purple", "c": "yellow", "d": "pink"}
    async def fetch(file, size_bytes, **kwargs):
        return original(colors[file.file_id])
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    result = tool(client, token, "ingest_original_photos", {
        "files": [file(k) for k in "dcba"],
        "photo_inputs": [{"file_index": i, "role": role} for i, role in
                         zip([3, 2, 1, 0], ["front", "back", "front", "back"])]})
    data = new_draft(env, bundle)
    data["photos"] = [r["photo"] for r in result["results"][:2]]
    first = tool(client, token, "save_listing_draft", {"draft": data})
    second_data = {**deepcopy(data), "draft_id": "btco-comic-second-draft", "physical_item_id": "second-copy", "master_sku": "second-sku"}
    assert "already assigned" in str(call_error(client, token, "save_listing_draft", {"draft": second_data}))
    second_data["photos"] = [r["photo"] for r in result["results"][2:]]
    second = tool(client, token, "save_listing_draft", {"draft": second_data})
    assert first["draft"]["photos"] != second["draft"]["photos"]
    tool(client, token, "approve_listing_draft", {"draft_id": data["draft_id"], "revision": first["revision"],
        "owner_approval_evidence": "Synthetic owner approves exact first draft and originals only."})
    colors["e"] = "brown"
    extra = tool(client, token, "ingest_original_photo", {"file": file("e"), "role": "detail"})
    data["photos"].append(extra["photo"])
    changed = tool(client, token, "save_listing_draft", {"draft": data, "expected_revision": first["revision"]})
    assert changed["revision"] != first["revision"] and changed["approval"] is None


def test_attachment_to_saved_draft_approval_publish_verified_id_through_mcp(env, bundle, monkeypatch):
    client, provider, settings, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    images = {"front": original("orange"), "back": original("purple")}
    # Exercise real downloader against a mock HTTPS transport, then real PhotoStore.
    real_download = download_original
    async def fetch(file, size_bytes, **kwargs):
        def handler(request):
            assert "authorization" not in request.headers
            return httpx.Response(200, content=images[file.file_id], headers={"Content-Type": "image/jpeg"})
        return await real_download(file, size_bytes, transport=httpx.MockTransport(handler))
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    uploaded = tool(client, token, "ingest_original_photos", {
        "files": [file("back"), file("front")],
        "photo_inputs": [{"file_index": 1, "role": "front"}, {"file_index": 0, "role": "back"}]})
    assert uploaded["complete"]
    data = new_draft(env, bundle)
    data["photos"] = [r["photo"] for r in uploaded["results"]]
    saved = tool(client, token, "save_listing_draft", {"draft": data})
    assert saved["approval"] is None and saved["draft"]["photos"] == data["photos"]
    # Reopen persistent objects/draft to establish restart survival before approval.
    reopened = ListingStore(provider.store, PhotoStore(provider.store))
    assert reopened.get("seller-123", data["draft_id"])["revision"] == saved["revision"]
    for p, raw in zip(data["photos"], images.values()):
        assert reopened.photos.get("seller-123", p) == raw
    fake = FakeSelling(list(images.values()))
    fake.require = lambda family: {"user_id": "seller-123"}
    # Inject only eBay dependencies; run the actual Publisher state machine and MCP tool.
    real_run = Publisher.run
    async def simulated_run(self, *args):
        self.selling, self.collector, self.enabled = fake, fake.collect, True
        return await real_run(self, *args)
    monkeypatch.setattr(Publisher, "run", simulated_run)
    args = {"draft_id": data["draft_id"], "revision": saved["revision"]}
    denied = call_error(client, token, "publish_approved_listing", args)
    assert "not been approved" in str(denied) and fake.calls == []
    approved = tool(client, token, "approve_listing_draft", {
        **args, "owner_approval_evidence": "Synthetic owner approves displayed draft and original photos; no real listing."})
    assert approved["approval"]["revision"] == saved["revision"]
    result = tool(client, token, "publish_approved_listing", args)
    assert result["publication_status"]["all_checks_verified"]
    assert result["publication_status"]["item_id"] == "123456789123"
    assert fake.calls == ["upload", "upload", "put", "create", "publish"]
    assert tool(client, token, "publish_approved_listing", args) == result
    assert fake.calls.count("publish") == 1
    receipt = tool(client, token, "get_publication_receipt", {"item_id": "123456789123"})
    assert receipt

