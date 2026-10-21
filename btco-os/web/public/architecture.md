# BTCo OS technical overview

BTCo OS is a browser application for collectible inventory, backed by authenticated Cloudflare Worker routes and D1 storage. Canonical source is this GitHub repository. The Python package is a separate local operator utility retained and repaired from the original foundation; it is not the browser server and does not dual-write to D1.

## Runtime map

| Component | Location | Responsibility |
|---|---|---|
| Browser | web/app, web/public | React/Vinext shell and existing DOM-based module UI; responsive CSS; browser cache and device recovery |
| Domain | web/domain | Pure inventory, money, sales allocation, import, SKU linking and reconciliation rules |
| APIs | web/server, web/app/api | Owner authentication, same-origin writes, revision checks, provider validation |
| Database | web/db, web/drizzle | D1 workspace manifests/chunks, snapshots, recognition operations and encrypted PSA credentials |
| eBay connector | Separate btco-ebay-connector repository | OAuth/PKCE, encrypted durable grants, fixed read-only eBay endpoints and paginated Trading API listings |
| Operator utility | btco_os | SQLite CSV validation and CDP identity registration; independently packaged Python CLI |
| Native Vision | web/native/vision-ios | Recovered SwiftUI/AVFoundation iPhone scanner with Keychain connection settings |
| Optional legacy service | web/services/vision-node | Node recognition service and export-based inventory matching |

Node 22.13+, React 19, Vinext/Vite and TypeScript build the browser service. Framework dependencies are pinned in web/package-lock.json. Python 3.11+ supports the dependency-free Vault CLI. SQLite/D1 are the implemented stores; web/public/schema.sql is a proposed normalized PostgreSQL model, not an applied migration.

## Implemented modules

| Module | Current capability | Next boundary |
|---|---|---|
| Vision | Photo recognition, public PSA research, review drafts, existing-record matching and explicit CDP links; recovered SwiftUI code | Xcode/device acceptance and authenticated native sync |
| Vault | Shared inventory, exact CDP identities, eBay-only review records, source provenance, cost allocation, sales, import/export and recovery | Normalized storage and explicit reconciliation actions |
| Scout | Editable purchase economics, budget check, sold-evidence confirmation and minimum 5% eBay promotion | Saved opportunities and verified sourcing adapters |
| Market | Independent eBay/CollX asks, source dates, exact-identity duplicate review and live eBay observations | Live CollX retrieval and authorized listing management |
| Flow | Complete-page collection validation, atomic reconciliation, replay protection, review queue/history and daily automation | Durable jobs with retry/lease state and alerts |
| Pulse | Recorded sales, known versus unknown costs, net after entered expenses and activity history | Normalized metrics and historical performance |

## Inventory invariants

CDP is the listing hub. A confirmed CDP master SKU remains separate from eBay aliases and internal record IDs. Scans stay drafts until reviewed linking. An eBay-only listing never fabricates a CDP master identity. Existing master mappings, physical quantities, costs, sales and manual price decisions survive refreshes. The UI exposes exact duplicate listing IDs, CDP SKUs and grading certificates for review; title similarity alone cannot merge physical copies.

The connector returns up to 200 listings per page, including CDP-created listings. Collect all pages and validate seller, totals, order, timestamps, currency and unique IDs. The source is not an atomic census. Preview against a workspace revision, then apply with its checksum and optimistic revision. Replay does not append records. Missing listings are observations, not sales. New listings enter review with zero physical units; variations remain blocked for separate mapping. Fees and active asks do not establish sold comps.

## Persistence and trust

Authenticated browser routes scope all reads/writes to the platform owner identity. Content-addressed chunks stay below 450 KB; an atomic manifest advances the revision. Ten recovery snapshots and preserved device backups share unchanged chunks. A stale device cannot replace current state. The dedicated inventory writer is scoped by server-only owner/seller settings behind the owner-private Sites boundary; it must be disabled or redesigned before any audience expansion.

The production database is not versioned source. Source contains synthetic tests only. Provider tokens remain server-side; PSA per-owner credentials use authenticated encryption. Existing AI limits, idempotency and credential boundaries are retained. Hosted provider readiness is independent of native testing.

## Path to multi-tenant SaaS

Introduce tenant/membership/role tables and server-enforced tenant authorization on every record, job and credential. Add explicit authenticated service principals for reconciliation; the current owner-private service path is not a public-SaaS auth layer. Migrate chunked workspaces to normalized items/listings/ledger with compatibility readers, backfills, idempotency keys and rollback checkpoints. Add durable queue leases, per-tenant rate limits, integration health alerts, backups/restore drills and measured retention policies. Only then support dealer onboarding, collaboration and commercial billing.

## Versioning and deployment

GitHub foundation 0.1.0 repairs the initial Python commit. Foundation 0.2.0 consolidates the already-existing browser line and integration. Browser 0.10.0 was recovered from Sites commit 198b82257a15de88e3a562e538452d3f9e35113c; browser 0.11.0 contains this milestone. Sites is a deployment mirror, not a competing canonical repository. See DEVELOPMENT.md and releases for exact evidence and verification limits.
