# BTCore 0.3.4 — finish blocked cards together

The review queue previously left users facing disabled bulk approval with no efficient way to complete missing fields. Finish remaining now presents unfinished cards together with missing asking-price and condition inputs, original-photo thumbnails, descriptions, condition notes and photo uploads. Owner-entered defaults fill only blank inputs; existing fields remain unchanged. Live readiness feedback shows which cards will be selectable after saving.

Photos save immediately. Detail corrections save atomically after exact-content validation, then eligible cards are selected for the existing owner confirmation. No card is approved by saving details. Unresolved cards remain queued without blocking eligible cards. Preparation is disabled when the current queue contains no jobs to prepare.

The new details endpoint accepts only asking-price and condition edits for unapproved, unfinished cards that are not preparing. It rejects stale content, duplicate rows, invalid values and attempts to modify unrelated fields before changing any record. Existing CSRF, origin, revision and idempotency protections apply. No production data migration, AI call or automatic approval is performed by this release.

Validation covers atomic conflict handling, price rounding, review separation and mobile recovery from a zero-ready mixed queue, including fill-blanks behavior, back-photo upload while preserving typed fields, partial completion, approval and CDP export.

The acceptance test waits for the final approval response and dialog closure before checking persisted approval counts; a pre-existing remaining-card label does not indicate that an approval has completed.
