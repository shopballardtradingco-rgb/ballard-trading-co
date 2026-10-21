# Prioritized engineering backlog

| Priority | Work | Acceptance criteria |
|---|---|---|
| P0 | Review 69 quantity discrepancies and 32 missing observations | Explicit user-reviewed resolution; preserve historical evidence; no automatic stock or sale inference |
| P0 | Browser/iPhone acceptance | Signed-in desktop and Safari flows: Vault edit, stale revision conflict, Market/Flow search, Scout calculation, photo intake and recovery verified |
| P0 | Xcode/device build | Maintained SwiftUI target compiles on Mac; camera framing, permissions, image transport and review tested on physical iPhone |
| P0 | Observe first scheduled daily run | 7 AM Pacific run collects all pages, saves one checksum, verifies readback, reports failures without stale overwrite |
| P1 | Exact identity locks on manual editing | Explicit reviewed mapping operation; prevent incidental changes to confirmed CDP SKU/aliases; regression tests |
| P1 | CDP export recovery | Authorized export acquired; source timestamp and exact master SKU preserved; conflicts reviewed before import |
| P1 | Durable reconciliation worker | Per-owner job lease, bounded retry, idempotency, freshness/clock guard and failure alerts; no dependency on conversation runtime |
| P1 | Reviewed quantity resolution | Reconcile evidence and physical counts with append-only audit reason and optimistic lock |
| P1 | Native authenticated shared sync | Supported device sign-in and scoped authorization; no shared owner secret embedded in iOS |
| P1 | Tenant authorization foundation | Membership/role model, tenant-scoped jobs/credentials and negative cross-tenant tests before audience expansion |
| P2 | Normalize Vault and sales ledger | Explicit schema migration/backfill, cost conservation, signed reconciliation totals and rollback rehearsal |
| P2 | Scout saved opportunities | Store evidence URLs, source times, delivered cost, projected net, liquidity and status; no auto-purchase implied |
| P2 | Live CollX prices | Supported authenticated read adapter, currency/date provenance and no eBay overwrite |
| P2 | Pulse trends and diagnostics | Time-series observations, unknown-cost coverage, inventory age, sell-through and sync-failure metrics |
| P2 | CI/deployment provenance | Required status checks, release tags after verification, canonical subtree-to-Sites mapping, reproducible artifact checks |
| P3 | Commercial readiness | Retention/deletion controls, tested restores, incident runbooks, tenant onboarding and subscription billing |

Production data must remain outside Git. Existing deployment and connector continue operating while these steps are introduced incrementally.
