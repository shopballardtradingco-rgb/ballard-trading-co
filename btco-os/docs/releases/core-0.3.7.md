# BTCore 0.3.7 — eBay batch staging

First increment toward direct card publication. Card review now opens an eBay batch queue. Select approved cards, inspect their saved details, and stage an exact review snapshot. Batches persist across devices and reloads. Cards in active batches cannot be staged twice; changed cards are visibly flagged. Removing an unpublished batch releases those cards without changing inventory or originals.

This release does not publish or authorize publication. BTConnect main currently supports comic contracts only. Card-specific category/condition mapping, seller shipping/payment/return policies, authenticated standalone access and a recoverable publication worker remain required. External eBay duplicates have not been checked. The capability remains false and the publication button disabled.

Validation: standalone unit suite and mobile preparation browser acceptance, including stale/duplicate atomic rejection, operation replay, session protection, exact snapshot persistence, cancellation and no automatic publication. No real inventory was approved or published in testing.
