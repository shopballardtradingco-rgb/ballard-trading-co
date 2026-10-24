Pricing: AI research never sets the asking price. Check price on older AI-prepared cards, or enter a price for new cards, before listing approval. A suggestion is based only on matching reported sales within 180 days, uses the median item price before shipping and fees, and still needs the owner to inspect its sources. Manual asking prices do not require comps.

> Latest: 0.7.2 — Performance and independence maintenance; no new product features. See [release notes](../docs/releases/0.7.2.md), [dependency audit](../docs/DEPENDENCY-AUDIT.md) and [CDP replacement acceptance ledger](../docs/CDP-REPLACEMENT.md). Direct CollX posting remains unconnected.

# BTCore standalone application · 0.7.2

A private, independently authenticated inventory and intake application for Ballard Trading Co. It runs on Node 22 and PostgreSQL with no ChatGPT, Sites, MCP, or external identity dependency. Optional card preparation uses the OpenAI API. The existing `web/` Site and BTConnect remain separate products and data stores.

## Working in this release

- One owner account with a single-use setup code, scrypt password hashing, hashed server sessions, same-origin/CSRF checks, login throttling, password rotation, and sign-out.
- Responsive desktop/phone UI and an installable home-screen manifest. Online saving is required.
- Searchable inventory, exact local SKUs, costs, asking prices, locations, holds, sale recording and preserved reversals. Existing `web/domain/core.mjs` supplies stock and financial rules.
- Saved manual intake drafts, immutable front/back originals, separate JPEG previews, original SHA-256 verification, full review, and explicit confirmation into physical inventory.
- Batch intake for up to 500 mixed front-only or paired card photos: review order, swap before upload, pause/resume, and retry without duplicate drafts or photos. Files not yet uploaded remain only in the open tab.
- Correct front/back assignments or replace a photo before confirmation. Previous originals remain downloadable and included in backups; corrections clear both review checks.
- Search and filter unfinished, received, and archived intake. Archive is reversible and never changes physical stock.
- Whole-dollar asking prices for cards, comics and other collectibles. Nearest-dollar rounding uses half-up ($5.99 → $6, $7.99 → $8, $5.50 → $6). Unknown acquisition cost stays unknown. Core-generated SKUs never claim a CDP mapping.
- Compare-and-save revisions and request replay protection; two devices cannot silently overwrite one another.
- CSV exports, listing-preparation packets with `publicationApproved: false`, complete streamed backups, and verified restore into an empty workspace only.

Direct eBay card publication is available through BTConnect with explicit owner review. Automatic eBay/HC/CollX synchronization, direct CollX posting, scheduled backups, multi-user roles, and native iPhone packaging are **not connected**. This is a bounded Core Dev release, not a production inventory migration.

## Run locally

```sh
npm ci --prefix core --ignore-scripts
# Supply your own random setup code out of source. Store only its SHA-256 digest.
BTCORE_LOCAL=1 \
BTCORE_SQLITE_PATH=/private/btcore/core.sqlite \
BTCORE_ORIGIN=http://127.0.0.1:3000 \
BTCORE_SETUP_TOKEN_HASH=<64-character-sha256> \
node core/server.mjs
```

Open the origin, enter the setup code, and choose your owner email/password. The code cannot create another account after the first owner exists. Remove the setup digest from the hosting environment after setup. Local SQLite is explicit, loopback-only development; the hosted process refuses to fall back to it.

## Dedicated Core Dev deployment

Build from the repository root using `core/Dockerfile`. Configure start `node core/server.mjs`, pre-deploy `node core/provision.mjs`, healthcheck `/healthz`, port 3000 and root `/` through Railway service settings. Config-as-code `railway.json` is deprecated by the current Railway control plane; no such manifest is required. Do not use the existing Site manifest. Track the tested `release/btcore-development` branch without a permanent commit pin; do not attach Connect Production or change either default branch.

| Setting | Purpose |
| --- | --- |
| `BTCORE_ORIGIN` | Exact HTTPS origin; no trailing slash or path |
| `DATABASE_URL` | Dedicated Core Dev migration/admin connection, used by pre-deploy only |
| `BTCORE_APP_DB_PASSWORD` | Random application-role password, at least 32 characters |
| `BTCORE_APP_DATABASE_URL` | Same Core Dev DB using `btcore_app`; application runtime uses this restricted login |
| `BTCORE_SETUP_TOKEN_HASH` | SHA-256 digest of an owner-held random setup code |
| `PORT` | Supplied by host, default 3000 |

Pre-deploy runs `node core/provision.mjs`: idempotent, additive `core_*` tables and a restricted `btcore_app` login. It refuses database names without `dev` or `test`. The runtime does not migrate. The role has only usage and CRUD on the seven Core tables, not schema creation or role administration. Railway's shared service variable context still makes the migration secret available to the container environment; a separately credentialed migration job is a future hardening step. No secret values are logged.

