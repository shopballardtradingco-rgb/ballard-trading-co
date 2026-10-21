"""Readiness overlaps bounded GETs without weakening errors or fresh consent."""
import asyncio
from collections import Counter
import time
from types import SimpleNamespace

from cryptography.fernet import Fernet
import httpx
import pytest

from btco_ebay.config import ACCOUNT_SCOPE, INVENTORY_SCOPE, MARKETING_SCOPE, TRADING_SCOPE
from btco_ebay.ebay import Ebay
from btco_ebay.selling import Selling, SellingError
from btco_ebay.store import Store


REQUIRED = ("fulfillment_policy", "payment_policy", "return_policy", "location")
OPTIONAL = ("get_item_condition_policies", "get_negotiated_price_policies", "ad_campaign")


def adapter(path, handler, selling_class=Selling):
    store = Store(str(path / "records.sqlite3"), Fernet.generate_key().decode())
    store.put("grant", "family", {
        "access_token": "synthetic-token", "expires_at": time.time() + 3600,
        "refresh_expires_at": time.time() + 7200, "user_id": "synthetic-seller",
        "consented_scopes": [ACCOUNT_SCOPE, INVENTORY_SCOPE, MARKETING_SCOPE, TRADING_SCOPE],
    }, family="family")
    return selling_class(Ebay(SimpleNamespace(), store, httpx.MockTransport(handler)))


def response(request, *, generation=0, campaigns=0):
    """Synthetic, deterministic responses; reject any unexpected request."""
    assert request.method == "GET"
    assert request.headers["authorization"] == "Bearer synthetic-token"
    name = request.url.path.rsplit("/", 1)[-1]
    if name in REQUIRED[:3]:
        assert dict(request.url.params) == {"marketplace_id": "EBAY_US"}
        data = {"marketplaceId": "EBAY_US", "fixture_generation": generation, "kind": name}
    elif name == "location":
        assert dict(request.url.params) == {"limit": "100"}
        data = {"locations": [{"merchantLocationKey": f"synthetic-{generation}"}]}
    elif name in OPTIONAL[:2]:
        assert dict(request.url.params) == {"filter": "categoryIds:{259104}"}
        key = "itemConditionPolicies" if name == OPTIONAL[0] else "negotiatedPricePolicies"
        data = {key: [{"categoryId": "259104", "fixture_generation": generation}]}
    else:
        assert name == "ad_campaign"
        offset = int(request.url.params["offset"])
        assert dict(request.url.params) == {"campaign_status": "RUNNING", "funding_strategy": "COST_PER_SALE",
                                      "limit": "100", "offset": str(offset)}
        data = {"campaigns": [{"campaignId": str(i + 1), "fixture_generation": generation}
                              for i in range(offset, min(campaigns, offset + 100))],
                "total": campaigns, "offset": offset, "limit": 100}
        if offset + 100 < campaigns:
            data["next"] = "https://untrusted.invalid/must-not-follow"
    return httpx.Response(200, json=data)


def test_required_and_optional_groups_overlap_but_remain_bounded_and_fresh(tmp_path):
    async def run():
        started = {"required": asyncio.Event(), "optional": asyncio.Event()}
        running, peak, seen, generation = Counter(), Counter(), [], 0
        async def handler(request):
            name = request.url.path.rsplit("/", 1)[-1]
            group = "required" if name in REQUIRED else "optional"
            seen.append((generation, name))
            running[group] += 1
            peak[group] = max(peak[group], running[group])
            target = 4 if group == "required" else 3
            if group == "optional":
                assert running["required"] == 0
            if running[group] == target:
                started[group].set()
            try:
                await asyncio.wait_for(started[group].wait(), 2)
                return response(request, generation=generation)
            finally:
                running[group] -= 1
        selling = adapter(tmp_path, handler)
        async with selling.ebay.http.lifespan():
            for generation in range(2):
                for event in started.values():
                    event.clear()
                result = await selling.policy_options("family")
                assert list(result) == [*REQUIRED[:3], "locations", "comic_category", "promotion_campaigns"]
                assert result["fulfillment_policy"]["fixture_generation"] == generation
                assert result["locations"]["locations"][0]["merchantLocationKey"] == f"synthetic-{generation}"
                assert result["comic_category"]["itemConditionPolicies"][0]["fixture_generation"] == generation
                assert result["promotion_campaigns"] == {"campaigns": [], "total_matching": 0, "complete": True}
                assert all(count == 0 for count in running.values())
        assert peak == {"required": 4, "optional": 3}
        assert Counter(seen) == Counter((g, name) for g in range(2) for name in (*REQUIRED, *OPTIONAL))
    asyncio.run(run())


