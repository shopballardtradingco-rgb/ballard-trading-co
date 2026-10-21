# Core Dev release preparation · October 17, 2026 Pacific

Owner message: “Approved and keep working on the next version too.” This explicitly lifts the earlier hold for launching the reviewed Core Dev v0.1 app. Do not ask for that launch approval again.

## Approved build

- Repository: `shopballardtradingco-rgb/btco-os`
- Branch: `feature/standalone-btcore-app`
- Pinned commit: `f5fb5a9e0e554e0539d40a241a0b02b7cc792e64`
- Review: PR #4. All exact-head standalone and existing-suite workflows succeeded.
- Next-version work: `feature/btcore-intake-v0.2`; does not change the approved v0.1 branch.

## Existing deployment target

- Project BTCo OS: `aaef2a54-5f57-4950-8477-b944e3574984`
- Environment development: `ae8e9a01-68d4-4f89-80ed-1c9f31dde280`
- API btco-os-dev-api: `f76307d9-1a45-4b16-af55-e3d69636e677`
- Database btco-os-dev-postgres: `0f792d1d-49e8-4f6e-bf34-5bf12290ae35`
- Created HTTPS address: `https://deployment.example.invalid`, target port 3000. An address is not evidence of a successful deployment.
- Existing resource caps remain 0.25 vCPU / 500 MB, one replica. Keep the owner's existing additional-usage target; no plan or cap changes authorized by this milestone.

## Outstanding external prerequisite

Railway `connect_service_source` still returned: `Repository "shopballardtradingco-rgb/btco-os" not found or is not accessible` after owner approval. The owner must grant the Railway GitHub App access to this repository in GitHub installation settings. No alternative identity or permission workaround was attempted.

Nine settings are staged in patch `2cbd04e0-f9f2-4d0f-a24f-8354096fbcdb`: root `/`, Dockerfile `core/Dockerfile`, healthcheck `/healthz`, healthcheck timeout 60, predeploy `node core/provision.mjs`, start `node core/server.mjs`, HTTPS `BTCORE_ORIGIN`, `PORT=3000`, and `NODE_ENV=production`. Readback shows only the API service affected and no destructive changes. No source is attached, no app has deployed, and no Core tables or owner account have been created on the hosted database.

## Complete after access is granted

1. Re-read environment/service state and attach the approved source commit with `staged: true` in development.
2. Generate a protected random application-role password and owner setup code. Put only the setup code's SHA-256 digest in `BTCORE_SETUP_TOKEN_HASH`. Do not commit secrets or copy BTConnect credentials.
3. Stage `BTCORE_APP_DB_PASSWORD` and a restricted `BTCORE_APP_DATABASE_URL` using the existing database's private-host variables. Retain `DATABASE_URL` for the dedicated dev-only provisioner. Existing PostgreSQL variable names include `PGHOST`, `PGPORT`, and `PGDATABASE`.
4. Read the whole staged patch, preserving any unrelated concurrent changes. Accept only the authorized Core Dev deployment.
5. Verify terminal `SUCCESS`, HTTPS readiness, app shell, unauthenticated API denial, and owner setup behavior. Deliver the setup code privately to the owner; they choose the password.
6. Record deployment ID, exact source commit and verification receipt. Do not merge main, move production inventory, publish marketplace listings or modify Connect Production as part of this launch.
