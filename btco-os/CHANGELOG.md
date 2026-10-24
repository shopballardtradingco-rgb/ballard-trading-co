## BTCore 0.7.5 — Retry saved photo preparation failures

- Restart failed preparation explicitly from the listing desk, retaining settings, originals and completed transfers.
- Append newly prepared cards without changing existing connector groups; never retry approved publication through preparation.
- Add service and browser regression coverage for failed uploads followed by a same-batch retry.

## Recovery maintenance — 2026-10-21 Pacific

- Export the tested Core Docker image, source/image identifiers, browser hash and checksums from GitHub Actions for Railway-independent deployment.
- Pin workflow actions and disable persisted checkout credentials; retain existing publication and validation gates. No runtime feature, schema, data or credential change.
- See docs/deployment/INDEPENDENT-RUNTIME.md. A release artifact does not establish a live host or recover missing connector state.

## BTCore 0.7.4 — eBay publication progress repair

- Continue other approved cards when one card fails; use persisted connector outcomes instead of an increase in the verified-listing count to advance the queue.
- Skip cards requiring owner action and honor connector retry times. Stop unchanged responses instead of repeatedly polling or replaying uncertain writes.
- Display the connector's per-card errors and retry timing in the existing listing desk.
- Preserve exact review approval, original photos, SKUs, prices, policies, promotion rates and publication journals. No new features, dependencies or marketplace calls from CI.
- See docs/releases/0.7.4.md for reproduction, validation and release limits.

## BTCore 0.7.2 — 2026-10-20

## BTCore 0.7.3 — inventory locations and fulfillment

- Import original CDP inventory rows into Core with exact master identity, original cost evidence, all five physical-location fields and a dated migration baseline. Preview changes and retain exceptions without overwriting existing stock, costs or locations.
- Search linked CDP, CollX and eBay identifiers; link eBay records only when exact master SKU and exact title agree uniquely. Keep other mappings explicit and evidence-backed.
- Resolve order pick locations and consume confirmed paid stock once. Preserve cancellations/refunds for review without silently restocking. Keep historical orders behind the migration cutoff and financial sale reconciliation separate.
- Show missing, partial and conflicting locations in the Vault and order observations. CollX, HipComic and Mercari feeds and automatic delisting remain unconnected.
- Add synthetic import, lookup, fulfillment, replay, finance and mobile browser coverage. See docs/releases/0.7.3.md for validation and rollout gates.


- Compress/revalidate static assets once per process; authenticated preview revalidation avoids repeated object reads and never loads full database originals.
- Skip idle preparation locks and whole-workspace parsing; retain revision/lease wakeups, costs, retries and original integrity checks.
- Prevent overlapping/background preparation polls and delayed redraws over active edits.
- Document CDP-first and ChatGPT-second maintenance priorities while preserving secondary-market contracts and dated strategy evidence. No new product features, schema or paid dependencies. See docs/releases/0.7.2.md.

## BTCore 0.7.0 — 2026-10-20

## BTCore 0.7.1 — Identified years and owner condition defaults

- Reuse identified years and normalize seasons such as 2001–02 to 2001 without another year or price-review prompt.
- Apply owner-requested editable eBay defaults to existing unfinished cards and new preparation: Hoody’s or less than three years old → Near mint or better; other raw cards → Very good. Keep explicit dropdown overrides, graded choices and condition notes.
- Apply defaults through authenticated per-card guarded mutations, retain originals/stock, invalidate obsolete unapproved previews and preserve the active batch reference. Live/approved outcomes are locked.
- Validate source races, year ambiguity, age boundary, owner overrides, received inventory identity, API replay and mobile correction/publication flows.

- Put cards with issues and the exact correction fields at the front of one listing page; let ready cards advance. Keep other cards and completed account settings compact.
- Apply the named eBay inventory location, retain per-card correction failures and add one final Publish confirmation. Preserve fingerprints, original photos, stock and exact publication approval.
- Record Core-as-hub lifecycle requirements and explicit later-channel/manual-delisting gaps in docs/CORE-MARKETPLACE-HUB.md. See docs/releases/0.7.0.md.

