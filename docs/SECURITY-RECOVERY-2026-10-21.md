# GitHub-only security and publisher recovery audit

October 21, 2026 Pacific. Scope: current canonical Core release
`284584562db0c5c08e309c7cde8a1715bec9085b` (417 source blobs), connector main
`0796f42a277d02d3188875bfbb1cc8562d4dcffb` (130 source blobs), their workflows,
the public checkpoint and independent worker installation result. All source
bytes were checked against GitHub blob hashes before editing. No Railway API,
runtime, browser, email or other provider was accessed in this pass.

This is a source/configuration-reference audit. It does not establish the scope
of the reported hosting incident, inspect Railway-held secret values, or prove
that credentials were stolen. Full private Git history, historical Actions logs,
provider access logs, secret scanning alerts, environment protections and secret
rotation are outside the verified scope of this connection.

## Findings and repairs

| Finding | Evidence / response | Status |
| --- | --- | --- |
| Connector Settings diagnostics include eBay developer and encryption secrets | Mark both fields `repr=False`; test `str` and `repr` using synthetic values | Fixed in connector PR #13 |
| Workflow rerun can retain the original owner's actor identity | Require original and triggering owner, manual dispatch and attempt 1 for a new approval; saved exact approvals still resume | Fixed in connector PR #13 |
| Actions use movable version tags; some checkouts retain tokens | Pin checkout, setup and artifact actions to exact official GitHub commits; disable persisted checkout credentials | Fixed in connector PR #13 and Core PR #10 |
| Core's tested Docker runtime is discarded after CI | Export that image with manifest, image ID, source/tree/browser hashes and checksums | Core PR #10; delivery must be verified separately |
| Deployment branches have no protection reported by branch metadata | Core release, connector main and public main report `protected=false` | Unresolved; administration settings unavailable through this connector |
| Previously documented Core open-access mode exposes the workspace to visitors | New isolated deployment recipe requires existing private access; do not expose a runtime URL publicly | Existing live configuration not inspected or changed |
| Independent worker cannot start | Installation run 39716363901 reports missing credential/key names and handoff; no publisher-state branch exists in the current branch listing | Still blocked; never seed an empty replacement journal |

A bounded scan of all 547 canonical source blobs found no known provider-token
prefixes or private-key blocks. Seven credential-URL matches were inspected and
were synthetic tests or example placeholders. This does not detect every possible
secret or prove that history/logs are clean. The separate public-content check
remains mandatory before the source checkpoint is published.

## Credential containment and rotation order

Treat a credential as potentially affected **if it was present in the affected
hosting environment or its logs**. The table records required actions, not a claim
of confirmed exposure or completed rotation. Do not copy old environment dumps
into GitHub, chat, issues, source, artifacts or new deployments.

| Credential / state | Recovery action | Why sequencing matters |
| --- | --- | --- |
| eBay `EBAY_CLIENT_SECRET` and saved seller refresh/access grants | Replace developer secret and revoke/re-authorize seller grants at eBay; install only through private secret settings | Preserve listing/offer IDs and approval journal; a new token must not create a new publishing history |
| `TOKEN_ENCRYPTION_KEY` | Preserve the matching old key privately for recovery, then re-encrypt a verified frozen journal and original objects with a fresh key | Merely replacing the environment value makes old records/photos unreadable; revoking OAuth alone does not re-encrypt backups |
| Stored `signing-key/publication-v1` | Assess as affected if both encrypted database and decrypting key were accessible; retain old public verification identity and plan a versioned key transition | Blind replacement breaks receipt verification; no unreviewed key migration in this pass |
| Core `BTCORE_CONNECTOR_KEY` and existing sessions/grants | Rotate on the replacement host and invalidate/reconnect old connector cookies/grants | Ciphertext held in the browser or mirror table depends on the old key |
| PostgreSQL admin/app passwords | Create separate least-privileged recovery credentials; revoke affected credentials after controlled cutover | Never point the recovery app or migration at the only live database |
| Core S3/R2 access keys and any connector original-store keys actually configured | Create narrowly scoped replacement keys and verify original checksum coverage; revoke affected keys | Stored originals and their identity must survive key rotation |
| `OPENAI_API_KEY`, `BTCORE_AI_KEY_ENCRYPTED`, `BTCORE_AI_KEY_WRAPPING_KEY` | Rotate underlying provider key and wrapping key if present; keep AI unconfigured during recovery | Storing a wrapped key beside its wrapping key does not protect against full environment access |
| Railway account/project tokens or GitHub credentials stored in Railway | Revoke/replace at their issuer if present; audit account sessions/deploy keys | No such token references were found in the audited GitHub workflows; actual hosting inventory is unverified |
| `BTCO_WORKER_ARCHIVE_KEY` | Generate a fresh independent archive key and keep a separately recoverable copy | Never use the potentially affected old hosting environment to store the replacement key |

GitHub secret-setting and provider revocation operations are not exposed by the
available GitHub tools. No secret was rotated and no protection setting was
changed. Do not infer safety from an empty GitHub configuration check.

## Deployment and eBay acceptance

- [x] Existing GitHub worker runs without hosted Core/Connect or Railway calls.
- [x] Preserve exact approval, original checksums, uncertain-write recovery and one-writer safeguards.
- [x] Prepare Core runtime packaging and private isolated-host instructions.
- [ ] Recover the connector's consistent SQLite journal, encrypted originals and matching recovery key. The Core logical export is insufficient.
- [ ] Install independently secured seller credentials in the private `ebay-publisher` environment.
- [ ] Confirm a real single-writer handoff before setting `BTCO_WORKER_HANDOFF=github-only`.
- [ ] Deploy Core onto a separately controlled host with restored PostgreSQL/S3 state; validate owner access and exact asset/version.
- [ ] Complete the reviewed handoff for Core-only staged cards; the worker currently resumes connector batches.
- [ ] Obtain approval for one exact reviewed live card, verify its eBay item ID and all terms, and resume without duplication.

GitHub can build and retain the runtime and execute bounded publisher jobs. It is
not an always-on application host. No additional paid service, live listing,
inventory migration, journal reset or provider reconnection was performed.

Tracking: [publisher recovery](https://github.com/shopballardtradingco-rgb/ballard-trading-co/issues/9),
[connector repair](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/13),
[Core packaging](https://github.com/shopballardtradingco-rgb/btco-os/pull/10).

## Verified connector release

Connector PR #13 is merged as `bf37a3a701d1e063994d586670c63f0e286c4dfd`, with the same tree as reviewed `ab2597a6105758835142f63e89bd0ba505a7bf69`. Both exact-head GitHub full-suite checks passed (39719552532 and 39719590329). The local full suite had one existing one-second photo-worker scheduling timeout; all 26 focused photo-worker/recovery/security cases passed on rerun. No secret rotation or live activation is implied.

## Verified Core package candidate

Core PR #10 is merged into the development release as `3313cf3a424eaaee8fb91bb2f789075f72f9e23b`, with the same tree as reviewed `ee17a1465535a35466248d7eb073d63b442bac5f`. Standalone run 39719595057 passed PostgreSQL, all nine browser suites, Docker/private-API smoke and runtime artifact upload; Verify runs 39719595056 and 39719607141 passed. The candidate artifact was 100,879,492 bytes, digest `d8854961817ea58d83be8855dc23f80587677e53e47ecd29dd1a47e430d26a2d`. The PR artifact records its synthetic merge commit; use the subsequent development-release push artifact for deployment. Live hosting and eBay acceptance remain unverified.