@pytest.mark.parametrize("status", [429, 503])
def test_required_error_drains_group_without_retry_or_optional_requests(tmp_path, status):
    async def run():
        all_started, release, failed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        running, seen = 0, []
        async def handler(request):
            nonlocal running
            name = request.url.path.rsplit("/", 1)[-1]
            assert name in REQUIRED
            seen.append(name)
            running += 1
            if running == 4:
                all_started.set()
            try:
                await all_started.wait()
                if name == "fulfillment_policy":
                    failed.set()
                    return httpx.Response(status, json={"errors": [{"errorId": 42, "message": "PRIVATE"}]})
                await release.wait()
                return response(request)
            finally:
                running -= 1
        selling = adapter(tmp_path, handler)
        task = asyncio.create_task(selling.policy_options("family"))
        try:
            await asyncio.wait_for(failed.wait(), 2)
            assert not task.done() and running == 3
        finally:
            release.set()
        with pytest.raises(SellingError) as error:
            await asyncio.wait_for(task, 2)
        assert error.value.status == status and "PRIVATE" not in str(error.value)
        assert running == 0 and Counter(seen) == Counter(REQUIRED)
    asyncio.run(run())


@pytest.mark.parametrize("group", ["required", "optional"])
def test_cancellation_drains_nested_requests_and_next_call_still_works(tmp_path, group):
    async def run():
        all_started = asyncio.Event()
        running, blocked, seen = 0, True, []
        async def handler(request):
            nonlocal running
            name = request.url.path.rsplit("/", 1)[-1]
            seen.append(name)
            should_block = blocked and ((name in REQUIRED) == (group == "required"))
            if not should_block:
                return response(request)
            running += 1
            if running == (4 if group == "required" else 3):
                all_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                running -= 1
        selling = adapter(tmp_path, handler)
        async with selling.ebay.http.lifespan():
            task = asyncio.create_task(selling.policy_options("family"))
            try:
                await asyncio.wait_for(all_started.wait(), 2)
            finally:
                task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 2)
            assert running == 0
            if group == "required":
                assert Counter(seen) == Counter(REQUIRED)
            seen.clear()
            blocked = False
            result = await selling.policy_options("family")
            assert result["promotion_campaigns"]["complete"] is True
            assert Counter(seen) == Counter((*REQUIRED, *OPTIONAL))
    asyncio.run(run())


@pytest.mark.parametrize("failures", [(OPTIONAL[0],), (OPTIONAL[2],), (OPTIONAL[0], OPTIONAL[2])])
def test_optional_errors_keep_business_data_and_drain_all_reads(tmp_path, failures):
    async def run():
        seen = []
        async def handler(request):
            name = request.url.path.rsplit("/", 1)[-1]
            seen.append(name)
            await asyncio.sleep(0)
            if name in failures:
                return httpx.Response(429, json={"errors": [{"errorId": 42, "message": "PRIVATE"}]})
            return response(request)
        result = await adapter(tmp_path, handler).policy_options("family")
        assert result["payment_policy"]["kind"] == "payment_policy"
        for name, key in ((OPTIONAL[0], "comic_category"), (OPTIONAL[2], "promotion_campaigns")):
            assert (result[key].get("status") == "unavailable") == (name in failures)
        assert "PRIVATE" not in str(result)
        assert Counter(seen) == Counter((*REQUIRED, *OPTIONAL))
    asyncio.run(run())


def test_optional_reads_recheck_revoked_grant_after_required_group(tmp_path):
    async def run():
        seen, finished = [], 0
        async def handler(request):
            nonlocal finished
            name = request.url.path.rsplit("/", 1)[-1]
            assert name in REQUIRED
            seen.append(name)
            await asyncio.sleep(0)
            finished += 1
            if finished == 4:
                selling.ebay.store.delete_family("family")
            return response(request)
        selling = adapter(tmp_path, handler)
        result = await selling.policy_options("family")
        assert result["comic_category"]["status"] == result["promotion_campaigns"]["status"] == "unavailable"
        assert Counter(seen) == Counter(REQUIRED)
        with pytest.raises(ValueError, match="consent"):
            await selling.policy_options("family")
        assert Counter(seen) == Counter(REQUIRED)
    asyncio.run(run())


def test_campaign_pagination_stays_sequential_and_validated(tmp_path):
    async def run():
        offsets, running = [], 0
        async def handler(request):
            nonlocal running
            if request.url.path.endswith("/ad_campaign"):
                running += 1
                assert running == 1
                offsets.append(int(request.url.params["offset"]))
                try:
                    await asyncio.sleep(0)
                    result = response(request, campaigns=201)
                    if offsets[-1] == 200:
                        data = result.json()
                        data["campaigns"][0]["campaignId"] = "1"
                        return httpx.Response(200, json=data)
                    return result
                finally:
                    running -= 1
            return response(request)
        result = await adapter(tmp_path, handler).policy_options("family")
        assert offsets == [0, 100, 200] and running == 0
        assert result["promotion_campaigns"]["status"] == "unavailable"
        assert "duplicate" in result["promotion_campaigns"]["error"]
    asyncio.run(run())
