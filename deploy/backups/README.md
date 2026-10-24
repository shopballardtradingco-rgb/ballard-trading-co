# Verified Core backups without ChatGPT

This runner captures a current Core v2 logical export, restores it into an empty offline workspace, uploads a dated archive, downloads the stored copy, verifies SHA-256, restores the downloaded bytes again, and verifies the remote receipt. Only then does it replace the local last-success record. A failed run retains the previous verified backup and makes the health check fail.

**Scope is Core logical data and every original photo, including retired-photo history.** It preserves saved listing batches and the publication results held in Core. It does not contain the separate connector database, encrypted connector originals, encryption/signing keys, Core credentials/sessions, legacy D1, Git history or hosting configuration. Those remain separate recovery requirements. A source backup is not a connector backup.

## Current acceptance

- Synthetic tests use the actual Core restore implementation, including an original and a retired original. They exercise truncated input, failed upload/download, corrupted remote bytes/receipt, failed remote restore, stale results, overlapping runs and preservation of the previous success record.
- CI requires a real rclone round trip through its local backend plus refusal to overwrite a changed destination. This proves the transport command, not any live provider authorization.
- Existing public source release archives have been independently copied to the private recovery provider and downloaded for checksum verification. The October 23 Core export was separately owner-approved, uploaded to the private recovery destination, downloaded again with a matching SHA-256, and restored into an empty offline workspace with all original hashes verified. The archive and verification receipt are held together privately. This completed manual backup does not activate a recurring schedule or prove unattended provider authorization.
- **No production timer or unattended storage authorization is active as a result of this source change.** Installing unit files alone would not complete this acceptance.

## Run on an independently controlled machine

Use an always-on Linux host with Python 3.11+, Node 22.13+, and [rclone](https://rclone.org/install/). Keep this repository checked out at `/opt/ballard-trading-co` and install the locked Core dependencies:

```sh
npm ci --prefix /opt/ballard-trading-co/btco-os/core --ignore-scripts --no-audit --no-fund
```

Create an operator account `btco-backup`, a private state directory `/var/lib/btco-backup`, and private configuration directory `/etc/btco-backup`, owned by that account. Keep directory permissions 0700 and configuration files 0600. Copy `config.example.json` to the private configuration location, never into version control.

Configure a named rclone remote using its normal owner-authorized provider sign-in. Use the existing private recovery destination or another independently controlled provider; an rclone `crypt` remote can add client-side encryption if its recovery key is kept separately. The ChatGPT Drive connection is not an unattended credential for this runner. Preserve the provider's private access rules and verify the destination with a small synthetic file before transferring business data.

The example deliberately leaves the source unconfigured. Two supported input paths are:

1. `--input /private/fresh-export.ndjson` for a recent owner-exported archive. It must be a complete v2 export created within the last 26 hours. Do not schedule repeated copies of a static file.
2. Set `source.mode` to `existing-open-core` with the exact HTTPS origin of a Core instance already configured for that access mode. The runner requires the existing session response to explicitly report authenticated access with no login requirement, then performs only GET `/api/session` and GET `/api/backup`. It refuses redirects, private/login-required sessions, HTML responses and stale exports. It never changes an access setting or imports browser cookies. Private Core instances need a separate supported unattended export/authentication mechanism before scheduling; do not disable their sign-in to use this runner.

Run once under the operator account:

```sh
python3 /opt/ballard-trading-co/tools/runtime_backup.py run --config /etc/btco-backup/config.json
python3 /opt/ballard-trading-co/tools/runtime_backup.py check --config /etc/btco-backup/config.json
```

The command emits only a bounded result or sanitized failure stage. Private receipts remain in the destination and state directory. It inherits no database, eBay or AI credentials into restore/transfer subprocesses. Every restore uses a newly created offline SQLite workspace and local object directory; it never calls a marketplace or production database. Temporary recovered data is cleaned after verification.

Inspect the destination's `core-logical/<UTC timestamp>-<random id>/` archive and receipt. Confirm the provider and sharing state independently. Keep the downloaded archive checksum and successful restore evidence. The receipt binds the configured source and destination names; changing either requires a new verified run. Re-authorizing or rebinding a named rclone remote also requires a fresh manual round trip before trusting the schedule. The local `last-success.json` is not by itself proof that the remote still exists: every scheduled run performs a fresh upload/download/restore, and periodic manual recovery should use the remote copy.

## Scheduling and monitoring

Only after the real round trip succeeds, install the four `.service`/`.timer` files from this directory into `/etc/systemd/system` and enable the two timers:

```sh
systemctl daemon-reload
systemctl enable --now btco-backup.timer btco-backup-check.timer
systemctl list-timers btco-backup.timer btco-backup-check.timer
```

The nightly timer targets 3:00 a.m. America/Los_Angeles with up to ten minutes of jitter and catches up after downtime. The hourly check exits unsuccessfully for a missing/stale success record, a source over 26 hours old, or a newer failed attempt. See the official [systemd timer reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

Connect failed-unit notifications to the owner's chosen monitoring destination and test delivery. The files provide failure signals and systemd journal records; they do not configure email/SMS alerts or prove notification delivery. ChatGPT is neither the scheduler nor the monitor.

Uploads use [rclone copy](https://rclone.org/commands/rclone_copy/) with `--immutable --checksum`, staging the exact destination filename. This avoids an older `copyto` path that can bypass the immutable check. CI verifies both different-size and same-size conflicts preserve the original bytes, while identical retries succeed. Readbacks use `copyto` only into a new local file. The runner never syncs or deletes remote files. Dated names preserve prior copies and partial failures never overwrite the last good archive. Automatic retention deletion is intentionally not enabled. Measure actual storage growth and validate the proposed 7 daily / 4 weekly / 3 monthly retention before enabling a separately reviewed deletion job. Check local free space for approximately five times the exported size; the runner currently bounds an export to 512 MiB.

For clean recovery elsewhere, download the archive and receipt, verify its SHA-256, decompress it privately, and run:

```sh
node tools/restore-drill.mjs /private/core.ndjson --cleanup
```

A production cutover still requires empty-destination restoration, independent connector recovery, matching existing listing IDs, seller reconnection where needed and exactly one active publisher. No listing approval is implied by restoring a backup.
