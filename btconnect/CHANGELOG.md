# 0.6.5 — 2026-10-23 Pacific

- Accept original JPEG/MPF photos with one auxiliary image, validating both pictures without modifying original bytes or hashes. Retain single-frame PNG and resource limits.
- Fix the reproduced Core photo-transfer rejection; see docs/releases/0.6.5.md.

# 0.6.4 — 2026-10-23 Pacific

- Give browser consent a visible eBay sign-in link so an external form redirect cannot strand the saved selection. Preserve non-browser redirects and all existing authorization checks.
- Name BTCore correctly on its consent page. See docs/releases/0.6.4.md.

# 0.6.3 — 2026-10-23 Pacific

- Keep the configured Core callback origin in the consent GET/POST redirect policy. Retain exact callback checks and existing listing approval.
- See docs/releases/0.6.3.md for the connection repair and remaining live acceptance.

# 0.6.2 — 2026-10-22 Pacific

- Raise the encrypted-photo ceiling from 300 MB to 400 MB on the existing volume. Preserve the independent 50 MB disk reserve, original integrity, duplicate behavior and all approvals.
- Readiness still reports the smaller of quota and disk headroom. No volume resize, subscription, storage migration or listing change.
- See docs/releases/0.6.2.md for capacity sizing and acceptance.

# 0.6.1 — 2026-10-22 Pacific

- Report measured encrypted-photo usage, remaining quota, free disk and upload headroom through existing authenticated readiness. Measure off the event loop; retain the 300 MB quota and 50 MB disk reserve.
- Return unavailable capacity when filesystem measurement fails, with no private paths. Readiness reserves no bytes; uploads still enforce capacity independently.
- Correct stale descriptions of the supported automatic 5% campaign and card publishing contracts. No marketplace behavior, original bytes or approvals change.
- See docs/releases/0.6.1.md and docs/NEXT-COMIC-BATCH.md for preparation and remaining acceptance.

# Core staged-card handoff — 2026-10-22

- Import verified Core-only staged cards and original photos into the recovered GitHub publication journal using the existing batch engine.
- Preserve exact physical identities, master SKUs and saved publication history across imports/restarts; reject conflicting snapshots and never infer approval.
- See docs/releases/core-handoff-2026-10-22.md for the paired Core exporter and operational prerequisites. No live listing or inventory mutation is claimed.

# Recovery security maintenance — 2026-10-21 Pacific

- Redact eBay developer and store encryption secrets from settings diagnostics.
- Reject new listing approvals on reruns or when the triggering actor differs from the owner.
- Pin workflow actions and stop retaining checkout credentials. Preserve the existing publisher, exact approval and journal recovery.
- See docs/releases/recovery-security-2026-10-21.md; no live activation or listing change is claimed.

# Independent publisher execution — 2026-10-22

- Run the existing saved-batch publisher on GitHub Actions without a hosted Core/Connect API or Railway connection. Require exact-source CI and exact listing approval.
- Restore and synchronously checkpoint the same encrypted publication journal and original objects in a private state branch. Stop the whole runner on unconfirmed persistence; preserve unknown outcomes across runner loss.
- Add recovery seeding with original-hash verification and an automatic names-only configuration check. No live activation, credentials, state migration or listing approval is included. See `docs/releases/independent-publisher-2026-10-22.md`.

# 0.6.0 — 2026-10-20

Card listing contracts, condition descriptors, existing batch publisher support and exact standalone Core OAuth callback.

# Changelog

## 0.5.2 — responsive photo checks and policy readiness (undeployed candidate, October 17)

- Overlap independent policy-readiness GETs in two bounded groups: four required business-policy/location reads, then up to three category/campaign reads. Preserve fresh per-request consent, sequential campaign pagination, optional-error reporting and cancellation draining. The successful seven-GET benchmark falls from 309 to 106 ms with fixed 50 ms upstream latency; zero-latency overhead is essentially unchanged. Failed groups may issue more reads before stopping. See [readiness measurements](docs/benchmarks/2026-10-17-connect-policy-readiness.md). All 516 tests, compilation and the offline package build pass.
- Use the existing single-capacity photo worker for draft-preparation verification and saving, ordinary draft saves, draft validation, and private original retrieval including base64 encoding. Preserve both fresh preparation/save checks; do not cache decrypted bytes or broaden publication concurrency.
- Drain an in-flight save before returning cancellation or releasing the batch lock. A completed save whose response was cancelled is adopted on resume without duplicating the draft or clearing its journal. Retain per-attempt checkpoints, input revisions, uniqueness claims and the existing preparation budget.
- Recheck the seller's connection in the draft commit transaction, preventing a revoked or mismatched grant from authorizing a later worker save. Approval/publication paths are unchanged.
- Correct the preparation tool description to its existing 20-attempt limit. Version and health identify the candidate as 0.5.2. See [measurements and limitations](docs/benchmarks/2026-10-17-connect-preparation.md).

