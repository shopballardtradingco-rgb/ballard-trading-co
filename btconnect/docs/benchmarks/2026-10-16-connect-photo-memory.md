# Photo buffer lifetime — October 16, 2026

Scope: BTConnect 0.5.1 candidate only. Review found that validated image pixels
remained alive throughout encryption and storage. Pillow's normal context manager
closes the file but retains the decoded image core. Explicit `closing(...)` now
releases it after validation, also when decoding fails. Original JPEG/PNG bytes,
dimensions, checksums, encryption, quota, durable read-back and approvals are unchanged.
See [Pillow's image lifecycle](https://pillow.readthedocs.io/en/stable/reference/open_files.html#image-lifecycle).
The installed version used for source inspection and measurement was 12.3.0.

## Controlled results

Baseline: previous performance candidate
`88a1cfa17860d6ee13059a47e5b4ff1e0d63b51b`, with the bounded photo worker already in
place. Five interleaved repetitions per version and image, each in a fresh process.
Figures below are process RSS, not just image memory and not a hosting capacity cap.

| Measurement | Previous candidate | Buffer cleanup |
| --- | ---: | ---: |
| 12MP: maximum kernel process peak | 181.19 MiB | 145.08 MiB |
| 12MP: median sampled peak | 155.84 MiB | 145.14 MiB |
| 12MP: median ingestion time | 242.17 ms | 249.16 ms |
| 12MP: median maximum event-loop delay | 19.79 ms | 39.97 ms |
| 40MP: maximum kernel process peak | 247.12 MiB | 219.45 MiB |
| 40MP: median sampled peak | 233.38 MiB | 217.96 MiB |
| 40MP: median ingestion time | 201.80 ms | 208.17 ms |
| 40MP: median maximum event-loop delay | 12.35 ms | 18.66 ms |

This change lowers measured memory demand; it does **not** demonstrate a speed gain.
Median ingestion is about 6–7 ms slower and event-loop delay is higher in this run.
Keep that tradeoff visible in release review. No aggregate speedup is calculated
across the earlier reports: their process histories and fixtures differ.

## Method and limitations

- The 12MP JPEG is 3000×4000, quality 88, 9,993,736 bytes. The 40MP JPEG is
  5000×8000, quality 10, 4,406,828 bytes. Both use deterministic RGB noise, seed 42.
  Quality 10 keeps the second fixture within the existing 12 MB input limit while
  exercising the maximum accepted pixel count. They are not collectible evidence.
- Generate files in the parent process; run each measurement in a fresh child.
  Input reading and application/database setup precede timing. Invoke the actual
  registered `ingest_original_photo` MCP tool with a synthetic grant and fake
  download, using real decode, encryption, disk writes and durable read-back.
  Assert the stored bytes and SHA-256 match after every invocation.
- Sample `/proc/self/statm` every 2 ms and read `/proc/self/status` `VmHWM` after
  the call. Kernel process peaks include startup/input loading, but not fixture
  generation or a parent's pre-exec memory peak. RSS counters and polling can
  differ slightly; samples may miss brief allocations. Neither is a memory cap.
- Event-loop heartbeat interval is 5 ms; delay is lateness above that interval.
  CPU scheduling, allocator behavior and filesystem caching affect these small
  timing measurements. The full response/download latency is not measured.
- The exported baseline has 107 tracked files: 50 byte-identical to GitHub and 57
  differing only in terminal newlines from the earlier snapshot. No other
  difference exists; the baseline `photos.py` is byte-identical.
- Single-photo workloads only. Concurrent request buffers, repeated mixed photos,
  approval/preparation photo checks and hosted memory remain separate concerns.
  Decoded-image concurrency remains one per app; request buffering is not capped
  by that worker. No new replicas, services, paid calls or production writes.

[Raw samples and environment](2026-10-16-connect-photo-memory.json).

Reproduce with an export of the baseline commit:

```sh
.venv/bin/python scripts/benchmark_photo_memory.py --baseline-root /absolute/baseline --repeats 5
.venv/bin/python -m pytest -q
```

Three targeted regressions failed before the fix and pass after it: JPEG and PNG
decoded buffers are unavailable before encryption, original bytes remain exact,
and a decoder failure after pixel allocation releases its buffer without storing
an object or catalog record. Full candidate validation: **497 tests passed**.

Release assessment: ready for PR review, not deployed. Keep the existing idle-window
release and rollback procedure. Measure hosted mixed-photo memory and response times
after explicit deployment approval; new-photo owner productivity testing stays deferred.
