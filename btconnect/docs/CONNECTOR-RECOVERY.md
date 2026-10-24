# BTConnect recovery without ChatGPT

The operator command preserves a consistent SQLite snapshot, every finalized local encrypted original (including unindexed history), and a separate private recovery configuration file. It validates every encrypted record and original, binds a checksum manifest to the matching key file, and restores only into a new directory. No server starts and no marketplace or AI request is made.

The SQLite snapshot retains all tables and rows, including expired records, saved approvals, exact master SKUs, published eBay IDs, uncertain jobs, OAuth grants and the encrypted publication receipt-signing key. It uses SQLite's [online backup API](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup); it never copies the live database file directly or changes the source journal mode. Only the copied database is finalized into a self-contained journal format. Originals are immutable; the snapshot's references must all resolve and decrypt correctly. Concurrent finalized uploads may be included as extra originals; unfinished upload temporary files are excluded. No deletion or retention process may run concurrently with capture.

## Capture on the existing operator host

Use Python 3.11+ with this repository's locked dependencies. The module is also included in the normal connector image. Run as the existing operator with read access to the live database/original volume and the existing runtime environment. Do not paste keys into chat or command arguments. Required variables are `TOKEN_ENCRYPTION_KEY`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`, and `PUBLIC_URL`. Existing seller/callback configuration and `BTCO_WORKER_ARCHIVE_KEY`, when set, are retained. AI credentials and publication-enable flags are excluded.

Choose a new dated destination on independent mounted storage, or a private operator disk with sufficient space. Directories must already exist with mode 0700. The live small volume may not have space for a second copy; the command checks free space and refuses insufficient capacity. It currently supports a 128 MiB database, 17 MiB per encrypted original, and 2 GiB of originals. Allow the complete encrypted-original size, three database copies and 50 MB reserve on the capture destination; restore requires another complete copy plus reserve.

```sh
python -m btco_ebay.recovery capture \
  --database /data/btco.sqlite3 \
  --originals /data/listing-objects \
  --output /private-backups/CONNECT-DATE \
  --keys-out /private-keys/CONNECT-DATE.json
```

Both output names must be new. The command copies only into its own temporary directory and reserves the final output without replacing an existing backup. Failure reports no success. An interrupted run can leave a partial output or a key file; preserve earlier copies and use new dated names after reviewing the failure. Capture does not attest off-site delivery.

The package contains `state.sqlite3`, `listing-objects/` and `manifest.json`. Keep the separate mode-0600 key/configuration file in an owner-controlled recovery store. It contains actual secrets; the package is not recoverable without it. Database record values and original files retain their existing encryption, but metadata and the key file are not encrypted by this command. Use private storage and a separate owner-authorized encryption layer where required; never upload either to public source, issue attachments or CI artifacts.

## Verify downloaded bytes and rehearse recovery

Copy the entire package to the independent private destination, download it into an owner-only operator directory, and recover the matching key file through its separate private process. Then run:

```sh
python -m btco_ebay.recovery verify \
  --package /private-readback/CONNECT-DATE \
  --keys /private-keys/CONNECT-DATE.json
python -m btco_ebay.recovery restore \
  --package /private-readback/CONNECT-DATE \
  --keys /private-keys/CONNECT-DATE.json \
  --destination /private-restores/CONNECT-DATE
```

The restore destination must not exist, even if empty. Restored bytes are verified again before final placement. Corrupt or missing originals, wrong keys, changed manifests, symlinks and unexpected files fail verification. The tool does not instantiate the application store during inspection, so normal expiry cleanup cannot silently change recovered history.

The restored directory includes `recovery-defaults.json` with publication disabled and AI budget zero. This is a reviewable configuration template, not an automatically loaded environment file or a global lock on other processes. Restore never starts the application. Before deliberate activation, supply those settings, update the public origin/callback as required, verify the same receipt-signing identity and existing listing IDs, and reconcile every uncertain outcome using the existing read-back paths. Stop the previous writer and establish exactly one active publisher. Reconnect seller access if grants have expired; do not blindly replay a restored queue.

Record the private manifest hash, capture time, destination, restore counts/duration and all remaining exclusions. A local capture and synthetic test do not prove that the live journal is backed up. Independent delivery, matching download verification, and an isolated actual-data restore are all required before checking off operational recovery.

## Boundaries and current acceptance

Synthetic acceptance covers exact SQLite rows and extra tables, committed/uncommitted WAL behavior, expired record retention, active and retired originals, legacy catalogs, receipt signing identity, uncertain publication state, wrong keys, corruption, missing references, symlinks, insufficient space, non-overwrite behavior, and redacted CLI errors. Networking is forbidden throughout these recovery tests.

Live capture still requires authorized access to the existing runtime volume and configuration. The current connected listing tools do not expose that operator access. No new HTTP export endpoint, production timer, storage subscription, replica or marketplace write is introduced. Separate Core data, external R2 copies, hosting/DNS/account recovery and private Git history remain separate requirements. This does not activate the existing GitHub publisher worker or replace its single-writer handoff gates.
