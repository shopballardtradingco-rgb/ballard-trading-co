# Browser release workflow

Canonical source is GitHub shopballardtradingco-rgb/btco-os under web/. The Sites repository is a deployment mirror. Keep the Python foundation version (currently 0.2.0) distinct from the recovered browser release line (currently 0.11.1); do not rename historical releases.

1. Inspect the latest GitHub branch and working tree. Make a coherent change; preserve existing code and runtime state.
2. Update browser versions, cache imports, changelog and release note. Run npm test, npm run check:release, npm run typecheck and production build. Native modifications also need Xcode/iPhone verification or an explicit unverified boundary.
3. Commit and verify GitHub's branch and every changed file hash. Keep production data, private source reports, credentials and dependencies out of source.
4. Open the existing Site with the current Sites source helper. Verify no concurrent changes. Mirror the reviewed canonical web/ tree only; preserve hosting project ID and bindings. Remove retired source files deliberately, never runtime storage.
5. Use the Sites helper to build, commit, push and package that exact mirror revision. Save/deploy the returned project, SHA and archive using owner-private publication. Confirm terminal success.
6. Record the canonical GitHub SHA, exact web subtree, Sites SHA and hosted version. Each must be independently observed; do not guess mappings. Source rollback never means database rollback.

There is no migration between the Python operator SQLite database and hosted D1. Recovery uses exported inventory and existing shared snapshots, not a Git seed file. The original Vision archives remain immutable; check:release verifies their fingerprints.