## BTCore 0.6.9 — 2026-10-20

- Fix the actual payment blocker: eBay returns two Managed Payments policies, differing in immediate-payment requirements. Automatically use the non-immediate policy for Core's combined-shipping card workflow, preserving any valid saved choice.
- Verify the resolver against the live read-only account response and add the two-policy shape to the full mobile eBay regression. No eBay policy or listing changes. See docs/releases/0.6.9.md.

## BTCore 0.6.8 — 2026-10-20

- Apply the single live eBay payment policy automatically. Remove the editable payment selector and keep cached blank form values from overriding it.
- Retain a saved policy only when eBay still returns it; missing or ambiguous account configuration is a loading error, never an arbitrary policy choice. See docs/releases/0.6.8.md.

## BTCore 0.6.7 — 2026-10-20

- Stop unrelated workspace changes from blocking selected price/condition/shipping saves and listing preparation. Validate every selected card against current saved content under the transaction lock.
- Preserve newer unrelated work and increment from the latest revision. Actual card changes, stock locks, publication approval and future revisions still reject safely; other writes retain strict revision checks.
- Existing 0.6.6 tabs can retry without reloading or re-entering pending row edits. Clear stale saving-progress text on failures and identify the card involved in a real conflict.
- Add API concurrency, replay, atomic rejection and mobile regression coverage. See docs/releases/0.6.7.md.

## BTCore 0.6.6 — 2026-10-20

- Intake and eBay listings use one selection for inline bulk edits, shared shipping and explicit Publish selected. No repeated details/shipping/review dialogs.
- Ready selected cards continue while incomplete cards show their specific issues. Existing unapproved batches are resumed or regrouped automatically, retaining omitted cards and previous history.
- Reuse unchanged prepared reviews; refresh edited previews with saved shipping choices carried forward. Selection changes and pending selected edits disable stale publication actions.
- Reload resumes the saved selection; verified per-card status and links stay on the same page. Existing exact-review approval, stock locks and publication readback remain required. See docs/releases/0.6.6.md.

## BTCore 0.6.5 — 2026-10-20

- Checkboxes, Select all shown and an explicit selected-only price/condition/shipping bulk editor on card lists, with a compact reachable selection action on mobile.
- Raw card dropdowns contain only eBay's four condition choices. Numeric grades and legacy ranges stay visible as prior assessments outside the dropdown; no silent upgrade. Mixed item types cannot receive an incompatible bulk condition.
- Compact shipping group lists and expandable per-card eBay conditions replace walls of card titles. Mobile dialogs fit short screens, controls have touch-sized targets, and the bottom navigation no longer covers dialogs.
- Atomic server validation preserves unselected edits, originals, stock, independent channel prices and explicit publication approval. See docs/releases/0.6.5.md.

## BTCore 0.6.4 — 2026-10-20

- Inline price, condition dropdown and shipping controls on Intake, review, saved eBay batches and linked Vault rows, with mobile full-width cards and save-all.
- Eligible ungraded singles through $20 default to a shared reusable measured PWE setup. The owner's $0.78 postage baseline is explicitly separate from current rates and buyer shipping charges.
- Higher-priced singles, slabs, comics and lots do not inherit PWE. Lots and manual-review groups require packed measurements, a current cost estimate and explicit charge review.
- Unpublished saved rows edit in place; prepared previews are retired and rebuilt automatically with fresh final approval. Publishing/live/unknown outcomes, sold and held stock stay locked.
- Atomic conflict checks, original photos, stock, costs, exact SKUs and independent CollX prices are preserved. See docs/releases/0.6.4.md.

## BTCore 0.6.3 — 2026-10-20