Readiness is `/healthz`; the public login shell exposes no inventory. Sessions are Secure/HttpOnly/SameSite=Strict over HTTPS. There is no public registration, password email reset, or unauthenticated inventory route. A lost owner password needs an operator recovery step; do not reset the workspace.

## Storage and recovery decision

With dedicated object storage connected, originals and previews are saved in a private S3-compatible bucket, with a **10 GiB total original quota** and **12 MiB per original**. PostgreSQL holds metadata and immutable object references. Existing database photos remain readable and included in backups; no originals are migrated, compressed, or deleted. Local or unconfigured instances retain the 64 MiB database limit. Partial storage configuration refuses startup rather than silently falling back.

Set `BTCORE_S3_ENDPOINT`, `BTCORE_S3_BUCKET`, `BTCORE_S3_REGION`, `BTCORE_S3_ACCESS_KEY_ID`, and `BTCORE_S3_SECRET_ACCESS_KEY` through host-managed references. Railway uses virtual-host addressing; only set `BTCORE_S3_PATH_STYLE=1` for a provider requiring path style. Pre-deploy verifies bucket write/read integrity using one small system object, then applies additive nullable photo-reference columns. A deployment without bucket access fails before replacing the running service. The existing connector/R2 setup is unchanged.

Uploads are sequential; each original and preview is written with `If-None-Match: *` and SHA-256 readback verified before its database record commits. Retries reuse content-addressed objects. A failed transaction may leave an unreferenced immutable object; there is no automatic deletion. Downloading originals verifies their hashes. The 10 GiB quota counts saved original references including replacement history; previews and possible orphan objects also consume bucket bytes.

Exports stream originals one at a time. The operator file restore also streams, so it does not load a multi-gigabyte backup into memory. It verifies the complete footer and all original hashes before committing the restored workspace. Restore requires an empty destination and object storage for backups exceeding the database allowance. Keep using 0.3.0 or later after object-backed photos are saved; older runtimes cannot resolve their references.

JPEG, PNG and WebP are supported by the pinned decoder. HEIC is accepted only when the decoder can actually read it; otherwise the UI asks for JPEG/PNG. Physical iPhone/Safari/HEIC acceptance is still needed. A preview is always a separate derivative; original download and backup use unchanged uploaded bytes.

Original bytes are immutable. Before confirmation, front/back assignments can be swapped and a current photo can be replaced while preserving the previous original in history. History also counts toward the configured photo allowance. Each intake supports up to 50 photo replacements. Confirmed intake stays locked; archive/restore is available only for unfinished drafts. There is no photo deletion UI. Twenty state snapshots support diagnosis but are not off-site backups. The Settings backup includes state and original bytes; it excludes passwords, sessions and credentials. Keep it separately. A complete footer and matching hashes are required for restore. Version 0.2 writes `btcore-backup-v2`, including archives and previous originals, and also accepts old v1 backups. The v0.1 restore tool cannot read v2 backups. Take a backup before upgrade; after using v0.2 archive/history features, use v0.2 or later for runtime and recovery rather than downgrading in place.

```sh
# Destination must already have its own owner account and otherwise be empty.
# Select the dedicated destination DB through DATABASE_URL (operator connection).
node core/backup.mjs --file /private/BTCore-backup.ndjson --into-empty-workspace
```

Restore verifies every photo and association, regenerates previews, binds records to the destination owner, and adds a preserved restore event in one transaction. It refuses an occupied workspace. There is no automatic import from BTConnect, Sites/D1, eBay, or another account.

## Validation

```sh
npm test --prefix core
npm run check --prefix core
# Disposable database name must contain "test"; CI creates one.
BTCORE_TEST_DATABASE_URL=postgresql://.../btcore_test npm run test:postgres --prefix core
npx --prefix core playwright install chromium
npm run test:browser --prefix core
```

Browser tests create synthetic records, block external requests, exercise the complete workflow and 390px layout, and write screenshots outside tracked source. An existing Chromium binary can be selected with `BTCORE_CHROMIUM_EXECUTABLE`; `BTCORE_SCREENSHOT_DIR` chooses the QA output directory. The Docker build omits tests and browser tooling.

See [release notes](../docs/releases/core-0.2.0.md) and [architecture decision](../docs/BTCORE-STANDALONE.md).

## Optional open workspace (0.2.1)

The owner can set `BTCORE_ACCESS_MODE=open` on the dedicated development service to skip account setup and sign-in. Any visitor to that URL can view and edit the same workspace. The UI removes account/password/sign-out controls and identifies this mode in Settings. The default is `private`; unknown values fail startup.

