"""Reproducible offline five-comic preparation/retry benchmark.

Synthetic images/facts and simulated eBay reads only. Not a real identification,
pricing, owner-interaction or production-throughput benchmark. Run with PYTHONPATH=.
"""
import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from test_listings import bundle
from test_listing_batches import setup
from test_comic_intake import intake_from_drafts
from btco_ebay.comic_intake import ComicIntake, compile_intake
from btco_ebay.listing_batches import ListingBatches


async def measure(batch_class, candidate, latency):
    with tempfile.TemporaryDirectory() as folder:
        fixture = bundle.__wrapped__(Path(folder))
        original, fake, payload = setup(fixture, count=5)
        # Four ordinary Good books and one Acceptable book, the latter requiring
        # a distinct policy check that fails once. No real book scarcity inferred.
        payload["items"][4]["draft"]["condition"] = "USED_ACCEPTABLE"
        inputs = intake_from_drafts([e["draft"] for e in payload["items"]], payload["batch_id"])
        batches = batch_class(original.repo, original.publisher)
        read_counts = {"policies": 0, "campaigns": 0, "active": 0, "originals": 0}
        failing = True
        async def policy(family, draft):
            nonlocal failing
            read_counts["policies"] += 1
            await asyncio.sleep(latency)
            if draft.condition == "USED_ACCEPTABLE" and failing:
                failing = False
                raise ValueError("Synthetic transient policy read failure")
        async def campaign(*args):
            read_counts["campaigns"] += 1
            await asyncio.sleep(latency)
        async def active(*args):
            read_counts["active"] += 1
            await asyncio.sleep(latency)
            return []
        fake.validate_policies, fake.validate_promotion = policy, campaign
        original.publisher.active = active
        photo_get = original.repo.photos.get
        def counted(*args):
            read_counts["originals"] += 1
            return photo_get(*args)
        original.repo.photos.get = counted
        start = time.perf_counter()
        if candidate:
            compiled, issues = compile_intake(ComicIntake.model_validate(inputs))
            assert not issues
            data = compiled.model_dump(mode="json")
        else:
            # Baseline starts with already-written complete drafts. Their authoring
            # time is unknown and is deliberately NOT imputed as a saved cost.
            data = payload
        batches.submit("seller", data)
        first = await batches.prepare("seller", "family", payload["batch_id"])
        initial_s = time.perf_counter() - start
        assert len(first["listings"]) == 4 and len(first["exceptions"]) == 1
        before = dict(read_counts)
        start = time.perf_counter()
        final = await batches.prepare("seller", "family", payload["batch_id"])
        retry_s = time.perf_counter() - start
        assert len(final["listings"]) == 5 and not final["exceptions"] and not fake.calls
        return {"initial_seconds": initial_s, "retry_seconds": retry_s,
                "total_seconds": initial_s + retry_s,
                "seconds_per_saved_draft": (initial_s + retry_s) / 5,
                "retry_reads": {key: read_counts[key] - before[key] for key in read_counts},
                "request_bytes": len(json.dumps(inputs if candidate else payload).encode()),
                "ready": 5, "injected_failures": 1, "retry_calls": 1, "ebay_writes": 0,
                "owner_interactions_measured": None, "identification_accuracy_measured": None,
                "pricing_accuracy_measured": None}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-file", required=True)
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--latency-ms", type=float, default=30)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("btco_ebay._baseline_batches", args.baseline_file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    runs = {"baseline": [], "candidate": []}
    for _ in range(args.repeats):
        runs["baseline"].append(await measure(module.ListingBatches, False, args.latency_ms / 1000))
        runs["candidate"].append(await measure(ListingBatches, True, args.latency_ms / 1000))
    summary = {}
    for name, values in runs.items():
        summary[name] = {**values[0], **{
            key: statistics.median(v[key] for v in values)
            for key in ("initial_seconds", "retry_seconds", "total_seconds", "seconds_per_saved_draft")}}
    print(json.dumps({"scope": "synthetic local preparation and retry only", "repeats": args.repeats,
                      "simulated_read_latency_ms": args.latency_ms, "summary": summary, "runs": runs}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
