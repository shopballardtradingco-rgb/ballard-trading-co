# Verified release record

## October 12 listing activation: browser 0.11.3 / connector 0.3.1

| Component | Canonical code commit | Deployment source / ID | Verified result |
|---|---|---|---|
| Browser 0.11.3 | `0a6e73ef61e3e201b45bf00c38a00b8a2eec15ab` | Sites mirror `7ae772c0d686acdacd82175c7b6e05699250b116` | Terminal succeeded, 2026-10-12 21:25:34 UTC |
| Connector 0.3.1 | `7d0f35a8d6c080a1810cf04ddba3dedd82680769` | Railway `763684cc-869f-4877-99be-4463885ad8b9` | SUCCESS; live version 0.3.1, publication disabled |

Owner authorization for the three new eBay account permissions was granted at 14:07 Pacific. Do not request that authorization again. Interactive eBay consent has not yet completed: the installed ChatGPT app still exposes its six original read tools and requires a host-side tool refresh. App identity and audience were preserved. The release fixes optional-scope discovery, adds the documented OAuth challenge and permits existing registered clients to request a fresh consent flow without upgrading old tokens. Live metadata returns HTTP 200 with `btco:read` and `btco:listings` supported; authenticated status still correctly reports `reconnect_required`.

Vault now verifies signed publication receipts, previews changes, applies with revision protection and provides independent readback. The authenticated connector public key was pinned in the existing Site environment, revision 4. No secret key was copied, no new paid resources were created, and no live eBay or Vault write was performed. No pilot listing is published; exact approved prose remains required. Signed receipts are historical publication evidence, not a fresh live inventory census.

