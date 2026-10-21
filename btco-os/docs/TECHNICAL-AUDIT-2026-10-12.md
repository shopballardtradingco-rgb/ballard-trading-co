# BTCo OS technical audit — October 12, 2026

This audit distinguishes repository evidence, deployed observations, synthetic tests and work that still needs acceptance. GitHub remains canonical. No production inventory mutation, account permission upgrade, paid infrastructure provisioning or eBay publication was performed for this audit.

## 1. Verified repository state and history

| Repository | Inspected main at start | Actual version | Tracked files |
|---|---|---|---:|
| `shopballardtradingco-rgb/btco-os` | `47157c0118dbf26a4b9daf833c416d4fb43f6c28` | Browser 0.11.1; independent Python utility 0.2.0 | 278 |
| `shopballardtradingco-rgb/btco-ebay-connector` | `346b67639917ff1dd4c895b2114a989ada0331a6` | 0.2.0 plus an unintegrated listing-draft module | 20 |

Every retrieved file was checked against its Git blob SHA and original file mode. The complete path/hash inventory is [source-inventory-2026-10-12.json](source-inventory-2026-10-12.json). Both repositories use `main`; neither had Git tags or GitHub Releases. The OS also has `cost-baseline-20261012` at `c6c81d1cf601cadc6c4361be43f6e1d77f55209d`; it was not merged or overwritten. Both main branches report unprotected. Scope this finding as a release-governance risk, not an authorization to change repository permissions.

Canonical OS history verifies `a2aab65` (Vault 0.1.0), `b5f8bad` (foundation 0.2.0/browser 0.11.0), `29e3c70` (release evidence), then `47157c0` (browser 0.11.1 startup correction). Earlier browser hashes exist in the Sites mirror ancestry, not canonical GitHub main's pre-consolidation history:

| Handoff hash | Verified mirror package version |
|---|---|
| `fbd4bcf585e5447abcebe5c73685bd361b56bbb5` | 0.5.0 |
| `c0536cfca1d35a6caaec3ed1f702719ad25373a0` | 0.6.0 |
| `695ca6cf61644475d48fd1c76c0f583cf07094eb` | 0.7.0 |
| `3ffaf50103230439f23326534899f8ea89f1a706` | 0.7.1 |
| `5f8faef5ee51c11555f89a29b90b26d2aa1af4b3` | 0.7.4 |
| `98741f233122cf530b7d5541479fa46fc39e59c8` | 0.7.5 |
| `bab5084851faba108b68cded9d743cedaeb94518` | 0.9.0 |

Historical 67/101/188-test claims are release-history evidence, not current totals. The draft commit `346b676` did succeed. However, it added no draft tests, was not connected to MCP tools, and its object-reference regex rejected normal image extensions. It did not enable listing publication.

## 2. Actual source/module inventory

| Source area at inspected baseline | Files | Implementation |
|---|---:|---|
| `btco_os/` | 3 | Independent SQLite operator CLI, core, package marker |
| `web/app/` | 15 | Browser shell and API route adapters |
| `web/domain/` | 14 | Inventory, money, imports, sync packing, Vision intake/economics, eBay reconciliation, module projections |
| `web/server/` | 7 | D1 Vault persistence, inventory writer, recognition/PSA providers, credentials and operations |
| `web/db/` + `web/drizzle/` | 9 | Implemented D1 schema and migrations |
| `web/public/` | 11 | Browser UI/storage/CSS/release metadata; proposed architecture/SQL |
| `web/components/` | 62 | UI components, many reusable scaffolding rather than independent business features |
| `web/native/` | 10 | Maintained SwiftUI/AVFoundation iPhone project and assets |
| `web/services/` | 6 | Optional recovered Node Vision service and locked dependencies |
| `web/archive/` | 40 | Original Vision source artifacts with verified SHA-256 fingerprints |
| `web/tests/` | 17 | Domain, API, real Worker/D1, service and mocked browser-connection tests |
| Connector `btco_ebay/` | 8 | Existing OAuth, encryption, eBay reads, inventory pagination, server/config and incomplete draft contract |
| Connector `tests/` | 2 | Original 48 cases; no draft tests at baseline |

The JSON inventory includes all remaining build, scripts, docs, package and config files. Maintained native source and all 40 archive fingerprints are present. The old claim of 27 integrated artifacts is not an exhaustive current inventory. No known listed archive is missing; completeness relative to every prior chat attachment remains unproven. `web/public/schema.sql` is a proposed PostgreSQL design, not the deployed database.

## 3. Implemented versus proposed

