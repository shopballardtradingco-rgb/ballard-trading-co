# Connect-first execution audit — October 15, 2026

Status updated October 16: **Work-independent execution is the immediate release
goal; perfect AI identification and the five-comic comparison are follow-up work.**
The candidate passes backend workflow tests; deployment and actual regular-Chat
attachment/recovery acceptance remain pending. See [the release path](WORK-INDEPENDENT-LISTING.md).
Owner directive: approved development, tests and PRs; no risky deployment, new expense,
bid, or unapproved listing publication. Build impact: BTConnect runtime only; BTCore
receives documentation separately. No production data or credentials are in this change.

## Verified architecture

| Resource | Observed state |
| --- | --- |
| Connector GitHub main | `c8b874b4777dee00ab0801a09f3ef2d8542550c5`; Python MCP, OAuth, encrypted SQLite and original photos |
| OS GitHub main | `de9dc775dbcfbb6b7b8e705d13ff516b527a3250`; existing Sites/D1 browser app, Python operator utility, Vision code |
| Railway BTCo eBay Connector | Production only; `btco-ebay-connector` follows main; one SFO replica; 500 MB volume at `/data`; successful deployment `3edfee77-4ca9-4eef-a490-4bf68a976eeb` |
| Live BTConnect | Version 0.4.1; 31 advertised tools, all exposed in this Work session; original storage, draft/batch approval and publication enabled; both existing links identify the same authorized seller |
| Railway BTCo OS | Development only; PostgreSQL 17 running with 1 GB volume; API service has no source, deployment or public domain |
| Existing OS changes | PR #2 HipComic operator pilot and PR #1 acquisition-cost baseline remain separate; neither changed or merged |

No staged Railway changes were present. Main is the production source and Railway
`checkSuites` is false: merging is a deployment-impacting action, not a routine
development step. No new environment/service was provisioned. Only variable **names**
were inspected; no secret values were requested. Connect has no configured AI-provider
variable. OS's API variable names include database/R2 placeholders, which are not proof
that object storage or a standalone listing API works. Later in this session the
owner approved creating a dedicated development OpenAI key and up to $5 total API
testing. The key was securely created locally; Railway configuration is unchanged.

## Work-dependency map

| Operation | Current implementation | Work dependency / remaining gap |
| --- | --- | --- |
| Receive actual photos | Native MCP file ingestion; server downloads original JPEG/PNG, hashes and encrypts it; batch file-index matching | Backend needs no Work files/browser. Regular-Chat attachment transfer remains unverified; raw-upload script is only a fallback |
| Identify collectible | Production caller supplies verified comic identity; OS has separate card Vision code | Candidate adds optional hosted original-photo analysis, saved proposals and explicit fact review. Archived real-image research is measured but imperfect; ordinary ChatGPT observations and owner corrections can feed hosted intake with paid AI off |
| Pricing/comps | Production caller supplies proposed price | Candidate adds bounded web research with source URL/date checks and separately labeled sold/asking candidates. No independent authentication of sales or dedicated sold-data feed; owner review remains required |
| Individual drafts | Caller builds full nested ListingDraft | Candidate assembles title, description, specifics, disclosures and stable identifiers on BTConnect from explicit observations |
| Pricing/shipping | Existing strict draft and policy validators; whole-dollar comic pricing, explicit Best Offer, reviewed 5% promotion, measured or expressly authorized estimated parcel | Candidate accepts shared settings once. No silent reuse of unrelated shipping authorization; new defaults are proposals until review |
| SKU/location | Stable listing SKU, physical-copy/photo reservations, exact CDP SKU preservation; batch physical location | Candidate derives repeatable IDs from the original front checksum when no physical ID is supplied; location stays in the revision-bound batch |
| Review/approval | Complete paginated server review; explicit exact-revision approval | Chat remains UI; Work not required by backend. Full original-photo review and regular-Chat acceptance still required |
| Publishing/verification | Hosted eBay image upload, Inventory/Offer APIs, duplicate scans, live read-back, promotion checks | Already hosted. No live publication authorized or attempted in this task |
| Inventory reconciliation | Atomic local publication journal/receipt; separate signed receipt export into OS Vault | Local listing records persist independently. Vault apply uses the Sites operator/service-token path; no durable independent Sync worker exists. Pending is not reconciled |
| Failures/retries | Durable batch/jobs, same-offer reconciliation, uncertain writes fail closed | Existing preparation repeats earlier successes. Candidate bounds preparation and resumes pending work first; publishing safeguards unchanged |
| Cards | Original image storage accepts card photos | Comic-only identity/category/condition/publication contract. Card publishing is not implemented; never force a card through it |

