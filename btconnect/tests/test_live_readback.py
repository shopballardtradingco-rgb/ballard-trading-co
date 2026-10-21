"""Diagnose a saved publication job with seller-scoped GETs only."""
from copy import deepcopy
from hashlib import sha256
from urllib.parse import unquote

import httpx

from test_connector import env as env, connect, tool
from test_listings import bundle as bundle
from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.listing_drafts import ListingDraft
from btco_ebay.listing_store import ListingStore
from btco_ebay.photos import PhotoStore


def test_saved_job_readback_exposes_mismatch_without_mutation(env, bundle):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    _, source, originals = bundle
    data = deepcopy(source)
    photos = PhotoStore(provider.store)
    repo = ListingStore(provider.store, photos)
    data["photos"] = [photos.put("seller-123", raw, sha256(raw).hexdigest(), role).model_dump()
                      for raw, role in zip(originals, ["front", "back"])]
    row = repo.save("seller-123", data)
    row = repo.approve("seller-123", data["draft_id"], row["revision"], "Approved synthetic original fixture.")
    row["job"] = {"inventory_attempted": True, "images": [{"image_url": "https://i.ebayimg.com/test.jpg"}], "offer_id": "123"}
    repo.write("seller-123", row)
    before = repo.get("seller-123", data["draft_id"])
    draft = ListingDraft.model_validate(data)
    actual = draft.inventory_payload(["https://i.ebayimg.com/test.jpg"])
    actual["product"]["title"] = "Unexpected title"
    requests = []

    def handler(request):
        requests.append(request)
        assert request.method == "GET"
        if "/inventory_item/" in request.url.path:
            assert unquote(request.url.path).endswith(draft.listing_sku)
            return httpx.Response(200, json=actual)
        assert request.url.path.endswith("/offer/123")
        return httpx.Response(200, json={"offerId": "123", **draft.offer_payload()})

    provider.ebay.transport = httpx.MockTransport(handler)
    result = tool(client, tokens["access_token"], "get_listing_draft", {"draft_id": data["draft_id"]})
    assert result["live_readback"]["inventory_matches"] is False
    assert result["live_readback"]["inventory"]["product"]["title"] == "Unexpected title"
    assert result["live_readback"]["offer_matches"] is True
    assert len(requests) == 2
    assert repo.get("seller-123", data["draft_id"]) == before
