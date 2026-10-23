# Core recovery on Render

This is a deployment definition for an isolated copy of the existing Core 0.7.4
runtime. It is not an accepted live deployment or a migration of BTConnect.
Canonical Core remains `3313cf3a424eaaee8fb91bb2f789075f72f9e23b`;
`tools/verify-source.py` verifies the unchanged exported application source.

## Resources and cost

The owner selected the connected Render workspace. Read-only discovery returned
no web services or Postgres databases. The root `render.yaml` defines:

| Resource | Configuration | Published base estimate per month |
| --- | --- | --- |
| Core web service | Oregon; one 0.5c-512mb instance; private application login | $7 |
| PostgreSQL | Oregon; 0.1c-256mb; PostgreSQL 17; dedicated development database | $6 |
| Database storage | Explicit 1 GB; automatic growth disabled | $0.30 |
| Base subtotal | Hobby workspace assumed; before external storage and usage | $13.30 |

The overall authorized cloud budget remains $20/month. This subtotal does not
prove the total: include existing hosting overlap, private object storage,
workspace fees, bandwidth and build overages. No paid resources were created by
preparing this configuration. Confirm the actual Dashboard quote and remaining
budget before Apply. Do not delete the original host to make the estimate fit.
Free Postgres expires after 30 days and is not the durable recovery destination.

Prices and current plan mappings were checked on October 22, 2026 Pacific:
[pricing](https://render.com/pricing),
[compute plans](https://render.com/docs/compute-plans),
[storage billing](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses),
[published entry compute prices](https://render.com/articles/production-rails-hosting-guide).

## What is wired automatically

- Docker builds from the reviewed public source checkpoint, including Core's
  sibling domain modules. Automatic deploys are off during recovery.
- A dedicated database named `btcore_recovery_dev` is reachable over Render's
  private network only. The existing provisioner creates the `btcore_app` role.
- Render generates the application-role password and an owner setup code.
- The pre-deploy phase runs the existing provisioner and verifies the object
  store. Failure prevents application rollout.
- The deployment adapter converts the generated password into a correctly
  escaped restricted-role URL and supplies only the setup-code digest to Core.
  It removes migration credentials and the plaintext setup code from its own
  environment and the child application's environment. Render itself still
  stores these values in the service configuration; this is not a claim of
  separately scoped host-level secret storage.
- Private access, HTTPS origin, complete object storage and the absence of
  connector/AI credentials are mandatory. The adapter refuses an incomplete
  configuration and never falls back to a local database.

The adapter is deliberately limited to isolated recovery. Enabling publishing
later requires a reviewed configuration change after the connector's independent
journal, matching key, seller authorization and single-writer handoff are ready.

## Required private inputs

The Blueprint prompts for five values for an **independent, empty private
S3-compatible bucket**: endpoint, bucket, region, access key ID and secret access
key. Enter values through Render's private configuration, not source or issues.
For Cloudflare R2, use the account S3 endpoint and region `auto`; path-style
addressing is enabled. Do not select the old live Core bucket as a restore target.
The existing archive exceeds Core's 64 MiB database-only photo allowance, so
omitting object storage cannot restore the real workspace.

The connected Render tools cannot provision an external R2 bucket, retrieve its
credentials or apply a Blueprint. No compatible Cloudflare/R2 management plugin
was found in the targeted directory search. Existing Core/Connect credentials
are not available merely because Render is connected.

## Apply and verify

1. Validate the current file with `render blueprints validate render.yaml` using
   an authenticated Render CLI. The public JSON Schema is a separate structural
   check, not platform acceptance.
2. Open the Blueprint setup for this repository:
   https://dashboard.render.com/blueprint/new?repo=https://github.com/shopballardtradingco-rgb/ballard-trading-co
3. Use the owner-selected workspace. Complete GitHub access if prompted, supply
   the five independent object-storage values, and verify the full cost before
   Apply. Keep the existing live services unchanged.
4. Monitor the specific deployment until `live`. Check `/healthz` for 0.7.4,
   compare the browser asset hash with this source, and verify unauthenticated
   `/api/workspace` is denied. A green build alone is insufficient.
5. Retrieve the generated `BTCORE_RECOVERY_SETUP_CODE` privately from the new
   service's Environment page and use Core's existing setup screen to create
   the destination owner. Never paste the code into an issue or public log.
6. Restore the checksum-verified Core archive into this otherwise empty
   destination. Verify all 24 intake records, 33 originals and their hashes.
   See [the recovery runbook](RECOVERY.md). Do not overwrite live state.
7. Reopen the restored work and verify private login, locations and staged
   snapshots. Publishing remains disabled pending independent connector recovery
   and a complete exact-item review.

## Validation record

- Five adapter tests cover restricted credentials, reserved password characters,
  secret-free errors, private/offline recovery guards, signal forwarding and
  two real child launches with identical saved configuration.
- The current public Blueprint JSON Schema and source-integrity check pass.
- The bounded public-content check passes; no inventory, credentials, original
  photos or runtime addresses are included.
- CLI/platform validation, actual Render PostgreSQL provisioning, live startup,
  restored originals and eBay acceptance remain unverified until their gates run.

Current references: [Blueprint specification](https://render.com/docs/blueprint-spec),
[environment variables](https://render.com/docs/configure-environment-variables),
[default variables](https://render.com/docs/environment-variables),
[private network](https://render.com/docs/private-network),
[deploy lifecycle](https://render.com/docs/deploys),
[health checks](https://render.com/docs/health-checks).
