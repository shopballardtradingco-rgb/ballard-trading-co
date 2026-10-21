# Five-comic evidence and benchmark — 2026-10-15

**No end-to-end productivity improvement is established.** Read-only validation of
five historical records, an offline preparation/retry comparison and a subsequently
authorized real-photo API replay were performed. None substitutes for the requested new
common/variant/older/scarce/difficult-comic trial against a timed manual baseline.

## Hosted API follow-up after key/budget approval

The optional hosted research path passed 33 new offline tests. One actual API call
using two synthetic solid-color images completed in 12.580073 seconds, 6,547 input
tokens, 337 output tokens, zero web calls, estimated $0.006427. It correctly returned
unknown identity, no condition, no price and no sources. No collectible accuracy or
listing productivity score can be derived from that abstention test.

The owner subsequently explicitly approved archived-original egress. The
[five-comic real-photo API replay](2026-10-15-archived-research.md) returned five
proposals in 128.916933 seconds elapsed (101.484028 service seconds), with only 3/5
supported complete core identities, one confirmed false condition claim and zero
verified sold comparables. The archive's Elementals identity itself conflicted
with its cover. Archived validation below was schema validation, not proof of facts.

Two diagnostic failures drove source-isolation and budget-overrun fixes; all 447
tests now pass. Total estimated completed pilot usage is $0.352862 plus an earlier
$1 uncertain reservation, leaving $3.647138 of the $5 limit. The reservation is
not a confirmed charge. No production record was changed or new listing prepared.

## Real stored-record replay (live 0.4.1, read-only)

Selected five existing comic drafts with matched original-photo references. Every
record explicitly leaves printing and variant unknown. Existing publication state
was inspected only; these physical copies must not be republished as test stock.

| Historical comic | Read saved record / live diagnostic | Initial validator | Result | In-memory correction validation |
| --- | ---: | ---: | --- | ---: |
| Elementals #6 (1986) | 4.627 s | 0.436 s | Missing newer exterior disclosure | 0.609 s — pass |
| Journey #2 (1983) | 0.430 s | 0.436 s | Missing newer exterior disclosure | 0.432 s — pass |
| Kid Eternity #1 (1993) | 2.157 s | 0.434 s | Pass | Not needed |
| Nestrobber #1 (1992) | 3.238 s | 0.503 s | Pass | Not needed |
| The Final Cycle: Part 1 #3 (1987) | 11.705 s | 0.404 s | Pass | Not needed |

Measurements are client wall time per tool call, including transport. Some record
reads also diagnose stored eBay offers; these reads do not have identical workloads.
Sum of measured tool-call durations: **25.411 s**, or **5.082 s per record**. This
excludes gaps between calls, research, photography, drafting and owner review; it
is **not total listing time**. Initial validations: 3/5 passed; two text corrections
and two revalidations produced 5/5 valid in-memory candidates. No transport failure
or retry was observed. Original-byte integrity is checked by the live validator.

Correction: append “Page quality, hidden defects, and the presence of inserts,
cards, posters or other extras are unverified.” to the two candidate descriptions.
No corrected candidate was saved or approved. Historical approvals and records
were preserved; these results do not require changing an already published listing.

Owner interactions/manual steps during replay: zero, because historical inputs were
reused. This says nothing about real listing effort. Independent identity accuracy,
condition accuracy and pricing accuracy were **not measured**; stored facts are
not ground truth and no fresh comparable sales were researched in this replay.

| Required representative slot | Available evidence | Acceptance |
| --- | --- | --- |
| Common | Stored ordinary back issues | Schema/original validation only; new-item trial pending |
| Variant | All five identities explicitly have variant unknown | No verified variant selected; blocked |
| Older | Stored 1983/1986/1987 examples | Schema/original validation only; fresh identity review pending |
| Scarce | No verified scarcity evidence in this selection | Blocked; obscure is not proof of scarce |
| Difficult to identify | Stored Final Cycle reference describes issue/publisher verification | Historical evidence only; no fresh blind identification test |

## Offline comparison against audited main

Baseline: `c8b874b4777dee00ab0801a09f3ef2d8542550c5` `listing_batches.py`.
Candidate: this branch. Python 3.12, identical local runtime dependencies, five
synthetic comic/photo pairs in temporary encrypted stores, five alternating runs,
30 ms simulated latency per policy/campaign/active-feed read. Four Good books and
one Acceptable book; the latter's policy read fails once. Both implementations
finish 4/5 initially and 5/5 after one explicit resume. Zero eBay writes.

The baseline starts with already authored full drafts; that authoring time is
unknown and excluded. The candidate includes schema parsing and deterministic
assembly. Input preparation and synthetic photo creation are outside both timers.
This comparison isolates server preparation/recovery, not intelligence or owner UI.

| Metric (median of five runs) | Baseline | Candidate |
| --- | ---: | ---: |
| Initial prepare, including one injected exception | 0.1483 s | 0.1559 s |
| Resume after exception | 0.1441 s | 0.1062 s |
| Prepare + resume total | 0.2923 s | 0.2594 s |
| Time per saved draft | 0.0585 s | 0.0519 s |
| Remote reads on resume | 4 | 3 |
| Original reads on resume | 12 | 4 |
| Input JSON bytes | 10,331 | 7,629 |
| Injected failures / resume calls | 1 / 1 | 1 / 1 |

Measured synthetic retry reduction: **26.3%**; prepare-plus-retry reduction:
**11.3%**. Initial preparation showed no meaningful speed improvement. These
numbers do not predict eBay latency or claim a faster real listing workflow.
Owner interactions and identification/pricing accuracy are null, not zero/100%.
Raw synthetic runs: [JSON](2026-10-15-synthetic-intake.json).

Reproduce with the baseline exported outside the repository:

```sh
git show c8b874b4777dee00ab0801a09f3ef2d8542550c5:btco_ebay/listing_batches.py > /tmp/btco-baseline-batches.py
PYTHONPATH=. .venv/bin/python scripts/benchmark_comic_intake.py --baseline-file /tmp/btco-baseline-batches.py
```

## Required acceptance run

Use five new, explicitly selected physical comics and exact front/back/detail
originals, covering the five slots above. Record ground-truth identity/condition
and independently supported price ranges before scoring accuracy. Time the same
listing content through manual and BTConnect paths; distinguish owner active time,
waiting, system time and retries. Record all corrections, exceptions, actual owner
messages/clicks and per-draft timestamps. Hold unknown variants/printing/scarcity.
Recover the batch in a fresh ordinary Chat. Only after full owner review and exact
publication approval may a separate live pilot measure verified item IDs and Sync.

Originals for the archived replay were authorized, but no new representative
selection or timed manual baseline was supplied for this task. No owner
listing approval was requested from historical/replay outputs. Publishing test:
**not run**. P0 performance gate: **open**.
