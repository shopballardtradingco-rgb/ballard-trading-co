# Owner-controlled BTCore server

This package runs the existing Core, PostgreSQL and BTConnect applications on one
Linux amd64 Docker host. Caddy supplies HTTPS. Daily use is directly in a browser;
Railway and ChatGPT are not runtime dependencies. The existing S3-compatible photo
bucket and eBay account remain external services. No new app features are added.

## Destination

The owner selected their own cloud server. Suggested initial size: 2 GB RAM, one
CPU and 50 GB disk. DigitalOcean lists $12/month for that Basic server, plus 20%
for weekly backups ($14.40 before tax). This is infrastructure only; retain the
existing $20 total infrastructure ceiling and account for bucket usage and any
temporary old-host overlap. Nothing here creates or bills a resource.

Use Ubuntu with Docker Engine and Compose v2 installed, SSH keys, OS security
updates, and a cloud firewall allowing 80/443 publicly and SSH only from the
owner's administration address. Core, connector and PostgreSQL have no published
ports. The Core database role cannot create tables or administer PostgreSQL.
Connector runs as UID 10001 with a read-only root filesystem.

## Install the tested package

Download `btcore-owned-server-COMMIT` from a successful **Owned server acceptance**
run for `main`, with **Public source verification** passing for the same commit.
Keep a permanent owner-held copy: Actions artifacts expire after 90 days.
Transfer and unpack in a new private directory on the host. The artifact includes
all four tested images, image IDs, source identity and checksums; no registry login
or build on the production server is required.

```sh
bash host.sh load
python3 initialize.py core.example.com connect.example.com
```

Point these two owner-controlled DNS names at the server. Configure a **new empty
independent S3-compatible bucket** in `private/core.env`, using bucket-scoped keys.
Keep all private files mode 600 and their directory 700. Do not print environment
files or expanded `docker compose config` into shared logs. This installer does
not overwrite old settings, generate a replacement connector key, or copy secrets
from Railway.

```sh
bash host.sh up
```

Open Core directly over HTTPS. Use the code in `private/owner-setup-code.txt` once
to create the owner account, then remove that file and clear the setup hash in
`private/core.env`. Recreate Core with `docker compose up -d core`. Save the new
owner password and server/account recovery keys in an independent password manager.

Restore the latest verified backup **only into this new empty workspace**:

```sh
bash host.sh restore /private/BTCore-backup.ndjson
```

The streaming restore validates the complete footer and every original photo hash
and refuses an occupied destination. Sign in, compare counts/SKUs/locations with
the backup, open originals, restart the containers and verify the saved workspace.
Do not redirect the live app or discard the previous deployment before this passes.

## Recover the existing eBay publisher

Keep all publication switches off until the existing journal is recovered and the
old publisher is stopped. Restore the consistent connector `btco.sqlite3` and
`listing-objects/` into `private/connector-data/`. Preserve its matching encryption
key and the receipt signing record within that database. Correct ownership with
`sudo chown -R 10001:10001 private/connector-data` and restrict directory access.
Configure `private/connector.env`; credentials belong only on the owner host.

```sh
bash host.sh connector --old-writer-stopped
```

This checks database integrity, decrypts journal records and original objects, and
refuses an empty journal or an enabled publication switch. It does not establish
that every expected record was recovered; reconcile source counts and all pending
or uncertain offers first. A newly generated empty journal is not a migration.

Register the new connector HTTPS callback against the eBay application's RuName
and configure its exact Core callback (provided by Compose). Set `BTCONNECT_ORIGIN`
in `private/core.env` to the replacement connector HTTPS origin, recreate Core,
then use Core's existing **Connect eBay** flow and verify the seller and policies.
Review saved work and uncertain outcomes before enabling publication. Only after
one active writer and recovered-state acceptance, change `BTCO_PUBLICATION_ENABLED`
to `true` and recreate the connector. Approve one exact real card in Core, publish,
verify the item on eBay, and reload/resume to verify there is no duplicate. Migration
authorization does not approve a listing.

## Backup and recovery

Enable the selected host's backups, but do not call a provider snapshot a complete
application backup. Keep the existing Core **Export backup** (including originals)
on a second provider. For connector backup, stop its container, copy its entire
data directory and matching keys privately, then restart. Never copy a changing
SQLite file alone. Keep an encrypted copy off this server, verify every checksum,
and rehearse a restore into an empty destination. DNS, eBay developer credentials,
the photo bucket, secret store and host-account recovery must be owner-accessible.

Never use `docker compose down -v` on an installation with business data. To update,
back up first, preserve the previous image package and configuration, load the new
verified images, run the migration container and recreate services. Database/data
rollback requires a matching backup; changing image tags alone is not data rollback.

## Acceptance scope

The workflow tests real containers, PostgreSQL provisioning and app-role
permissions, private access, owner setup, restart persistence, proxy routing and
connector health with synthetic credentials and external application networking
disabled. It does not claim live-host deployment, live eBay authorization,
production S3 restore, recurring off-site backup delivery or a successful listing.

Official references: [Docker startup order](https://docs.docker.com/compose/how-tos/startup-order/),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets).
