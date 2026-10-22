# Core staged-card handoff — October 22, 2026

The independent worker previously could only resume batches already saved in
BTConnect. Core-only staged cards had no input path. This repair transfers a
verified Core backup into the same recovered connector journal. It adds no
inventory database, hosted service, subscription or eBay authorization shortcut.

## Export the exact staged selection

From the public source checkout, install the existing Core dependencies, then:

```sh
node tools/export-publisher-input.mjs \
  --backup /private/recovery/Core.ndjson \
  --batch CORE_BATCH_ID --seller STABLE_EBAY_SELLER_ID \
  --settings /private/recovery/reviewed-ebay-settings.json \
  --output /private/recovery/core-publisher-input.json
```

The settings file has the existing `compileCard` settings structure: categoryId,
locationKey, campaignId/campaignHash/campaignMode, policies (or shippingGroups
with policies and measured parcel), and cards keyed by exact Core draft ID with
conditionId and descriptors. Use actual selected seller policies and campaign
snapshots. Do not invent IDs, select arbitrary policies or infer a condition.
The existing connector preparation revalidates these against eBay before review.
No settings are fabricated for unconfigured Core batches.

The exporter runs Core's actual backup parser, original checksum checks, staged
review validation and card compiler. It preserves master SKUs, physical IDs,
prices, locations, original bytes and front-only cards. It refuses changed,
already transferred, approved or publishing batches; those must resume from
their existing journal. It writes a new mode-600 file outside the source checkout
and refuses overwrite. The bounded recovery tool accepts backups up to 100 MB;
it does not replace Core's streaming full-workspace restore.

## Import without approving or publishing

First complete the private journal recovery and single-writer handoff described
in `independent-publisher-2026-10-22.md`. Run from a clean canonical private
connector checkout at its exact successful push-CI commit, with the existing
private GitHub/archive/store/seller configuration:

```sh
python -m scripts.import_core_handoff \
  --input /private/recovery/core-publisher-input.json \
  --tested-commit EXACT_CONNECTOR_COMMIT
```

The importer restores the existing journal, verifies seller/photo/physical-copy
identities and the complete card contracts, then stores originals and submits
unchanged batch inputs using the existing batch engine. Source provenance is
encrypted with the journal. Every transaction reaches the private GitHub branch
before the next step. It makes no eBay request and grants no approval.

Repeat the exact input after interruption. Same-input retries preserve saved
approvals, jobs, offer/listing IDs and receipts. A different snapshot or a draft
that conflicts with existing work stops the import. Missing state never starts
an empty replacement. Keep the source backup and private handoff independently.
Do not run another publisher while transferring or importing.

Use the returned batch IDs in the existing GitHub workflow: `prepare`, download
and review the complete private artifact, then a separately owner-approved
`publish` with its exact review revision. Re-importing does not authorize a sale.

## Verification and remaining activation

Tests cover the actual Core backup/export-to-connector preparation contract,
changed/partial backups, seller/checksum/identity mismatches, lost checkpoint
responses and restart, preserved uncertain jobs, and re-import after a verified
synthetic publication without a duplicate create or publish.

This closes the source-level staged-input gap. Live activation still requires
the independently recovered connector journal and encryption key, privately
configured eBay authorization, actual reviewed shipping/condition selections,
and a confirmed single writer. A live pilot requires its own exact owner
approval and verified eBay item ID. Tests are not live-publication evidence.
