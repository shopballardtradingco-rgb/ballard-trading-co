# Backup and recovery runbook

Updated October 20, 2026 (Pacific). Recovery is a release requirement. This document distinguishes delivered evidence from unconfigured work.

## Verified checkpoint

| Layer | Evidence | What it does not cover |
| --- | --- | --- |
| Current source | 530 files recovered from exact Core and Connect commits, all original Git blob hashes matched; reviewed public snapshot | Complete original Git histories, GitHub settings, issues, PRs or secrets |
| Independent source copy | Complete original source snapshot uploaded to owner-only Google Drive recovery folder, downloaded again and SHA-256 verified | A scheduled mirror or live-deployment migration |
| Core logical backup | Full workspace plus original bytes exported and copied to owner-only Google Drive, downloaded again and SHA-256 verified | Passwords, sessions, saved eBay authorization grants, connector database, legacy D1 or account recovery |
| Restore drill | Offline empty workspace restored; every original read back and hash verified; a second restore into the occupied target was rejected | A production PostgreSQL/S3 failover, cross-channel resumption or reconnecting seller grants |
| GitHub source archive workflow | First on-push run succeeded; on-push/manual/weekly workflow creates source tarball, public Git bundle and checksums, retaining each Actions artifact for 90 days | Scheduled independent-provider delivery and runtime data backup |
| Railway volume backup | Current account's Backups screen requires a Pro upgrade to create snapshots or schedules | No new backup plan/subscription was activated; no native schedule is claimed |

Checkpoint evidence: [first source archive run](https://github.com/shopballardtradingco-rgb/ballard-trading-co/actions/runs/39541817600) and [Core/Connect CI](https://github.com/shopballardtradingco-rgb/ballard-trading-co/actions/runs/39541817538) succeeded on public commit `c02e894853375088817534f288aac199f92bcc8f`. All 546 public file blobs at that commit matched the reviewed local content.

## Target policy — not yet fully active

Keep three recoverable copies: running system, encrypted/private independent cloud backup, and an owner-held offline copy. A second folder or GitHub branch alone does not satisfy provider redundancy.

- Nightly full logical workspace export, including all original-photo history, with a complete footer, item/photo counts and cryptographic hashes.
- Native PostgreSQL dump plus connector SQLite online backup and original-object inventory. Never copy a live SQLite file without its supported online backup procedure; do not discard publication/approval journals.
- Retain 7 daily, 4 weekly and 3 monthly independent backups, subject to measured cost/storage. Failed runs must not overwrite the last good backup. Keep immutable dated names; never mirror deletions into every backup.
- Encrypt off-site backup bytes where supported and maintain a separate recoverable encryption-key copy. The current Drive copy is owner-only, not a claim of client-side encryption or immutable storage.
- Alert the owner through GitHub/host monitoring when a run fails, a backup is older than 26 hours, or restore verification fails. ChatGPT is not the scheduler.
- Monthly isolated restore drill, plus a pre-migration backup. Record duration, source SHA, recovered counts and every remaining blocker.
- Working targets: at most 24 hours of data loss and recovery within 4 hours. These are goals, not measured service guarantees.

## Source recovery without ChatGPT

```sh
git clone https://github.com/shopballardtradingco-rgb/ballard-trading-co.git
cd ballard-trading-co
python3 tools/check-public.py
python3 tools/verify-source.py
bash tools/archive-source.sh /absolute/private/recovery-output
```

With a downloaded bundle, run `git bundle verify FILE.bundle`, then `git clone FILE.bundle recovered-source`. With a source tarball, extract to an empty directory and verify its recorded checksums. Keep private original histories private; this public repository intentionally starts fresh.

## Core data recovery

1. Retrieve the dated private archive and checksum manifest from the owner-controlled recovery store. Verify checksums before decompression. Never commit its contents or attach it to a public issue.
2. On an isolated machine, install Core dependencies and exercise the actual restore implementation:

   ```sh
   npm ci --prefix btco-os/core --ignore-scripts
   gzip -dk /private/BTCore-DATE.ndjson.gz
   node tools/restore-drill.mjs /private/BTCore-DATE.ndjson
   ```

   This uses a fresh temporary SQLite database and private local object directory. It calls no marketplace, provider or live database. It keeps recovered files private for inspection; remove them through the operator's normal private-data process when finished.
3. For real failover, provision a separate empty PostgreSQL workspace and private S3-compatible bucket. Configure a new owner account and least-privilege runtime/migration roles using Core's README. Keep marketplace publication and paid AI disabled during acceptance.
4. Use `node btco-os/core/backup.mjs --file /private/backup.ndjson --into-empty-workspace` with the destination's operator database connection and complete object storage variables. The backup includes objects; restoring only database object references is insufficient. This snapshot exceeds the local database-only photo allowance, so use object storage for real recovery.
5. Reconnect required marketplace authorization, verify existing listing/order identities, reconcile unknown publication outcomes and compare originals before allowing any new publish. Reusing old pending work blindly risks duplicate listings or sales.
6. Validate the new host end to end and deliberately switch routing. Keep the previous system and last known good backup until the owner accepts recovery. Never restore over the only live copy.

## Connector and legacy recovery still required

- Save the connector's consistent SQLite backup, its local encrypted listing-objects directory/checksums (plus any separately maintained R2 copies), TOKEN_ENCRYPTION_KEY and any publication/receipt-signing keys through a private recovery process. Runtime environment values must never enter public artifacts. Preserve write-ahead state, approvals and uncertain publication outcomes.
- Back up eBay application configuration and redirect setup instructions, then verify restoration/reconnection without duplicating published offers. A logical Core export alone cannot restore BTConnect.
- Export the legacy Sites/D1 database and original objects separately. Reconcile exact master SKU mappings before treating Core as its replacement.
- Back up repository history and issue/PR metadata to another provider. Export account recovery instructions, billing ownership, DNS/domain renewal information and secret-store recovery to a private owner-held record.

## Operational checks

Track last successful backup, destination, source SHA, checksum, age, tested restore date, measured recovery time and blockers in the private backup index. Link only a sanitized result from public Issues. A green app health check does not prove backup delivery. Do not cancel subscriptions until the CDP and independence acceptance gates are met.