## 0.5.1 — hosted performance (released October 16)

- Make ordinary encrypted-record reads read-only, without taking the SQLite writer lock or scanning expired records. Expiry remains enforced; secure physical cleanup stays in actual write transactions. Single-use token consumption and revocation remain atomic/fresh.
- Read each complete batch review through one consistent database snapshot. A 25-item review uses one connection instead of 26, with no expiry scans or write transactions.
- Run three independent policy GETs together and two category-rule GETs together. All responses are checked, all reads finish before errors return, and cancellation reaches every request. No cross-request cache, automatic retries or concurrent marketplace writes.
- Controlled five-repeat comparison against deployed 0.5.0: five fresh drafts 319.5 → 167.5 ms with 50 ms mock HTTP delay; 25-item review with 10,000 unrelated records 32.74 → 2.88 ms. These are backend fixture measurements, not live eBay throughput or owner time. Both versions make the same six policy HTTP requests.
- Own one bounded eBay HTTP connection pool per ASGI worker. Reporting, OAuth, Trading and Sell adapters reuse sockets; request credentials remain separate, cookies are rejected, redirects stay disabled, and no retries are introduced. Shutdown drains MCP sessions before closing the pool. Preserve standalone/test calls without sharing sockets across event loops.
- Add an expiry-range index and a seller/draft catalog index in place. Existing records and uniqueness constraints are preserved. Against the first candidate, 10,000-draft fixture journal writes fell from 1.239 to 0.209 ms and a 20-draft page from 23.09 to 0.480 ms. Index overhead is 2.82 MiB in that fixture. Twenty real loopback-TLS reads use one connection instead of 20; a full 18-page active scan uses four instead of 18, retaining all requests. See [second-pass measurements](docs/benchmarks/2026-10-16-connect-resources.md).
- Move original-photo ingestion off the event loop through one bounded worker per app. Drain in-flight work before cancellation returns, including repeated asyncio and AnyIO cancellation; cancelled queued work never starts. Recheck the grant inside the photo commit transaction. Keep byte validation, encryption, fsync, quota enforcement and independent durable read-back.
- Prepare up to 20 drafts per call within the existing 35-second budget. Yield after each durable attempt, remove redundant final saves and combine unchanged unresolved-result bookkeeping. The 100-ready fixture uses five calls instead of 20, 100 batch saves instead of 120, and takes 471 ms instead of 711 ms. The 12MP ingest fixture's event-loop delay falls from 233 to 23 ms, with sampled peak RSS rising from 196 to 206 MiB. These are controlled measurements; see [workload results](docs/benchmarks/2026-10-16-connect-workloads.md).
- Release decoded-image buffers before encryption, including decoder failures. In five isolated repetitions, maximum kernel process RSS falls from 181.19 to 145.08 MiB for a 12MP JPEG and from 247.12 to 219.45 MiB for a 40MP JPEG. Median ingestion is 6–7 ms slower; this is a memory improvement, not a speed claim. See [photo-memory results](docs/benchmarks/2026-10-16-connect-photo-memory.md).
- 497 regression tests pass, covering prior guards plus cancellation-safe worker capacity, responsive health requests, revocation before photo commit, 100-draft recovery, unresolved reviews, preparation deadlines and decoded-buffer cleanup. No production data, credentials, AI budget, listing approvals or deployments changed. Two pre-existing framework warnings remain.

## 0.5.0 — Connect-first preparation (released October 16)

