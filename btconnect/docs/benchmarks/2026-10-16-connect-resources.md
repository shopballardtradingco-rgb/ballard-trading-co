# BTConnect resource ownership and scaling — October 16, 2026

Historical second-pass measurement at commit
`e94834fbb2f2c732799af39e7893037ffe609631`. Its 484-test count and remaining-work
section describe that candidate. The next pass is documented in the
[photo and batch workload report](2026-10-16-connect-workloads.md).

The owner requested stronger structure and performance without more features. This
second pass builds on the unmerged first performance candidate, commit
`51171adbebb7d0a033e1666ae6a2a068426b4c35`, in PR #8. It makes no production change,
marketplace write, paid API call or new service purchase. New photos are not used.

## Changes and boundaries

| Resource | Owner and lifetime | Limits and safeguards |
| --- | --- | --- |
| eBay HTTP client | One ASGI worker, opened before MCP sessions and closed after they drain | Eight connections, eight reusable idle connections, 15-second idle expiry |
| Authentication | Each individual adapter request | Fresh grant/scope checks; no client-level seller credentials, cookies or response cache |
| HTTP behavior | Existing reporting, OAuth, Sell and Trading adapters | Existing fixed endpoints, response validation, 20/30/45-second timeouts and no redirects/retries |
| Standalone adapters | Explicit pool context or a client scoped to one call | Never reuse sockets across event loops; no hidden global client |
| Photo downloads and optional AI | Their existing separate clients | Cannot borrow the eBay pool or credentials |
| Database reads/writes | Existing short snapshots and atomic write transactions | Non-unique indexes accelerate cleanup and pagination; existing keys and uniqueness constraints remain |

The network module owns resources, not business decisions. Endpoint restrictions,
scope requirements, approval checks and publication journals stay in their existing
adapters/services. No publication mutation is parallelized. The existing complete,
fresh active-feed scans remain in place before and after publication.

## Measurement method

Five repetitions in separate processes against the first candidate and this change.
The source snapshot matches that baseline's executable content; some unchanged
files have one extra terminal blank line from snapshot capture. Setup, database
seeding and test certificate generation are outside timed intervals.

Storage fixtures contain 1,000 or 10,000 encrypted draft-shaped records, one future
expiring token per ten drafts and three uniqueness claims per draft. Each repetition
performs 100 journal writes or 100 complete 20-row draft-page reads, including
decryption, at an 80%-through-the-catalog cursor. Timings are per operation.

Network fixtures use real HTTPX connections and verified TLS to a temporary local
server. A test-only request hook routes fixed eBay URLs to loopback; all credentials
and responses are synthetic. No external network request or artificial delay is
used. Twenty sequential reporting reads and a full 3,597-item/18-page Trading scan
exercise the real adapters, parser and pagination checks. Each sample starts with
a cold client and includes its creation and cleanup. TLS keys remain in temporary
directories. The same trust context is supplied to both versions; system trust-store
loading and WAN latency are not measured.

## Results

| Backend operation | First candidate median | This candidate median |
| --- | ---: | ---: |
| Journal write, 1,000 drafts | 0.326 ms | 0.203 ms |
| Draft page, 1,000 drafts | 1.501 ms | 0.449 ms |
| Journal write, 10,000 drafts | 1.239 ms | 0.209 ms |
| Draft page, 10,000 drafts | 23.093 ms | 0.480 ms |
| Twenty sequential local TLS reads | 77.58 ms | 25.34 ms |
| Full active scan over local TLS | 179.83 ms | 163.94 ms |

The active-scan latency samples overlap substantially. That small median difference
is not evidence of a reliable percentage improvement in scan time. Its consistently
reduced connection count is the stronger result. Raw samples are in
[the JSON report](2026-10-16-connect-resources.json).

| Operation | HTTP requests before/after | TLS connections before → after | HTTP clients before → after |
| --- | --- | --- | --- |
| Twenty sequential reads | 20 / 20 | 20 → 1 | 20 → 1 |
| Complete active scan | 18 / 18 | 18 → 4 | 18 → 1 |

Request volume is unchanged. These results do not measure actual eBay latency,
listing throughput, photo transfer or owner time, and must not be added to the
percentages from the earlier independent benchmark.

## Validation and rollout considerations

All **484 tests pass**, including eleven new cases covering actual TLS connection
reuse and the eight-request bound; no shared cookies or authentication; changed
tokens and revoked permissions; redirects/rate limits/uncertain writes without
retries; streamed-body limits and cancellation; ASGI cleanup; separate event loops;
and upgrades of existing encrypted data and reservations. Storage tests count SQLite
work instead of using brittle wall-clock thresholds. Existing approval, original-photo,
duplicate, partial-success, retry and publication reconciliation coverage passes.
Two pre-existing framework deprecation warnings remain.

The two additive indexes are built with `CREATE INDEX IF NOT EXISTS` at startup.
No data is rewritten, schema columns changed or uniqueness removed. The 10,000-draft
fixture grows from 16,023,552 to 18,980,864 bytes: **2.82 MiB** overhead. The first
startup takes a write lock while building indexes; release during an idle listing
window. Rollback code can safely retain both indexes. Keep the existing one-process,
one-replica deployment: pooling does not make multi-worker OAuth refresh safe.

HTTP pooling follows the [HTTPX client lifecycle](https://www.python-httpx.org/async/)
and [resource-limit](https://www.python-httpx.org/advanced/resource-limits/)
interfaces. TLS certificate checking remains enabled. Idle connections may be closed
by eBay; existing error handling and uncertain-write reconciliation remain the
authority. No automatic retry was added to mask a dropped connection.

## Reproduction

Use a development environment with the repository's test requirements installed:

```bash
git worktree add --detach /tmp/btconnect-first-pass 51171adbebb7d0a033e1666ae6a2a068426b4c35
python scripts/benchmark_connect_resources.py \
  --baseline-root /tmp/btconnect-first-pass --repeats 5
python -m pytest -q
```

Next measure large-original processing and event-loop delay, plus 100-item batch
serialization costs. Those are measurement tasks, not reasons to introduce a
background queue, image cache, database replacement or additional subscription.
