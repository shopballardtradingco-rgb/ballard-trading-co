# System map — October 20, 2026

| Component | Current runtime | Data/state | Independence status |
| --- | --- | --- | --- |
| BTCore 0.7.1 | Node application on Railway, development environment | PostgreSQL metadata; private S3-compatible original/photo bucket | Standalone browser UI; daily operation does not require a ChatGPT conversation |
| BTConnect 0.6.0 | Python service on Railway | SQLite volume with encrypted authorization/listing records; separate private Cloudflare R2 originals | Shared marketplace backend; preserve OAuth, approval and publication journals |
| Legacy BTCo OS | Earlier Sites deployment and D1 | Separate inventory/database | Not automatically synchronized or migrated into standalone Core; retirement requires export and reconciliation |
| Python inventory utility | Local command line | Separate SQLite file | Not a second writer to Core or D1 |
| eBay | External marketplace | Authoritative listing/order identifiers | Card publishing via Core → BTConnect exists; read-only mirror is distinct from applying sales to stock |
| CollX / HipComic / Mercari | External marketplaces | Separate listings and prices | Complete Core lifecycle integration is not implemented |
| AI identification | Core server provider adapter | Saved proposals/jobs/usage included in workspace backup | OpenAI endpoint currently fixed; provider interchangeability remains work |

## Source identities at recovery checkpoint

- Core/legacy: `shopballardtradingco-rgb/btco-os`, commit `f09f6fdad6ae1b62ce57c3d0880130e06ba0d65b` on `release/btcore-development` and `feature/marketplace-mirror` at inspection.
- Connector: `shopballardtradingco-rgb/btco-ebay-connector`, `main` commit `337a5a044152d5a587ccc33587d6f6ee043ff400`.
- Public snapshot: this repository; source-lock.json records each exported file and hash.

The live deployment registry and backup objects are private. Runtime addresses must not be copied into public issues while the workspace is in open-access mode. Existing open access is a material remaining recovery/security issue, not a completed private-access guarantee. Add an owner-friendly access boundary before promoting broad public discovery of the app; do not silently change the owner's approved sign-in workflow.

## What survives a lost ChatGPT account

The public code, documentation, tests, schemas, deployment recipes and GitHub work queue. The owner-controlled GitHub, Railway, cloud storage, marketplace and backup accounts remain necessary. Their recovery codes and encryption keys belong in an independently recoverable password manager, not the repo. A verified source copy and Core workspace export also exist outside ChatGPT. Full connector, legacy database and secret recovery still need completion.

## Change discipline

Keep a dated decision record for material product rules and architecture changes. Every release records tested source SHA, deployed version/SHA, migrations, rollback constraints and backup evidence. Never treat an empty work queue, a successful deploy, or a passing synthetic test as proof of cross-channel inventory parity.
