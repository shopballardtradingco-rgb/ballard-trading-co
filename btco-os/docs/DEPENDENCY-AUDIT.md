# Maintenance and independence audit — October 20, 2026

Owner direction for this pass: add no product features. Improve performance and independence from paid tools, CDP first and ChatGPT second. Other marketplaces remain secondary in delivery order and integral to the owner's eventual patent strategy. This records architecture and provenance, not a conclusion about patentability. Keep dated commits and acceptance evidence; do not invent legal claims or remove existing channel contracts.

## Current dependency boundary

| Workflow | Actual requirement | Independence status |
| --- | --- | --- |
| Manual intake, review, stock and CSV/backup exports | Node, PostgreSQL or explicit local SQLite; original storage | No CDP, ChatGPT session, Pro, AI key or marketplace account required |
| Direct eBay cards | Core → owned BTConnect → eBay OAuth/API | No CDP-mediated connection or ChatGPT session; existing approval/retry/readback contracts remain |
| Automated identification/research | Optional OpenAI Responses API assessor | Paid API remains; no Pro requirement. Existing assessor injection, validation, manual entry and budget/unknown-charge protections remain. Alternative model support is future work |
| Photos | Database blobs or configurable S3-compatible storage | No Railway-specific storage API; database mode is capped at 64 MiB, object-backed originals at 10 GiB. Local recovery above 64 MiB still needs the documented object adapter/bucket |
| Hosting | Node container and PostgreSQL | Current deployment is Railway. Dockerfile, provisioning, environment contracts and health checks are owned source; moving hosts still needs a restore and a verified cutover |
| Other marketplaces | Existing independent prices, observations, IDs and publication contracts | Preserve these records and interfaces. No new adapters, paid tools or marketplace writes in this pass |
| Build and recovery | npm/Python packages, GitHub source/checks and independent backups | No ChatGPT runtime needed; remote registries and configured backup destinations remain dependencies |

## 0.7.2 maintenance

- Static files are read and compressed once per process and revalidated by content hash. Deployments change the hash; stale files receive fresh bytes. Compression applies only to the fixed public asset allowlist, never to personalized responses.
- Preview requests authenticate and check ownership before cache validation. Unchanged previews skip both database blobs and object downloads. Database previews no longer load full originals. Originals and backups still use unchanged bytes and integrity checks; API state retains `no-store`.
- The preparation worker checks the small workspace revision while idle, avoiding repeated whole-workspace parsing/row locks. Changed revisions and expired job leases wake it; cost reservations and explicit retries remain unchanged.
- Browser preparation polling pauses in hidden tabs, cannot overlap another poll, and does not redraw over edits made while a response was in flight.

There is no schema migration, new package dependency, new provider, new paid service or product feature. No subscription is cancel-ready solely because of this release.

## Next maintenance order

1. CDP: harden the existing direct eBay workflow, exact SKU/physical-item links, trial observations, original preservation and recovery. Close actual cutover gaps before cancelling.
2. ChatGPT: keep prompts, schemas, operating rules, evaluations and recovery instructions in source. Verify the existing manual fallback; future provider replacement must preserve validated output and owner approval.
3. Secondary markets: retain channel-specific identity, pricing, event provenance and retry semantics. Schedule their implementation separately. Any live cross-listed inventory still needs an explicit safe lifecycle/manual closure plan before cutover.
4. Hosting/backups: reduce redundant compute and transfers first. Move providers only after complete data restoration and operational acceptance, not on a presumed lower subscription price.

## Reproduce without paid accounts

From the repository root, use Node 22.13 or newer:

```sh
npm ci --prefix core --ignore-scripts --no-audit --no-fund
npm run check --prefix core
npm test --prefix core
npx --prefix core playwright install chromium
npm run test:preparation-browser --prefix core
npm run test:ebay-browser --prefix core
docker build -f core/Dockerfile -t btcore-local .
docker run -d --name btcore-local \
  -e BTCORE_LOCAL=1 -e BTCORE_SQLITE_PATH=/tmp/btcore.sqlite \
  -e BTCORE_ORIGIN=http://127.0.0.1:3000 btcore-local
docker exec -i btcore-local node --input-type=module < core/tests/container-smoke.mjs
docker rm -f btcore-local
```

The last command is a disposable health/login-shell check, not durable storage or a provisioned owner account. For local browser work, follow `core/README.md` with an owner-held setup code and persistent SQLite path. For larger restores use `docs/deployment/BTCORE-CORE-DEV.md` and the backup contract. Browser suites use synthetic photos, mocked AI and mocked eBay; they make no paid AI or live marketplace requests. PostgreSQL and Docker acceptance also run in the private repository CI. Public GitHub source and independent backup checks are tracked separately in the public hub.
