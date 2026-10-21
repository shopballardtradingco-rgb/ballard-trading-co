# BTConnect performance comparison — October 16, 2026

Historical first-pass measurement, candidate commit
`51171adbebb7d0a033e1666ae6a2a068426b4c35`. The subsequent resource-lifetime and
index changes have [separate measurements](2026-10-16-connect-resources.md).
The statements and 473-test count below describe that first candidate.

The owner deferred new photographs and requested performance-only work. This
comparison uses no production inventory, credentials, external requests, paid AI,
listing approvals or marketplace writes. Production is unchanged by this branch.

Baseline: deployed 0.5.0 source at
`3ed24729b82b343d8eb7edc158af7dede086b78d`, tree
`9ee30145e476f0e82f105d548b5a9666c44d1ead`. Candidate: 0.5.1 on
`codex/connect-performance-2026-10-16`. The raw timings and operation counts are in
[the JSON report](2026-10-16-connect-performance.json).

## Method

Run the same harness in separate Python processes against an exact baseline source
checkout and the candidate. Use encrypted temporary SQLite databases and synthetic
front/back originals. Setup/seeding/photo creation is excluded from timings.
Storage runs seed 1,000 or 10,000 unrelated permanent encrypted records, prepare a
25-item batch, then measure 100 individual draft reads or 20 complete batch reviews
per repetition. Five repetitions are reported as medians and raw samples.

Network runs use the real Selling adapter and validation logic over a mock HTTP
transport with a fixed **50 ms delay per request**, five repetitions. Six GETs
verify fulfillment/payment/return policies, location and category conditions/offer
rules. Five-item preparation creates five fresh saved drafts in each repetition,
with shared policy settings, synthetic originals and an empty simulated active
inventory feed. No model identification, live sales research, actual upload delay,
large active-feed scan, ChatGPT latency or owner decision time is included.

## Results

| Operation | Fixture size | 0.5.0 median | Candidate median | Lower elapsed time |
| --- | --- | ---: | ---: | ---: |
| Read one saved draft | 1,000 unrelated records | 0.288 ms | 0.122 ms | 57.8% |
| Review 25 saved items | 1,000 unrelated records | 11.00 ms | 3.07 ms | 72.1% |
| Read one saved draft | 10,000 unrelated records | 1.267 ms | 0.128 ms | 89.9% |
| Review 25 saved items | 10,000 unrelated records | 32.74 ms | 2.88 ms | 91.2% |
| Fresh policy validation | Six mock HTTP GETs | 308.2 ms | 155.9 ms | 49.4% |
| Prepare five fresh drafts | Same mock delay | 319.5 ms | 167.5 ms | 47.6% |

These are reductions for the named backend operations. The absolute saved time is
small for storage and depends on database size. They do not establish a percentage
improvement in the owner's listing productivity or live eBay speed.

Deterministic work removed:

- One draft read: one writer transaction and expiry scan → neither.
- One 25-item review: 26 connections, writer transactions and expiry scans → one
  read-only snapshot, no writer transactions or expiry scans.
- Fresh policy validation: six HTTP requests in both versions. Peak concurrent
  requests increases from one to three; independent waits overlap. Request volume,
  scope checks, response validation and publication freshness remain intact.

## Safeguards and limits

All **473 tests pass**, including seven new cases for reserved-writer contention,
expiry/pagination, atomic single-use consumption, revocation, consistent review
during a concurrent update, drained read failures and propagated cancellation.
Existing approval, stale-revision, photo integrity, duplicate, retry and publication
reconciliation tests pass. Two pre-existing framework deprecation warnings remain.

Read snapshots are short and end before network calls. No schema, journal-mode,
storage, OAuth or encryption change is required. Expired records remain inaccessible
immediately, but physical cleanup now occurs on the next actual write/startup rather
than on an ordinary read. No decrypted record or policy response is cached between
requests. Approval still executes in its original write transaction.

Policy groups issue up to three independent GETs at once; on an early failure the
other reads may already be in flight. The group drains them before returning the
original typed error. HTTP 429 is not retried automatically. No publishing or other
marketplace mutation was parallelized. Live rate limiting and network conditions
remain factors to observe during a separately approved deployment.

## Reproduction

From the candidate checkout, after installing its test requirements:

```bash
git worktree add --detach /tmp/btconnect-050 3ed24729b82b343d8eb7edc158af7dede086b78d
PYTHONPATH=. python scripts/benchmark_connect_performance.py \
  --baseline-root /tmp/btconnect-050 --repeats 5 --latency-ms 50
python -m pytest -q
```

The baseline archive used in this session contains the same reviewed source tree;
the working snapshot's local commit identity differs from GitHub history. Timing
values naturally vary by machine. Transaction/connection/request counts should not.

## Remaining performance work

Profile connection setup and photo decrypt/decode costs with representative file
sizes before introducing shared HTTP-client lifetimes or cached image validation.
Measure full active-inventory scans and actual ChatGPT tool-call overhead when a
listing session is available. Keep fresh checks before publication; do not trade
duplicate safety, approval integrity or original-photo integrity for benchmark speed.
No further identification tuning is included in this performance pass.
