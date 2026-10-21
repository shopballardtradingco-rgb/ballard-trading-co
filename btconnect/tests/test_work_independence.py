"""Native MCP workflow; synthetic HTTPS photos/eBay only, no paid AI or Work APIs."""
from dataclasses import replace
import time

import httpx
import pytest
from starlette.testclient import TestClient

from btco_ebay.comic_research import ComicResearch
from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.photo_transfer import download_original
from btco_ebay.publishing import Publisher
from btco_ebay.server import build_app
from test_connector import env as env, connect, rpc, tool
from test_listings import bundle as bundle, original
from test_listing_contract import new_draft
from test_listing_batches import MultiSelling
from test_comic_intake import intake_from_drafts
from test_comic_research import proposal
from test_photo_pipeline import file, call_error


@pytest.mark.parametrize("route", ["chat_observations", "owner_corrected_research"])
def test_native_tools_complete_listing_after_restart_without_work_or_ai(env, bundle, monkeypatch, route):
    client, provider, settings, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    token = tokens["access_token"]
    images = {"front": original("orange"), "back": original("purple")}
    async def fetch(attachment, size_bytes, **kwargs):
        def upstream(request):
            assert "authorization" not in request.headers
            return httpx.Response(200, content=images[attachment.file_id], headers={"Content-Type": "image/jpeg"})
        return await download_original(attachment, size_bytes, transport=httpx.MockTransport(upstream))
    monkeypatch.setattr("btco_ebay.listing_tools.download_original", fetch)
    native = tool(client, token, "ingest_original_photos", {
        "files": [file("back"), file("front")],
        "photo_inputs": [{"file_index": 1, "role": "front"}, {"file_index": 0, "role": "back"}]})
    assert native["complete"]
    photos = [r["photo"] for r in native["results"]]
    fake = MultiSelling(list(images.values()))
    fake.require = lambda family: {"user_id": "seller-123"}
    async def policies(self, *args): return await fake.validate_policies(*args)
    async def promotion(self, *args): return await fake.validate_promotion(*args)
    async def active(self, family): return (await fake.collect(None, family, 1))["records"]
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_policies", policies)
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_promotion", promotion)
    monkeypatch.setattr(Publisher, "active", active)
    real_run = Publisher.run
    async def publish(self, *args):
        self.selling, self.collector, self.enabled = fake, fake.collect, True
        return await real_run(self, *args)
    monkeypatch.setattr(Publisher, "run", publish)
    contract = tool(client, token, "get_comic_intake_contract")
    assert not contract["hosted_research"]["configured"]
    data = new_draft(env, bundle)
    data["photos"] = photos
    intake = intake_from_drafts([data], batch_id="btco-batch-work-independent")
    if route == "chat_observations":
        prepared = tool(client, token, "prepare_comic_intake", {"intake": intake})
    else:
        # A prior uncertain proposal is persisted test data; the workflow only uses MCP.
        p = proposal()
        p.update(issue="6", year=None, condition=None, confidence="low")
        row = {"seller": "seller-123", "request_id": "btco-research-recoverable",
            "revision": "a"*64, "started_at": time.time(), "status": "needs_owner_review",
            "proposal": p, "photos": photos, "source_verification": "Synthetic candidate only"}
        provider.store.put("comic-research", ComicResearch.key("seller-123", row["request_id"]), row)
        reviewed = {"batch_id": intake["batch_id"], "inventory_location": "TEST-BOX-01",
            "defaults": intake["defaults"],
            "owner_review_evidence": "Synthetic owner reviewed originals, corrected issue/year/condition, $8 and $6 minimum; not publication approval.",
            "items": [{"request_id": row["request_id"], "revision": row["revision"],
                "price_usd": "8", "minimum_offer_usd": "6", "corrections": {
                    "issue": "3", "year": 1985, "condition": "USED_GOOD",
                    "condition_notes": "Synthetic owner inspected light edge wear and corner creasing.",
                    "owner_correction_evidence": "Synthetic owner corrected issue to 3 and year to 1985 after inspecting the original photos."}}]}
        prepared = tool(client, token, "prepare_researched_comic_intake", {"reviewed": reviewed})
    assert len(prepared["listings"]) == 1 and not prepared["approval_current"] and not fake.calls
    # A fresh server/client uses the same encrypted storage and OAuth token, no local file handoff.
    app, _, _ = build_app(replace(settings, publication_enabled=True),
                         httpx.MockTransport(lambda req: pytest.fail("Unexpected network request")))
    with TestClient(app, base_url=settings.origin) as fresh:
        catalog = tool(fresh, token, "list_listing_batches")
        assert any(r["batch_id"] == intake["batch_id"] for r in catalog["records"])
        if route == "owner_corrected_research":
            found = tool(fresh, token, "list_comic_research")
            assert found["records"][0]["request_id"] == row["request_id"]
            assert tool(fresh, token, "get_comic_research", {"request_id": row["request_id"]})["research"] == row
        review = tool(fresh, token, "get_listing_batch_review", {"batch_id": intake["batch_id"]})
        listing = review["listings"][0]
        assert listing["draft"]["photos"] == photos and listing["inventory_location"] == "TEST-BOX-01"
        args = {"batch_id": intake["batch_id"], "review_revision": review["review_revision"]}
        assert "approv" in str(call_error(fresh, token, "publish_approved_batch", args)).lower()
        assert not fake.calls
        if route == "owner_corrected_research":
            tool(fresh, token, "approve_listing_batch", {**args,
                "owner_approval_evidence": "Synthetic owner approved the first review before changing the price; no real inventory."})
            reviewed["items"][0].update(price_usd="9", expected_draft_revision=listing["revision"])
            reviewed["owner_review_evidence"] = "Synthetic owner changes this item's price to $9 and retains the reviewed $6 minimum and corrected facts."
            changed = tool(fresh, token, "prepare_researched_comic_intake", {
                "reviewed": reviewed, "expected_revision": review["batch_revision"]})
            assert not changed["approval_current"] and changed["review_revision"] != args["review_revision"]
            call_error(fresh, token, "publish_approved_batch", args)
            assert not fake.calls
            review = tool(fresh, token, "get_listing_batch_review", {"batch_id": intake["batch_id"]})
            assert review["listings"][0]["draft"]["price_usd"] == "9"
            args["review_revision"] = review["review_revision"]
        tool(fresh, token, "approve_listing_batch", {**args,
            "owner_approval_evidence": "Synthetic owner explicitly approves this complete final review and original photos; mock publication only."})
        result = tool(fresh, token, "publish_approved_batch", args)
        assert result["verified_count"] == 1 and result["complete"]
        item_id = result["listings"][0]["publication"]["item_id"]
        before = list(fake.calls)
        repeated = tool(fresh, token, "publish_approved_batch", args)
        assert repeated["verified_count"] == 1 and fake.calls == before
        assert fake.calls.count("publish") == fake.calls.count("create") == 1
        assert tool(fresh, token, "get_publication_receipt", {"item_id": item_id})


def test_saved_research_catalog_filters_sellers_and_exposes_uncertain_attempts(env):
    client, provider, _, _ = env
    _, tokens = connect(env)
    for seller, suffix, status in [("seller-123", "first", "pending"),
                                    ("other", "private", "needs_owner_review"),
                                    ("seller-123", "last", "uncertain")]:
        request_id = "btco-research-" + suffix
        provider.store.put("comic-research", ComicResearch.key(seller, request_id), {
            "seller": seller, "request_id": request_id, "status": status,
            "photos": [], "started_at": time.time()})
    one = tool(client, tokens["access_token"], "list_comic_research", {"limit": 1})
    two = tool(client, tokens["access_token"], "list_comic_research", {"cursor": one["next_cursor"], "limit": 1})
    rows = one["records"] + two["records"]
    assert len(rows) == 2 and {r["status"] for r in rows} == {"pending", "uncertain"}
    assert all(r["revision"] is None and "private" not in r["request_id"] for r in rows)
    assert two["next_cursor"] is None
