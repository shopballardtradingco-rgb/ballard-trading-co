# Independent policy-read scheduling — October 17, 2026

Scope: `get_listing_policy_options` / `Selling.policy_options`, on the undeployed
0.5.2 development branch. This follows the [photo-preparation pass](2026-10-17-connect-preparation.md).
Production is still 0.5.1. No live eBay request, photo upload, paid AI call,
marketplace write, deployment, service or subscription was used in this pass.

## Change and boundaries

Business-policy discovery formerly waited for each fulfillment, payment, return
and inventory-location GET in sequence, then category rules, then campaigns.
The first four independent reads now overlap. All four must finish successfully
before the optional category/campaign group starts. That group has at most three
requests in flight: two existing category reads and one sequential campaign pager.
The upper bound is four concurrent GETs per readiness invocation; it is not a
seller-wide rate limit. The existing production HTTP pool limit is unchanged.

Required-read errors drain the group before propagating, in the same field order
as before. An optional category/campaign failure still reports `unavailable`
without hiding business-policy data. Cancellation propagates through both levels
of request grouping and waits for children to finish. Each request retains its
fresh grant/scope check, fixed endpoint, timeout, no-redirect and no-retry behavior.
Campaign pagination stays sequential with its existing completeness, changing-total
and duplicate checks. Nothing is cached, and approval or publication is unchanged.

Tradeoff: up to four required GETs may already have started when one fails, where
the old implementation could stop after the first failed read. Failed groups also
wait for their remaining reads to drain. Successful request counts are unchanged;
request bursts are larger. No claim is made about live rate-limit frequency.

## Measurements

Five repetitions per version/workload, interleaving baseline/candidate order and
alternating which runs first. Real encrypted temporary SQLite grants, HTTP adapter,
response parsing, category/campaign validation and lifespan-owned HTTP client.
The upstream is an entirely local `httpx.MockTransport` with fixed delay per GET.
Fixture and client setup are excluded. Every paired run asserts exact complete
response equality, identical requested URLs and query parameters, expected request
count, no repeated request, and no unfinished handler.

| Workload | Baseline median | Candidate median | Change | GETs each |
| --- | ---: | ---: | ---: | ---: |
| One campaign page; no simulated latency | 3.973 ms | 3.985 ms | +0.012 ms | 7 |
| One campaign page; 50 ms per GET | 309.137 ms | 105.524 ms | 65.9% less elapsed | 7 |
| Three campaign pages; 50 ms per GET | 411.727 ms | 208.854 ms | 49.3% less elapsed | 9 |

Peak concurrent handler count rises from two to four. This is a scheduling
improvement under upstream latency, not reduced CPU work. The zero-latency control
shows essentially unchanged local overhead; sub-millisecond differences are not
meaningful speed claims. The three-page case has 201 synthetic campaigns and keeps
all three pagination requests in their original order.

This measures the policy discovery tool only. It does not measure every draft,
publication validation, real eBay/TLS latency, owner interactions or complete
listing productivity. It cannot establish a live throughput improvement. The
five-comic owner benchmark remains deferred until the owner supplies new photos.

Environment: Linux, Python 3.12.14, httpx 0.28.1, cryptography 46.0.7.
[Raw samples and response hashes](2026-10-17-connect-policy-readiness.json).

## Provenance and reproduction

Baseline: GitHub commit `7c8dd5bbea73e05795657841840f5660d6fdce6c`, exact
`btco_ebay/selling.py` blob `3893167d964f3dcc6e4b8048a014515ca4a1b107`.
The benchmark imports that adapter beside the candidate using the same unchanged
dependencies and records both source blob hashes. It rejects a different baseline.

In a normal Git checkout with that commit available:

```sh
git show 7c8dd5bbea73e05795657841840f5660d6fdce6c:btco_ebay/selling.py > /tmp/btco-policy-baseline.py
.venv/bin/python scripts/benchmark_policy_options.py --baseline-file /tmp/btco-policy-baseline.py
.venv/bin/python -m pytest -q tests/test_policy_options_performance.py
```

Ten new regression cases cover bounded overlap, fresh responses, 429/503 handling
without retries, draining both cancellation stages, independent optional failures,
revocation between groups, and rejection of a duplicate on the final campaign page.
Existing authenticated MCP coverage continues to verify the public tool contract
and sanitized optional errors. All 516 tests pass in 29.09 seconds, with two existing
framework deprecation warnings. Compilation and an offline wheel build also pass.
The test virtualenv lacks the build backend; packaging used the existing primary
runtime's setuptools 84.0.0 and wheel 0.48.0, without installing anything.
