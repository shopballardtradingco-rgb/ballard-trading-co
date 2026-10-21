# CDP replacement acceptance ledger

Updated 2026-10-20 · standalone BTCore 0.7.1 · development release

Goal: run the complete card selling workflow in Core without needing a CDP subscription or a CDP-mediated connection. CollX posting is a required cutover gate, not an optional later enhancement. Mercari and HipComic are authorized later phases under docs/CORE-MARKETPLACE-HUB.md; no live Core connection is claimed. Existing Sites/D1 data and BTConnect are separate; features in the older Site do not count as delivered in standalone Core.

**CDP is not yet fully replaceable.** The largest gaps are direct CollX publication and lifecycle access, verified listing/order reconciliation, and proven cross-channel delisting. A prepared record, CSV download, successful mock test, or manually recorded status does not satisfy a live integration gate.

## Acceptance matrix

| Workflow | Standalone Core evidence | Remaining cutover acceptance |
| --- | --- | --- |
| Phone/batch photo intake | Saved queues up to 500, optional backs, retries, original checksums, history | Real iPhone/Safari and scanner export acceptance; durable background upload after closing the tab is not implemented |
| Identification and review | Original-based AI identity, manual correction, bulk review | Owner check of exact parallels/serials and difficult cards; no assumption that AI accuracy equals a database match |
| Pricing | 0.4.2 stops AI asks; explicit price confirmation; mobile quick editor | Live owner acceptance after deployment; sold evidence remains source research, not independent verification |
| Separate channel pricing | 0.5.0 stores independent CollX targets, including cents; last observed price stays separate | Connect actual marketplace repricing; preserve existing CollX prices during migration rather than deriving them from eBay/CDP |
| Original photos | Private object storage, original download, backup and byte-verified eBay transfer | Verify CollX's supported image upload contract and readback against the original |
| Direct eBay posting | 0.6.4 Core → BTConnect approval, original photo transfer, exact 5% campaigns, measured calculated shipping per card group, durable batches, readback | Owner-approved real card pilot with actual parcel measurements; existing listing edit/end operations in Core |
| Direct CollX posting | **Blocked: supported external posting/auth contract not located** | Obtain authorized integration access; account identity, card catalog matching, original uploads, review, create, readback, retry safety; real owner-approved pilot |
| CollX listing tracking | 0.5.0 owner-recorded listing ID/link/status/observed price, duplicate-link protection and attention flags | API-backed status; owner records are dated observations only |
| Import existing live listings | 0.6.0 complete eBay mirror, exact IDs, all-page validation; mapped dated CDP/CollX CSV observations | eBay listing import first; CollX source contract next; preview mappings, preserve exact master SKU and storage location, quarantine ambiguous matches, deduplicate reruns |
| Sales/orders and cancellations | 0.6.0 read-only eBay order/line IDs, payment/fulfillment/cancellation observations and change history; manual Core sales remain separate | Read orders with stable order/line IDs, refunds/cancellations/unpaid states, durable cursors, replay protection, exception queue, explicit financial reconciliation |
| Cross-channel delisting | Not connected; 0.5.0 flags known active CollX records with unavailable/held stock or known eBay publication | Confirmed sale/reservation event → correct physical item → end/adjust other listings → readback. Handle partial quantities, refunds, cancellations and unknown write results without duplicate sales or unsafe relisting |
| Physical inventory, SKU, location, cost | Vault stock ledger, holds, receipt confirmation, known/unknown cost | Controlled migration reconciliation; marketplace observations never create physical stock or infer sales |
| Titles, descriptions, condition, policies | 0.6.5 dropdown-only eBay raw conditions; legacy assessments kept separately; current eBay policy/descriptor review | Reusable channel templates and CollX seller shipping/discount/offer settings with preview and exact approval |
| Bulk edit and listing batches | 0.7.1 identified-year normalization and editable owner condition defaults; 0.7.0 same-page exception fields, named inventory location and one final publish confirmation; 0.6.9 automatic managed-payment selection; 0.6.7 saves tolerate unrelated workspace changes while validating each selected card; 0.6.6 same-page selection, bulk price/condition/shipping and Publish selected; incomplete rows excluded with reasons; automatic unapproved-batch resume/regroup and preview refresh; exact review approval and verified per-card results. Shared measured PWE defaults and conservative parcel/lot cost review remain | Real owner-approved card pilot; bulk independent CollX target edits and supported bulk posting with per-card failures |
| Fulfillment | Manual financial fields; marketplace fulfillment still external | Order queue, shipping/tracking/fulfillment linkage and exception visibility where supported; do not recreate carrier billing without an agreed provider |
| Comics and HipComic | Existing independent BTConnect comic contracts preserved | Core end-to-end comic lifecycle and HipComic access/pilot remain separate gaps; do not silently reroute existing comic listings |
| Whatnot / Shopify | Not connected in standalone Core | Track as CDP feature coverage gaps; no capability claim or assumed live access |
| Exports, backups, audit | Inventory/sales exports, 0.5.0 CollX record CSV, originals + state backup, empty-target verified restore | Scheduled independent backups, restore drill, final migration counts/checksums; CSV export is not marketplace sync |

