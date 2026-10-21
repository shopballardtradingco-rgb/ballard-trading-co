# Card bulk intake

Adds a mixed queue outside chat: add card fronts only, add front/back pairs, inspect grouping, remove groups or swap paired sides, then save with pause and retry recovery. Up to 500 images per queue, 12 MiB per image, subject to the existing 64 MiB total photo allowance. The preflight includes all queued bytes. Saved drafts survive leaving; unuploaded files require the tab to remain open.

For value-based card drafts, a reviewed ordinary card priced at or below an editable cutoff (default $5 inclusive) needs one front photo. Premium, unknown, above-cutoff, autographed, memorabilia, numbered, graded/certified, or variant cards require front and back. Unknown prices require both sides. Classification and price changes invalidate identity review. The server enforces the requirement, and single-photo review explicitly leaves reverse condition unassessed. Existing drafts default to two-sided policy; comics still require both sides.

Validation: unit/integration tests cover policy boundaries, receiving, review invalidation, 500-image limits, mixed grouping, atomic odd-pair rejection and interrupted uploads without duplicate drafts. Browser acceptance adds 11 front-only cards plus one paired card and single-photo confirmation. GitHub CI supplies browser/PostgreSQL checks when local runtimes are unavailable.

Limits: AI identification and the assistant/BTConnect bridge are not connected to this standalone app. CDP import/export and stable externally retrievable image URLs are not implemented here. No marketplace writes. Large real-world batches need original-photo object storage; the 500-image queue does not bypass the 64 MiB allowance. No new paid service or storage migration is included.
