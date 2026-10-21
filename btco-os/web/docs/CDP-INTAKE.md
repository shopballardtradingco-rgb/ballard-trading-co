# CDP-first intake

CDP remains Ballard Trading Co.’s listing hub. BTCo OS provides identification, research, cost/location notes and a shared reference to the same physical inventory. A manual link is not a live CDP connection.

## Working flow

1. Identify front/back photos in Vision. Successful identification saves an intake draft in the current workspace. Blank/unusable identifications may need a title before the draft can be saved; Recent scans retains the provider result. Manual review can also save a draft without a SKU.
2. Review the card fields. Save intake draft preserves edits without counting inventory. Continue draft restores it on another signed-in device. Original recognition is retained alongside reviewed fields.
3. Find the existing CDP card, or enter the new physical copy in CDP through the established listing workflow. Copy its exact SKU.
4. Select an existing Vault candidate or enter the CDP SKU. Imported CDP aliases and the existing inventory SKU are both searched exactly, case-insensitively. Confirm the CDP record and the physical copy.
5. Linking an existing record appends reviewed intake evidence and a manual CDP link. It does not replace its title/identity, source data, inventory SKU, marketplace ID, quantities, stock status, location, costs, prices or sales. Review proposed changes in the attached evidence and edit the record separately if needed. A new Vault counterpart receives the confirmed CDP SKU, one unit, Intake status and pending physical verification.

CDP retains listing creation and management. eBay, CollX and Whatnot listing IDs remain channel-specific references. This release does not write to any of those services, perform automatic sales reconciliation or prevent cross-marketplace overselling through delisting. Continue the existing CDP workflow.

## Identity rules

`item.id` is the internal stable identifier. `item.sku` retains the existing inventory/marketplace SKU. `source.cdpSku` retains imported provenance. `item.cdpLink` records the manually confirmed CDP master SKU, method and timestamp. An imported CDP SKU may not be changed by intake linking. New records use the CDP master SKU as their inventory SKU. Existing records may retain an older marketplace alias.

The October 6 source baseline contains 2,474 CDP SKU mappings; 529 differ from the retained marketplace/inventory SKU. These are existing source records, not current live inventory counts. No bulk renaming or reimport is performed.

New generated Vision SKU placeholders are not accepted as CDP master SKUs. Repeated scan linkage, exact certificate duplication, conflicting graders/certificates, ambiguous or conflicting CDP mappings, and unconfirmed similar physical copies are blocked. Linking a sold or review-held record does not restore available stock. eBay report refresh flags a conflicting CDP alias for reconciliation instead of adding another inventory record.

## Persistence and compatibility

Drafts are append-only `vision.intake.saved` events; completed links are `vision.intake.linked` events. Each carries a validated record snapshot. The latest event per draft ID supplies its current view. No new database table, storage array or backup-schema version is needed. The original provider identity and timestamps remain immutable through subsequent draft edits. Photos and credentials are excluded.

The draft/link events and inventory counterpart are saved together in the existing shared workspace revision transaction. Concurrent stale saves fail rather than creating a second item. Existing server history preservation prevents a stale/old client from dropping or rewriting intake events. Full JSON backup import and device migration include draft-only records; conflicts preserve the current copy and the device backup. Inventory CSV excludes draft-only records and exports CDP SKU/link basis for linked items.

No CDP API validation is implied by a user confirmation. Automatic import/export handoff and live marketplace reconciliation remain follow-up integration work. Existing generic manual inventory entry remains available for other workflows and is not relabeled as CDP-connected.

## Acceptance and rollback

Automated acceptance covers draft creation and replay, zero inventory impact before linking, alias preservation, existing sold/review records, new-item confirmation, duplicate/conflicting identity, draft-only backup import, device conflicts, owner isolation, atomic linkage and stale saves. The original 3,817-record source fixture must remain unchanged through shared serialization.

Physical-phone acceptance is still required: scan a card, see its draft on another device, link one existing CDP record without increasing inventory, and link one genuinely new CDP item exactly once. No physical acceptance or actual CDP write is claimed by automated tests.

Code rollback to Site 13 preserves intake events and optional link fields in the existing schema, but the older UI will not expose pending drafts or enforce this intake workflow. Do not resume old Vision receipt while CDP-first operation is required. Prefer a forward fix; never restore older inventory data merely to roll back code.