Code evidence: `photo_transfer.py`, `photos.py`, `listing_drafts.py`,
`listing_batches.py`, `publishing.py`, `receipts.py`; OS `web/server/vision-api.mjs`,
`web/server/publication-sync.mjs`, `web/scripts/publication-reconcile.mjs` and
`docs/ARCHITECTURE.md`. The prior regular-Chat report describes a host “Model not
found” error; this session did not retest another Chat. That report's statement
that production was 0.4.0 is superseded by today's live 0.4.1 response.

## Implemented slice

`prepare_comic_intake` is a deterministic hosted composer, not an AI recognizer.
The caller supplies matched original refs, identity and inspection evidence,
per-copy condition notes, price and offer floor, and research sources. The server
constructs buyer text and item specifics, adds required disclosures, validates
the existing contract, saves eligible drafts and leaves unknowns as exceptions.
`get_comic_intake_contract` describes both the envelope and per-item schema.

After the subsequent key and $5 budget authorization, the candidate also adds
`research_comic_photos`, `get_comic_research` and `prepare_researched_comic_intake`.
The hosted provider receives verified original bytes, returns identity/condition
and cited price proposals, and saves them with immutable request IDs. The service
does not equate AI confidence to verification: the owner must review the exact
research revision before it can enter draft assembly. Final listing publication
approval remains separate. See [the implementation and measured API check](HOSTED-COMIC-RESEARCH.md).

Research appears only in the complete owner review. Sold-comps basis requires at
least one caller-attested exact, condition-comparable sold observation with a sale
date. Asking-only basis stays labeled. The composer does not infer value, authenticate
the source, or turn the owner's proposed price into publication approval. Dates and
sources must still be assessed by the reviewer. No minimum sale price is introduced.

Original checksum-derived draft IDs and physical IDs survive a new chat or batch;
photo/SKU/copy uniqueness still prevents creating a second listing for the same
stored original. An existing CDP master SKU is copied exactly. Rephotographed copies
still need identity review; image hashes alone cannot prove physical uniqueness.

Preparation attempts at most five books or 35 seconds per call. A caller continues
`resume_listing_batch` while `continue_preparation` is true. Pending books precede
exceptions; unchanged successful drafts are not revalidated on every resume. The
review exposes their validation timestamp, not a claim of fresh readiness. Policy,
photo, content and duplicate checks still run before publication. Exceptions require
correction or a deliberate retry; there is no busy-loop or background auto-publisher.
Metrics record attempt duration, calls, failures and cancellations; they exclude
owner time, identification/research and some persistence/review overhead.

October 16 adds seller-scoped `list_comic_research` discovery and direct owner
corrections on saved research. Correction retains originals, removes prior AI price
comparisons, and supports revising prepared drafts with stale-write checks. Existing
approval is invalidated. Low AI confidence alone does not block complete owner-confirmed
facts. Native MCP tests cover the workflow with hosted AI unconfigured, including
restart, exact approval, simulated publication, verified IDs and repeat-call safety.

No ListingDraft fields or historical draft hashes changed. Historical batch input
serialization is preserved when the new evidence field is absent. Existing tools,
OAuth, accounts, storage, signing key and eBay publication journal remain intact.

## Owner actions and bottlenecks

