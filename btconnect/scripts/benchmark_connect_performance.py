"""Offline comparison of an exact baseline checkout and the current implementation.

Uses encrypted temporary SQLite databases, synthetic originals and a mock eBay
transport with fixed latency. No credentials, external requests or marketplace
writes. Setup is excluded from timings; no owner-throughput claim is implied.
"""
import argparse
import asyncio
from collections import Counter
import json
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time


def worker(args):
    root = Path(args.worker_root).resolve()
    sys.path[:0] = [str(root), str(root / "tests")]
    import httpx
    from types import SimpleNamespace
    from btco_ebay.config import ACCOUNT_SCOPE, INVENTORY_SCOPE, TRADING_SCOPE
    from btco_ebay.ebay import Ebay
    from btco_ebay.listing_drafts import ListingDraft, fingerprint
    from btco_ebay.selling import Selling
    from btco_ebay.listing_validation import prepare_text
    from test_listings import bundle
    from test_listing_batches import setup

    results = []
    for unrelated in (1000, 10000):
        with tempfile.TemporaryDirectory() as folder:
            fixture = bundle.__wrapped__(Path(folder))
            batches, fake, payload = setup(fixture, count=25)
            store = fixture[0].store
            with store.tx() as db:
                for i in range(unrelated):
                    store.put("benchmark", str(i), {"seller": "synthetic", "value": "x" * 200}, db=db)
            batches.submit("seller", payload)
            async def prepare_all():
                while (await batches.prepare("seller", "family", payload["batch_id"]))["continue_preparation"]:
                    pass
            asyncio.run(prepare_all())
            assert not fake.calls
            draft_id = payload["items"][0]["draft"]["draft_id"]
            expected = batches.review("seller", payload["batch_id"])
            # Count database transactions/cleanup without logging SQL or private values.
            import btco_ebay.store as storage
            connect = storage.sqlite3.connect
            counts = Counter()
            def counted(*a, **kw):
                counts["connections"] += 1
                db = connect(*a, **kw)
                def trace(sql):
                    if sql.startswith("BEGIN IMMEDIATE"):
                        counts["write_transactions"] += 1
                    if sql.startswith("DELETE FROM records WHERE expires"):
                        counts["expiry_cleanup_scans"] += 1
                db.set_trace_callback(trace)
                return db
            storage.sqlite3.connect = counted
            try:
                for operation, fn, iterations in (
                    ("saved_draft_read", lambda: fixture[0].get("seller", draft_id), 100),
                    ("review_25_items", lambda: batches.review("seller", payload["batch_id"]), 20),
                ):
                    samples = []
                    counts.clear()
                    for _ in range(args.repeats):
                        start = time.perf_counter()
                        for _ in range(iterations):
                            value = fn()
                        samples.append((time.perf_counter() - start) / iterations)
                        if operation.startswith("review"):
                            assert value == expected
                    results.append({"operation": operation, "unrelated_records": unrelated,
                        "median_seconds": statistics.median(samples), "samples_seconds": samples,
                        "counts_per_operation": {k: counts[k] / (args.repeats * iterations)
                            for k in ("connections", "write_transactions", "expiry_cleanup_scans")}})
            finally:
                storage.sqlite3.connect = connect

    async def network():
        with tempfile.TemporaryDirectory() as folder:
            fixture = bundle.__wrapped__(Path(folder))
            batches, fake, payload = setup(fixture, count=5)
            store = fixture[0].store
            policies = {k: {"marketplaceId": "EBAY_US"}
                for k in ("fulfillment_policy", "payment_policy", "return_policy")}
            policies["fulfillment_policy"]["shippingOptions"] = [{"optionType": "DOMESTIC",
                "costType": "FLAT_RATE", "shippingServices": [{"shippingCost": {"currency": "USD", "value": "5"}}]}]
            calls, running, peak = [], 0, 0
            async def upstream(request):
                nonlocal running, peak
                assert request.method == "GET"
                calls.append(request.url.path)
                running += 1
                peak = max(peak, running)
                try:
                    await asyncio.sleep(args.latency_ms / 1000)
                    path = request.url.path
                    for kind, data in policies.items():
                        if "/" + kind + "/" in path:
                            return httpx.Response(200, json=data)
                    if "/location/" in path:
                        return httpx.Response(200, json={"merchantLocationStatus": "ENABLED"})
                    if path.endswith("get_item_condition_policies"):
                        return httpx.Response(200, json={"itemConditionPolicies": [{"categoryId": "259104",
                            "itemConditions": [{"conditionId": "5000"}]}]})
                    if path.endswith("get_negotiated_price_policies"):
                        return httpx.Response(200, json={"negotiatedPricePolicies": [{"categoryId": "259104",
                            "bestOfferAutoDeclineEnabled": True}]})
                    raise AssertionError("Unexpected endpoint")
                finally:
                    running -= 1
            store.put("grant", "family", {"access_token": "synthetic-token", "expires_at": time.time()+3600,
                "refresh_expires_at": time.time()+7200,
                "consented_scopes": [ACCOUNT_SCOPE, INVENTORY_SCOPE, TRADING_SCOPE]})
            selling = Selling(Ebay(SimpleNamespace(), store, httpx.MockTransport(upstream)))
            for entry in payload["items"]:
                entry["draft"]["policies"]["snapshots_sha256"] = fingerprint(policies)
            draft = ListingDraft.model_validate(prepare_text(payload["items"][0]["draft"])[0])
            samples = []
            for _ in range(args.repeats):
                start = time.perf_counter()
                await selling.validate_policies("family", draft)
                samples.append(time.perf_counter()-start)
            results.append({"operation": "fresh_policy_validation", "median_seconds": statistics.median(samples),
                "samples_seconds": samples, "requests_per_operation": len(calls)/args.repeats,
                "peak_concurrent_requests": peak})
            # Real draft preparation, with fresh mock policy HTTP reads and empty fake inventory.
            samples, calls_before = [], len(calls)
            for i in range(args.repeats):
                batches, fake, payload = setup(bundle.__wrapped__(Path(folder) / f"batch-{i}"), count=5)
                batches.publisher.selling = selling
                for entry in payload["items"]:
                    entry["draft"]["policies"]["snapshots_sha256"] = fingerprint(policies)
                batches.submit("seller", payload)
                start = time.perf_counter()
                review = await batches.prepare("seller", "family", payload["batch_id"])
                samples.append(time.perf_counter()-start)
                assert len(review["listings"]) == 5 and not review["exceptions"] and not fake.calls
            results.append({"operation": "prepare_5_items", "median_seconds": statistics.median(samples),
                "samples_seconds": samples, "requests_per_operation": (len(calls)-calls_before)/args.repeats,
                "every_sample_creates_5_fresh_drafts": True})
    asyncio.run(network())
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-root")
    parser.add_argument("--worker-root")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--latency-ms", type=float, default=50)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 20 or not 0 < args.latency_ms <= 1000:
        parser.error("Use 1–20 repeats and positive latency up to 1000 ms")
    if args.worker_root:
        print(json.dumps(worker(args)))
        return
    if not args.baseline_root:
        parser.error("--baseline-root is required")
    all_runs = {}
    for name, root in (("baseline", args.baseline_root), ("candidate", Path(__file__).resolve().parents[1])):
        raw = subprocess.check_output([sys.executable, str(Path(__file__).resolve()), "--worker-root", str(root),
            "--repeats", str(args.repeats), "--latency-ms", str(args.latency_ms)], text=True)
        all_runs[name] = json.loads(raw)
    comparisons = []
    for before, after in zip(all_runs["baseline"], all_runs["candidate"]):
        assert (before["operation"], before.get("unrelated_records")) == (after["operation"], after.get("unrelated_records"))
        comparisons.append({"operation": before["operation"], "unrelated_records": before.get("unrelated_records"),
            "baseline_seconds": before["median_seconds"], "candidate_seconds": after["median_seconds"],
            "reduction_percent": 100*(1-after["median_seconds"]/before["median_seconds"])})
    print(json.dumps({"scope": "offline encrypted storage and mock HTTP; not owner productivity or live eBay",
        "repeats": args.repeats, "mock_latency_ms": args.latency_ms,
        "comparisons": comparisons, "runs": all_runs}, indent=2))


if __name__ == "__main__":
    main()