- Fix nested BTConnect campaign options: show only eligible existing fixed 5% campaigns, preselect a sole match, reject blank/stale choices without changing a campaign.
- Support existing calculated card shipping using explicitly confirmed measured packed weight/dimensions. Separate low-value raw, high-value raw and graded shipping inside one saved batch; exclude Standard Envelope for cards over $20 and slabs.
- Preserve the saved group on invalid settings, map NM to the returned Near mint or better condition, and show each policy and measured parcel in final review. No automatic publication or invented parcel values.
- See `docs/releases/0.6.3.md` for regression coverage and remaining live acceptance.

## BTCore 0.6.2 — 2026-10-20

- Add a direct List on eBay flow from Home, card review and Vault records: review editable prices, continue to shipping, then approve publication.
- Save reviewed prices, card approval and the saved listing group atomically, including received cards. Preserve stock, originals and independent channel prices.
- Resume the same group after connection or reload; automatically open final review when preparation finishes. Select sole available policies without guessing among alternatives.
- See `docs/releases/0.6.2.md` for validation and remaining integration limits.

## BTCore 0.6.1 — 2026-10-20

- Restore mobile asking-price confirmation for cards already received into the Vault. Saving updates the existing inventory record and requires fresh listing approval.
- Hide the misleading Finish remaining action when no unfinished intake can use it; point price-only issues to Check price.
- Preserve originals, quantities, master SKUs and marketplace publication gates. See `docs/releases/0.6.1.md`.

## BTCore 0.6.0 — 2026-10-20

- Mirror existing eBay listings and recent orders without creating listings, inferring sales or changing physical inventory.
- Add a three-week, server-side read-only sync trial, complete-page validation, encrypted credentials, persistent retry status and stop control.
- Compare dated CDP and CollX CSV exports by exact external IDs, preserving independent prices and master SKUs; retain changes and exportable history.
- Add a phone-friendly side-by-side screen with missing-link, stale-source, price, quantity and status exceptions. CollX API posting/sync and cross-channel delisting remain disconnected.
- See `docs/releases/0.6.0.md` for evidence, deployment and trial limits.

## BTCore 0.5.0 — 2026-10-20

- Add independent CollX cents pricing and owner-recorded listing identity/status/price, with original photos and mobile access.
- Preserve exact item links, observed versus intended prices, physical stock and eBay approval; add conflicts, duplicate/stale protection and dedicated records export.
- Record CDP replacement acceptance gates, including the unresolved CollX posting contract and cross-channel sale/delisting lifecycle.
- See `docs/releases/0.5.0.md`; direct CollX posting is not connected.

## BTCore 0.4.2 — separate research from asking prices

AI preparation no longer writes asking prices. Older AI-prepared prices remain intact but need explicit price confirmation before approval/export/publication. Numeric research suggestions use the median of structurally matching recent reported sales; unsupported estimates remain blank. Mobile review distinguishes suggestions, sources and owner asking prices. Core release-branch CI now runs the standalone application, PostgreSQL, pricing and eBay browser tests.

## BTCore 0.4.1 — mobile price editing

Add direct Edit price actions beside review prices and at the top of intake details, including previously approved cards. Preserve revision checks and require review after price changes. Saved eBay batches direct the owner to remove/rebuild before editing.

# 0.4.0 — 2026-10-20

Direct card publication through BTConnect: owner eBay connection, original photos, policy/condition review, bulk approval and durable publication status.

## BTCore 0.3.7 — saved eBay review batches (2026-10-19)

- Stage approved cards in durable, exact-content eBay review batches; preserve original photos, costs, SKUs and stock.
- Reject stale reviews and duplicate local staging, detect later edits, and allow removing an unpublished batch.
- Keep publishing explicitly disconnected until card-specific BTConnect support and seller-policy review exist. See [release notes](docs/releases/core-0.3.7.md).

## BTCore 0.3.6 — bulk review editing (2026-10-19)

