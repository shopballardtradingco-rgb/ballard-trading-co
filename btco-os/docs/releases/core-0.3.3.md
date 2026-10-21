# BTCore 0.3.3 — one-photo cheap cards

The owner allows a single front photo for inexpensive cards. Value-based intake now uses only the rounded asking price and saved cutoff ($5 inclusive by default) to decide whether a back is required. Classification and special-card labels no longer veto a cheap card. Existing value-based drafts benefit immediately, with no data migration or new AI calls. Explicit two-sided policies and cards above the cutoff still require both sides.

Missing prices, identity or listing condition still need completion. The review page identifies the missing field and does not demand a back solely because a price is unknown. Ready cards appear first, approved cards last, and Select all ready excludes unfinished cards while allowing the rest of the batch through. Approval still requires owner confirmation and exact-content validation; no card is automatically approved. Original photos, SKUs, saved prices and inventory are not rewritten.

Validation covers cheap base/parallel/unknown/premium/autograph/numbered/graded cards, price and cutoff boundaries after whole-dollar rounding, unknown prices, explicit two-sided policies, and mixed-batch bulk approval/export with an above-cutoff card left behind. Browser acceptance checks one-photo cards, remaining-card ordering and persistent approvals.
