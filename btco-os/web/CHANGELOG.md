# Changelog

## 0.11.4 — 2026-10-13

Optional owner-confirmed physical copy and location in signed publication reconciliation; exact preview binding, replay protection and current-record readback. Existing stock, costs, CDP SKUs and locations are preserved. See [release notes](docs/releases/0.11.4.md).

## 0.11.3 — 2026-10-12

Signed publication receipt preview/apply/readback, immutable links and audit evidence, exact CDP identity preservation, and duplicate-safe daily refresh linkage. No live inventory changes. See [release notes](docs/releases/0.11.3.md).

## 0.11.2 — 2026-10-12 Pacific

- Preserve the original capitalization and whitespace of confirmed CDP master SKUs during intake linking.
- Reject shared snapshots that replace or remove established CDP source IDs or master links.
- Keep normalized aliases for candidate lookup, while retaining exact master identity.
- Add regression coverage for these cases without changing stored inventory.

## 0.11.1 — 2026-10-11 Pacific

- Fix shared inventory startup on fresh devices and devices needing migration.
- Remove stale requests for retired static inventory/channel files from connectShared.
- Keep saved cloud inventory authoritative and preserve conflicting local records for review.
- Add regression tests that fail on 0.11.0 and pass with this correction.
- No database, CDP SKU, quantity or inventory-content changes.


## 0.11.0 — 2026-10-11 Pacific

- Consolidate source under canonical GitHub web/ directory; remove bundled business datasets.
- Replace dataset-dependent tests with a deterministic 3,817-record synthetic fixture.
- Add Market price/duplicate review, Flow reconciliation queue and Scout acquisition worksheet.
- Add sequential listing collection with complete-batch validation.
- Preserve shared workspace, CDP master mappings, existing provider configuration and source archives.

# BTCo OS release history

## 0.10.0 — 2026-10-11

- Add a scoped unattended eBay connector refresh with complete pagination, seller identity, timestamp and duplicate-ID validation.
- Preserve exact CDP master SKUs and existing aliases, physical quantities, sales, costs, identity, CollX prices and review holds. New listings remain review-only; missing listings never imply sales.
- Record API observations, update non-manual eBay prices, expose refresh counts and overdue source status, and preserve atomic recovery snapshots. Repeated payloads are idempotent; concurrent device changes require a new preview.
- Add the versioned daily runbook and a credential-free updater script for a linked Site automation. No CSV upload workaround or marketplace write.

See [release evidence](docs/releases/0.10.0.md).

## 0.9.0 — 2026-10-11

- Keep CDP as the listing hub. Successful Vision scans save shared intake drafts without assigning a listing SKU or adding available inventory.
- Link drafts to existing inventory using the exact CDP SKU or an explicitly selected record; retain marketplace SKU aliases, identity, quantities, costs, prices, sales and source evidence. New Vault counterparts use the user-confirmed CDP SKU.
- Add a pending-draft queue, CDP master SKU display/export and reviewed intake evidence. Include drafts in full backup import and device recovery.
- Commit draft linking and inventory changes together through the existing revision-checked save path. Block duplicate certificate/scan links, CDP SKU conflicts and generated Vision SKU placeholders. No CDP or marketplace write integration is claimed.

See [release evidence](docs/releases/0.9.0.md).

## 0.8.0 — 2026-10-11

- Add Google certificate search and direct official PSA record links in Vision and existing PSA inventory records, without an API token.
- Keep capture first; move optional API setup below the working flow and leave it collapsed. Public lookup starts with test certificate `24311536`, follows the actual certificate after a PSA scan or certificate edit, and clears for another card.
- Keep public research separate from inventory edits and API verification. Opening a link does not alter card identity, ownership or verification.

See [release evidence](docs/releases/0.8.0.md).

## 0.7.5 — 2026-10-11

- Recognize PSA’s exact approved-customer restriction and explain that API approval is required; further token generation or certificate changes do not grant access.
- Keep unexpected provider error bodies private and limit inspected JSON to 16 KiB. Preserve existing credentials after a rejected connection test.
- Record the authorized live test result and prepare an API approval request. PSA activation remains blocked by provider approval.

See [release evidence](docs/releases/0.7.5.md).

## 0.7.4 — 2026-10-11

- Add a fixed, credential-free hosted connectivity check against PSA public API documentation so development can investigate access failures without repeated token submissions. Preserve owner-private Site access and all user-record authorization.
- Distinguish explicit Cloudflare security challenges from generic denied API access. Expose only safe status/classification and a validated request reference; discard provider bodies and sensitive headers.

