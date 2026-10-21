# BTCore automatic development releases — 2026-10-19

The development API was pinned to a single commit. Every release required staging a new source revision and applying it in Railway. Follow a dedicated release branch so passing code releases deploy automatically.

## Scope and flow

- Source: `shopballardtradingco-rgb/btco-os`, `feature/card-bulk-upload`.
- Release: `release/btcore-development`, initially the verified BTCore 0.3.0 commit `2f299d1a3bbb5f05a80d3ef4b3f521d0e667cbc0`.
- Railway: BTCo OS project, development environment, `btco-os-dev-api` service only. PostgreSQL, photos, the independently deployed BTConnect and the Sites mirror are unchanged.
- Runtime version stays 0.3.0; this milestone changes release infrastructure, not application behavior.

The existing BTCore push workflow tests the application, PostgreSQL integration, three browser suites and packaged container. Its promotion job waits for the latest push-triggered `ci.yml` (Verify) run on the exact candidate SHA to succeed. It rechecks the source branch before a fast-forward-only release update. Railway builds the release branch and retains the running deployment until the new `/healthz` readiness check passes.

The promotion script fails closed on failed/cancelled/skipped/missing checks, API errors, or divergent release history. It skips superseded commits and treats an already-released SHA as a no-op. Promotion jobs are serialized. There is no force push, new Railway secret, automatic PR merge, inventory mutation or marketplace publication. The only write token is GitHub's short-lived job token with `contents: write`; `actions: read` lets it read Verify. Test and PR jobs keep read-only permission. A repository maintainer could still move the release ref directly; this is CI gating, not a GitHub branch-protection rule.

## One-time service connection

Create the release branch at the verified live commit. Connect the dedicated API to that branch **without `commitSha`**. The project currently has only the development environment; a live source connection applies across environments, so recheck scope before repeating this setup if environments are added later. Keep the Dockerfile, commands, health check, limits and service variables unchanged. Do not pin routine code releases again.

## Recovery

If tests fail, the release ref stays unchanged. Fix the source and push again. If Verify is slow or unavailable, promotion times out after about ten minutes; rerun the failed job after Verify passes, or push a correction. A newer source commit causes an old promotion job to skip.

If GitHub rejects write permission or a fast-forward, inspect the branch and workflow logs; do not force the branch. If Railway does not start a build after the release ref advances, check the connected branch and GitHub autodeploy permissions in the service settings. A successful GitHub promotion alone is not proof of a deployed release. Verify the exact deployed SHA, Railway SUCCESS and public `/healthz`.

For a bad application release, prefer a tested revert commit on the source branch. Emergency Railway rollback is an operator action; inspect database compatibility before rolling back. Configuration and secret changes remain separate staged infrastructure changes.

## Validation

`node --test .github/scripts/promote-core.test.mjs` covers exact-commit success, disallowed callers, failed or absent Verify runs, superseded candidates, idempotency, divergence/rollback and rejected writes. This test also runs in BTCore CI. End-to-end acceptance requires a real source push to pass both workflows, advance the release ref and produce a successful Railway deployment of that same SHA without a dashboard click.