| Step | Existing workflow | Candidate reduction | Evidence |
| --- | --- | --- | --- |
| Photograph and match copies | Owner supplies actual front/back and location | Same required inputs | No reduction claimed |
| Draft authoring | Caller assembles every full description and nested settings | Server assembles text/specifics; settings supplied once per batch | Working code + contract tests; owner time not measured |
| Recover interrupted preparation | Prior successful books checked again | Continue pending/failed books; no re-upload | Synthetic failure benchmark and cancellation tests |
| Correct research | Re-enter a complete observation or repeat research | Patch the saved item with actual owner corrections; keep photos and unchanged facts, no paid retry | Native MCP tests; actual owner time not measured |
| Approve batch | One full review + explicit approval | Same safety gate | Tests only; no new owner approval in this task |
| Publish + reconcile | Hosted publish; external Vault operator step remains | Hosted publish unchanged; Sync remains an open dependency | Read-only stored publication evidence |

The five-item synthetic input shrank from 10,331 to 7,629 JSON bytes (26.2%);
this is agent input size, **not** an owner-click reduction. No measured manual
listing baseline exists. See the [benchmark record](benchmarks/2026-10-15-connect-first.md).

## Product boundaries and priorities

- **BTConnect:** permanent ChatGPT-integrated product; operational execution belongs
  in its hosted service. Chat provides conversation and explicit owner decisions.
- **BTCore:** future standalone product; separate environment and data. Its migration
  must earn priority through measured productivity, not a second interface.
- **Shared:** intentionally reusable pure services/rules; no shared production database.
- **Sync:** explicit authenticated, replay-safe exchange with preview, conflict checks
  and read-back. A connector receipt alone never implies a Vault update or physical count.

P0 release: deploy the hosted intake/correction/recovery path after explicit approval,
then verify one new comic's draft and fresh-Chat recovery in ordinary ChatGPT with
hosted AI off. Maintain exact publication approval and verified local records.
A separately approved publication test follows complete review.

Follow-up P0 measurements: five representative comics against a timed manual baseline,
with owner actions, corrections and accuracy recorded. Optional research quality,
card support and independent external Sync stay tracked; they do not delay releasing
the owner-reviewed comic path. Do not claim productivity gains before measurement.

P1: larger batches; comic/card inventory reconciliation; supported multichannel
distribution and HC export repricing; preserve the existing HC pilot; Gixen CSV for
owner-approved caps/exposure; broader verified research. No bids or automatic exports
are authorized by this directive.

P2: standalone BTCore after measured gains; maintain BTConnect separately; explicit
Sync, tenant boundaries and migration/restore testing. Do not add dashboards,
subscriptions, databases or duplicated services to make this branch deployable.

## Readiness and next acceptance gates

**Ready for review and controlled rollout of the owner-reviewed hosted path with AI
off. Not yet deployed or accepted in ordinary Chat.** The full suite passes 466 tests;
HTTP MCP workflow tests cover both chat observations and owner-corrected saved
research through approval-controlled simulated publishing and restart/recovery.
Live production and existing approvals remain unchanged.

1. Approve merge/deploy of PR #7 to the existing service; no infrastructure or API
   credential changes are needed. Follow [the rollout](WORK-INDEPENDENT-LISTING.md).
2. Refresh the same app's tools and demonstrate actual original intake, complete
   review, one correction and fresh-Chat recovery with one new comic in regular Chat.
   The historical host “Model not found” failure still needs a real client recheck.
3. Publish only after explicit owner approval of a complete exact final review;
   verify the item ID and local record. External Vault Sync is reported separately.
4. Run the representative five-comic/manual-baseline comparison as follow-up work.
   The archived research tests and their failures remain historical evidence, not
   a release gate for this owner-reviewed route. No productivity gain is claimed.
5. Optional paid AI remains off in production. The existing development ledger is
   unchanged at $0.538042 estimated completed usage plus $2 uncertain reservations;
   $2.461958 remains of the same $5 allowance. This follow-up made no paid calls.

Rollback for a later approved release: deploy the recorded previous connector commit,
preserve `/data`, credentials, signing key and all records. No destructive migration
is needed. New metadata is additive; do not downgrade an in-flight operation without
first inspecting its journal. Tests do not constitute deployment or listing approval.