- Edit existing prices and conditions together for selected cards or an unapproved batch, with explicit shared values and whole-dollar rounding.
- Filter ready cards, exceptions, active preparation and prior approvals; keep selection visible across filters. Finish remaining contains only blocked cards.
- Saving selects only ready cards from the edited batch and still requires explicit approval. See [release notes](docs/releases/core-0.3.6.md).

## BTCore 0.3.5 — optional backs for every card (2026-10-19)

- Remove the back-photo requirement for all trading cards at any price, including premium cards, autographs, numbered cards, slabs and existing two-sided drafts.
- Remove card cutoff controls and update intake/review guidance. Existing back photos remain saved and usable; front photos and listing details still apply.
- Verify high-price front-only approval, receiving and export. See [release notes](docs/releases/core-0.3.5.md).

## BTCore 0.3.4 — finish blocked cards together (2026-10-19)

- Add Finish remaining for missing prices, listing conditions and photo uploads in one review form; optional owner-entered defaults fill blank fields only.
- Save corrections together, select ready cards automatically, and leave unresolved cards queued for later. Approval still uses a separate owner confirmation.
- Validate corrections atomically against exact card fingerprints, preserve original photos and existing approvals, and disable preparation when there is no work to queue. See [release notes](docs/releases/core-0.3.4.md).

## BTCore 0.3.3 — one-photo cheap cards (2026-10-19)

- Allow one front photo for any value-based card within its saved cutoff ($5 by default), including base, parallel, premium and unknown classifications.
- Keep unfinished cards out of bulk approval, show ready cards first and approved cards last, and identify missing fields precisely.
- Verify mixed-batch approval/export, optional backs, rounded cutoff boundaries and unchanged originals. See [release notes](docs/releases/core-0.3.3.md).

## BTCore 0.3.2 — whole-dollar asking prices (2026-10-19)

- Round asking prices to the nearest dollar, with half dollars rounding up, across AI suggestions, saved card/comic/collectible prices, review, bulk approval and CDP Start Price.
- Keep purchase costs, fees, shipping, source comparisons and recorded sales exact; retain unknown prices and existing approved image access.
- Verify rounding examples and boundaries, large-batch review compatibility, preserved acquisition costs and mobile price display. See [release notes](docs/releases/core-0.3.2.md).

## BTCore 0.3.1 — bulk card approval (2026-10-19)

- Select all ready cards, deselect exceptions or clear the selection, then approve up to 500 together with one batch confirmation.
- Sticky mobile controls show the selected count; missing requirements, active preparation and prior approvals are excluded from bulk selection.
- Compact exact-content fingerprints keep large approval requests small. Any changed selected card rejects the entire approval before mutations.
- Verified mixed-batch browser acceptance and 500-card, stale-content, photo and inventory preservation tests. See [release notes](docs/releases/core-0.3.1.md).

## BTCore development release automation (2026-10-19)

- Promote the exact current development commit only after the standalone runtime acceptance and repository Verify workflow pass.
- Railway follows `release/btcore-development` instead of a pinned commit, removing the routine dashboard Deploy step for code releases.
- Reject failed, missing, superseded or divergent candidates; use a scoped workflow token and fast-forward updates, with no new Railway credential.
- See [deployment automation](docs/releases/core-auto-deploy.md) for setup, recovery and acceptance.

## BTCore 0.3.0 — saved photos to reviewed CDP preparation (2026-10-19)

- Durable, budgeted card preparation for existing saved uploads and completed new batches; read-only vision and web evidence, retry/restart handling, and preservation of originals, SKUs, costs, locations and stock.
- Mobile review of suggested identity, pricing, condition, listing text and missing backs; batch approval bound to exact details/photos.
- CDP template CSV with stable approved-image URLs; edits revoke export approval. No marketplace publication or automatic physical-inventory change.
- Synthetic unit/recovery/export tests and mobile end-to-end acceptance; one real saved-card API smoke test. CDP's actual import preview is still to be verified.

