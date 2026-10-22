# Railway-independent Core deployment

The existing **BTCore standalone** GitHub workflow now exports the Docker image
that passed unit, PostgreSQL, nine browser suites and the non-root container smoke
test. The `btcore-runtime-COMMIT` artifact contains the image, source/image IDs,
browser hash, deployment instructions and checksums. It contains no data or
credentials. Artifacts expire after 30 days; retain an independently controlled
copy. A GitHub artifact is a deployable release, not a running application.

Use the artifact from a successful `release/btcore-development` push, and require
the separate **Verify** workflow to pass on that same source commit. PR artifacts
are acceptance candidates, not production releases. No Railway token/API or
container-registry credential is required to build or download this package.

## Start an isolated recovery destination

On an owner-controlled Linux amd64 Docker host:

```sh
sha256sum -c SHA256SUMS
gzip -dc btcore-image.tar.gz | docker load
```

Read `manifest.json`; use its exact `image_tag` and compare `docker image inspect`
with its `image_id`. Never substitute an unverified `latest` tag. Keep the private
runtime environment file outside source and chmod it to 600. Populate:

- `BTCORE_ORIGIN`: the replacement HTTPS origin, without a trailing slash.
- `BTCORE_ACCESS_MODE=private`: use existing owner sign-in/setup. Do not copy the
  old open-access setting into the recovery deployment.
- `BTCORE_APP_DATABASE_URL`: a dedicated recovered PostgreSQL app-role URL.
- `BTCORE_SETUP_TOKEN_HASH`: a SHA-256 setup-code digest when owner setup is needed.
- All five `BTCORE_S3_*` settings for a separate recovered original-photo bucket.

Leave `OPENAI_API_KEY`, wrapped AI keys, `BTCONNECT_ORIGIN` and
`BTCORE_CONNECTOR_KEY` absent during isolated acceptance. Do not point at the old
database or bucket, copy production secrets into a workflow, or restore over live
state. This deployment preserves the existing Core/PostgreSQL/S3 architecture.
The provisioner remains restricted to development/test databases; use a dedicated
`btcore_recovery_dev` database, then the existing empty-workspace restore runbook.
Do not run the app as a database administrator. Database provisioning credentials
belong only in the one-time migration process, not the app environment.

After substituting the image tag from the manifest:

```sh
docker run -d --name btcore-recovery --restart unless-stopped \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file /private/btcore-recovery.env \
  -p 127.0.0.1:3000:3000 btcore:COMMIT
```

Terminate HTTPS at the owner's reverse proxy. The Node app stays non-root and
port 3000 stays on loopback. Verify `/healthz`, the version and browser hash in
the manifest, unauthenticated `/api/workspace` rejection, owner access, restored
counts and every original checksum. Keep a current backup before changing routing.
Do not use a GitHub Actions runner or GitHub Pages as an always-on Core server.

## eBay recovery remains a separate acceptance gate

Core's current publisher talks to BTConnect. Its independent GitHub worker resumes
the recovered connector journal; packaging Core does not reconnect it, recover
seller grants, or import Core-only staged cards into the worker. Recover the
connector's own consistent database/originals, rotate/re-authorize credentials,
establish one active writer and complete the input handoff before live publishing.
Never create an empty replacement journal or replay an uncertain listing as new.
One exact reviewed card still needs owner approval and eBay read-back, followed
by a reload/resume showing no duplicate. No new feature or live listing is part
of this release package.
