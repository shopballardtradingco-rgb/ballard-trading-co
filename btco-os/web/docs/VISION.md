# BTCo Vision in the OS · 0.9.0

## Current workflow

Open Vision on the signed-in phone, select front/back photos, and Identify. The browser normalizes supported camera files to JPEG at a maximum 2048-pixel dimension and under 3 MB per side. Only the explicit Identify action sends them to the hosted recognition endpoint. The existing OS Worker calls OpenAI directly; the Mac Node service is not required for browser identification or PSA lookup.

A successful photo identification also saves a shared intake draft. A draft does not have a listing SKU and is excluded from inventory counts. If that save fails, the identification remains recoverable from Recent scans and the UI explains that the intake is not saved. Manual/pasted results use Save intake draft. Edited draft fields require Save intake draft or Link CDP record to persist.

Review the proposed identity and shared Vault candidates. Use **Link to this record** for the same existing item, or enter its exact CDP SKU. Confirm both the physical copy and the SKU in CDP. If an exact SKU or known CDP alias exists, linking attaches the reviewed draft to that record while preserving all inventory identity, quantities, prices, costs, sales, source data and marketplace IDs. Proposed corrections remain visible in Linked Vision intake; they do not overwrite existing inventory fields. A sold or review-held record stays sold or excluded.

If no existing record matches, confirmed linking creates one Vault counterpart using the exact CDP SKU. Another similar physical copy requires a separate-copy confirmation. Duplicate certificates, reused scans, conflicting CDP identities and generated `BT-V-` placeholders are blocked. Existing Vision-generated SKUs can be linked to the real CDP record without renaming the old inventory SKU. New items retain unknown cost when blank and pending physical verification.

Pending drafts appear in Vision and as a count on the Vault sidebar. They are included in shared saves, recovery snapshots and full JSON backups. Inventory CSV contains only actual inventory records, with separate CDP master SKU and link-basis columns. CDP remains the listing hub; this release does not create CDP records, push listings, synchronize quantities or delist after a sale.

Photos themselves are not retained. Original recognition is preserved beside edited draft fields. CDP record links are explicitly labeled manually confirmed; source-imported mappings retain their provenance and dates. See [CDP intake design](CDP-INTAKE.md) for persistence and acceptance details.

## Public PSA certificate lookup

Vision’s Review section includes an editable certificate lookup with **Google this cert** and **Open PSA record**. It works without a connected PSA account. The initial research number is `24311536`; it is never copied into card identity or inventory automatically. A PSA scan, restored result or certificate/grader edit updates the research number from the actual card. Another card or non-PSA scan clears it. Changing the research input does not change the reviewed card.

Links open in a new tab and include only a validated 5–12 digit certificate. Leading zeroes are retained. Google search targets PSA certificate pages and the exact number. Official record links use `https://www.psacard.com/cert/<number>/psa`. Existing PSA Vault records offer both links using their saved certificate. No provider token, account data, photo or inventory payload is sent with either link.

Compare the official record to the slab and edit identity fields before receiving. Public research does not mark a card or connection verified, save API results, alter inventory or consume the app’s API request allowance. Results are not scraped or automatically imported. Optional API setup is collapsed below the scanning/review/receipt flow; automated checks remain available when a valid API connection exists.

## Private PSA setup

Vision includes a password-style token field and an official PSA sign-in link. The user authenticates on PSA, then supplies the token and one real certificate in the private OS form. The form clears the token field immediately on submission and does not put it in browser storage. Same-origin, authenticated server handling verifies the certificate before saving; invalid/mismatched responses leave the prior credential intact. Every new verification counts against the existing daily PSA allowance. The default test certificate `24311536` can be reused. PSA failure messages include the upstream HTTP status in the response and operation history, using fixed wording only. A bounded JSON reader recognizes the exact PSA approved-customer restriction and directs the user to request account API approval. Arbitrary provider messages are never displayed or stored. HTTP 500 remains ambiguous between credentials and a PSA server problem per PSA documentation; denied access is not automatically blamed on the certificate.

`vision_credentials` stores only AES-256-GCM ciphertext, timestamps and a disconnect marker. `PSA_CREDENTIAL_KEY` is a 32-byte hexadecimal protected Site runtime secret. Additional authenticated data binds each token to the signed-in owner. Keep that wrapping key stable; changing or losing it requires users to reconnect. The API never returns a saved token. Disconnect clears ciphertext and suppresses the legacy environment-token fallback. Normal lookup uses the owner token when present, otherwise the existing `PSA_API_TOKEN` fallback. Tokens are excluded from portable inventory and scan history.

## Provider connections and controls

`OPENAI_API_KEY` and `PSA_API_TOKEN` are separate protected Site runtime secrets. AI, PSA and active-market readiness are reported independently. Their presence is configuration readiness, not proof of a successful real call. Use [activation and acceptance](VISION-ACCEPTANCE.md) to complete the live setup and physical-phone test. The Sites skill requires the OpenAI Developers key workflow.

All hosted provider requests use manual redirect handling because the Worker runtime does not support `redirect:error`. Non-success responses, including redirects, are rejected without forwarding credentials to another URL. Local workerd tests exercise the real request, encryption and D1 paths with synthetic provider responses.

