# Live listing consent and original-photo ingestion — October 12, 2026

This acceptance step follows the isolated test in `2026-10-12-comic-dry-run.md`. It used deployed connector 0.3.1, canonical connector commit `7d0f35a8d6c080a1810cf04ddba3dedd82680769`.

## Verified live results

- The owner refreshed the ChatGPT connector tools and completed fresh account consent. All 18 tools became available.
- Authenticated status identifies the authorized seller as ballardtradingco, reports approval-gated mode and listing access consented.
- Listing readiness reports connector listing permission true and no missing upstream eBay scopes. Inventory, account-policy read and marketing scopes are present.
- The publication switch remains disabled.
- Ten original JPEGs, one front and one back for each of the five approved pilot comics, were ingested into the existing private encrypted production volume through single-use upload tickets.
- Every ingestion returned HTTP 201, the expected front/back role, the original SHA-256 checksum, and a stable seller-bound object reference. Original bytes were sent without editing or re-encoding.
- Upload tokens were passed through hidden process input and not persisted. No image bytes, object references, credentials, or private location addresses are included in Git.
- The real eBay business-policy and inventory-location reads succeeded. These were read-only API calls.

The earlier automatic in-chat permission challenge returned a host internal error. Server logs showed no application exception; the focused challenge and fresh-consent regression tests passed (2 tests). Successful interactive reconnection resolved the live account permission blocker. Do not report the automatic challenge itself as proven working in this host.

## Newly verified shipping limitation

All five existing fulfillment policies returned calculated shipping. One comic policy has a nonzero shipping-discount profile; a second has a name/description referring to an additional-comic amount but no discount profile. A policy name or description alone is not proof of that charge being enforced.

Connector 0.3.1 currently rejects calculated shipping because it has no measured package contract. Extend and test that contract using actual packed weight and dimensions before using the existing comic policy. Do not substitute an envelope policy, invent dimensions, create a new policy, or change live shipping configuration to bypass this requirement. Combined-shipping behavior and the selected complete policy snapshot still require review.

## Publication boundary and next acceptance

No eBay image upload, inventory-item creation, offer creation, listing publication, campaign change, or Vault reconciliation was performed in this step. The production changes were private original-photo ingestion and the owner's interactive account consent.

The five prior title/price approvals remain conditional on the exact previously reviewed descriptions and photographs. The exact description text has not been recovered in this workspace. Recover that text, or prepare replacement drafts and obtain explicit approval of every complete replacement revision. Also verify printing/variant and condition evidence, measured shipping, existing 5% campaign eligibility, duplicate checks, live publication read-back, and signed receipt reconciliation.

No new pilot item ID or live URL is available from this acceptance step.
