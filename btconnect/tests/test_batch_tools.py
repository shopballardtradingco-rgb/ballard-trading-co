"""OAuth/MCP contract and original-photo recovery, using test-only storage."""
import base64
import json
from copy import deepcopy
from hashlib import sha256

from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.listing_drafts import ListingDraft
from btco_ebay.listing_validation import validate_new_standards
from btco_ebay.photos import PhotoStore
from test_connector import env as env, connect, rpc, tool
from test_listing_contract import new_draft
from test_listings import bundle as bundle, original


def test_status_manifest_matches_advertised_tools_without_claiming_host_acceptance(env):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    status = tool(client, token, "get_connection_status")
    tools = rpc(client, token, "tools/list", {}).json()["result"]["tools"]
    tools.sort(key=lambda t: t["name"])
    manifest = status["server_tool_manifest"]
    assert manifest["names"] == [t["name"] for t in tools]
    assert manifest["count"] == len(tools)
    assert manifest["sha256"] == sha256(json.dumps(tools, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert manifest["host_callability_verified"] is False
    assert {"ingest_original_photos", "prepare_listing_batch", "get_listing_batch_review",
            "approve_listing_batch", "publish_approved_batch"} <= set(manifest["names"])


def test_contract_required_text_is_sufficient_for_real_validator(env, bundle):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    contract = tool(client, token, "get_listing_contract")
    data = new_draft(env, bundle)
    for field in ("description", "condition_description"):
        data[field] = "Individualized synthetic condition notes. " + " ".join(contract["standards"]["required_text_by_field"][field])
    parsed = ListingDraft.model_validate(data)
    validate_new_standards(parsed)
    assert tool(client, token, "validate_listing_draft", {"draft": data})["valid"]


def test_legacy_photo_discovery_private_original_and_new_metadata(env):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    photos = PhotoStore(provider.store)
    raw = original("blue")
    photo = photos.put("seller-123", raw, sha256(raw).hexdigest(), "back")
    row = provider.store.get("photo", photo.object_key)
    for key in ("object_key", "roles"):
        row.pop(key)
    provider.store.put("photo", photo.object_key, row)  # actual pre-0.4 record shape
    page = tool(client, token, "list_stored_photos")
    assert page["records"][0]["object_key"] == photo.object_key
    assert page["records"][0]["recorded_roles"] == []  # never invent old front/back labels
    args = {"object_key": photo.object_key, "sha256_hex": photo.sha256_hex}
    result = rpc(client, token, "tools/call", {"name": "get_stored_original_photo", "arguments": args}).json()["result"]
    image = next(c for c in result["content"] if c["type"] == "image")
    assert base64.b64decode(image["data"]) == raw
    assert "https://" not in str(result)
    photos.put("seller-123", raw, photo.sha256_hex, "back", file_name="IMG_TEST.jpeg", file_id="source-1")
    catalog = photos.list("seller-123")["records"][0]
    assert catalog["original_filenames"] == ["IMG_TEST.jpeg"] and catalog["recorded_roles"] == ["back"]
    assert photos.list("other-seller")["records"] == []
    foreign = photos.put("other-seller", raw, photo.sha256_hex, "back")
    denied = rpc(client, token, "tools/call", {"name": "get_stored_original_photo", "arguments":
                 {"object_key": foreign.object_key, "sha256_hex": foreign.sha256_hex}}).json()["result"]
    assert denied["isError"]


def test_catalog_pagination_no_cross_seller_disclosure(env):
    _, provider, _, _ = env
    photos = PhotoStore(provider.store)
    for color in ("red", "blue", "green"):
        data = original(color)
        photos.put("seller-123", data, sha256(data).hexdigest(), "detail")
        photos.put("other-seller", data, sha256(data).hexdigest(), "front")
    cursor, seen = "", []
    while True:
        page = photos.list("seller-123", cursor, 1)
        seen.extend(r["sha256_hex"] for r in page["records"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(seen) == len(set(seen)) == 3


def test_native_ingest_persists_filename_without_signed_download_url(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    raw = original("blue")
    async def fetch(*args, **kwargs):
        return raw
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    tool(client, tokens["access_token"], "ingest_original_photo", {
        "file": {"download_url": "https://files.oaiusercontent.com/image?sig=PRIVATE",
                 "file_id": "host-file-id", "file_name": "IMG_TEST.jpeg"}, "role": "front"})
    row = PhotoStore(provider.store).list("seller-123")["records"][0]
    assert row["original_filenames"] == ["IMG_TEST.jpeg"]
    assert "PRIVATE" not in str(row) and "download_url" not in str(row)


def test_batch_mcp_prepare_review_and_approval_permissions(env, bundle, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    async def policies(*args):
        pass
    async def active(*args):
        return []
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_policies", policies)
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_promotion", policies)
    monkeypatch.setattr("btco_ebay.publishing.Publisher.active", active)
    data = new_draft(env, bundle)
    payload = {"batch_id": "btco-batch-http", "inventory_location": "SIMPLE-TRUTH-SEC3-2",
               "items": [{"item_key": "one", "label": "Synthetic copy", "draft": data},
                         {"item_key": "two", "label": "Unresolved", "unresolved_reason": "Issue number needs inspection."}]}
    prepared = tool(client, token, "prepare_listing_batch", {"batch": payload})
    assert len(prepared["listings"]) == 1 and len(prepared["exceptions"]) == 1
    assert "draft" not in prepared["listings"][0]
    catalog = tool(client, token, "list_listing_batches")
    assert catalog["records"][0]["batch_id"] == payload["batch_id"]
    review = tool(client, token, "get_listing_batch_review", {"batch_id": payload["batch_id"]})
    assert review["listings"][0]["draft"]["photos"] == data["photos"]
    assert review["listings"][0]["draft"]["condition_description"] == data["condition_description"]
    stale = rpc(client, token, "tools/call", {"name": "get_listing_batch_review", "arguments": {
        "batch_id": payload["batch_id"], "expected_review_revision": "0" * 64}}).json()["result"]
    assert stale["isError"]
    approved = tool(client, token, "approve_listing_batch", {
        "batch_id": payload["batch_id"], "review_revision": review["review_revision"],
        "owner_approval_evidence": "Synthetic owner approval of full review and exact photos, no rejection retries."})
    assert approved["approved"]
    assert tool(client, token, "get_listing_batch", {"batch_id": payload["batch_id"]})["approval_current"]
    _, readonly = connect(env)
    denied = rpc(client, readonly["access_token"], "tools/call", {
        "name": "approve_listing_batch", "arguments": {"batch_id": payload["batch_id"],
        "review_revision": review["review_revision"], "owner_approval_evidence": "Not authorized to write"}}).json()["result"]
    assert denied["isError"] and "mcp/www_authenticate" in denied["_meta"]
    schema = rpc(client, token, "tools/list", {}).json()["result"]["tools"]
    publish = next(t for t in schema if t["name"] == "publish_approved_batch")
    assert publish["annotations"]["destructiveHint"] and publish["annotations"]["idempotentHint"]
