# Connector listing readiness — October 22, 2026 Pacific

BTConnect 0.6.1 reports measured encrypted-photo and free-disk headroom through its existing authenticated readiness tool. The quota and disk reserve remain unchanged. It also corrects stale automatic-promotion and card-contract descriptions and preserves the next-session runbook. [Canonical PR #15](https://github.com/shopballardtradingco-rgb/btco-ebay-connector/pull/15) is merged at `71167314af41b9326c77dca8b0bef8dd9e72137b`; its tree matches tested head `b63f1332c7eade4de8ceff6cae5accd0ae9e1771`.

Validation: 566 connector tests passed with the cross-repository case deferred; all 12 handoff cases then passed with the real Core exporter fixture, plus three exporter tests. Compilation, wheel build and both exact-head GitHub CI runs passed. Source readiness does not prove runtime deployment, expanded storage or new-photo/live-listing acceptance. No marketplace writes or AI requests were made. [Runbook](btconnect/docs/NEXT-COMIC-BATCH.md).

# 2026-10-21 — GitHub publisher recovery path

- Preserve the same BTConnect publisher as an on-demand GitHub Actions worker with durable encrypted checkpoints and exact approval.
- Record independent recovery configuration and activation gaps explicitly; Railway reconnection is not the next step.
- Validate 542 connector tests locally; private CI and workflow installation checks remain separate from live listing acceptance.

## BTCore 0.7.4 publisher repair checkpoint

- Preserve the upstream queue-continuation fix, failure details and synthetic tests.
- Keep live deployment and exact owner-approved card publication explicitly pending.

# Public recovery hub changelog

## 2026-10-20 — BTCore 0.7.2 maintenance

- Gzip transfers reduce the main app script from 141,227 to 40,425 bytes (71%) and CSS from 36,403 to 8,634 bytes (76%); unchanged assets return 304.
- Authenticated preview revalidation avoids repeated object reads and full-original database reads. Original SHA checks remain mandatory.
- Idle AI preparation uses revision checks instead of repeated workspace parsing/locks; hidden and overlapping browser polls stop.
- No new features, packages, schema or paid tools. Recorded CDP-first, ChatGPT-second priority and retained secondary-market architecture and provenance.
- Source checkpoint: Core `089ab911eff02b02db9ce594016f155627dc2f1e`; Connect remains `337a5a044152d5a587ccc33587d6f6ee043ff400`. See the release evidence in docs/SYSTEM.md.

## 2026-10-20 — independent source and recovery foundation

- Published reviewed current BTCore 0.7.1 and BTConnect 0.6.0 source snapshots, their tests, historical documentation and legacy/native code; upstream commits and all file hashes are recorded.
- Added a standalone system map, owner/product rules, dependency-removal roadmap, recovery runbook and agent handoff instructions.
- Added offline restore-drill and source-verification/archive tools, plus GitHub source verification and weekly/on-push recovery workflows.
- Core export restored offline with original hashes verified and occupied-target overwrite rejected. Complete current source and Core export copied to a private independent provider.
- Remaining gaps are explicit: scheduled independent data backups, connector/legacy recovery, original private Git-history backup, deployment/source mirroring, open-access boundary and CDP/channel cutover acceptance.
- Validation: 99 Core tests passed, 1 PostgreSQL-dependent test skipped locally. Production PostgreSQL/S3 failover and native iOS acceptance were not performed. No live deployment, marketplace write, secret rotation or subscription cancellation.
