# BTCore independent runtime decision · October 17, 2026

## Why this slice

The prior standalone branch established Python/R2 storage and isolated Railway/PostgreSQL infrastructure. The canonical browser still required Sites identity and D1, so that foundation was not a usable standalone app. The owner's October 17 request prioritizes a real independent application.

`core/` adds a separate Node 22 service and browser UI in the canonical `btco-os` repository. It directly reuses the existing framework-independent JavaScript Vault domain, instead of translating stock, SKU and sale-allocation rules. It does not copy the connector's listing/publication state machine, claim live publishing, or replace the existing browser.

| Build | Impact |
| --- | --- |
| BTCore / Core Dev | New independent authentication, application API, responsive UI, PostgreSQL tables, original-photo intake and backup/restore |
| BTConnect / Connect Production | No runtime, credentials, source, configuration or data changes |
| Existing Sites browser | All existing tracked `web/` bytes retained; separate authentication and D1 records remain |
| Shared | Existing Vault domain imported directly in-process; source is shared, databases are not |
| Sync | No automatic synchronization or production import; listing packets are preparation, never publication authority |

## Important boundaries

This is a single-owner development app. Every protected route checks a database session; incoming `oai-*` identity and forwarding headers confer no authority. Writes require the configured origin and a session CSRF token. Initial setup requires a strong operator-supplied one-time secret; password/session material is never included in backups or rendered into static assets.

PostgreSQL transactions lock the one workspace row, compare the revision, preserve one response per idempotency key, update state, and save a recovery snapshot together. The local-only SQLite adapter serializes transactions for tests. Inventory cannot be replaced wholesale through an HTTP request. Item edits are whitelisted, and the reused Vault domain enforces unique SKUs, remaining stock, cost allocation and sales reversal history.

Intake drafts do not count as physical inventory. Confirmation requires title, location, asking price, visible condition notes, explicit identity/condition review and front/back originals. Photo and relevant identity edits invalidate review. Marketplace approval is a separate future contract; no eBay write client exists in this runtime.

The versioned Python R2 adapter remains on the existing connector standalone branch. This release deliberately uses bounded PostgreSQL original bytes to make a complete small Core Dev workflow testable without introducing a private cross-repository package release or copying that implementation. Move to the reviewed R2 adapter through a versioned service/package boundary before larger intake volumes. Preserve hashes and associations, verify full readback, and retain the ability to restore previous data.

## Release and remaining work

The new branch is `feature/standalone-btcore-app` in `shopballardtradingco-rgb/btco-os`. It is the application counterpart to connector branch `feature/standalone-btco-os`, not a new third repository or a renamed connector.

Owner explicitly approved launching the reviewed Core Dev v0.1 build on October 17, 2026 and authorized continued next-version work. The previous launch hold is lifted. The HTTPS address is created, but Railway cannot yet access the canonical repository; its GitHub App needs the owner to grant that access. No new launch approval is required for the pinned v0.1 build. See the current [release preparation](deployment/BTCORE-CORE-DEV.md). Version 0.2 is isolated on `feature/btcore-intake-v0.2`; no main branch, marketplace, production inventory or paid plan changes are included.

Next integrations, in order: verified Core Dev deployment and real phone acceptance; external backup scheduling/alerts and restore drills; integrate the existing R2 implementation; versioned transport-neutral listing rules from BTConnect; independent provider-based recognition; separately authorized eBay sandbox and per-item publication authority. Keep manual operation available when recognition is unavailable.

## Intake workbench v0.2

Photo assignment changes now run inside the same revision-checked workspace transaction as inventory changes. Swapping uses temporary role slots to satisfy PostgreSQL uniqueness. Replacing an original moves its assignment to `retired:<photo-id>`, keeps every byte, and records the prior association in `photoHistory`. Retired originals remain private and count toward quota. Confirmed intake cannot be corrected or archived.

Backups capture the full active/history association manifest while holding the workspace lock, then stream immutable bytes. Corrections during streaming cannot change the captured backup. Version 2 backup envelopes include archived drafts and previous originals; the parser retains v1 compatibility. Database schema is unchanged, but v0.1 cannot validate archived drafts or v2 backups. Do not downgrade a used v0.2 workspace in place.

Batch upload is a bounded browser coordinator over the existing authenticated single-draft API. It never confirms inventory automatically. Each pair gets its own durable draft; each write retains its idempotency key through response loss and subsequent workspace-refresh failures. Pause finishes the active pair. Unsent file handles remain in memory only, so closing/reloading the tab loses only unsent selections; completed and partial uploads remain in Intake.
