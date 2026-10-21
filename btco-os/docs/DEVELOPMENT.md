# Development and verification

GitHub is canonical. Inspect remote main before editing and use fast-forward updates with an expected-head lease. Each release includes automated checks, changelog and versioned notes. Verify the returned GitHub commit and all file hashes; local commits or successful API responses alone do not establish a deployed release.

Python: run `python -m unittest discover -s tests -v`; build a wheel with `python -m pip wheel --no-deps . -w dist`, install into a clean virtual environment and run its CLI outside the source tree. No runtime dependencies.

Browser: from web/, install lockfile dependencies and the optional service's test dependencies, then run `npm test`, `npm run check:release`, `npm run typecheck`, and `npm run build`. The test command prepares shared browser modules. Production datasets are neither needed nor allowed in CI. Original Vision source fingerprints are checked. Report absent Xcode/device/browser acceptance explicitly.

For publication, follow [the browser release workflow](../web/docs/DEVELOPMENT.md). A reviewed web/ subtree is mirrored into the existing private Sites checkout; the Sites helper owns its build, mirror commit/push and archive. Verify terminal deployment status. Record both GitHub and mirror source identities and the saved Site version. No force pushes, secret files, customer data, runtime databases, generated output or dependency directories in Git.

If multiple sessions edit either repository, stop on a changed head and reconcile changes. The deployed eBay connector is independently versioned; do not redeploy it just to update OS code. Its full source and 48-test baseline were audited before this milestone.