| Area | Implemented and verified in source/tests | Still proposed, blocked or unverified |
|---|---|---|
| Vault | Shared D1 workspace, local IndexedDB recovery, checksummed chunks, revisions, ten snapshots, preserved backups, sales/cost records, independent channel asks | Normalized large-scale inventory, tenant membership/roles, stock reservations |
| eBay sync | Read-only OAuth and complete paginated active feed; scoped atomic preview/apply; replay and conflict checks | A freshly applied production reconciliation was deliberately not performed; independent scheduled-run delivery/alerting proof remains incomplete |
| CDP | Literal master identity in Python; reviewed browser scan-to-CDP linkage; source aliases retained | Reliable dedicated current-CDP CSV intake and authoritative comparison against a fresh CDP export |
| CollX | Independent price fields, provenance and manual/source-enrichment paths | Reliable CollX listing-price ingestion/live adapter; eBay/CDP prices must never fill CollX by inference |
| Vision | Provider requests, usage limits, idempotency, review drafts, matching, archived/native source, public PSA lookup | Real-card accuracy acceptance; retained browser scan originals; native account sync; actual iPhone camera/compile acceptance |
| PSA | Denied-access diagnostics and public lookup fallback; mocked provider tests | Approved-customer API access; no new live PSA verification was performed |
| Scout | Purchase economics, budget and sold-evidence checks, minimum 5% promotion | Saved sourcing jobs, verified exact-card sold data, leading-indicator feeds |
| Market | Channel price comparison and exact-identity duplicate review | Automated exact-issue pricing/repricing and trend metrics |
| Flow | Collection validation, reconciliation review queue and history; existing daily schedule | Durable cross-service job queue, alert delivery and receipt reconciliation |
| Pulse | Recorded sales/net/cost coverage/activity projections | Normalized time-series operational metrics and financial completeness |
| Comic listings after connector 0.3.0 | Private original ingestion, complete revision-bound drafts, approvals, Sell/Media adapter, durable duplicate protection, live ID verification, existing fixed 5% CPS campaigns; 103 synthetic tests | Live permission consent and acceptance; original approved pilot prose; batch review UI; automatic comic identification/SEO proposals; verified sold-comp retrieval; receipt-to-Vault adapter |

Native compilation is not implied by Swift source recovery. AI recognition and PSA verification are independent acceptance gates. A successful provider mock or historical blank-image response does not establish real-card recognition accuracy.

## 4. Inventory persistence and reconciliation

The browser's source of truth is an owner-scoped D1 manifest and immutable content-addressed chunks. IndexedDB is a device cache/recovery source. Optimistic revisions stop stale saves; a transaction advances the manifest and snapshot together. Chunk integrity, missing uploads, owner isolation, historical event preservation and replay behavior pass automated tests against SQLite and real Worker/D1. The independent Python SQLite utility does not synchronize to this D1 workspace automatically.

Reconciliation matches eBay IDs, keeps marketplace aliases distinct from CDP masters, protects physical quantity, costs, sales, manual prices, CollX values and review exclusions. An unseen listing creates a missing-observation review; it does not delete stock or infer a sale. An unmatched listing becomes an unverified review record with zero physical units. Variation listings and SKU collisions are blocked for review. A complete paginated feed is still not an atomic marketplace snapshot.

Read-only production observations:

| Observation | Verified result | Limit |
|---|---|---|
| Fresh eBay audit around 20:28–20:30 UTC | 3,588 records, 3,588 unique item IDs, 18 pages, stable totals, 138 blank listing SKUs | Active listings, not physical inventory; not applied to Vault |
| Vault workspace | Revision 44, last update `2026-10-12T15:15:00.916Z` | Bounded database tool truncates the manifest; current total item count was not independently recomputed |
| Stored reconciliation receipt | 3,573 source rows/18 pages, 69 quantity differences, 32 missing observations, zero SKU conflicts; imported `2026-10-12T14:14:31.172Z` | An older saved observation; these are not current discrepancy counts |
| Schedule | Existing enabled daily 7 AM `America/Los_Angeles` inventory automation | Enabled configuration plus a stored receipt does not prove every future run succeeds |

The handoff's 3,817/3,532/2,193/1,329/282 and 3,886 figures are historical snapshots. They were not substituted for present inventory counts. Current zero-SKU-conflict claims require a fresh authorized CDP/Vault comparison; the old receipt alone cannot establish that.

## 5. Findings and safe implementation delivered

| Priority | Finding | Disposition |
|---|---|---|
| P0 integrity | Browser intake normalized an established master SKU's capitalization/whitespace | Fixed in 0.11.2: normalize only candidate lookup, copy master identity verbatim |
| P0 integrity | A structurally valid shared snapshot could replace/remove `source.cdpSku`, `source.cdpId` or `cdpLink.sku` | Fixed in 0.11.2 with server-side preservation checks and regression tests |
| P0 publication | Draft code landed without tests or an operational approval-bound publishing path | Connector 0.3.0 adds tests, full material fingerprints, original checksums, protected write tools, durable intents and duplicate claims; production gate remains off |
| P1 security | Inventory service writer relies on owner-private Sites boundary and fixed owner/seller configuration | Retained private. Add independent service principals before audience expansion |
| P1 scale/recovery | 15 MB workspace cap and one connector SQLite/volume; no verified offsite photo restore drill | No destructive migration. Pilot encrypted photo quota 150 MB; approve object-storage expense before scaling |
| P1 identity | Raw/graded intake matching blocks conflicting nonempty grader/certificate values but needs stronger explicit unknown-versus-raw classification | Tighten receipt/linking acceptance before high-volume scanning; never merge or infer physical ownership from a marketplace record |
| P1 operations | Connector previously had no CI | Added GitHub Actions; run `38306688295` passed for `c04970d` |
| P2 governance | Main branches unprotected; no tags/releases; previous docs mixed package and browser version lines | Audit/source inventory and exact deployment mapping added; permissions changes require owner approval |

