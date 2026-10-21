# Hosted comic research — 0.5.0 candidate

Build impact: BTConnect only. Disabled by default. No deployment, production
credential change, new service, subscription or marketplace write has occurred.
The permanent BTCore environment and its separate Vision code/data stay separate.

## Execution and owner actions

1. Ingest actual front/back photographs through the existing native tools. Optional
   indicia/variant detail photos may be included (two to four originals, 32 MB total).
2. `research_comic_photos` sends checksum-verified, seller-owned originals to OpenAI
   on the service. The fixed Responses request analyzes visible identity/condition
   and may use at most two web searches. No Work filesystem or browser is involved
   in this operational path. No arbitrary endpoint, tool, system prompt or model
   can be supplied by a caller or by image/page content.
3. `list_comic_research` discovers saved attempts across chats; `get_comic_research` recovers the saved proposal and exact revision. Display the
   actual photos, uncertainty, proposed identity/condition, price, and clickable
   source URLs. Identity references are separate from market prices. Sold candidates
   require an observed sale date; asking prices remain asking. Every source must occur
   in the provider's completed search/open results or citations. Invalid market
   sources are visibly excluded and the proposed price/rationale removed. Invalid
   identity references also require an explicit identity correction before draft promotion.
   Publication year requires consistent visible-date or exact-issue evidence.
   A leading issue `#` is formatting; different suffixes/series are not silently
   equated. Explicit guide-value language is excluded from offer/sale evidence.
   Ambiguous marks and mark/stain claims hold condition, including negative claims.
   This currently over-flags some harmless wording; see the retest below.
4. After the owner confirms those facts and explicit whole-dollar price/offer terms,
   `prepare_researched_comic_intake` copies the reviewed evidence into the existing
   hosted composer. Supply shared shipping/policy settings and physical location
   once. Supply actual owner corrections in the selected item's `corrections` field;
   unchanged facts and original photos remain saved. Complete owner-confirmed facts
   need no high AI confidence. Missing facts, mismatched sides and noncomics remain
   exceptions. A correction drops prior AI price comparisons and uses the owner's
   explicit price. Revising a prepared draft requires its expected draft revision
   and current batch revision; changes invalidate publication approval.
5. Read the complete resulting listing batch. Only the owner's explicit approval of
   that exact final review authorizes the existing approval/publishing tools.
   Research confirmation itself neither approves nor publishes a listing.

This adds a fact-review step before final publication approval. Whether reduced
research/typing outweighs that step is **not measured**. Do not claim fewer owner
interactions until the representative five-comic trial is completed.

Unknown printing/variant stays unspecified. Partial printing/variant evidence is
retained in research but cannot become a full-identity claim in the draft. All AI
inspection is exterior-only. No numerical grade, hidden completeness, autograph
authentication, key or scarcity claim is inferred. Card publication remains unsupported.

## Configuration and cost controls

Provision `OPENAI_API_KEY` securely and set `BTCO_AI_BUDGET_USD` to the explicitly
authorized total ledger ceiling, from zero to five USD for this pilot. With the
existing pilot ledger the ceiling stays $5; remaining allowance is computed after
committed usage/reservations and is not a fresh budget. Both settings
default off. The local test key is in an ignored env file; the app does not load
that file automatically. A production key/budget must be configured deliberately
after separate deployment approval. Secrets are excluded from configuration repr.

The fixed model is `gpt-5.4-mini-2026-03-17`, also used by the separate OS Vision
implementation. Low reasoning effort, standard service tier, 6,000 maximum output tokens, two maximum
built-in tool calls, 50-second total timeout, no automatic HTTP retries, no redirect
following and a 2 MB response limit bound each request. Photos are sent as original
bytes; only the provider performs its normal vision input processing. `store:false`
disables Responses application storage; this is not a claim of zero provider retention.

An atomic transaction reserves **$1 per request** in the existing encrypted SQLite
records. With the documented 400k context and standard $0.75/M input, $4.50/M output,
and $0.01/web-call rates, three full-context passes plus the output/tool caps are
below $0.947. Cached-token discounts are ignored. The model/rates must be reviewed
before changing these assumptions. Accepted usage settles the reservation to a
conservative estimate. Missing usage, unexpected model/tier, interrupted calls,
HTTP errors and lost responses retain the full reservation. This favors stopping
early over spending beyond the approved test allowance.

