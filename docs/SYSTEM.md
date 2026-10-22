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
| BTCore 0.7.2 | Node application on Railway, development environment | PostgreSQL metadata; private S3-compatible original/photo bucket | Standalone browser UI; daily operation does not require a ChatGPT conversation |
| BTConnect 0.6.0 | Python service on Railway | SQLite volume with encrypted authorization/listing records; separate private Cloudflare R2 originals | Shared marketplace backend; preserve OAuth, approval and publication journals |
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
