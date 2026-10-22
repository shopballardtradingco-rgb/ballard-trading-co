# Independence roadmap

Latest owner direction, October 21, 2026 Pacific: **full operational independence
as soon as possible**, no new app features, with working eBay publishing first.
The owner selected an owner-controlled cloud server under the existing $20/month
total infrastructure target. Railway recovery is not the deployment prerequisite.
The [portable server package](../deploy/owned-server/README.md) preserves the existing
applications and direct browser operation. This supersedes the relaxed timing
for ChatGPT independence below; it does not claim marketplace parity or authorize
an arbitrary listing. Cloud account access, complete connector state, one active
writer and live acceptance are still required.

Owner direction, October 20, 2026: the company and app must outlive ChatGPT. Replace CDP first. Reducing ChatGPT/Pro dependence is a long-term objective. Cheaper models must be replaceable tools. Retire CollX Pro when its required workflows and economics justify doing so. Subscription cancellation is a separate owner action, not an automatic side effect of development.

Latest instruction: add no new features in the current pass; improve performance and independence from all paid tools. CDP first, ChatGPT second. Other marketplaces are secondary in delivery order and remain integral to the owner's eventual patent strategy. Retain their contracts, independent prices, identifiers and dated architecture evidence. See [the dependency audit](../btco-os/docs/DEPENDENCY-AUDIT.md) and [0.7.2 maintenance](../btco-os/docs/releases/0.7.2.md). This direction supersedes earlier requirements to develop every channel together; it does not claim patentability or that existing cross-listed stock can be abandoned safely.

## P0 — owned source and recoverable business

- [x] Establish a public GitHub home with current Core and Connect source, documentation and a durable work queue.
- [x] Verify current source snapshots against upstream blob hashes.
- [x] Obtain a complete Core export and prove an isolated offline restore with original-photo hashes.
- [ ] Verify recurring off-site backup delivery, retention and restore checks.
- [ ] Back up connector SQLite, its original photo bucket and required encryption keys independently.
- [ ] Export/reconcile the older Sites/D1 workspace and preserve needed originals before retiring it.
- [ ] Preserve complete private Git histories and GitHub issue/PR metadata on another provider.
- [ ] Automate reviewed public-source refreshes or migrate deployment to this repository after validation.
- [ ] Resolve open workspace access before public app promotion; retain a low-friction owner flow.
- [ ] Verify independent recovery of GitHub, hosting, storage, domain/DNS, marketplace and secret-store accounts.

## P1 — CDP cutover first

See the detailed [CDP acceptance ledger](../btco-os/docs/CDP-REPLACEMENT.md) and [marketplace hub direction](../btco-os/docs/CORE-MARKETPLACE-HUB.md).

1. Finish the already requested three-week side-by-side trial. Preserve exact master SKUs, original photos, costs, locations and independent channel prices. Read-only observations do not create physical stock.
2. Prove eBay publication/recovery with a separately approved live card pilot. Reconcile existing listings, orders, payments, cancellations and refunds without replaying sales.
3. Inventory the channels actually in use and document a safe supported or explicitly owner-accepted manual continuity plan before cutover. Supported CollX integration remains a secondary implementation dependency; a CSV or owner-recorded listing is not API-backed synchronization.
4. Build the confirmed sale ledger and cross-channel closure queue. Each remaining listing must be verified ended/adjusted or shown as a specific manual action with its link and reason.
5. Reconcile migration counts and photo coverage, rehearse recovery, and document rollback. Only then mark CDP cancel-ready. No new CDP-specific feature development.

HipComic, Mercari and CollX remain later channel phases. Preserve their architecture and gaps. The owner has explicitly reprioritized delivery; no channel parity or subscription cancellation readiness is implied.

## P2 — reduce ChatGPT dependence over time

- Move every operational instruction, prompt, schema, evaluation fixture, acceptance result and backlog item into versioned source or the private operational record.
- Keep the core inventory, batch review, publishing, reconciliation and recovery workflows usable directly in BTCore.
- Introduce a provider interface returning the existing validated identity/research schema, with configurable provider/model, timeouts and explicit costs. No model gets direct authority to publish or rewrite stock.
- Run the same fixed evaluation set against alternatives. Compare identity/parallel accuracy, source support, latency, retry cost and total cost per accepted listing. Do not replace a model based only on token price.
- Provide manual review when a provider is unavailable, cost caps, an auditable job queue and portable exports. Preserve exact publication approval and unknown-outcome recovery.
- Trial routine work without Pro before cancellation. Record subscription savings separately from API, hosting, storage and integration costs.

## P3 — CollX Pro and remaining subscriptions

Inventory every feature actually used, its replacement and its cancellation date. Confirm that independent marketplace access will still work after ending any plan. Keep exports and account recovery before cancelling. The target is lower total operating cost, not shifting the same cost into hidden API/hosting fees.

## Tracking rule

Use GitHub Issues with checkboxes and concrete acceptance evidence. Link each implementation PR and recovery result. Record blocked access and exact owner actions. A chat promise is not a completed task, and a configured workflow is not a successful scheduled backup.
