# BTCo Connect — Chat batch workflow

Release candidate: **0.4.0**. Build impact: **Connect only**.
BTCo Core, R2, Railway credentials and production deployments are unchanged.

## Owner experience

The target is one batch request, one complete review and one publication approval.
Chat handles multiple connector calls without asking permission between comics.
Missing identity evidence, ambiguous photo matches, unapproved parcel estimates
and uncertain publication results remain genuine exceptions.

This is connector-managed durable progress, not a scheduled background worker.
After an interrupted chat, Chat retrieves the batch and resumes the same records.
It does not claim that work continued while disconnected.

## What changed

- The live 0.3.13 contract advertised only the newer extras disclosure while the
  model also required the older interior/completeness sentence in both fields.
  The contract now exposes **every exact required sentence by field**.
- Batch preparation appends those required sentences to existing individualized
  exterior-only descriptions before review. It never changes the inspection scope,
  fabricates evidence, infers printing/variant, or rewrites an approved draft.
- Stored originals and saved drafts are discoverable without remembering their
  IDs in the conversation. Original bytes can be viewed privately and checksummed.
- Batches persist submitted inputs, physical inventory location, per-copy photo
  references, saved revisions, exceptions, approvals and publication progress.
- Approval is atomic across eligible drafts, bound to the complete review digest.
  Physical location, exceptions and the proposed recovery policy are part of it.
- Bounded publication calls resume the existing per-listing journals, continue
  other eligible comics after a failure and return one consolidated status.

Historical draft serialization is unchanged. Existing revision hashes, approvals,
receipts, original bytes, SKU reservations and publication journals are preserved.

## Tools and sequence

| Step | Tools | Behavior |
| --- | --- | --- |
| Recover work | `list_listing_batches`, `get_listing_batch` | Durable status and exact revisions |
| Recover older records | `list_saved_listing_drafts`, `list_stored_photos`, `get_stored_original_photo` | Private original inspection; no re-upload |
| Prepare | `get_listing_contract`, policy/campaign snapshot tools, `prepare_listing_batch` | Validate, check fresh policies/duplicates, save eligible drafts |
| Resume preparation | `resume_listing_batch` | Reuse saved input; isolate errors |
| Owner review | `get_listing_batch_review` | Paginated full drafts, original matches, shipping, location and recovery policy |
| Record approval | `approve_listing_batch` | Explicit owner evidence and exact review revision; no eBay writes |
| Publish/resume | `publish_approved_batch` | Bounded chunk, same offers, verified IDs and separate exceptions |

Retrieve every review page with the same `expected_review_revision`. Present
the full buyer-facing descriptions, condition descriptions, prices, Best Offer,
original photographs, policy terms, shipping measurements/authorized estimate,
location and retry policy before approval. A title/price table alone is insufficient.

The existing individual draft, approval and publication tools remain supported.

### Batch input

`prepare_listing_batch` accepts a `batch` object:

- `batch_id`: stable `btco-batch-...` identifier.
- `inventory_location`: physical storage, for example `SIMPLE-TRUTH-SEC3-2`.
  This is distinct from eBay's merchant shipping address.
- `items`: up to 100 entries, each with stable `item_key`, `label`, and either
  a complete `draft` or an explicit `unresolved_reason`.
- `expected_draft_revision` inside an item is needed when changing a saved draft.
- `confirmed_rejection_retry_limit`: 0 by default; 1 can be proposed in the
  owner review. It is not authorized merely by creating the batch.

Identical resubmission is idempotent and cannot reset approvals or progress.
Changed batch inputs require the current `expected_revision`. After publication
starts, do not replace the batch inputs or create a replacement batch to evade
an unresolved offer. Existing individual recovery/revision operations remain gated.

The MCP request body remains limited to 256 KiB. Use appropriately sized batches
if unusually long descriptions exceed it. Private originals travel through native
file ingestion, not inside the batch JSON.

### Recovery boundaries

Missing/invalid eBay image references may retry the missing upload, with up to
three attempts recorded across calls. Already journaled images are reused.
This addresses the four such failures recorded in the previous 14-comic run.
Never change or re-encode originals to make a retry pass.

A lost publication response is reconciled using the saved offer and live reads.
It never permits a second offer or another unverified publish request.
Policy changes, content differences, duplicates and stale approval remain blocked.

An owner-reviewed `confirmed_rejection_retry_limit: 1` permits at most one
same-offer retry after a definite HTTP 400 rejection, at least five minutes after
the failed attempt, and only after fresh content, policy, photo and duplicate
checks. This calls the existing guarded recovery path. A timeout/5xx/unknown
outcome cannot qualify. The recovery allowance is consumed before the request;
an interrupted retry cannot rearm it.

Each publication call processes at most `max_items` (default 3, maximum 10),
with a 40-second call budget. Chat follows `continue_automatically` and
`next_retry_at`, without busy polling or requesting permission between calls.
Retries that cannot safely continue are reported as `owner_action`.

`verified_count` means complete publisher verification and a durable receipt.
A known live item awaiting checks is reported separately. Promotion is
`verified`, `unsupported` with a reason, or `unverified`; never assumed.
Vault reconciliation is still a separately reported step.

### Legacy photo recovery

Old photo metadata may have no original filename or recorded front/back role.
The catalog reconstructs an existing object reference from its stored checksum
and actual file extension without modifying or re-uploading it. Unknown metadata
stays unknown. Prefer saved draft photo pairs; otherwise inspect the original.
Catalog listing alone does not perform a fresh integrity check. Private retrieval,
draft preparation, approval and publication verify stored bytes as applicable.

New ingests record filenames, host file IDs and declared roles in encrypted
metadata. Temporary signed download URLs are never included in that metadata.
No public photo URL, extra storage service or Core credential is introduced.

## Chat operator instructions

Use BTCo Connect as the authority for saved batches, drafts and publication
results. Discover existing work before starting or re-uploading. Research exact
identity, visually match original photographs, and retain the supplied physical
location. Use whole-dollar prices and individualized condition descriptions.
Reuse approved facts only within their recorded scope; never invent inspection
results, shipping authorization, printing or variant.

Prepare the whole batch, continue eligible items and group genuine exceptions.
Fetch all review pages and present one complete approval package. After explicit
owner approval of that exact package and its stated recovery policy, record
batch approval and process/resume bounded publication calls independently.
After an interruption, retrieve durable status first. Return verified eBay IDs,
prices, revisions, promotion status and exceptions together.

## Release and acceptance gates

1. Review and merge the Connect development PR only after owner release approval.
   There is no authorization in this change to publish inventory.
2. Use the existing Connect release process and verify the 0.4.0 health/version,
   authenticated tool discovery and read-only recovery on existing records.
3. Refresh the existing Chat connector's tool discovery if needed; do not recreate
   the connection unless consent is actually missing.
4. In regular Chat, prepare a new owner-provided batch. Verify no repeated
   continuation prompts, complete review pages and recovery after an interruption.
5. Publish only after that batch's separate exact-revision owner approval. Verify
   live IDs and promotion results. Do not use historical inventory as a live test.

Local tests use synthetic originals and simulated eBay. They establish connector
behavior, including MCP/OAuth boundaries, but not a completed new batch in the
regular Chat UI or fresh live eBay publication. Those checks remain release gates.

Rollback can restore 0.3.13 code without rewriting stored drafts or photos.
The older build does not expose batch records; preserve the encrypted database
and volume, then resume with 0.4.0 when the release is corrected.
