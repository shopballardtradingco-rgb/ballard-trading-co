# Fresh photo checks during preparation — October 17, 2026

BTConnect 0.5.2 candidate against deployed 0.5.1 commit
`656c0edca45cefe7ed99342bc8b6405cda42fdd9`. Synthetic draft-only workloads; no
marketplace writes, AI calls, owner photos, production data or additional services.

## Result

Five repetitions per version and workload. Elapsed time and maximum event-loop delay
are medians; memory is the highest sampled process RSS across the five runs.

| Five-draft workload | Deployed-code baseline | Candidate |
| --- | ---: | ---: |
| Ten small JPEGs: backend elapsed | 52.83 ms | 61.18 ms |
| Ten small JPEGs: maximum event-loop delay | 27.04 ms | 1.74 ms |
| Ten small JPEGs: sampled peak process RSS | 53.65 MiB | 56.98 MiB |
| Ten 12MP JPEGs: backend elapsed | 1,156.49 ms | 970.06 ms |
| Ten 12MP JPEGs: maximum event-loop delay | 687.63 ms | 32.23 ms |
| Ten 12MP JPEGs: sampled peak process RSS | 124.14 MiB | 153.45 MiB |
| Fresh original reads, either workload | 20 | 20 |
| Policy-validation calls, either workload | 1 | 1 |

The primary gain is server responsiveness during photo checks. Large-photo backend
time is also lower in this fixture. Small-photo execution is about 8 ms slower and
large-photo sampled peak memory is about 29 MiB higher. These tradeoffs remain part
of release review. Do not combine these numbers with earlier ingestion-only tests
or claim real-world listing productivity from them.

## Change and safeguards

Move preparation verification and ordinary draft saving through the existing
single-capacity photo worker. Apply the same worker to native draft validation and
private original retrieval, including its base64 encoding. This adds no worker pool,
tool or service. Each original is read and discarded in sequence; no byte cache.

Every prepared draft still checks its originals before upstream reads and checks
them again during save. The seller lock, atomic revision checks and uniqueness
reservations remain. New worker saves also recheck the seller's grant inside the
commit transaction. Revocation or an ownership mismatch prevents that commit.

Cancellation waits for in-flight work before releasing capacity and the outer batch
lock. If the save completed but its caller was cancelled, resume adopts the same
unchanged durable draft after fresh checks. Per-attempt batch checkpoints remain.
The existing 35-second preparation budget includes queue time; already-running work
must drain and may finish after the deadline. Publishing and approval are unchanged.

## Method

The script generates ten deterministic noisy JPEGs with seeds 0–9 and quality 88.
Small originals are 600×800; large originals are 3000×4000. It seeds real encrypted
storage and five complete synthetic drafts with two unique photos each. Generation,
ingestion and batch submission are excluded from the measured operation.

Measure one `ListingBatches.prepare` call, including policy/duplicate validation,
photo verification, draft saves, per-item batch writes and complete review assembly.
Upstream responses are immediate fakes; original reads, cryptography and SQLite are
real. Assert five successful drafts, no pending items/errors/approval and no eBay
writes on every run. All runs assert the same 20 fresh photo reads: 8,025,922 bytes
for the small workload and 199,866,338 bytes for the large workload.

A 5 ms heartbeat measures event-loop lateness. A separate sampler reads Linux
`/proc/self/statm` every 2 ms. Samples can miss transient allocations and include
the interpreter and retained fixtures, not just original bytes. Each version/workload
runs in a separate process with five fresh temporary stores; its default executor
and allocator may be warm after the first repetition. Versions run consecutively,
not interleaved. No artificial upstream sleep or production request timing is used.

The baseline export contains 111 tracked files: 54 byte-identical to GitHub and 57
with only terminal-newline differences from the earlier snapshot. No executable
behavior differs. Both benchmark versions receive the same synthetic seller grant.
Environment details, all input hashes and all samples are in the
[raw JSON](2026-10-17-connect-preparation.json).

```sh
.venv/bin/python scripts/benchmark_photo_preparation.py --baseline-root /absolute/0.5.1-export --repeats 5
.venv/bin/python -m pytest -q
```

## Verification and limits

**506 tests passed**, including nine new cases covering actual health requests while
preparing/saving/validating/retrieving originals, cancellation during verification
and save, recovery without duplicate saves, corruption after the first photo check,
and revocation during worker processing. The 100-item recovery test now requests
cancellation at the actual durable checkpoint instead of assuming when the first
await happens. Compilation and offline 0.5.2 wheel build passed; two existing
framework deprecation warnings remain. GitHub CI results are recorded in the PR.

This is not an end-to-end ChatGPT/eBay benchmark. It does not measure owner actions,
identification, pricing accuracy, full-volume concurrency or 100 large-photo drafts.
The worker bounds processing concurrency, not all request/response buffers. Approval,
publication and optional hosted research retain their existing synchronous checks.
New-photo acceptance remains deferred. Production stays on 0.5.1 until explicit
release approval; [release and rollback procedure](../releases/0.5.2.md).
