"""Compare readiness scheduling with an exact baseline adapter; entirely offline.

Run from the repository with .venv/bin/python. Setup is excluded. Each sample
uses real encrypted grant reads, the HTTP adapter and a lifespan-owned client,
but the upstream is a fixed-latency MockTransport. No live eBay or AI calls.
"""
import argparse
import asyncio
from collections import Counter
from hashlib import sha1, sha256
from importlib import util
from importlib.metadata import version
import json
from pathlib import Path
import platform
import statistics
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]
from btco_ebay.selling import Selling
from test_policy_options_performance import adapter, response

BASELINE_COMMIT = "7c8dd5bbea73e05795657841840f5660d6fdce6c"
BASELINE_BLOB = "3893167d964f3dcc6e4b8048a014515ca4a1b107"


def git_blob(data):
    return sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


async def sample(selling_class, campaigns, latency_ms):
    running, peak, requests = 0, 0, []
    async def handler(request):
        nonlocal running, peak
        requests.append(str(request.url))
        running += 1
        peak = max(peak, running)
        try:
            await asyncio.sleep(latency_ms / 1000)
            return response(request, campaigns=campaigns)
        finally:
            running -= 1
    with tempfile.TemporaryDirectory() as folder:
        selling = adapter(Path(folder), handler, selling_class)
        async with selling.ebay.http.lifespan():
            start = time.perf_counter()
            result = await selling.policy_options("family")
            elapsed = time.perf_counter() - start
        assert running == 0
    count = 6 + max(1, (campaigns + 99) // 100)
    assert len(requests) == count and all(n == 1 for n in Counter(requests).values())
    assert result["promotion_campaigns"]["complete"] is True
    assert result["promotion_campaigns"]["total_matching"] == campaigns
    canonical = json.dumps(result, sort_keys=True, separators=(",", ":")).encode()
    return {"elapsed_seconds": elapsed, "get_requests": len(requests), "peak_inflight_reads": peak,
            "response_sha256": sha256(canonical).hexdigest()}, result, sorted(requests)


async def benchmark(args, baseline):
    workloads = []
    for label, campaigns, latency in (("zero_latency_control", 1, 0),
            ("one_campaign_page", 1, args.latency_ms), ("three_campaign_pages", 201, args.latency_ms)):
        samples = {"baseline": [], "candidate": []}
        expected_result = expected_requests = None
        order = []
        for repeat in range(args.repeats):
            names = ("baseline", "candidate") if repeat % 2 == 0 else ("candidate", "baseline")
            order.extend(names)
            for name in names:
                row, result, requests = await sample(baseline if name == "baseline" else Selling, campaigns, latency)
                if expected_result is None:
                    expected_result, expected_requests = result, requests
                assert result == expected_result and requests == expected_requests
                samples[name].append(row)
        workloads.append({"label": label, "campaign_count": campaigns, "latency_per_request_ms": latency,
            "run_order": order, "runs": {name: {"samples": rows,
                "median_seconds": statistics.median(row["elapsed_seconds"] for row in rows)}
                for name, rows in samples.items()}})
    return workloads


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-file", required=True)
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--latency-ms", type=int, default=50)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 10 or not 1 <= args.latency_ms <= 250:
        parser.error("Use 1–10 repeats and 1–250 ms latency")
    baseline_data = Path(args.baseline_file).read_bytes()
    if git_blob(baseline_data) != BASELINE_BLOB:
        parser.error("Baseline must be the exact selling.py blob from " + BASELINE_COMMIT)
    spec = util.spec_from_file_location("btco_ebay._benchmark_baseline_selling", args.baseline_file)
    module = util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = {"baseline_github_commit": BASELINE_COMMIT, "baseline_selling_blob": BASELINE_BLOB,
        "candidate_selling_blob": git_blob((ROOT / "btco_ebay/selling.py").read_bytes()),
        "scope": "offline policy readiness; synthetic GET latency; not full-listing or owner productivity",
        "environment": {"python": platform.python_version(), "httpx": version("httpx"),
                        "cryptography": version("cryptography"), "system": platform.system()},
        "repeats": args.repeats, "workloads": asyncio.run(benchmark(args, module.Selling))}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