The budget is global within the deployment, survives OAuth revocation/restarts and
does not reset daily, monthly, or with prompt versions. Persist its database. A
fresh database/environment has a distinct ledger: carry forward prior usage and
reservations before authorizing the remaining allowance elsewhere. It is an
application limit, not a Platform account/project billing cap and cannot constrain
other software using the key. No tool can raise or reset it.

An unfinished tool-call item can appear after the requested processing cap. Cost
estimates conservatively include it; only completed actions count as processed.
If completed actions or estimated cost exceed expected bounds, the persistent
ledger halts further paid requests for operator investigation, before parsing
the proposal. This is a second line of defense, not a provider billing guarantee.

Repeated request IDs return their saved result/failure/pending state without another
paid request. Changed photos require a distinct ID. A pending operation after a crash
or uncertain outcome must be investigated; a new ID is a separate deliberate paid
attempt, never an automatic retry. Saved research has no expiry and is dated; reuse
does not establish that old market prices remain current.

## Verification and limitations

Offline tests cover original byte/seller checks, schemas, citation/date rejection,
whole-dollar proposals, uncertain identity, owner-review bridging, final approval
remaining absent, concurrent reservations, restart persistence, cancellation,
redacted errors, default-disabled configuration and OAuth boundaries.

An actual API request using two newly created solid-color synthetic images
completed in **12.580073 seconds**: 6,547 input tokens, 337 output tokens, zero web
calls, estimated **$0.006427**. It correctly returned unknown identity, no condition,
no price and no sources. This verifies API access and the abstention/output path,
not collectible identification or live comparable-sale accuracy.

The owner subsequently explicitly approved original-photo egress for up to five
archived comics. The [actual five-comic replay](benchmarks/2026-10-15-archived-research.md)
completed five research proposals in **128.916933 seconds elapsed**, including
**101.484028 seconds** of service time. Only **3/5** had complete supported core
identities; one had a wrong year and another lacked year/publisher. One condition
claim mistook printed art for damage. No verified sold comps were obtained. A
historical identity discrepancy was also found and reported without changing live
inventory. This failed the research accuracy/productivity evaluation; it does not block the
owner-corrected hosted workflow under the October 16 priority.

Two initial diagnostic calls failed and drove evidence-handling fixes. The later
[same-five guard retest](benchmarks/2026-10-15-research-guard-retest.md) completed in
92.508577 service seconds, but still misidentified Elementals and held all five
conditions. Three holds are caused by negative wording; reduced owner effort is
not established. A preceding medium-reasoning request timed out and retains $1.
The final parser fixes an issue-marker false rejection and excludes guide values;
those fixes were verified against saved responses without further paid calls.
That follow-up passed **459 connector tests**; the October 16 correction/recovery
follow-up passes **466**, without additional paid requests. Completed pilot estimates now total **$0.538042**
plus **$2 uncertain reservations**: **$2.538042 committed/reserved**, **$2.461958
remaining**. Both uncertain reservations remain. These are not provider charges.

Source URL membership proves that the search tool returned a URL, **not** that a
price/sale/date, condition comparison or exact variant is correct. The provider's
source content is not independently reproduced by this service; sale records may
be unavailable behind marketplace access restrictions. All extracted sales/prices
remain owner-reviewed candidates. No new paid data subscription is introduced.

October 16 release priority: [Work-independent owner-reviewed execution](WORK-INDEPENDENT-LISTING.md)
can ship with this optional AI path disabled. Merge/deploy approval and actual
ordinary-Chat tool/attachment/recovery acceptance remain required. Research accuracy
and the representative five-comic timed comparison are follow-up work; the archived
test is not that representative trial. Live publishing requires exact owner approval.
External Vault Sync remains separate pending work.

## Official API references (checked 2026-10-15)

- [Model snapshot, modalities, context and standard rates](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Responses limits, service tier and storage](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Web search and sources](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Tool pricing](https://developers.openai.com/api/docs/pricing)
