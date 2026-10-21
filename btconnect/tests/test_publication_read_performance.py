"""Bounded read concurrency must never weaken completeness or duplicate gates."""
import asyncio
from types import SimpleNamespace

import pytest

from btco_ebay.inventory import PAGE_SIZE
from btco_ebay.publishing import Publisher
from btco_ebay.selling import SellingError
from test_listings import bundle as bundle, publisher, run


class Pages:
    def __init__(self, count=3597, mutate=None, failure=None):
        self.count, self.mutate, self.failure = count, mutate, failure
        self.calls, self.finished = [], []
        self.inflight = self.peak = 0

    async def __call__(self, ebay, family, page):
        self.calls.append(page)
        self.inflight += 1
        self.peak = max(self.peak, self.inflight)
        try:
            # Finish pages out of order to exercise deterministic assembly.
            for _ in range(5 - page % 4):
                await asyncio.sleep(0)
            if page == self.failure:
                raise SellingError(429)
            first = (page - 1) * PAGE_SIZE
            result = {
                "page": page, "total_matching": self.count,
                "next_page": page + 1 if page * PAGE_SIZE < self.count else None,
                "records": [{"item_id": str(900000000000 + i), "title": "Other comic", "sku": str(i)}
                            for i in range(first, min(first + PAGE_SIZE, self.count))],
            }
            if self.mutate:
                self.mutate(result, page)
            return result
        finally:
            self.inflight -= 1
            self.finished.append(page)


def collect(source):
    return asyncio.run(Publisher(None, SimpleNamespace(ebay=None), collector=source).active("family"))


@pytest.mark.parametrize("count", [0, 1, 200, 201, 3597, 24999])
def test_complete_ordered_results_with_at_most_four_reads(count):
    source = Pages(count)
    rows = collect(source)
    assert [r["item_id"] for r in rows] == [str(900000000000 + i) for i in range(count)]
    assert source.calls == list(range(1, max(1, (count + 199) // 200) + 1))
    assert source.peak <= 4 and source.inflight == 0
    if count == 3597:
        assert source.peak == 4 and source.finished != source.calls


@pytest.mark.parametrize("fault", ["total", "page", "next", "missing", "duplicate"])
def test_inconsistent_parallel_page_stops_before_any_marketplace_write(bundle, fault):
    pub, fake, row = publisher(bundle)
    def mutate(result, page):
        if page != 3:
            return
        if fault == "total": result["total_matching"] += 1
        elif fault == "page": result["page"] = 2
        elif fault == "next": result["next_page"] = None
        elif fault == "missing": result["records"].pop()
        else: result["records"][0]["item_id"] = "900000000000"
    source = Pages(mutate=mutate)
    pub.collector = source
    with pytest.raises(ValueError):
        run(pub, row)
    assert fake.calls == []
    assert source.calls == [1, 2, 3, 4, 5] and source.inflight == 0


def test_rate_limit_drains_batch_without_retrying_or_starting_more_reads(bundle):
    pub, fake, row = publisher(bundle)
    source = Pages(failure=3)
    pub.collector = source
    with pytest.raises(SellingError) as error:
        run(pub, row)
    assert error.value.status == 429
    assert fake.calls == []
    assert source.calls == [1, 2, 3, 4, 5]
    assert sorted(source.finished) == source.calls and source.inflight == 0


def test_duplicate_on_last_page_still_blocks_publication(bundle):
    pub, fake, row = publisher(bundle)
    def mutate(result, page):
        if page == 18:
            result["records"][-1]["sku"] = " CDP-Master-1 "
    pub.collector = Pages(mutate=mutate)
    with pytest.raises(ValueError, match="duplicate"):
        run(pub, row)
    assert fake.calls == []


def test_each_collection_is_fresh():
    source = Pages(201)
    assert len(collect(source)) == 201
    source.count = 200
    assert len(collect(source)) == 200
    assert source.calls == [1, 2, 1]


def test_cancellation_drains_inflight_reads():
    async def scenario():
        started = asyncio.Event()
        pending = set()
        async def source(ebay, family, page):
            if page == 1:
                return {"page": 1, "total_matching": 1000, "next_page": 2,
                        "records": [{"item_id": str(i)} for i in range(200)]}
            pending.add(page)
            if len(pending) == 4:
                started.set()
            try:
                await asyncio.Event().wait()
            finally:
                pending.remove(page)
        task = asyncio.create_task(Publisher(None, SimpleNamespace(ebay=None), collector=source).active("family"))
        await asyncio.wait_for(started.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not pending
    asyncio.run(scenario())
