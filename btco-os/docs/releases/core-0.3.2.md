# BTCore 0.3.2 — whole-dollar asking prices

Asking prices now round to the nearest whole dollar: $5.99 becomes $6, $7.99 becomes $8, $5.49 becomes $5, and $5.50 becomes $6. AI recommendations, draft/inventory saves and bulk approval use the same cent-based rule. Asking-price displays omit redundant cents. CDP Start Price remains a standard decimal CSV value such as `6.00`, with no fractional dollars.

Purchase costs, source sale comparisons, fees, shipping and actual sale receipts retain exact cents. Unknown prices stay unknown, invalid monetary input still fails validation, and a positive amount rounding down to zero cannot pass listing approval.

Existing records are not mass-rewritten on deployment. Older drafts display the rounded asking price; approval persists it after validating the exact selected content and photo requirements. AI applied-price tracking follows this normalization so it does not spuriously queue another paid preparation. Previously approved fractional asks export at the requested whole-dollar price without changing their records or revoking existing image links. Other approval changes still invalidate the exact-content review normally. No marketplace prices or inventory quantities are changed.

Validation covers $5.99/$7.99 examples, .49/.50 boundaries, null/zero/invalid input, card/comic/other saves, cost preservation, old-draft approval and preparation tracking, legacy CDP export with stable photo links, and photo requirements. The mobile mixed-batch browser test verifies whole-dollar displayed AI prices through approval and export. Existing CI gates run before automatic deployment.
