# Repository audit — October 11, 2026 Pacific

Current continuation audit: [October 12 technical audit](TECHNICAL-AUDIT-2026-10-12.md), including actual source inventory, verified history, feature matrix, integrity fixes and the next three releases. The observations below remain historical.

## Canonical GitHub foundation

Inspected commit ed5f5ed62580c552210f924012c579c14ad1ebb4 and all seven committed files. Four were empty: .gitignore, btco_os/cli.py, docs/ARCHITECTURE.md and tests/test_vault.py. No packaging metadata or CI existed. core.py contained working SQLite import primitives but silently skipped malformed IDs, accepted lossy money conversion, overwrote observed aliases without review, and marked missing listings inactive. v0.1.0 preserves the public entry points/schema, completes the missing files and adds validation/review semantics.

Verified milestone a2aab65fff059e575d1ebe263d4d9228d4613169 on GitHub main after the fast-forward update. Ten automated tests passed; wheel build, isolated installation and CLI execution outside the source tree succeeded. A wrong-directory first test invocation failed on module resolution; rerunning from the documented repository root passed. No failing checks were represented as successful.

## Existing connector

Inspected all 19 committed files and matched their Git blob hashes to GitHub commit ede57df11ccbd8b802bf297ee9c863e305385499. Reran the complete suite: 48 passed, two upstream framework deprecation warnings. Existing OAuth, order, finance and active-listing code is unchanged. The connector was not redeployed or reconfigured.

Live connection identified the authorized seller and version 0.2.0. Eighteen sequential pages returned 3,573 unique active listings. Collection validation and the existing scoped writer applied and read back workspace revision 3. Recorded summary: 69 quantity differences, 32 missing observations, 123 blank listing SKUs, zero SKU conflicts, zero newly added records. This is a verified API observation, not a physical stock census. The existing enabled daily 7 AM Pacific automation was inspected; its future execution remains to be observed.

## Recovered browser and Vision source

Opened the existing private Site through its supported source workflow. Verified source head 198b82257a15de88e3a562e538452d3f9e35113c, browser 0.10.0, saved Site version 15. The prior claim that Sites was canonical conflicts with the user's explicit GitHub instruction; new workflow documentation makes Sites a deployment mirror.

Recovered 252 tracked files from a 255-file source tree. Excluded two production inventory/channel JSON files and the private-source seed builder. Retained browser APIs, domain rules, D1 schema/migrations, native SwiftUI, optional Node service, original Vision archives and fingerprint records. Historical release notes remain historical evidence rather than claims about this new build. Their old private-data census tests now use a deterministic synthetic 3,817-record dataset. The original-source manifest lists the recovered file hashes before adaptations.

The existing source's README mixed contradictory statements that live eBay was unavailable and available. Updated current documentation to reflect the verified connector and scoped writer. Removed automatic seed imports: new users start empty; existing D1 workspaces and device recovery remain intact. No current inventory records are embedded in source.

Baseline browser tests: 126 passed on recovered code and again with synthetic fixtures. Browser 0.11.0 adds Market, Flow and Scout surfaces, sequential collection tests and duplicate/reconciliation view tests. Release gate verifies all 40 original Vision archive fingerprints. Native Xcode and physical-device acceptance are unverified in this Linux environment. Supported browser QA is unavailable; no visual acceptance claim is made.

## Remaining engineering risks

The authenticated owner workspace is not yet a commercial membership/tenant system. The private service writer depends on the owner-private hosting boundary and explicit owner/seller configuration. Keep this boundary private until service principals and tenant authorization are implemented. The chunked workspace has a 15 MB cap; production-scale normalized storage and durable job execution remain backlog work. CDP export and live CollX access are incomplete. No synchronization can infer missing physical inventory or unrecorded sales.