# BTCore standalone 0.2.2 — 2026-10-19

Fix the 64 MiB total storage bottleneck blocking bulk phone-photo uploads. Dedicated object storage supplies 10 GiB for unchanged originals; existing DB photos remain readable. Stream large backup restoration, verify object integrity before commit, and add a home-screen Bulk upload button. See [release notes](docs/releases/core-0.2.2.md).

# BTCore standalone 0.2.1 — 2026-10-19

Add optional open access for the owner-requested development workflow: direct workspace entry with no setup/login, unchanged design and bulk intake, and a reversible configuration switch. Preserve inventory/photo ownership and cross-site write protection. See [release notes](docs/releases/core-0.2.1.md).

# BTCore card bulk intake — 2026-10-19

Add mixed front-only and paired card groups (up to 500 photos within storage allowance), editable single-photo price cutoff, conservative special-card requirements, and server-enforced review. Existing two-sided drafts retain their policy. See [release notes](docs/releases/core-card-bulk.md).

# BTCore standalone 0.2.0 — 2026-10-17 Pacific

Add paired batch photo intake with pause/resume and retry recovery, front/back correction, preserved photo replacement history, reversible draft archive, intake search/status filters, mobile camera controls, and backward-compatible v2 backups. Owner approved the v0.1 Core Dev launch; Railway repository access remains the external blocker. See [release notes](docs/releases/core-0.2.0.md).

# BTCore standalone 0.1.0 — 2026-10-17

Add the independent Core Dev app in `core/`: owner auth, PostgreSQL persistence, responsive inventory/intake UI, immutable photo originals, reviewed intake, recorded sales/reversals, complete backup/restore, restricted DB role and Docker/CI packaging. Existing Site and BTConnect data/runtime remain separate. No marketplace or production deployment. See [release notes](docs/releases/core-0.1.0.md).

# Changelog

## Browser 0.11.3 / connector 0.3.1 — 2026-10-12

Added signed publication receipt reconciliation and corrected optional listing-consent prompting. Deployment does not upgrade grants, approve drafts or publish listings.

## Browser 0.11.2 and connector 0.3.0 — 2026-10-12 Pacific

- Audit both canonical repositories and distinguish mirror history from canonical releases.
- Preserve literal CDP identifiers in intake and reject shared saves that replace them.
- Add full source inventory, current feature matrix, security findings and three-release roadmap.
- Connector 0.3.0 adds encrypted original-photo ingestion and tested approval-bound publication with the live gate disabled.
- Preserve production inventory and existing account permissions; no pilot listing published.

## Browser 0.11.1 hotfix — 2026-10-11 Pacific

- Correct a release regression that made saved inventory appear empty on devices requiring migration.
- Load existing shared inventory without retired source JSON assets; preserve local differences for review.
- Verify three connection regression tests and confirm production retains 3,886 records.
- Python foundation remains 0.2.0; no inventory migration or data restoration.


## 0.2.0 — 2026-10-11 Pacific

- Consolidate browser 0.11.0 and recovered Vision source in canonical GitHub.
- Verify live 18-page eBay reconciliation and retain the existing daily schedule.
- Add Market price/duplicate review, Flow queues/history and Scout acquisition worksheet.
- Replace private inventory fixtures with synthetic scale tests; stop shipping production seed data.
- Document runtime boundaries, audit findings, release process and prioritized SaaS backlog.


## 0.1.0 — 2026-10-11 Pacific

- Complete the empty CLI, tests, architecture and ignore files discovered in canonical GitHub.
- Add installable Python packaging and CI.
- Preserve exact CDP master SKUs and item identity during listing refreshes.
- Validate batches before writes; reject malformed money, quantities and duplicate IDs.
- Treat missing listings and duplicate marketplace aliases as review evidence.
- No connector, hosted database or production deployment changes.