## Implementation order

1. Ship 0.4.2 pricing safety and 0.5.0 independent CollX records once Railway resumes builds; verify exact commit, health version and UI asset.
2. Wire existing eBay listing/order reads into Core with a preview and exception queue. Reconcile exact SKU/location links before any stock or live listing write.
3. Resolve CollX integration access in parallel with local implementation. The 0.5.0 record model separates intended price, dated observation and physical item so a supported adapter can be added without treating one as another.
4. Implement channel changes/end operations and sales-driven delisting with durable journals and readback. Exercise retries, duplicate events, ambiguous writes, partial orders and cancellation reversals.
5. Run explicit owner-approved live pilots, reconcile historical inventory and original photo coverage, then execute a cutover checklist. Stop CDP writes only after counts, mappings and channel lifecycle parity are proven. Do not cancel CDP or disconnect its channels as part of a development deployment.

## CollX integration findings

Checked official public sources and available connectors on 2026-10-20. No CollX connector was returned. No supported third-party developer documentation, external auth contract, or accepted bulk CSV import schema was located. This is an access/contract gap; it is not proof that CollX has no internal or partner API.

Official CollX help describes adding cards and selling from the app. CDP documents an integrated CollX connection, and CDP advertises inventory import plus cross-channel delisting. Reusing CDP's connection would preserve the dependency we are removing. No CDP-specific feature is being added.

Primary references:
- CollX app workflow: https://www.collx.app/faq
- CollX seller lifecycle and settings: https://www.collx.app/marketplace-faq
- CDP CollX integration: https://support.carddealerpro.com/hc/en-us/articles/45990373454107-CollX-Connect-Your-Account-List-Cards-from-Card-Dealer-Pro
- CDP inventory lifecycle: https://www.carddealerpro.com/blog/inventory-management-is-here
- CDP auto-delisting: https://support.carddealerpro.com/hc/en-us/articles/48312488646811-Inventory-Sync-and-Auto-Delisting
- CollX contact route: https://www.collx.app/contact

The access request below is prepared for owner review only; it has not been sent.

The complete [access request](COLLX-ACCESS-REQUEST.md) is ready for owner review.

## Three-week parallel trial (0.6.0)

Tim requested existing live listings mirrored alongside CDP on October 20. Trial is read-only on the marketplaces: CDP continues managing existing listings. Start scheduled eBay sync from the connected device after deployment; do not report it running until a saved successful sync and enabled status are verified. Review `/#mirror`, export history, and reconcile missing exact links before claiming price/quantity agreement. Obtain fresh CDP and CollX exports; older files may help identity review but must retain their original date and cannot prove current parity.

Acceptance remains incomplete until supported CollX API posting/reads, actual cross-channel lifecycle tests, old-order updates/refunds, stock reconciliation and authorized existing-listing edits/endings are verified. Identical prices alone are insufficient. Do not send the prepared CollX access request without authorization.
