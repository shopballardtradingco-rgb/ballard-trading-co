# BTCore 0.1.0 · independent development application

October 17, 2026. Application branch: `feature/standalone-btcore-app`.

The existing Site could not be used without ChatGPT identity and hosting. This milestone adds a separate runnable Core Dev application with its own owner login and PostgreSQL persistence while preserving the existing Site and BTConnect.

## Added

- Home dashboard, searchable Vault, location/cost/hold editing, saved intake, front/back original uploads, full review, physical-inventory confirmation, sales/reversals, activity, settings and password rotation.
- Immutable original storage, independently generated previews, byte hashes, bounded development storage, CSV/preparation exports and streamed complete backups.
- Empty-workspace restore that validates every original and assignment before committing.
- Secure independent sessions, CSRF/origin checks, durable login limits, optimistic revisions and idempotent writes.
- Dedicated restricted PostgreSQL runtime login, additive pre-deploy migrations, non-root Docker packaging and isolated CI.

## Verified locally

Six integration scenarios cover independent identity, CSRF, rate limits, password/session rotation, unique SKUs, comic prices, restart recovery, concurrent saves, sale accounting, immutable originals, review invalidation, backups/restore and access boundaries. The separate PostgreSQL 17 CI scenario passed on commit `996f6f3369df452d806f1d0a10fc889189bcbcb5`: restricted runtime role, denied schema creation, actual transactions/concurrency, independent reconnection, original-byte readback, and backup restoration.

The browser scenario completed owner setup → front/back uploads → review → Vault intake → manual item → sale → logout/login → verified backup → reversal at desktop and 390px widths. No browser errors or external service requests occurred. QA uses clearly synthetic inventory only.

Existing checks: 145 browser/domain tests, 10 Python tests, browser release markers, TypeScript and production build passed. No existing tracked web source changed. Runtime dependency audit reported zero vulnerabilities when checked.

## Release limits

Manual identification; no AI or marketplace integration. Core starts empty. No production inventory is copied. Original storage is bounded PostgreSQL, not the existing R2 adapter; 64 MiB originals total and 12 MiB per file. Backups are manual. Wrong-side originals need a new intake. Physical Safari/HEIC acceptance is still outstanding. The first Docker build and hosted CI browser acceptance passed in [run 39080870266](https://github.com/shopballardtradingco-rgb/btco-os/actions/runs/39080870266); the final head additionally runs the packaged non-root container.

No full application deployment is performed by this source milestone. Owner release approval is required under the earlier deployment hold. A fresh full application deployment will be scoped to the existing isolated Core Dev service with pinned source and current resource caps.