No credentials or original photographs were committed. The connector retains encrypted grants, drafts, approvals, originals and publication journals; OAuth revocation removes the grant and upload tickets while preserving audit history. Its new original upload is authenticated, bounded, single-use and checksum-verified. No URL-fetch ingestion or generated product photography exists. At-rest encryption does not remove the need for a protected key, backup policy and restore test.

## 6. Verification and deployment

- Initial connector baseline: 48 tests passed. After implementation: 103 pass on Python 3.12, bytecode compile and wheel build pass. Two upstream framework deprecation warnings remain.
- Browser: 136 tests pass, including 3 added test cases and stronger existing assertions. Four targeted assertions reproduced the defects before the fixes. Release marker checks, 40 original archive hashes, TypeScript and production build pass.
- Independent Vault Python: all 10 tests pass. Combined count is 249 tests across separate packages, not 249 live end-to-end acceptance cases.
- Preexisting OS main CI run `38203613522` succeeded. Runs on `cost-baseline-20261012` were not confused with main.
- Connector release is committed at `c04970df98dbca950937e5a6bb8fe8f5f66b3286`; branch and all 21 changed file hashes/modes were read back and verified. New GitHub Actions run `38306688295` succeeded.
- Existing Railway service: project **BTCo eBay Connector**, one production replica, `/data` 500 MB persistent volume, no object bucket. New release deployment is tracked in [RELEASES.md](RELEASES.md); only terminal success counts as deployed. Publication defaults false, and no new runtime expense or account scope was activated.
- Existing private browser URL: https://legacy-site.example.invalid . At audit start, saved Site version 17 / mirror `fe091ee661af835d62d103ad95b1ca22f0fc26da` had terminal succeeded deployment `appgdep_6acc60dbfb6c8191b9bd86607f655713`, environment revision 3. Owner-only access was verified. 0.11.2 source/deployment mapping is recorded separately after publication.
- Supported interactive browser QA and Mac/Xcode/device access were unavailable. No mobile/desktop visual or native-build acceptance is claimed. The current real inventory count is unverified because database reads are truncated; deployment must preserve the observed workspace revision rather than reconstruct its contents.

## 7. Pilot status and concrete activation requirements

The owner's five approvals remain recognized: Elementals #6 (February 1986) $8, SuperPatriot #1 (1993) $7, StormWatch #1 (1993) $8, Journey #2 (1983) $10, Elfquest: Siege at Blue Mountain #4 $7. Total $40; whole-dollar prices only. All ten original front/back photos were recovered and visually mapped. Exact previously reviewed individualized descriptions were not retrievable. No substitute text or images were approved or published.

Before live pilot acceptance: obtain the exact original approved text (or show revised complete drafts for renewed approval); request owner approval for `sell.inventory`, `sell.account.readonly`, `sell.marketing` through the connector's separate `btco:listings` consent; inspect existing seller policies/location/campaign and verify shipping/eligibility; ingest originals; save complete drafts; bind the original approval only if the content matches exactly; enable the server gate only once all checks are met. Then publish one approved listing, verify its same offer/item ID and live URL, reconcile its exact physical item in Vault with provenance, and continue the remaining four. A timeout must never start a new offer or draft.

## 8. Prioritized next three releases

| Release | Deliverable | Acceptance gate |
|---|---|---|
| OS 0.12 / connector 0.4 — pilot completion | Reviewable comic batch UI, explicit raw/graded identity rules, approved text recovery, scoped live consent, measured shipping where needed, publication receipt-to-Vault reconciliation | All five approved originals/text/whole-dollar prices matched; five verified unique live IDs; retries create zero duplicates; exact master SKUs and existing stock remain protected; no unapproved publication |
| OS 0.13 / connector 0.5 — reliable batch operations | Exact-issue sold-evidence capture and whole-dollar recommendations, source-evidenced identity/text suggestions, deterministic CDP/CollX import contracts, durable scheduled jobs/alerts; approved private object storage and backup drill | Real comic/card acceptance batch; reject mismatched printing/variant comps; reliable CSV replay; complete daily sync receipts and actionable alerts; verified photo restore; mobile/desktop and iPhone acceptance |
| OS 0.14 / connector 0.6 — commercial foundation | Tenant/membership authorization and service principals, normalized inventory/listing ledger migration, tenant-scoped keys/storage/queues; saved Scout opportunities, Market trend evidence, Flow recovery and Pulse operational metrics | Cross-tenant denial tests and independent review; staged migration counts/hashes and rollback drill; subscription/billing costs approved separately; performance at hundreds of new listings without losing owner approval control |

Do not start SaaS onboarding by simply making the current owner-private Site public. Keep the working single-business system intact while delivering these milestones incrementally.
