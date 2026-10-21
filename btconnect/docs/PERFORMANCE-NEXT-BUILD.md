# Next build: performance only

October 17 update: production is **0.5.1**, released through PR #8 with owner approval.
The **0.5.2 candidate** extends the existing bounded worker to fresh photo verification,
ordinary draft saves, and private photo reads. Preserve both integrity checks around
upstream validation, drain cancelled saves, and recheck seller authorization at commit.
See [current measurements](benchmarks/2026-10-17-connect-preparation.md) and
[release/rollback notes](releases/0.5.2.md). No new service, data migration or paid call.
This candidate is not deployed. New-photo acceptance and owner-time benchmarking stay
deferred. Approval and publication remain unchanged and require their existing gates.

The same candidate now overlaps independent policy-readiness GETs, bounded at four
per invocation, with sequential campaign pagination and fresh consent checks.
[Measured readiness](benchmarks/2026-10-17-connect-policy-readiness.md) falls from
309 to 106 ms at a controlled 50 ms upstream delay, using the same seven GETs and
returning identical data. This is discovery-stage evidence, not owner productivity.
Keep live timing and rate-limit observations for an approved release; a larger
request burst can finish faster but may have more in-flight reads when one fails.

The following October 16 notes describe the now-released 0.5.1 work:

October 16 update: [PR #8](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/8)
now adds read-only snapshots, bounded policy reads, application-owned HTTP pooling
and indexed storage access. See [first-pass measurements](benchmarks/2026-10-16-connect-performance.md)
and [resource/scaling measurements](benchmarks/2026-10-16-connect-resources.md).
497 tests passed for that release. New-photo acceptance and
owner-time benchmarking are deferred; no new feature is needed for this pass.

The [large-photo and 100-item pass](benchmarks/2026-10-16-connect-workloads.md) is also
complete: bounded photo worker, cancellation draining, per-item yields, fewer redundant
batch writes, and five preparation calls instead of 20 for 100 eligible drafts.
Release review also fixes decoded-photo buffer lifetime; [isolated measurements](benchmarks/2026-10-16-connect-photo-memory.md)
show lower process peaks with a small timing regression, explicitly recorded for review.
Next measure mixed large-photo batches on the existing hosted instance after release
approval, including RSS and health latency. Keep raw-photo checks and fresh publication
validation. Full batch-input normalization remains deferred: it would change durable
record formats for a subsecond local workload and complicate rollback. Do not add
replicas, databases or caches to hide unmeasured bottlenecks. The earlier inventory
measurement below remains historical.

Owner direction, October 13, 2026: the assisted automated listing workflow took
longer than manual posting. Pause feature additions and optimize elapsed time.
Prepare the next listing in its separate conversation. Do not use already listed
examples or the completed Shadowalker and MICRA copies for another publication test.

## First optimization

Publication scans the complete active inventory before writes and again after
publication. At the observed 3,597-listing size, each scan needs 18 pages. These
pages were read serially. Read page one to establish current bounds, then read
remaining pages in batches of at most four. Return records in page order.

Keep every request and both fresh scans. Reject changed totals, wrong page
numbers, incomplete pagination, missing records and duplicate item IDs. Drain
each batch before reporting a read failure, propagate rate limits without an
automatic retry, and cancel pending reads when the parent operation is cancelled.
No listing/photo writes are made concurrent. Draft revisions, approvals, photo
checksums, publication journals, retry behavior and Vault contracts are unchanged.

eBay documents a per-seller GetMyeBaySelling limit of 300 calls per 15 seconds:
https://developer.ebay.com/devzone/xml/docs/reference/ebay/getmyebayselling.html
This patch keeps the same request count and caps outstanding page reads at four.
Other traffic still counts toward provider limits; a 429 stops the scan.

## Measured result and limits

Controlled local benchmark against canonical main commit
`162b5319877cc5b677d1e97bc96e5c2cd7abaff4`, with 3,597 synthetic listings,
18 requests per scan, 30 ms simulated latency per request, median of five runs:

| Scan | Median elapsed |
| --- | ---: |
| Existing sequential implementation | 0.5466 s |
| Bounded parallel implementation | 0.1824 s |

Reduction: 66.6%; speedup: 3.0x. This is a synthetic read-stage benchmark, not a
production or full-listing speed claim. All 297 tests pass, including concurrency
bounds, out-of-order responses, last-page duplicates, incomplete feeds, rate-limit
handling, fresh re-reads and cancellation. No live listing was created to test this.

Reproduce after exporting the baseline publishing.py from that commit:

```sh
PYTHONPATH=. .venv/bin/python scripts/benchmark_active_reads.py --baseline-file /absolute/baseline-publishing.py
.venv/bin/python -m pytest -q
```

## Remaining performance work

Measure last original-photo receipt to complete review, and exact approval to
verified live item plus Vault. Separate owner response time from system time and
report recovery runs separately. Keep original-photo checks, exact approval,
duplicate protection and live read-back as acceptance requirements.

Profile original-file transfer round trips, repeated identity/pricing research,
preflight reads, publication, verification and Vault independently before choosing
the next optimization. Avoid re-fetching evidence already available in the same
unchanged intake; refresh time-sensitive marketplace evidence at the required
gate. Reuse the stored job and uploaded originals after an interrupted attempt.

The operator workflow also needs less overhead: use a concise complete listing
review tied to the saved revision and the available originals; do not generate
large downloadable reports or duplicate photo copies for every ordinary listing
unless requested or needed to make its exact content reviewable. Use explicit chat
approval if the existing button fails. Button redesign and other new features are
outside this performance build.

Production timing remains an acceptance gate. A successful unit benchmark does
not establish that the workflow beats manual listing. Keep rollout separate from
the next listing conversation so the currently deployed connector is not changed
mid-publication.