- October 16 priority: release Work-independent comic execution with hosted AI optional/off; identification tuning and the five-comic productivity comparison remain follow-ups. Add the existing-service rollout and regular-Chat acceptance procedure.
- Correct saved research directly with actual owner-supplied facts, retain originals, discard superseded price comparisons, and revise prepared drafts with stale-write checks that invalidate prior publication approval. Low AI confidence alone no longer blocks complete owner-confirmed facts.
- Add seller-scoped saved-research discovery across chats. Native MCP tests cover intake, assembly, restart/recovery, approval-controlled simulated publication, receipts and duplicate-safe repeat calls with hosted AI unconfigured. Full suite: 466 passed; no paid API calls or production changes in this follow-up.
- Add optional hosted photo analysis and web-sourced pricing proposals through the Responses API, with seller-bound originals, strict output validation and original bytes preserved.
- Separate catalog identity evidence from prices; isolate invalid sources with visible holds and remove automatic pricing. Persistently halt paid work on completed-tool/cost overrun before parsing. Record five authorized archived-photo API measurements and accuracy failures.
- Add issue-specific year consistency checks, leading-issue-marker normalization, guide-value rejection and condition holds for ambiguous artwork/marks. Same-five retest still fails acceptance and over-flags negative condition wording; 459 tests pass. Keep low reasoning after a measured medium-reasoning timeout, retaining the full reservation.
- Persist research results and immutable request IDs. Cap pilot spending with a nonrenewing encrypted ledger, conservative reservations, no automatic retries and no redirect forwarding.
- Require exact-revision owner confirmation of research before assembling drafts; missing required facts need explicit corrections. Final publication approval remains separate and unchanged.
- Assemble individualized comic drafts on the existing service from matched original refs, explicit identity/condition evidence and price research; share shipping/policy settings once per batch.
- Preserve whole-dollar prices, explicit offer floors, stable photo-derived IDs/SKUs, exact CDP identities and physical locations. Isolate incomplete observations and keep their correction inputs.
- Save pricing evidence in the full, revision-bound review; never treat asking prices as sold comps or research metadata as buyer description.
- Bound preparation to five attempts / 35 seconds per call. Resume pending books before exceptions and retain unchanged successful drafts. Publication still performs fresh safety checks.
- Record preparation attempt timings, failures and cancellations. Add synthetic retry benchmark and read-only five-record production validation evidence.
- Dedicated development key, $5 total usage and up to five archived comics' original-photo egress authorized October 15. Estimated completed usage $0.538042 plus $2 uncertain reservations; $2.461958 remains. No new hosted service, subscription, database migration, automatic approval, deployment or marketplace write. Real-image/comps quality failed acceptance; card publishing, regular-Chat acceptance and external Vault Sync remain open.

## 0.4.1 — regular-Chat diagnostics and photo exception isolation

- Correct obsolete app-facing read-only guidance and document observed regular-Chat host errors.
- Add a server tool manifest to status, explicitly distinguishing advertisement from host callability.
- Isolate invalid photo download references without weakening URL checks or original-byte storage.
- Preserve existing connections, data, approval gates and BTCore.
- 377 local tests pass; five new comics and real regular-Chat acceptance remain pending.

## 0.4.0 — Connect Chat batch reliability (release candidate)

- Expose exact required disclosure text by field; preserve historical draft hashes.
- Recover seller-scoped stored originals and saved drafts without re-uploading.
- Persist comic batch inputs, physical location, revisions, exceptions and progress.
- Bind one atomic batch approval to a complete paginated review and explicit retry policy.
- Resume bounded publication chunks with exception isolation, existing duplicate safeguards and verified item IDs.
- Preserve Connect Production configuration and all Core work; no live listings used in tests.


## 0.3.13 — 2026-10-13

Add explicit owner-approved recovery for the same rejected unpublished offer. Check original photos, immutable revision, inventory, offer, policies, campaign and a complete active feed before recording a fifteen-minute, single-use retry authorization. Never recreate an offer or automatically retry an uncertain write. Preserve typed, redacted publication failures separately from later guard errors. Keep legacy jobs blocked until explicit recovery approval and fresh authoritative reads. 346 tests pass, including 26 new recovery cases. See [release notes](docs/releases/0.3.13.md).

## 0.3.12 — 2026-10-13

Fix native batch photo mapping using explicit zero-based file indexes, independent of ChatGPT file-reference resolution. Return the index and actual host ID with each result; preserve strict legacy ID matching without guessing or silent positional fallback. Validate complete unique mappings before any download. Keep storage, concurrency, checksum verification and exact listing approval unchanged. See [release notes](docs/releases/0.3.12.md).

## 0.3.11 — 2026-10-13

Remove mandatory client-side hash/size calculation from native ChatGPT photo ingestion. Calculate SHA-256 from downloaded bytes and independently verify durable encrypted storage; enforce optional independent source checksums/sizes. Batch up to ten originals with three concurrent downloads, one shared HTTP client, exact file-ID/role mapping and per-file retry results. Verify raw-upload storage before acknowledging success. Preserve draft revisions, exact approval gates and duplicate protections. See [release notes](docs/releases/0.3.11.md).

## Review approval workflow — 2026-10-13

- Add a credential-free, exact-revision ChatGPT approval-button generator.
- Require a real owner click after reviewing the complete listing and original photos; changed or published drafts cannot generate approval requests.
- Add synthetic host fallback, escaping, revision and double-click tests. Live host-click acceptance awaits the next new comic. Connector runtime remains 0.3.10.


## 0.3.10 — 2026-10-13

