# BTCore independent application acceptance · October 17, 2026

## Source and scope

Canonical app repository: `shopballardtradingco-rgb/btco-os`, branch `feature/standalone-btcore-app`.
Initial app commit: `996f6f3369df452d806f1d0a10fc889189bcbcb5`, based on current main `de9dc775dbcfbb6b7b8e705d13ff516b527a3250`. All 320 remote file blobs matched local bytes. Of the 294 base files, only the root README and changelog changed; the 292 remaining base blobs, including every existing browser/native source file, were preserved.

## Acceptance results

- Independent auth/API/backup integration scenarios passed locally and in CI.
- Actual PostgreSQL 17 CI passed with the restricted application login. Schema creation under that login was denied; workspace transactions, simultaneous save conflict, separate connection persistence, binary photo readback and backup restore succeeded.
- Browser acceptance completed setup, manual identification, both original uploads, owner review, confirmed physical intake, inventory edit, sale recording, session recovery, complete backup verification and preserved sale reversal.
- Desktop 1440px and mobile 390px rendering checked. Mobile document width did not exceed viewport width. No browser errors. The browser test rejected all requests outside the app's own origin; none were attempted.
- Existing 145 browser/domain tests and 10 Python tests passed. Existing version/archive checks, TypeScript and production build passed locally and remotely.
- Docker image built successfully with Node 22, pinned production dependencies and non-root runtime user. A packaged-runtime smoke gate was added to the final workflow to verify startup, app shell and denied anonymous inventory.
- Dependency audit returned zero production vulnerabilities when checked.

Evidence: [standalone CI 39080870266](https://github.com/shopballardtradingco-rgb/btco-os/actions/runs/39080870266), [existing suites 39080870224](https://github.com/shopballardtradingco-rgb/btco-os/actions/runs/39080870224). All checks succeeded for the initial implementation. Subsequent exact-head CI is reported in the pull request; do not infer final-head success from the earlier run.

## Release preparation and hold

Core Dev remains the existing Railway project `aaef2a54-5f57-4950-8477-b944e3574984`, development environment `ae8e9a01-68d4-4f89-80ed-1c9f31dde280`, API service `f76307d9-1a45-4b16-af55-e3d69636e677`. Existing PostgreSQL is online. No app has been deployed.

Automatic approval review rejected generating a public domain because the owner's retained instructions hold full deployment pending approval. No alternative public exposure was attempted. Reversible service configuration was staged instead (Dockerfile, root, start/pre-deploy commands and healthcheck). No secrets were read/copied, no database mutation was performed on Railway, and no production service or subscription was changed. The current Railway control plane rejected deprecated `railway.json` configuration; that newly introduced file was removed and the supported service configuration is used instead.

After explicit owner launch approval: generate the Core Dev domain, generate protected application/setup secrets, use the existing dedicated database references, pin the approved app commit, review the entire pending patch, then deploy and verify terminal SUCCESS plus independent owner setup. Current API resource caps remain 0.25 vCPU and 500 MB; actual ongoing usage must still be measured against the owner's $20 additional-usage target. Do not raise caps or upgrade plans implicitly.

## Remaining limitations

This is a small, manual, single-owner development release. It is not an AI recognition or marketplace-publishing release. Photo originals use bounded PostgreSQL storage (64 MiB total) until the existing Python R2 adapter is integrated. Backups are manual; runtime deployment, off-site scheduled backup/restore, real iPhone/Safari/HEIC, and listing integration are subsequent acceptance gates. Synthetic tests do not migrate or prove the user's real inventory. No real collectible images or customer data are in source.
