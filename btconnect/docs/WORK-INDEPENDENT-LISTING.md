# BTConnect without Work — October 16, 2026

The immediate goal is the complete comic listing workflow in ordinary ChatGPT,
with execution and durable records on the existing BTConnect service. Perfect AI
identification is not a release gate. Unknown facts require an owner correction;
they are never invented. Hosted paid research is optional and remains disabled
in production. No new service, dashboard, subscription or database is required.

## Operational path

| Owner / ChatGPT action | Hosted operation |
| --- | --- |
| Attach actual originals, give physical location and shared settings | `ingest_original_photos` stores original bytes with checksum and seller ownership; no client hashing or file script |
| ChatGPT inspects images and researches available references; owner corrects uncertain facts | `get_comic_intake_contract` describes the evidence required by `prepare_comic_intake`; server builds individualized drafts, disclosures, stable SKUs and location records |
| If optional hosted research already exists, correct only the fields that are wrong | `list_comic_research` / `get_comic_research` recover the saved proposal; `prepare_researched_comic_intake` accepts explicit owner corrections, retains original photos, and drops prior price comparisons after a correction |
| Review the complete batch and resolve exceptions in chat | `get_listing_batch_review` exposes exact drafts, original photos, prices, shipping and research; preparation resumes without repeating unchanged successes |
| Explicitly approve the final review | `approve_listing_batch` binds the owner's actual approval to the exact review; corrections invalidate prior approval |
| Publish approved items | `publish_approved_batch` uses existing eBay integration, duplicate checks, bounded processing and uncertain-outcome reconciliation |
| Return in a new chat | `list_listing_batches` recovers work; verified item IDs and `get_publication_receipt` recover publication records without local files |

ChatGPT can supply observed facts directly; it does not need to run a local vision
script or an API client. Low AI confidence does not block complete owner-confirmed
facts. Missing required facts, mismatched photos and unapproved listing revisions
still stop the affected item. Unknown printing/variant stays unspecified.

For example, an actual owner correction of “issue 3, 1985, Good, light edge wear”
can update the saved research selection without re-uploading photos or paying for
another research call. Corrected facts and the owner's price are preserved in the
review; original AI claims remain in the audit history. Any final listing change
requires a new publication approval.

## Verification

The full connector suite passes **466 tests**. Native HTTP MCP tests cover two
paths: chat-supplied observations with AI unconfigured, and owner-corrected saved
research. Both ingest synthetic originals, prepare a draft, restart the service,
recover the batch, reject publication without approval, explicitly approve, verify
a simulated published item ID, and retrieve its receipt. Repeating publication
creates no second offer. Correcting a prepared research draft invalidates the old
approval. Research discovery is paginated and seller-scoped, including uncertain
attempts without issuing another paid call.

These are backend tests with simulated HTTPS/eBay. They do not prove real ChatGPT
attachment handoff or live publication. Earlier ordinary-Chat acceptance failed
with a host “Model not found” error before any tool call; no evidence yet establishes
that host issue is resolved. Tool advertisement alone is not acceptance.

## Existing-service rollout

1. Obtain approval to merge/deploy connector PR #7. Railway follows `main`, so a
   merge is production-impacting. Keep `/data`, encryption/signing keys, OAuth
   connections, publication settings and all existing records intact. Add no AI
   key or budget variables; this release needs neither.
2. Wait for successful deployment and verify health/version 0.5.0, seller identity,
   existing saved records, and the new intake/correction/research-discovery tools.
   Refresh tools on the existing BTConnect app without replacing its connections.
3. In a fresh conversation visibly using regular Chat, select BTConnect, attach
   one new comic's actual originals, and create a **draft only**. Review the full
   result, make one correction, and recover that saved batch in another fresh Chat.
   Record actual tool calls and any host failure. No Work browser/file step is part
   of the routine workflow. This functional check does not require five comics.
4. A live publication test requires separate explicit approval of its complete
   final listing. Verify the resulting item ID and local receipt. Deployment
   approval never authorizes publication.

Rollback uses the prior production commit
`c8b874b4777dee00ab0801a09f3ef2d8542550c5` and preserves `/data` and keys. There is
no destructive schema migration. Inspect in-flight publication journals before
rollback; never replay an uncertain marketplace write blindly.

## Follow-up boundaries

The five-comic manual-baseline comparison and AI accuracy work remain recorded
deliverables, not release prerequisites for owner-reviewed hosted execution. No
speed or owner-interaction improvement is claimed without those measurements.
This change makes no paid API requests and leaves the existing pilot ledger intact.

BTConnect owns its durable local listing/publication records. Independent exchange
with BTCore Vault remains separate Sync work; a receipt is not proof of a Vault
update. Card publication is still unsupported by the comic contract. Neither gap
requires adding Work to the comic listing execution path. Standalone BTCore and
new interfaces remain later work.
