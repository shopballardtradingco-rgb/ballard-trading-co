# Envelope read-back normalization — October 23, 2026 Pacific

Owner-approved Core publication produced verified live eBay listings. Envelope entries exposed a read-back discrepancy: approved width 4.125 INCH returned as 4.13. BTConnect 0.6.6 recognizes exact half-up rounding to two decimal places for same-unit INCH length/width only, preserving approved drafts and requiring exact weight and thickness. All 582 local connector tests passed, including recovery of a saved inventory-only job without duplicate writes, offers or publication. Canonical PR #20 merged as f579b1edf4c6cbefd3f58024a0abeee0d39bad93 with tested tree d83ea2585b07d413b07eee1e3315d80f89ffcf46. Both exact-head CI runs 40055627523 and 40055625602 passed. Issue #9 tracks final live resume.

Core 0.7.5 is live from canonical merge 9f3edfe0456ee5a8c2546f24cdf7908f7e7373e5 (tested tree 7ad04a979b673939191327dfdb29f09f09502606). Exact-head CI 40053143417 passed all storage/browser/Docker/package checks; 40053143412 passed Verify. Public source checkpoint b4ed326ba9f0d08e39691c09bfc34d220b2860db retains that source.

# Saved preparation retry — October 23, 2026 Pacific

Core 0.7.5 repairs the listing desk button that did not restart a completed preparation containing photo errors. An explicit retry retains the same Core batch, saved policies and original references, leaves submitted connector groups intact and adds only newly recovered entries to new groups. Normal preparation continuation stays bounded, and approved publication cannot enter this retry path. Canonical PR #11 contains service and browser regression coverage. The browser regression reproduces total upload failure, a reload, and recovery through the same button; it is isolated from the existing unsaved shipping-edit scenario. A separate pre-existing limitation in carrying non-PWE parcel form values across reload plus price editing is recorded in issue #9; unchanged-batch retry retains its durable settings.

Local service suite: 118 passed, one PostgreSQL test skipped locally. Release CI and live deployment results are recorded in issue #9. Original listing approval and live item verification remain separate acceptance gates.

# Original-photo transfer repair — October 23, 2026 Pacific

