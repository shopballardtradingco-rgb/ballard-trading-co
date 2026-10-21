# BTCo OS engineering contract

GitHub shopballardtradingco-rgb/btco-os is the canonical source. Inspect the current remote head and local changes before editing. Never force-push or overwrite concurrent work. Commit each verified milestone with tests, changelog and release notes. API-created GitHub commits must be verified against the branch and exact blob hashes.

The web/ subtree is the browser application; its Sites repository is a deployment mirror only. Stage only reviewed canonical web/ source into that mirror, use the Sites workflow to build/commit/package/publish, and record both commit identities. Keep owner-private access and the existing database. Python btco_os is an independent operator import utility; no dual-write or implicit migration exists between SQLite and D1.

Preserve exact CDP master SKUs and reviewed mappings. eBay aliases are not proof of CDP identity. Observations never change physical stock or infer sales. CollX prices remain independent. Never commit private customer data, production inventory exports, credentials, generated bundles or dependencies. Use synthetic test fixtures.

Test Python with unittest; web with npm test, npm run check:release, npm run typecheck and production build. Native iOS needs Mac/Xcode/device acceptance; report the limitation if unavailable. Retain original Vision archive fingerprints. Keep the independently deployed eBay connector operational.
