"""Compare a known baseline with current code using synthetic network latency.

No credentials, external requests, eBay writes, or production inventory.
PYTHONPATH=. python scripts/benchmark_active_reads.py --baseline-file /path/publishing.py
"""
import argparse
import asyncio
import importlib.util
import json
from statistics import median
from time import perf_counter
from types import SimpleNamespace

from btco_ebay.inventory import PAGE_SIZE
from btco_ebay.publishing import Publisher


async def sample(cls, count, latency):
    calls = []
    async def read(ebay, family, page):
        calls.append(page)
        await asyncio.sleep(latency)
        start = (page - 1) * PAGE_SIZE
        return {"page": page, "total_matching": count,
                "next_page": page + 1 if page * PAGE_SIZE < count else None,
                "records": [{"item_id": str(900000000000 + i)}
                            for i in range(start, min(start + PAGE_SIZE, count))]}
    start = perf_counter()
    rows = await cls(None, SimpleNamespace(ebay=None), collector=read).active("synthetic")
    elapsed = perf_counter() - start
    assert len(rows) == count and len({r["item_id"] for r in rows}) == count
    return elapsed, len(calls)


async def main(args):
    spec = importlib.util.spec_from_file_location("btco_ebay._benchmark_baseline", args.baseline_file)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    before, after = [], []
    for _ in range(args.rounds):
        sequential, before_calls = await sample(baseline.Publisher, args.count, args.latency_ms / 1000)
        parallel, after_calls = await sample(Publisher, args.count, args.latency_ms / 1000)
        assert before_calls == after_calls
        before.append(sequential)
        after.append(parallel)
    b, a = median(before), median(after)
    print(json.dumps({"kind": "synthetic_latency_not_live_ebay", "listings": args.count,
                      "requests_per_scan": before_calls, "latency_per_request_ms": args.latency_ms,
                      "rounds": args.rounds, "baseline_median_seconds": round(b, 4),
                      "optimized_median_seconds": round(a, 4),
                      "speedup": round(b / a, 2), "elapsed_reduction_percent": round((1 - a / b) * 100, 1)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-file", required=True)
    parser.add_argument("--count", type=int, default=3597)
    parser.add_argument("--latency-ms", type=float, default=30)
    parser.add_argument("--rounds", type=int, default=5)
    args = parser.parse_args()
    if not 0 <= args.count < 25000 or not 0 < args.latency_ms <= 1000 or not 1 <= args.rounds <= 20:
        parser.error("Use 0–24999 listings, 0–1000 ms latency, and 1–20 rounds")
    asyncio.run(main(args))