Apply the owner's new rule to review drafts: comics priced at exactly $5 require Best Offer OFF and no minimum offer. Other prices retain the existing Best Offer requirement. Expose the conditional rule in the listing contract. Existing live listings and historical approvals are not rewritten. Add authenticated save/validation and outgoing offer-payload regression coverage.

## 0.3.9 — 2026-10-13

Add authenticated native ChatGPT file ingestion plus a network-aware raw upload helper. Preserve original bytes and verify size, checksum, encrypted storage and seller scope. Expose the complete nested draft schema and validation diagnostics. Require Best Offer, conservative condition, packed parcel and fuller exterior-only disclosures for new review drafts without changing historical revisions. Return durable publication stage and known live item ID on errors. Read automatic campaign ads by exact listing ID, and atomically persist verified journals with their signed-receipt source. 278 tests pass. See [release notes](docs/releases/0.3.9.md).

## 0.3.8 — 2026-10-12

Accept only eBay’s exact inactive offer defaults (`tax.applyTax=false`, `eBayPlusIfEligible=false`, and visible buyer details). Continue rejecting tax rates, enabled programs, changed prices, offer floors and automatic acceptance. Reuse the existing offer and retain approval of the unchanged listing. Eight regression cases added; 71 focused tests pass.

## 0.3.7 — 2026-10-12

Enforce the owner's maximum comic condition label of Good, with Acceptable for rougher copies. Retain exterior-only inspection disclosures. Support a condition-only revision of this connector's existing inventory item before any offer attempt: verify the prior content and absence of offers, clear approval, preserve history and identifiers, then update the same item only after explicit approval. Lost-response recovery reads the same inventory item and never creates a second offer. See [release notes](docs/releases/0.3.7.md).

## 0.3.6 — 2026-10-12

Handle eBay's omission of the standalone condition description for inventory without a condition code. Keep the complete approved main description, exterior wear and uninspected-interior disclosure exact. Add read-only live diagnostics for a seller's saved publication job. Preserve draft revisions and approvals; recover the same original-photo inventory item without overwriting it or creating duplicates. 215 tests pass. See [release notes](docs/releases/0.3.6.md).

## 0.3.5 — 2026-10-12

Support the owner's exterior-only comic inspection practice. Record inspection scope explicitly, preserve unknown printing/variant values, require an uninspected-interior disclosure, and omit unsupported condition claims. Check live category permission before omitting a grade. Verify existing automatic 5% campaign inclusion through read-back only, retaining the same listing while waiting. All changes remain bound to exact owner-approved revisions. See [release notes](docs/releases/0.3.5.md).

## 0.3.4 — 2026-10-12

Support shipping estimates when the owner explicitly authorizes estimation. Preserve their sources, calculation, and authorization separately from verified measurements and include them in the listing approval revision. Add a public Gemini Flash Mailer single-comic estimate of 12 oz and 13 x 8 x 2 inches. Comic identity/condition verification and exact-listing approval remain independent. See [release notes](docs/releases/0.3.4.md).

## 0.3.3 — 2026-10-12

Support calculated shipping only with measured packed weight/dimensions bound to approval. Verify package read-back before and after publication, including recovery. Correct the Inventory API's used-condition enums, validate current category condition and Best Offer rules before external writes, and discover existing CPS campaigns through bounded read-only pagination. Health and authenticated status now report the same release. See [release notes](docs/releases/0.3.3.md).

## 0.3.2 — 2026-10-12

Add explicit whole-dollar Best Offer minimums to approved drafts and Sell API payloads. Automatic acceptance is not enabled. Verify offer terms before and after publication, including retry recovery; term changes require renewed approval. Existing live inventory is not changed. See [release notes](docs/releases/0.3.2.md).

## 0.3.1 — 2026-10-12

Correct optional-scope discovery and tool-level consent challenges. Export seller-bound, signed persisted publication receipts for Vault. Existing access stays read-only until fresh consent. See [release notes](docs/releases/0.3.1.md).

## 0.3.0 — 2026-10-12

- Add encrypted original-photo ingestion, complete draft validation and revision-bound approvals.
- Preserve exact CDP SKUs and reserve physical copies, SKUs and photograph content against duplicate drafts.
- Add separately consented Sell/Media/Marketing integration with durable intent journals and read-back recovery.
- Keep live publication disabled by default; existing read grants remain read-only.
- Add 55 tests beyond the original 48, plus GitHub Actions test/package verification.

See [release notes](docs/releases/0.3.0.md) for pilot blockers and operating limits.

## 0.2.0

Existing active-listing pagination, OAuth, orders, transactions and payouts. Historical 48-test baseline reverified before 0.3.0 development.