Open mode preserves the owner ID, all saved inventory, original photos, and revision history. It retains same-origin and CSRF checks using separate temporary signed cookies. These cookies never become password-authenticated sessions. Set the variable back to `private` to require login again. If no account existed before open mode, the existing private setup-code flow claims the same owner record; it does not create a fresh workspace or reassign photos. No database schema migration is needed.

## Card preparation and CDP export (0.3.0)

Use **Intake → Prepare cards** for existing uploads. New card batches queue automatically after every original finishes saving. The server processes saved originals one card at a time, so leaving the browser does not stop preparation. It fills empty fields (or its own prior suggestions after a correction), preserves manual values, and never changes SKU, cost, location, physical quantity, or marketplace records. Ordinary low-value cards may use one front; premium, numbered, variant, autograph, memorabilia, graded, unknown and above-cutoff cards still need both sides.

The review page shows photos, suggested details, confidence, price basis, linked evidence, and missing requirements. Use **Select all ready** to select every eligible card (up to 500), deselect exceptions, then **Approve selected** and confirm the batch. A sticky toolbar keeps the selected count and approval controls visible on phones. Cards needing details/photos or still preparing are excluded; already-approved cards are not selected again. The confirmation is the owner's review acknowledgment, so there is no separate checkbox requirement for every card. Download the CDP CSV after approval.

Approval captures the exact details and photo assignments using a compact SHA-256 fingerprint, allowing 500-card selections without repeating descriptions in the request. The server checks every selected card before approving any; a changed card rejects the whole selection for another review. Changed details, photos or review checks invalidate approval and image access. The CSV uses the owner's 29-column CDP template; CORE SKUs are new-record identifiers, not established CDP master mappings. A repeated import is not known to be idempotent in CDP: review CDP's import preview and do not re-import the same cards blindly. Live importer acceptance remains a manual validation step. Export does not receive inventory or publish listings.

Images in approved exports use random, persistent capability URLs that CDP can fetch without a BTCore cookie. JPEG delivery images are derived from verified originals; originals remain unchanged. Links depend on this service staying available and the reviewed card remaining approved. They are not signed URLs that expire after a few minutes. An exported card's images are intentionally shared through those URLs.

Set `OPENAI_API_KEY` on the server. The deployment also supports the transport envelope `BTCORE_AI_KEY_ENCRYPTED` plus `BTCORE_AI_KEY_WRAPPING_KEY` (AES-256-GCM); both are host-managed secrets, never repository content or browser data. This envelope protects plaintext during setup transport, not against an actor with access to the full server environment. The local key is ignored by git. The provider endpoint is fixed to OpenAI and redirects are rejected. Image/text instructions cannot change SKU, inventory, account credentials or publishing decisions.

Model: `gpt-5.4-mini-2026-03-17`, up to two web-search calls and 4,000 output tokens per card. Read-only live smoke test completed on one saved card; synthetic automated tests do not call the provider. Source URLs must be returned by the search tool before they can substantiate sold/asking evidence. These remain suggestions for owner review, not independently verified valuations or authentication.

AI accounting reserves $0.40 before each request, then settles observed token/search usage. The service stops before exceeding its **$10 monthly AI allowance**; infrastructure charges are separate. Unknown-cost failures keep the reservation. Billing/auth failures pause queued work instead of repeatedly calling the provider. Queued jobs survive restarts; a running job interrupted for four minutes becomes an explicit retry, preventing silent repeat charges. Historical cost calculations use standard input $0.75/M, output $4.50/M and web-search $0.01/call, verified against OpenAI documentation on 2026-10-19; keep pricing current before changing the model.

Run `npm run test:preparation-browser --prefix core` for the upload → prepare → review → export mobile acceptance test. Existing unit, PostgreSQL, browser, backup and packaged-runtime gates remain required. No new schema or database-role privilege is required in this version; jobs, reviews and usage are additive workspace fields included in backups.

## Whole-dollar asking prices (0.3.2)

As of 0.3.2, AI recommendations and newly saved asking prices round to whole dollars. Review screens show the rounded asking price; approving an older draft persists that price and binds approval to it. CDP Start Price uses whole-dollar amounts, including already-approved older drafts, while Purchase Price retains exact cents. Existing saved history is not mass-rewritten, and existing approved image URLs remain usable. Purchase costs, source comparisons, fees, shipping and recorded sale amounts retain their original precision. A price that rounds to zero cannot be approved for CDP.

## Automatic development releases

Push reviewed source to `feature/card-bulk-upload`. The BTCore workflow runs unit, PostgreSQL, browser and container acceptance, waits for the repository's `Verify` workflow on the exact same commit, then advances `release/btcore-development`. Railway follows that release branch without a commit pin. Routine code releases need no dashboard Deploy click or Railway API token in GitHub.