Core browser authorization now succeeds and the owner-supplied card packaging
settings reach preparation. The next live failure was a connector rejection of
an intact JPEG containing two MPF pictures: Pillow reported MPO, outside the
old JPEG/PNG allowlist. BTConnect 0.6.5 preserves the complete original bytes
while validating both pictures. [Canonical PR #19](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/19).

Canonical merge `8078585034ca7a2ed12c27636f530d4b2028f1d1` preserves tested tree `35a517efb684ec33c074e3774e6df6a2d26f7f7e`. Exact-head CI runs 40051741255 and 40051738917 both passed. All 575 connector tests passed locally with the Core exporter fixture. The
actual failing original passed isolated storage and byte-for-byte readback.
Synthetic coverage includes the actual upload route, duplicate reuse, corrupt
auxiliary data, animated PNG and unsupported extra pictures. Source readiness
is distinct from deployed batch preparation and owner-approved publication;
[issue #9](https://github.com/shopballardtradingco-rgb/ballard-trading-co/issues/9)
records the continuing live acceptance. Original photos and runtime addresses
remain private. No marketplace listing was published by this source change.

# Publisher deployment — October 23, 2026 Pacific

Core 0.7.4 is now live on the existing host. A same-tree release commit
`732bde37fc77d8c2585433b7ed72183082ad878c` triggered deployment through the
private repository's existing GitHub integration. Live health reported 0.7.4,
and the served browser module matched the repaired source byte for byte.
Core standalone [CI run 40046878539](https://github.com/shopballardtradingco-rgb/btco-os/actions/runs/40046878539)
passed unit, PostgreSQL, all nine browser suites, Docker smoke and packaging;
Verify run 40046878451 also passed. Saved drafts and original-photo references
were retained. The existing marketplace mirror continued its normal updates.

BTConnect 0.6.3 ([PR #17](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/17)) added the configured Core origin to the consent redirect policy and passed both exact-head CI runs. Authenticated live checks verified that release and existing seller permissions. A live Core browser test still stalled after the consent POST despite a correct server-side eBay redirect. The follow-up 0.6.4 ([PR #18](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/18)) supplies a visible sign-in link for HTML browsers and correctly names Core on its consent page. All 571 connector tests passed locally, including the actual Core export handoff; three exporter cases also passed. The first PR CI attempt hit the pre-existing 100 ms partial-progress timeout test on a slower runner; the exact-head push suite and local full suite passed. The targeted test also passed locally. The failed job passed on retry (CI run 40048220484, attempt 2); exact-head push CI 40048194551 also passed. PR #18 merged as `c7129765b98a0451ec97e626380e875e541763e2`, with the same tested source tree. Browser login and live-listing acceptance remain unverified at this source checkpoint; issue #9 carries the continuing live acceptance record.

This restores deployment of the publisher repair; it is not an independent
host migration or proof of live eBay publication. The next acceptance steps are
Core browser authorization, saved-batch shipping configuration, exact owner
review and one verified eBay item ID. Runtime URLs and inventory stay private.

# Render recovery configuration — October 22, 2026 Pacific

The owner selected the connected Render workspace; read-only discovery found no services or Postgres databases. The root Blueprint and [deployment runbook](RENDER-RECOVERY.md) prepare a private recovery destination using unchanged Core 0.7.4. This source change does not create resources or move inventory. Independent photo storage credentials, total cloud cost, platform validation, deployment and restore are still acceptance gates. The separate connector journal/original/key recovery remains incomplete.

# Existing photo headroom — October 22, 2026 Pacific

BTConnect 0.6.2 raises the encrypted-photo ceiling to 400 MB on the existing volume while retaining the independent 50 MB free-disk reserve. Readiness reports the smaller disk/quota allowance. The next batch must be sized from actual originals. No paid service, volume resize, migration or marketplace change. Canonical [PR #16](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/16), merged source `661959afd6c1b9297395b19816ee8f81af12f3b6`; all 568 connector tests and both exact-head CI runs passed, including the Core exporter integration locally. Live authenticated checks now confirm version 0.6.2 and the 400 MB quota with the 50 MB reserve enforced in readiness. New-photo intake and owner-approved live publication remain the next-session acceptance tests.

# Connector listing readiness — October 22, 2026 Pacific

BTConnect 0.6.1 reports measured encrypted-photo and free-disk headroom through its existing authenticated readiness tool. The quota and disk reserve remain unchanged. It also corrects stale automatic-promotion and card-contract descriptions and preserves the next-session runbook. [Canonical PR #15](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/15) is merged at `71167314af41b9326c77dca8b0bef8dd9e72137b`; its tree matches tested head `b63f1332c7eade4de8ceff6cae5accd0ae9e1771`.

Validation: 566 connector tests passed with the cross-repository case deferred; all 12 handoff cases then passed with the real Core exporter fixture, plus three exporter tests. Compilation, wheel build and both exact-head GitHub CI runs passed. Source readiness does not prove runtime deployment, expanded storage or new-photo/live-listing acceptance. No marketplace writes or AI requests were made. [Runbook](../btconnect/docs/NEXT-COMIC-BATCH.md).

# Core staged-card handoff — October 22, 2026

The independent publisher now has an offline input path for Core-only staged cards. The public `tools/export-publisher-input.mjs` uses Core's actual backup parser and card compiler; the canonical connector importer restores the existing private journal, stores originals and submits unchanged batch identities. No second inventory database or hosting service is added. [Commands and limits](../btconnect/docs/releases/core-handoff-2026-10-22.md).

Private connector PR #14, reviewed source `4a5a0e7204cbced213449ec178741afb465fe894`. Local validation passed all 562 connector tests, including actual Core-export-to-connector preparation, plus three exporter tests. Lost-checkpoint recovery and re-import after a verified synthetic publication preserve the original job/receipt without a second create or publish. Public CI runs the cross-repository contract explicitly.

This closes the source-level input gap. The existing private recovery record still does not establish a recovered connector database/originals/key or independently configured seller authorization. Those inputs, actual selected shipping/condition settings, a real single writer and separately approved live-card acceptance remain required. No live eBay listing or inventory changed; no Railway service was contacted.

# GitHub-only recovery maintenance — October 21, 2026 Pacific

Connector PR #13 closes credential-diagnostic and rerun-approval gaps. Core PR #10 exports the tested standalone Docker image with a source/image manifest, browser hash and checksums for independent hosting. Actions are pinned and checkouts no longer retain tokens. No runtime feature, live listing or credential rotation was performed. See [the scoped security audit](SECURITY-RECOVERY-2026-10-21.md) for findings, sequencing and acceptance blockers.

# Independent publisher checkpoint — October 21, 2026

The owner requires deployment without Railway. The GitHub Actions publisher reuses the existing BTConnect batch engine, original-photo validation and exact review approval. It runs without a hosted Core/Connect API, checkpoints the encrypted publication journal synchronously in a private GitHub branch, and stops all writes if a checkpoint is unconfirmed. [Setup and limits](../btconnect/docs/releases/independent-publisher-2026-10-22.md).

Source: private connector PR #12, `1f281158e55f43656980428e2eeccfa6cf94e205`. All 542 connector tests passed locally, including independent-runner recovery and lost eBay response tests. Exact-head CI is recorded in the PR. This does not deploy the Core browser or establish live eBay acceptance. Independent recovered connector state, privately configured seller authorization, one active writer and the Core-to-worker input handoff remain required. Railway reconnection is not a prerequisite or the chosen recovery path. No live listings, inventory or secrets are included in this checkpoint.

# Publisher repair checkpoint — October 21, 2026

BTCore 0.7.4 source is preserved at private implementation PR #9, commit `d50c8a418df5e5a67fab3e26282484cb300df127`. [Release contract](../btco-os/docs/releases/0.7.4.md). The publisher now continues eligible approved cards after another card fails, respects retry timing and displays the saved per-card error. No new features or paid dependencies.

Unit and PostgreSQL checks passed; browser and packaged runtime gates are recorded in the implementation PR. This snapshot does not establish deployment or live card publication. The live check still reported Core 0.7.2 and BTConnect 0.6.0. Current staged batches had not completed shipping configuration; the exact cause remains unproven. Railway control-plane access is unavailable. Do not add features ahead of the remaining publisher acceptance.

# Location migration checkpoint — October 21, 2026

BTCore 0.7.3 source: private implementation PR #8, commit `93a045a8e16bcdaba72b14a0e4289b501c56e70a`. [Release contract](../btco-os/docs/releases/0.7.3.md). The public copy preserves the exact implementation, synthetic tests and field mapping; actual export reconciliation and backup artifacts remain private.

This checkpoint adds CDP inventory migration, linked physical-location lookup and order stock allocation. CDP is a migration source. CollX, HipComic and Mercari automatic sales feeds and cross-market delisting remain incomplete. CI and the live migration are separate acceptance gates; source availability alone does not establish inventory parity.

# System map — October 20, 2026

| Component | Current runtime | Data/state | Independence status |
| --- | --- | --- | --- |
| BTCore 0.7.4 | Node application on Railway, development environment | PostgreSQL metadata; private S3-compatible original/photo bucket | Standalone browser UI; daily operation does not require a ChatGPT conversation |
| BTConnect 0.6.2 | Python service on Railway | SQLite volume with encrypted authorization/listing records and local encrypted listing-objects originals; separately maintained R2 copies are not this PhotoStore backend | Shared marketplace backend; preserve OAuth, approval and publication journals |
| Legacy BTCo OS | Earlier Sites deployment and D1 | Separate inventory/database | Not automatically synchronized or migrated into standalone Core; retirement requires export and reconciliation |
| Python inventory utility | Local command line | Separate SQLite file | Not a second writer to Core or D1 |
| eBay | External marketplace | Authoritative listing/order identifiers | Card publishing via Core → BTConnect exists; read-only mirror is distinct from applying sales to stock |
| CollX / HipComic / Mercari | External marketplaces | Separate listings and prices | Complete Core lifecycle integration is not implemented |
| AI identification | Core server provider adapter | Saved proposals/jobs/usage included in workspace backup | OpenAI endpoint currently fixed; provider interchangeability remains work |

## Source identities at recovery checkpoint

- Core/legacy: `shopballardtradingco-rgb/btco-os`, commit `089ab911eff02b02db9ce594016f155627dc2f1e` on `release/btcore-development`; maintenance PR #7. Earlier source checkpoint was `f09f6fdad6ae1b62ce57c3d0880130e06ba0d65b`.
- Connector: `shopballardtradingco-rgb/btco-ebay-connector`, `main` commit `337a5a044152d5a587ccc33587d6f6ee043ff400`.
- Public snapshot: this repository; source-lock.json records each exported file and hash.

## 0.7.2 release evidence

Exact source `089ab911eff02b02db9ce594016f155627dc2f1e` passed private Core CI run 39543494589 (unit, PostgreSQL, all eight browser suites and Docker smoke) and Verify runs 39543494573 / 39543491132 (legacy browser build and Python utility). All 410 Core/legacy Git blobs in this checkpoint match the remote tree before public sanitization; 534 source files are recorded across both projects.

Development deployment succeeded on October 21 UTC / October 20 Pacific. Live health returned `ready`, BTCore `0.7.2`. The live app asset matched the exact local source SHA-256 `bbcafa2882928bca53f3e0631cbb1332b5bab0f73e975b3a6c0afb859b5245af`; gzip transferred 40,425 bytes and a repeat validator returned 304 with zero body bytes. No schema, dependency package, provider or marketplace mutation was added. Prior 0.7.1 remains data-compatible for rollback. Current data backup evidence remains in the recovery runbook; this maintenance release did not create a new inventory backup.

The live deployment registry and backup objects are private. Runtime addresses must not be copied into public issues while the workspace is in open-access mode. Existing open access is a material remaining recovery/security issue, not a completed private-access guarantee. Add an owner-friendly access boundary before promoting broad public discovery of the app; do not silently change the owner's approved sign-in workflow.

## What survives a lost ChatGPT account

The public code, documentation, tests, schemas, deployment recipes and GitHub work queue. The owner-controlled GitHub, Railway, cloud storage, marketplace and backup accounts remain necessary. Their recovery codes and encryption keys belong in an independently recoverable password manager, not the repo. A verified source copy and Core workspace export also exist outside ChatGPT. Full connector, legacy database and secret recovery still need completion.

## Change discipline

Keep a dated decision record for material product rules and architecture changes. Every release records tested source SHA, deployed version/SHA, migrations, rollback constraints and backup evidence. Never treat an empty work queue, a successful deploy, or a passing synthetic test as proof of cross-channel inventory parity.
