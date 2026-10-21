import asyncio
from copy import deepcopy

import httpx
import pytest

from test_connector import env as env
from test_listing_http import selling_adapter
from test_listings import bundle as bundle
from btco_ebay.listing_drafts import ListingDraft


@pytest.mark.parametrize("bad", [None, "next", "total", "listing", "unpublished"])
def test_automatic_campaign_uses_exact_listing_get_without_writes(env, bundle, bad):
    _, source, _ = bundle
    data = deepcopy(source)
    data.update(promotion_campaign_id="444", promotion_campaign_sha256="c"*64,
                promotion_unavailable_reason=None, promotion_mode="automatic_existing")
    draft = ListingDraft.model_validate(data)
    seen = []
    def handler(request):
        seen.append(request)
        assert request.method == "GET"
        if request.url.path.endswith("/offer"):
            assert request.url.params["sku"] == draft.listing_sku
            return httpx.Response(200, json={"offers": [{"status": "UNPUBLISHED" if bad == "unpublished" else "PUBLISHED",
                "listing": {"listingId": "123456789123"}}]})
        assert request.url.path.endswith("/ad_campaign/444/ad")
        assert request.url.params["listing_ids"] == "123456789123"
        ad = {"adId": "555", "bidPercentage": "5.0", "listingId": "123456789123"}
        result = {"ads": [ad], "total": 1, "offset": 0, "limit": 100}
        if bad == "next": result["next"] = "https://evil.test"
        if bad == "total": result["total"] = 2
        if bad == "listing": ad["listingId"] = "987654321987"
        return httpx.Response(200, json=result)
    selling, family = selling_adapter(env, handler)
    if bad:
        with pytest.raises(ValueError): asyncio.run(selling.ads(family, draft))
    else:
        assert asyncio.run(selling.ads(family, draft))[0]["bidPercentage"] == "5.0"
    assert len(seen) == (1 if bad == "unpublished" else 2)
