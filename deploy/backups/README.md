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

1. `--input /private/fresh-export.ndjson` for a recent owner-exported archive, or add `--input-gzip` when it is already compressed. It must be a complete v2 export within `max_age_hours` (24 hours by default). Do not schedule repeated copies of a static file.
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

The nightly timer targets 3:00 a.m. America/Los_Angeles with up to ten minutes of jitter and catches up after downtime. The hourly check exits unsuccessfully for a missing/stale success record, a source or verification older than `max_age_hours`, or a newer failed attempt. The same positive finite age policy applies to input validation and status checks; the default is 24 hours, replacing the former hard-coded 26 hours. An explicitly relaxed policy such as 26 hours can return `healthy: true` while `within_24_hour_target: false`. Checks expose measured source/verification ages and always report `rpo_guaranteed: false`.

A fresh copy is evidence at a point in time, not a maximum-loss guarantee. Daily scheduling, ten-minute jitter, transfer/restore duration, hourly polling, daylight-saving transitions, host outages and alert delivery can exceed the 24-hour target. Review a shorter capture cadence and earlier warning threshold together before activation; this patch changes no timer or notification setting. See the official [systemd timer reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

Connect failed-unit notifications to the owner's chosen monitoring destination and test delivery. The files provide failure signals and systemd journal records; they do not configure email/SMS alerts or prove notification delivery. ChatGPT is neither the scheduler nor the monitor.

Uploads use [rclone copy](https://rclone.org/commands/rclone_copy/) with `--immutable --checksum`, staging the exact destination filename. This avoids an older `copyto` path that can bypass the immutable check. CI verifies both different-size and same-size conflicts preserve the original bytes, while identical retries succeed. Readbacks use `copyto` only into a new local file. The runner never syncs or deletes remote files. Dated names preserve prior copies and partial failures never overwrite the last good archive. Automatic retention deletion is intentionally not enabled. Measure actual storage growth and validate the proposed 7 daily / 4 weekly / 3 monthly retention before enabling a separately reviewed deletion job.

The old five-times-export staging requirement is removed from the runner. Raw input and HTTP capture are compressed directly into one bounded working archive. Already-compressed input is copied as compressed bytes. Both isolated restores stream that archive; the runner creates no full uncompressed working file. The separate host exporter still requires space for its full uncompressed NDJSON output (configured logical maximum plus 16 MiB free at capture preflight); a retained host/manual source occupies space in addition to the runner's working files when they share a filesystem.

Upload staging uses a same-filesystem hard link. The transfer checks inode identity, size, modification/change times and streamed SHA-256 around staging and upload. A mutation during upload, even one that restores the original bytes, fails the run. The source archive is removed only after upload succeeds, before readback creates its replacement. Any failed readback still preserves the separate last-success record and earlier dated remote objects.

Rclone uses a 1 MiB stream buffer, disables parallel ranged downloads and disables local preallocation. An unexpected remote size therefore cannot preallocate that full size before the hard byte-transfer cutoff. Exact downloaded size and SHA-256 still must match the verified source.

`max_export_bytes` now explicitly limits logical, decompressed NDJSON bytes. It defaults to 512 MiB for compatibility but is configurable rather than an absolute ceiling. `max_restore_bytes` independently budgets restored files (also 512 MiB by default). Both must be positive safe integers. The compressed archive bound is the logical budget plus 1% and 1 MiB for incompressible gzip overhead. The original 15-minute copy/subprocess deadlines still apply; a larger configured budget does not promise completion within those deadlines.

Before copying input, contacting a capture source, restoring or constructing the transfer client, preflight checks the actual work filesystem for **one compressed archive budget + the restore budget + 16 MiB reserve**. For raw manual input it uses that input's size plus gzip overhead; for compressed manual input it uses the actual compressed size; for unknown HTTP capture it uses the configured maximum. Unknown capacity fails closed. Restore limits SQLite's main database to one eighth of its budget, reserves twice that portion for WAL/journal overhead, and caps unique original/preview allocation (rounded to filesystem blocks) to the remainder before writing. It checks actual allocated recovery blocks before/after each SQL statement, before allocating each object and after writing it, and after commit; an excess aborts and cleans the isolated restore. The runner checks its entire working directory at phase boundaries, counting hard-linked inodes once, and rejects excess allocation before advancing. Choose a restore budget from measured originals, regenerated previews and workspace/database needs; exceeding a checked bound fails safely. A write, SQLite internal operation or filesystem change can exceed the observed bound between checks, and concurrent users can consume free space: these checks are not an OS quota or a reservation. Receipts label their allocation measurement as a checkpoint peak, not a continuous peak.

Input must be regular, nonempty and within its configured byte bound. Compressed-input expansion is checked while the actual Core restore consumes it, so gzip bombs, oversized records, corrupt/truncated streams and incomplete footers cannot reach upload. Core keeps the per-record bound (32 MiB with the current 12 MiB photo cap), decoding one record at a time. Freshness is rechecked after capture, before upload and before replacing last-success. Receipts record configured limits and observed capacity; no default or live setting is silently increased.

Synthetic acceptance exercises a greater-than-512 MiB logical NDJSON stream held in under 2 MiB of compressed fixture storage, with two real original images and legal whitespace padding. It performs both actual Core restores under a 96 MiB Node heap cap. This measures streaming logical growth, not recovery of that many original-photo bytes or production throughput. Real rclone acceptance still uses a temporary local backend, never a live provider.

A separate representative fixture has 12 unique noisy PNG originals and 300 drafts with random notes, with compressed bytes at least 70% of logical bytes. It tests a real object-space budget failure before any upload, preserves last-success, and completes both real restores under the same heap cap. It records the whole runner directory's allocated-block peak sampled every 5 ms, restore allocation peaks at SQL/object write boundaries, and OS-reported maximum restore RSS. Samples can miss short-lived allocation; JavaScript heap limits do not cap RSS (native image buffers and SQLite use additional memory). Neither fixture proves a production-size workload or a live provider transfer. The workflow also runs when the streaming Core reader or source lock changes.

Failures retain `last-success.json` and record a sanitized stage, run ID and fixed failure code in `last-attempt.json`. Source contents, filenames, credentials, provider messages and subprocess output are omitted. If the state filesystem itself cannot write, evidence persistence may also fail; the command still exits unsuccessfully and must not be treated as a successful backup. No configured monitor or alert delivery is implied.

The private Core host-export candidate is separate from this runner and has not been deployed. Its fresh NDJSON can use the existing `--input` path after authorized host execution; no HTTP login bypass, browser-cookie reuse or access-mode change is required. The public Core snapshot is older than the deployed runtime: use the reviewed matching Core restore source for real recovery, and require synthetic cross-version acceptance before activation.

The streaming-reader dependency in `btco-os/core/backup.mjs` is a narrow backport from canonical Core PR #92, commit `2afb0955bb9a7c817f2f4b0bcd1079eceb7928ed`. `source-lock.json` pins its canonical before/after blobs, the older snapshot baseline and the published backport bytes. The bounded reader/restore functions match that commit; the rest of this file and the remaining snapshot retain their older baseline. The source PR is still a draft, not merged or deployed. Refresh the pin after any source change or merge before activation.

For clean recovery elsewhere, download the archive and receipt, verify its SHA-256, decompress it privately, and run:

```sh
node tools/restore-drill.mjs /private/core.ndjson --cleanup
```

A production cutover still requires empty-destination restoration, independent connector recovery, matching existing listing IDs, seller reconnection where needed and exactly one active publisher. No listing approval is implied by restoring a backup.