The model is pinned to `gpt-5.4-mini-2026-03-17`, uses a strict card JSON schema, requests no external tools, caps output at 2048 tokens and sets `store:false`. The application stores structured results and token usage, not the submitted photos. Provider data retention is governed separately by the provider/account policies; `store:false` is not a promise of zero provider retention.

Default server limits are 20 recognition attempts, $1 estimated/reserved recognition spend and 90 uncached PSA requests per signed-in owner per Pacific day. Runtime overrides: `VISION_DAILY_SCAN_LIMIT`, `VISION_DAILY_BUDGET_USD`, `VISION_PSA_DAILY_LIMIT`. Zero stops new requests. Cost estimates use standard published model rates; the provider invoice, taxes and account-specific adjustments remain authoritative.

An atomic database reservation claims $0.32 before a recognition request, conservatively covering the documented maximum input context plus capped output at standard rates. Successful usage settles the estimate; unknown outcomes retain the reservation. Concurrent tabs cannot oversubscribe the configured allowance. Completed request IDs replay; pending or failed IDs are not silently retried. Start a new attempt explicitly only after checking Recent scans. A network interruption can still incur provider usage.

PSA records are cached for seven days per owner. HTTP 200 alone is not success: the returned certificate must exactly match the requested value and include identifying data. The official record is shown for comparison and never automatically overwrites the card or establishes physical slab authenticity. Cached records do not consume the app's provider-request allowance.

## Components

| Path | Purpose |
| --- | --- |
| `public/vision-ui.mjs`, `public/vision-photo.mjs`, `public/vision.css` | Phone photo preparation, review, history, receipt and acquisition worksheet |
| `domain/vision.mjs` | Identity normalization, candidate matching, legacy receipt and scan provenance |
| `domain/vision-intake.mjs`, `domain/intake-contract.mjs` | Durable intake drafts, CDP SKU aliases, linking and validation |
| `domain/vision-legacy-matcher.mjs` | Recovered weighted matcher interpreted as candidate ranking |
| `domain/vision-economics.mjs` | Integer-cent acquisition calculations |
| `server/vision-api.mjs` | Signed-in same-origin request routing |
| `server/vision-provider.mjs` | Fixed provider contracts, model/schema, normalization and usage estimates |
| `server/vision-store.mjs` | Atomic limits, idempotency and operation outcomes |
| `db/schema.ts`, `drizzle/0001_tricky_the_leader.sql` | Additive scan operations and PSA cache tables |
| `native/vision-ios/`, `services/vision-node/` | Preserved native camera app and legacy export-based service |
| `archive/vision/`, `docs/vision-sources.json` | Immutable recovered source and fingerprints |

## API and data boundary

All endpoints require the platform's signed-in user identity. POST additionally requires same-origin JSON. `GET /api/vision/status` reports configuration/usage; `GET /api/vision/recent` returns the latest 20 scan attempts for that owner. POST `/scan` requires front/back images and a stable request ID; POST `/psa` requires a numeric certificate and request ID. The provider URLs and model are fixed server-side. Secrets never enter browser code, request inputs, logs or Git.

POST `/market` alone retains the optional `VISION_SERVICE_URL`/`VISION_SERVICE_TOKEN` bridge. It reports active asking prices only, never sold evidence. The hosted AI/PSA paths do not fall back to that bridge or bypass their usage controls.

The additive tables do not change Vault's inventory schema. Receiving uses the existing shared save/revision path; code deployment does not import reports or modify current inventory. Scan records and archived original source are separate from financial records.

## Hosted connectivity diagnosis

`GET /api/diagnostics/psa` checks only the fixed public Swagger documentation URL on PSA’s API host. The owner-private Sites boundary permits owner or supported Site service access. No user identity is impersonated, no account data is read, and no PSA token, certificate lookup or database binding is used. The check coalesces concurrent requests and caches results per Worker isolate for five minutes. Its allowlisted output is HTTP status, classification, an explicitly detected Cloudflare challenge, a validated Cloudflare Ray reference and check time. It cannot establish whether a user token is valid. Existing Vision and Vault routes still require the signed-in owner.

The `cf-mitigated: challenge` header identifies a provider security challenge. Capture that evidence for API support; do not attempt to evade a provider access restriction. No scheduled polling or automatic retries are introduced.

## Native and commercial follow-up

The iPhone scanner source and Keychain-backed connection settings remain preserved. Its current native inventory lookup still reads the legacy service's historical CSV. Direct native shared-account authentication, a Mac/Xcode build, physical camera acceptance and retained photo evidence are not part of this browser release. Keep native iPhone-only operation; retired glasses code remains archived.

Before commercial multi-dealer access, introduce tenant-specific provider credentials or global account limits, retention policies, durable photo access rules if needed, and device authentication through supported platform capabilities. Never expose a shared owner secret as a public native login shortcut.

## Development

Edit maintained source, never original archives. Add provenance for recovered artifacts. Run the repo's release gates and include missing real-provider/device evidence in release notes. Official provider references and acceptance steps are in VISION-ACCEPTANCE.md.
