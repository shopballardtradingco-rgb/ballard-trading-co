# Core marketplace hub — owner direction, October 20, 2026

Latest maintenance direction: no new features in the current pass. Improve performance and independence from paid tools, CDP first and ChatGPT second. The other marketplaces remain secondary in delivery order and integral to the owner's eventual patent strategy. Preserve channel contracts and dated implementation evidence; the future phases below are not authorization to expand this maintenance release. See [dependency audit](DEPENDENCY-AUDIT.md).

Core is the operating hub. The owner approved an exception-first listing workflow and, in later phases, HipComic, Mercari and CollX publishing and sale synchronization. Marketplace publication still requires the owner's final confirmation for the exact reviewed cards. This direction does not authorize sending the prepared CollX access request or purchasing services.

## Phase 1: current eBay card workflow

- Keep ready cards moving; put only cards needing correction and their specific fields at the front of the same scrolling page.
- Save corrections individually so one rejected edit does not prevent other valid cards from advancing. Keep rejected edits visible.
- Apply existing account defaults, including the named inventory location. Keep completed account settings compact and reviewable.
- Prepare exact card snapshots, show prices and shipping, then use one Publish confirmation. Cancel must make no approval or publication call. Unknown publication outcomes must reconcile before a retry; never create duplicates.
- Do not guess card conditions, manufacture missing identifiers, overwrite originals or change physical stock while preparing a listing.

## Next phase: confirmed sales and manual closure queue

Implement a durable sale-event ledger keyed by channel, order and line item. Require confirmed sale evidence, an exact reviewed master-SKU/physical-item mapping and appropriate quantity. Never interpret a missing listing or a CSV mismatch as proof of a sale. Preserve cancelled-order, refund and multi-quantity distinctions; do not automatically restock a refund.

After a confirmed sale, update Core's available quantity once and enqueue closure or quantity adjustment for each matching listing on other channels. Retain immutable sale evidence, each attempt and the remote read-back. Make work idempotent across restarts and repeated events. A listing remains pending until the marketplace confirms closure; a successful request alone is insufficient.

If access, an unsupported channel, ambiguous mapping or a failed request prevents completion, show a prominent Core action: item and master SKU, sold-on channel, remaining channel, exact listing link, failure reason and last attempt. Provide “Open listing” and “I ended this manually”; record the latter as owner-reported until independently verified. Do not silently retry unknown outcomes or label the channels synchronized. Prevent re-publication of stock reserved by a sale event. Surface stale polling and disconnected channels.

## Later channel phases

| Channel | Required delivery | Current limitation |
| --- | --- | --- |
| eBay | Verified publication, confirmed-order ingestion and reconciliation; lifecycle updates | Card publishing exists; read-only mirror is separate and does not apply sales to stock or other channels |
| HipComic | Listing identity mapping, supported publication/update/end path and confirmed sales | End-to-end Core connection is not implemented |
| Mercari | Supported account access, mapping and publication/lifecycle path | End-to-end Core connection is not implemented |
| CollX | Supported API/export access, independent prices, publication, sales and delisting | Records and comparison imports exist; direct posting and lifecycle access are not connected |

Use supported connectors/APIs where available, and report manual work explicitly where they are unavailable. Preserve independent channel prices. Do not infer identity from equal titles or prices. A listing that has not been verified live is never counted as published. Ship and validate channel phases separately; no claim of complete CDP parity until real acceptance evidence exists.

## Acceptance evidence before enabling synchronization

Synthetic tests must cover duplicate sale events, concurrent sales, partial/multi-quantity sales, cancelled/refunded orders, absent or ambiguous SKU mappings, stale exports, connector expiry, rate limits, delayed read-back and restart recovery. An owner-approved pilot must prove that one sale updates Core once and every other channel is either verified adjusted/ended or visibly awaiting manual action. Show last successful sync, current state and a stop control.

0.7.0 delivers the listing workflow changes only. It does not enable cross-channel sale synchronization or automatic/manual-delisting alerts; those remain the next lifecycle phase.
