# Independent publisher security maintenance — October 21, 2026 Pacific

This recovery pass adds no product features and contacts no Railway service.

- Prevent settings diagnostics from printing the eBay developer secret or the
  connector encryption key. This closes a disclosure path; it does not establish
  that existing logs exposed either value.
- Require a fresh owner-initiated manual workflow run for new listing approval.
  GitHub reruns retain the original actor; checking only that field was insufficient.
  Both original and triggering actors must be the owner and run attempt must be 1.
  Resume an already approved exact revision with a fresh dispatch and approval
  unchecked. A rerun is not a new owner approval.
- Pin all connector workflow actions to reviewed Git commit IDs and prevent
  checkout from retaining repository credentials. Production secrets remain
  scoped to the `ebay-publisher` job environment; PR validation receives none.

Tests cover diagnostic redaction and rerun/different-actor rejection, alongside
the existing uncertain-publication, stale-writer and durable-checkpoint suite.
No approval, credential, live batch, inventory or marketplace record was changed.
Activation still requires independently recovered connector state, valid privately
configured seller credentials and a real single-writer handoff. See the independent
publisher release notes. Missing GitHub configuration is not evidence of compromise.