See [release evidence](docs/releases/0.7.4.md).

## 0.7.3 — 2026-10-11

- Preserve the PSA HTTP response code in safe connection/lookup errors and operation history. Distinguish authorization, denied access, provider quota, redirect and service failures without exposing provider bodies, headers or tokens.
- Explain that connection-test certificate `24311536` can be reused and is separate from the access token. The underlying live PSA rejection remains undiagnosed until a new attempt supplies its response code.

See [release evidence](docs/releases/0.7.3.md).

## 0.7.2 — 2026-10-11

- Fix hosted PSA connection checks failing before reaching the provider: use Worker-compatible manual redirect handling and reject redirected responses. Apply the same repair to certificate lookup, OpenAI recognition and the optional market bridge.
- Add workerd/D1 regression coverage for successful provider calls, encrypted PSA storage/reuse and rejection of credential-bearing redirects. Keep the setup certificate prefilled with `24311536`.

See [release evidence](docs/releases/0.7.2.md).

## 0.7.1 — 2026-10-11

- Prefill the PSA connection-test certificate with `24311536` on every form mount. Keep it editable and update the setup instructions so only the token needs pasting.
- Preserve per-card certificates, credential verification and inventory behavior.

See [release evidence](docs/releases/0.7.1.md).

## 0.7.0 — 2026-10-11

- Add a private PSA connection form with official sign-in instructions and a real-certificate test before saving. No token is submitted through chat.
- Store owner-specific PSA tokens using AES-256-GCM, with a separate protected runtime encryption key and owner-bound authentication data. Tokens never enter Vault backups or API read responses.
- Keep failed connection attempts from replacing a working token; enforce existing daily PSA limits, exact certificate matching, request replay and disconnect behavior.
- Record OpenAI runtime activation against the already-published 0.6.0 source. No recognition model, inventory or marketplace behavior changes.

See [release evidence](docs/releases/0.7.0.md).

## 0.6.0 — 2026-10-11

- Implement hosted recognition in the existing OS Worker using a pinned OpenAI model and strict identity schema. No Mac recognition server is needed for browser scans after credentials are configured.
- Add owner-scoped scan history, usage records and seven-day PSA cache through an additive schema migration. Require exact returned certificate agreement; retain manual slab/identity review.
- Enforce daily scan counts and estimated/reserved spending with atomic reservations. Replay completed request IDs, retain uncertain-charge reservations and avoid automatic paid retries.
- Resize phone photos before upload, recover recent scan results, suggest editable titles/SKUs, and accept explicit cost/location on receipt.
- Preserve original identification and scan reference on reviewed inventory. Block a second receipt from the same scan. Validate the complete simulated provider-to-shared-Vault save path.
- Record missing credential activation and physical-phone testing as release limits. Existing native scanner remains preserved; native shared-account integration follows browser acceptance.

See [release evidence](docs/releases/0.6.0.md) and [activation and phone acceptance](docs/VISION-ACCEPTANCE.md).

## 0.5.0 — 2026-10-11

- Consolidate 27 recovered Vision source artifacts into the OS repository, preserving 40 original files and SHA-256 provenance. Keep iPhone-only native source and the Node recognition service as maintained components.
- Open Vision in the OS: capture front/back photos, review saved identification JSON, edit identity fields, search current Vault records and explicitly receive one new physical copy.
- Preserve the original weighted identity matcher while treating results as candidates. Prevent duplicate grader/certificate receipts and require another-copy confirmation when candidates exist.
- Add an acquisition worksheet with integer-cent calculations, editable costs, budget and profit gates, sold-evidence review and a minimum 5% eBay promotion assumption.
- Add an authenticated optional bridge to the recovered recognition, PSA and active-listing service. Show disconnected status when no service is configured. No provider or paid service is provisioned by this release.
- Add bearer authorization to the Node service and configurable native connection settings with tokens in Keychain. Native inventory lookup remains export-based.
- Establish AGENTS.md development rules, versioned release notes, build checks, source provenance and published-version/commit history.

See [release evidence and limitations](docs/releases/0.5.0.md).

## 0.4.0 — 2026-10-11

Shared owner-scoped Vault storage, recovery snapshots, device migration and reviewed eBay CSV refresh.

## 0.3.0 — 2026-10-11

Separate marketplace prices and source attribution; eBay-only inventory view.

## 0.2.0 — 2026-10-11

Original inventory consolidation and source import.

## 0.1.0 — 2026-10-11

Vault foundation, inventory workflow and recorded sales.
