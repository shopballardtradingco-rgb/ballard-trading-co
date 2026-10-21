# Automated eBay listing development acceptance — October 13, 2026

## Verified release

Connector release **0.3.9** is deployed on the existing Railway production service.

- Canonical connector commit: `d4d3387f1d780e49fac9267526d572a0e92458d9`.
- Railway deployment: `7f30f92f-ad9e-4ef1-8a80-ba905718eb8e`, terminal **SUCCESS**.
- Authenticated connector status reports 0.3.9, listing access consented and publication enabled.
- GitHub CI: run `38415638384`, **success**, matching the release commit.
- All 15 changed source blobs were checked against the remote commit before main advanced.
- 278 connector tests pass; bytecode compilation and package build pass. Two existing upstream test-framework deprecation warnings remain.
- Seven current BTCo OS publication-receipt tests pass, including Worker/D1 persistence, signature validation, tenant separation, revision races, replay and preservation of literal CDP SKUs, stock, costs and existing marketplace identity.

The initial branch CI run found a stale test hardcoding version 0.3.8. The test now checks the actual package metadata; the corrected commit passed before production deployment.

## Original photo transfer

The existing raw upload endpoint is reachable through Work's configured network connection using curl. The new repository helper `scripts/upload_original.py` reads the one-use ticket through hidden stdin, preserves original bytes and checks the returned object checksum and role. It neither stores tokens in files nor puts them in command arguments.

A storage-only production test re-sent a previously ingested original JPEG of 847,590 bytes. The server returned the identical seller-bound object key, SHA-256 and front role. No image was regenerated or re-encoded, and no draft or eBay listing was created.

A second path, `ingest_original_photo`, supports native ChatGPT file input. It validates the host download destination, prevents redirects and seller-credential forwarding, limits download time and size, verifies the original checksum and image integrity, and reads encrypted storage back before returning success. Its host file injection is tested synthetically but has not yet been exercised with a new production upload. New tools may need connector tool discovery refreshed; the tested raw path works independently.

## Listing contract and recovery

The save tool advertises the full nested ListingDraft schema. New schema and validation tools provide required fields and field-level errors. New review drafts require Best Offer with an explicit floor, Good or Acceptable, packed-parcel evidence and fuller exterior-only disclosures. Existing draft hashes and approvals were not rewritten.

Publication errors now preserve the saved offer and known live item ID/URL, report their durable stage and distinguish a live listing awaiting verification from an unknown publication outcome. Promotion uses exact listing-ID read-back for the existing automatic campaign. Verified journal and receipt-source persistence now share one transaction.

The historical Elementals job did publish successfully, then stopped at promotion lookup error 35064. Its current inventory and offer match the saved approval. After release, the corrected read-only lookup returned the exact listing's ad at 5.0%. This inspection did not run the publish tool, modify the listing or change a campaign.

Its historical journal still lacks a finalized signed receipt. Do not claim that it has been reconciled or run a historical example through publication to repair that bookkeeping.

## Vault readiness

The owner-private production publication-sync endpoint reports configured=true, revision 45 and zero reconciled publication receipts at this check. The configured seller ID and receipt public key match the connector. Inventory, costs, quantities, locations, marketplace aliases, access settings and credentials were not changed.

Before a new publication, prepare or confirm the permanent physical inventory record and storage location. Link the resulting signed receipt to that identity; a marketplace observation alone cannot establish physical ownership, stock or acquisition source. Human-readable COM codes remain aliases rather than replacements for CDP or permanent identifiers.

## Historical exclusions and next acceptance

The owner confirms every prior example copy has already been listed. All ten listing entries from the handoff were independently observed active, including the Mr. Hero three-book lot. Existing asking prices matched the handoff; no price change was made. Never reuse these copies. Absence from a later active feed is not evidence that a copy is available.

The next test requires:
1. A completely new, unlisted comic with original front/back photographs and confirmed physical location.
2. Identity/condition review, duplicate checks and current policy/campaign snapshots.
3. A complete validated draft, saved revision and explicit owner approval of its exact content and photos.
4. One publication, live item/settings verification, and signed receipt preview/apply/read-back in Vault.

**No new comic has been supplied or approved. No new eBay publication or live Vault reconciliation was performed. End-to-end acceptance remains pending.** Batch publishing stays deferred until this succeeds.

See the [connector release notes](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/blob/d4d3387f1d780e49fac9267526d572a0e92458d9/docs/releases/0.3.9.md).