Failed, pending or missing checks do not promote. Superseded candidates are skipped, and release updates cannot force or roll back history. Only the trusted development push job receives repository write permission; pull requests remain read-only. See [deployment automation and recovery](../docs/releases/core-auto-deploy.md). Infrastructure/secret changes and marketplace publication retain their separate approval requirements.

## One-photo cheap cards (0.3.3)

Value-based card intake uses the rounded asking price and the saved single-photo cutoff ($5 by default). At or below the cutoff, one front is enough regardless of classification, parallel, autograph, serial number or grading fields; a back is optional. Above-cutoff cards and explicit two-sided intake still require both sides. Unknown prices still need a price before approval. Identity, visible condition and description remain review requirements; an unpictured reverse is unassessed.

Review lists ready cards first and approved cards last. Select all ready excludes unfinished cards, so those exceptions do not prevent the rest from being approved and exported. Existing drafts use the new rule immediately without changing their saved fields or originals.

## Finish blocked cards together (0.3.4)

When no cards are ready, use **Finish remaining** to enter missing asking prices and listing conditions or upload missing backs without opening every intake. Optional owner-entered defaults apply only to blank inputs. Photos save immediately; other corrections save together with exact-content checks through `/api/preparation/details`. Saving selects completed cards, then **Approve selected** provides the final review confirmation. Unresolved cards remain queued. No price or condition is invented, and existing approved cards are excluded.

## Optional card backs (0.3.5)

This supersedes all earlier card cutoff rules: every trading card needs only a front photo, regardless of price, classification or saved photo policy. Back photos are optional. Existing backs are preserved and exported when present. Legacy classification/cutoff fields are retained without controlling requirements. Comics and other collectibles keep their existing requirements.

## Bulk review editing (0.3.6)

Use Edit batch to change existing asking prices and conditions for up to 500 unapproved cards, or select ready cards and choose Edit selected. Shared values apply only to displayed rows. Saving selects ready cards from that edit for a separate approval. Review filters separate ready, attention, preparing and approved cards; selection persists across filters.

## eBay batch staging (0.3.7)

Card review → eBay batches saves up to 500 approved cards as exact review snapshots. Saved batches survive reloads and reserve cards from duplicate local staging. Changed cards are flagged; remove the old batch and re-review before staging again. No eBay writes are enabled: BTConnect currently publishes comics only. Card-specific condition, shipping, seller-policy validation and authenticated transport are required before enabling publication. Staging is not publication approval and does not check external eBay duplicates.


## Side-by-side trial

Open `/#mirror` from Home or Settings. Start three-week eBay sync from a connected device. The first complete read must succeed before scheduling is enabled. The server checks every 15 minutes, reads the last 30 Pacific calendar days of orders, and stops after 21 days; it also survives restarts. Reconnect if the grant expires or is revoked. Stop clears the encrypted saved grant after any in-flight read finishes. Credentials live in `core_mirror_connection`, outside workspace exports and backups. Recovery requires reconnecting; the normal development provisioner creates and grants this table.

The mirror is separate from physical inventory. It keeps exact listing/order/line IDs, preserves absent listings as unresolved, and never creates stock, infers a sale, changes a target price, publishes or delists. CDP remains the writer for existing listings during this first trial. Existing Core publication still requires its own explicit final approval.

Import dated CDP and CollX CSV exports with explicit column mapping and preview. Blank prices/quantities stay unknown. CDP price means its eBay price; CollX is independent. Exact eBay IDs join CDP records; exact CollX IDs from those CDP records join CollX observations. Titles and SKU aliases never establish identity. Missing sources/links and stale exports mean incomplete coverage. Owner-provided CSVs are observations, not authenticated API evidence.

Export history regularly: latest observations, 5,000 changes (visible drop count), 2,000 run summaries and up to 20,000 order records are retained. Full workspace snapshots have the existing 12 MB cap and 20-revision retention. Orders older than the rolling 30-day query can miss later changes; financial reconciliation and cross-channel delisting are not implemented. CollX direct API sync/posting still needs supported access. This release does not establish full CDP parity.


## Check publication completed through another client

Open **Manage listings**, continue the saved group, and choose **Check eBay status**. Core reads the existing connector outcomes and updates the saved count. Complete verified groups show **Published on eBay** with their listing links. This action does not approve, retry, or publish listings and does not require ChatGPT. Save or discard unsaved edits first. A connection error preserves the previous saved status; retry the check when connected.

The connector and its saved publication journal remain required. This control is not a replacement for independent connector backups or a tested alternate host. Incomplete jobs retain their existing recovery requirements.