- 106 connector tests, 143 browser tests and 10 Python Vault tests pass (259 total). Seven new browser tests include a Python-signed interoperability fixture verified in WebCrypto, real Worker/D1 concurrent apply and replay, signature/seller/identity conflicts, and protection of master SKUs, physical quantities, costs and CollX references. Bytecode/wheel packaging, typecheck, 40 archive fingerprints and production build pass.
- [Connector CI 38310075891](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/actions/runs/38310075891) and [OS CI 38310303439](https://github.com/shopballardtradingco-rgb/btco-os/actions/runs/38310303439) both succeeded for the exact code commits above.
- All 10 changed connector blobs and 23 changed OS blobs/modes were verified on GitHub. All 269 canonical web blobs/modes matched the clean pushed Sites mirror and packaged build.
- Sites deployment: `appgdep_6acd50455c0481918ff4942035320301`. Saved version: `appgprj_6acbe31183bc8191b3a6888dac3da21a~appgver_a004cfbf1a288191b18d1f1c49678e14`. Owner-private access and existing D1 retained.
- Read-only production checks before and after deployment returned **3,886 records**, workspace revision **44**, and unchanged update time `2026-10-12T15:15:00.916Z`. Publication reconciliation reports configured with zero reconciled receipts. No production receipt was applied. Browser visual/native device acceptance remains unverified.

This deployment-evidence update changes documentation only. See [browser release details](../web/docs/releases/0.11.3.md) and [the preceding real-photo controlled test](acceptance/2026-10-12-comic-dry-run.md).

## October 12 continuation: browser 0.11.2 / connector 0.3.0

| Component | Canonical code commit | Deployment source / ID | Verified result |
|---|---|---|---|
| Browser 0.11.2 | `45fa50875b98813e61221ed365bbd83f9449c66d` | Sites mirror `9ccf4370ea68154a2b22df2ccc582b484cddd3a3` | Terminal succeeded, 2026-10-12 20:56:51 UTC |
| Connector 0.3.0 | `c04970df98dbca950937e5a6bb8fe8f5f66b3286` | Railway `1d1691bf-a6d6-41ed-b23d-f5eaeb4a49b2` | SUCCESS; authenticated live status reports 0.3.0, read-only grant, publication disabled |

Browser deployment: `appgdep_6acd498bd5c0819181dcb8f17da56f9a`. Saved version: `appgprj_6acbe31183bc8191b3a6888dac3da21a~appgver_340d02a217b881918eee008b37cbdbba`. Existing owner-private access and environment revision 3 retained. All 261 canonical web source blobs matched the Sites mirror before publishing. Source was clean and the archive was built from that exact pushed mirror commit.

Post-deployment read-only D1 verification retained workspace revision 44 and update time `2026-10-12T15:15:00.916Z`, matching the pre-deployment observation. No inventory save was performed. The tool truncates the manifest, so this check does not assert a newly counted number of inventory items.

- [OS CI run 38307337455](https://github.com/shopballardtradingco-rgb/btco-os/actions/runs/38307337455): succeeded for `45fa508`, including browser build and independent Python package checks.
- [Connector CI run 38306688295](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/actions/runs/38306688295): succeeded for `c04970d`, including 103 synthetic tests and wheel packaging.
- Local verification: 136 browser tests, 10 Python Vault tests, 103 connector tests; 40 archive fingerprints, typecheck and production build passed. The Sites workflow repeated the browser checks and built the deployed package successfully.
- GitHub heads and exact hashes/modes for all changed files were verified after lease-protected fast-forward updates. The separate cost-baseline branch was left intact.
- No eBay write scopes were granted, no paid infrastructure provisioned, and none of the five pilot listings were published. Their original photos are recovered; exact approved prose and separately approved listing permissions remain activation requirements. Receipt-to-Vault reconciliation and real live publication acceptance remain open.

See [the full audit and three-release roadmap](TECHNICAL-AUDIT-2026-10-12.md). This evidence update changes documentation only; it does not require another browser deployment.

## Earlier releases

| Milestone | Canonical GitHub commit | Browser version | Sites mirror commit | Hosted version |
|---|---|---|---|---|
| Vault foundation 0.1.0 | a2aab65fff059e575d1ebe263d4d9228d4613169 | Existing browser unchanged | Existing mirror unchanged | No deployment |
| OS foundation 0.2.0 | b5f8badf2d95b12eee7e01b78d985db2f0bb6fb3 | 0.11.0 | bea068bc631c7ae36b3c8f88d3cc4fda183980c9 | 16 |

Private application: https://legacy-site.example.invalid

Deployment appgdep_6acc5db555988191b7eb9f1f89514307 returned terminal succeeded on 2026-10-12 04:10:37 UTC (October 11 Pacific), environment revision 3. Saved version ID: appgprj_6acbe31183bc8191b3a6888dac3da21a~appgver_4b729a5163548191a16bd189e628125b. Access remained owner-private.

## Verification evidence

- GitHub main and all 275 release file blob hashes/modes matched the inspected local source. All 258 canonical web/ files matched the packaged Sites mirror.
- GitHub Actions run [38202704910](https://github.com/shopballardtradingco-rgb/btco-os/actions/runs/38202704910) completed successfully for b5f8badf2d95b12eee7e01b78d985db2f0bb6fb3. Both Vault and browser jobs passed, including clean installs, tests, wheel/CLI, release fingerprints, typecheck and production build.
- Local tests: 10 Python Vault, 130 browser/domain/API/Worker/service, and 48 unchanged connector tests passed. All 40 archived Vision source fingerprints passed. The 0.2.0 wheel installed and ran outside the source tree.
- The initial mirrored build exposed lost executable bits on four recovered shell scripts. Restored the original Git modes; the subsequent production build passed. No failed build was published.
- No production inventory seed/channel data appeared in the deployment archive. No credentials or private customer records were added to GitHub.
- Post-deployment status readback retained workspace revision 3, 3,886 item records and the previously verified eBay collection checksum ec8f7a88bb74011cfa49167a1b721daae2ef8f25331f58117b0ce945a1fdc322.
- Live collection: 3,573 listings / 18 pages; 69 quantity differences; 32 missing observations; zero SKU conflicts. These are review observations, not physical stock changes.
- Existing daily inventory automation remained enabled at 7 AM America/Los_Angeles. Its next execution has not yet been observed.

## Unverified boundaries

No supported browser visual QA or Mac/Xcode/iPhone device environment was available. No new real-card recognition or PSA acceptance was performed in this release. Live CDP export, live CollX retrieval, durable standalone job execution and commercial multi-tenant authorization remain incomplete. See BACKLOG.md for ordered acceptance criteria.

This record is a documentation-only follow-up to the tested/deployed source above; it does not trigger a new application deployment or change inventory.
