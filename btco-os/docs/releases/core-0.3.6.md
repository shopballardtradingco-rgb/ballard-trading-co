# BTCore 0.3.6 — bulk review editing

Step 1 of the CDP replacement plan only. No direct marketplace publishing, inventory migration or order sync is introduced.

- Edit selected ready cards or up to 500 unapproved cards in one form, including existing prices and listing conditions.
- Apply an owner-entered shared price or condition to displayed rows; blank shared values leave that field unchanged. Inspect rows before saving.
- Prices round to whole dollars. Saving selects only ready cards within the edited batch; explicit bulk approval remains separate.
- Filter review by ready, attention, preparing or approved. Selection is retained across filters and its scope is explained beside the control.
- Finish remaining includes only cards with blockers. Existing original photos, SKUs, costs, approved cards and inventory are preserved. Back photos stay optional for every card.

Validation: syntax and standalone unit suite; mobile preparation browser acceptance covers editing existing values, filtered selection, rounding, excluded cards and explicit approval. Existing stale-content and atomic-validation tests cover the reused details API.

Deployment uses the existing gated development release workflow. No production inventory edits or marketplace publication are part of acceptance.
