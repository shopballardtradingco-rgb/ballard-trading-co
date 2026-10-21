# Large originals and 100-item batches — October 16, 2026

Third performance pass in PR #8, against second-pass commit
`e94834fbb2f2c732799af39e7893037ffe609631`. No deployment, new photographs, real
inventory, paid AI, external requests or marketplace writes were used.

## Findings and implementation

Pillow decoding and encrypted original storage ran synchronously inside async upload
tools. A synthetic 12-megapixel JPEG blocked the event loop for roughly a quarter
second. Ingestion now submits the existing validate/encrypt/fsync/read-back operation
to a worker, with one capacity slot shared by native single/batch and raw uploads
within each app. Original bytes are never resized or re-encoded.

The worker retains its slot until completion even when its caller is cancelled
repeatedly. AnyIO cancellation is shielded only while draining; cancellation is
then re-raised. A cancelled queued call never begins. Authorization is checked again
inside the write transaction after expensive processing, so revocation during decoding
cannot authorize an object write. An interrupted request may finish storing its
original before returning cancellation; the existing photo catalog and content-addressed
retry make that result discoverable. No work is detached after cancellation returns.

Batch preparation already allowed up to 20 items but defaulted to five. The default
now uses 20, retaining the 35-second budget, individual durable checkpoints and
exception isolation. It yields after each completed attempt. The final save is omitted
when that item's checkpoint already persisted the metrics. Unresolved entries are
deterministic from saved input and can be recorded together. Every complete attempted
draft is still saved immediately, including failures and cancellation during an attempt.

Publication concurrency, approval revisions, original-photo checks and fresh policy,
promotion and duplicate checks before marketplace writes are unchanged. Preparation
may reuse checks for more items within one call; there is no cache across calls.

## Method

Five repetitions per version, separate processes, encrypted temporary SQLite stores.
Setup, synthetic image creation and batch submission are outside timed intervals.
The baseline snapshot has the same executable content as the GitHub commit; some
unchanged files have one extra terminal blank line from snapshot capture.

- **100 ready drafts:** 200 unique, small lossless PNG originals; fake policy and
  active-inventory adapters; normal preparation, storage, validation and complete
  reviews. Assert all 100 drafts ready, no exceptions, no approval and no writes to eBay.
- **100 unresolved entries:** saved explanations, no invented details, one full review.
- **Large original:** a 3,000 × 4,000 noisy JPEG, 9,993,736 bytes. Invoke the actual
  registered MCP ingestion tool with a fake download and synthetic authorized grant;
  verify the returned checksum and exact stored bytes. No decoding/crypto/storage mocks.

A 5 ms event-loop heartbeat records delay above its scheduled period. RSS is sampled
from `/proc/self/statm` about every 2 ms by a separate thread, including native image
allocations. Sampling can miss brief peaks, especially while the GIL is held. RSS
includes interpreter, dependencies, retained fixture allocations and input buffers;
it is not isolated image memory or a guaranteed production memory ceiling.

The batch driver invokes preparation calls consecutively, without ChatGPT/network
gaps. Raw batch heartbeat delays therefore describe this continuous service workload,
not the delay of one production MCP request. The photo delay is measured within one
ingestion call. HTTP tests separately verify that health requests complete while
each of the three ingestion routes is processing an original.

## Results

| Workload | Previous median elapsed | Candidate median elapsed |
| --- | ---: | ---: |
| 100 ready drafts | 711.4 ms | 470.7 ms |
| 100 unresolved entries | 55.91 ms | 1.84 ms |
| 12MP original ingestion | 237.7 ms | 217.7 ms |

The photo improvement primarily concerns responsiveness, not a faster decoder.
Median maximum event-loop delay for the photo fell from **232.9 to 22.9 ms**.
The modest total processing difference should not be treated as a reliable image
throughput gain. Sampled maximum process RSS for the photo increased from
**205,504,512 to 215,969,792 bytes** (about **196 → 206 MiB**). The worker bounds decoded
image concurrency; it does not cap every HTTP request's retained input buffers.

| Deterministic work | Previous | Candidate |
| --- | ---: | ---: |
| Preparation calls for 100 ready drafts | 20 | 5 |
| Shared policy-validation invocations in that fixture | 20 | 5 |
| Durable batch saves for 100 ready drafts | 120 | 100 |
| Batch JSON bytes encrypted, approximate | 28.10 MB | 23.39 MB |
| Batch saves for 100 unresolved entries | 101 | 1 |
| Batch JSON bytes encrypted, unresolved | 2.12 MB | 25.4 KB |

The fewer calls are automatic service/tool continuations, not measured owner actions.
Actual ChatGPT delays, downloads, eBay latency, complex mixed conditions, 100 large
phone images and real owner throughput are not represented. Smaller chunks still
result when the time budget is exhausted. [Raw measurements](2026-10-16-connect-workloads.json)
include samples, heartbeat delays, RSS and work counts.

## Validation and limits

All **494 tests pass**. Ten new cases cover repeated cancellation, cancelled queues,
worker failure while cancelled, AnyIO cancellation, health responsiveness on all
three upload routes, revocation during processing, recovery from cancellation after
the first of 100 durable drafts, unchanged unresolved reviews and deadline handling.
Existing original-photo integrity, quota, OAuth, approval, duplicate, publishing and
reconciliation tests pass. Two existing framework warnings remain.

The current stored batch format still repeats immutable input in each checkpoint.
This pass reduces unnecessary copies without a new record format or migration.
Normalizing it further is deferred because the measured workload is subsecond and
format changes would complicate rollback. Photo verification during preparation and
publication remains synchronous and fresh; only ingestion is moved to the worker.
Filesystem stalls and SQLite commit contention can still affect response times.

No new process, hosted service or dependency download is needed. AnyIO's existing
locked version is declared explicitly for [cancellation shielding](https://anyio.readthedocs.io/en/stable/cancellation.html#shielding).
Keep the existing one-worker/one-replica deployment. This remains an undeployed
candidate; after release approval, measure real mixed-photo RSS and health latency
before expanding concurrency or changing storage architecture.

## Reproduction

Install the repository's existing development/test requirements, then:

```bash
git worktree add --detach /tmp/btconnect-second-pass e94834fbb2f2c732799af39e7893037ffe609631
python scripts/benchmark_connect_workloads.py \
  --baseline-root /tmp/btconnect-second-pass --repeats 5
python -m pytest -q
```
