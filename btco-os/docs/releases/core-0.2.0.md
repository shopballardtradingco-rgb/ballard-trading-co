# BTCore 0.2.0 · intake workbench

October 17, 2026 Pacific. Branch: `feature/btcore-intake-v0.2`, based on reviewed v0.1 commit `f5fb5a9e0e554e0539d40a241a0b02b7cc792e64`.

Receiving a stack should not require starting from scratch after a lost connection or a wrong photo assignment. This release adds a practical batch workflow and reversible corrections to the independent app.

## Changes

- Choose up to 24 photos in front/back order, inspect the pairs, swap sides before upload, and assign a common type/location. Save up to 12 draft pieces sequentially.
- Pause after the active piece and resume. Retry interrupted saves without duplicating drafts or originals, including when the server committed successfully but its response was lost.
- Swap front/back photos or replace a current photo before confirmation. Every previous original remains unchanged, private, downloadable, and backed up. Corrections clear review checks.
- Archive unfinished drafts without deleting anything; restore them for another review. Search/filter unfinished, received and archived intake separately.
- Dedicated mobile camera controls alongside file selection; responsive batch and history views.
- Version 2 streamed backups include archives and photo history. Recovery still accepts v1 backups and only writes into an empty destination workspace.
- Prevent edits in the active form during a save; keep write replay keys until the follow-up workspace refresh succeeds.

## Validation

Ten local integration scenarios pass, including original-byte readback, chained replacements, archive locks, stale-revision protection, v1 backup compatibility, complete history restore, and a correction racing with a streamed backup. The expanded browser scenario passes the complete v0.1 flow plus batch pairing, intentionally lost draft/photo responses, no duplicate records, pause/resume, correction/history, archive/restore, verified v2 backup, and 390px layout. No external service requests or browser errors occur.

PostgreSQL 17 CI exercises the restricted runtime login, role swaps under unique constraints, replacement history, archive persistence, independent reconnection and restore. CI also builds and runs the non-root Docker image and runs the existing browser/Python regression suites. The PR records the exact final commit and terminal CI results.

## Operating limits

AI, automatic marketplace synchronization and publication are still disconnected. Each saved batch piece requires manual identity, price, condition and full review before it becomes inventory. Queue selections are held only in the open tab; server-saved partial drafts survive closing it. Pause stops between pieces, not midway through an upload. Invalid image files need correction through the individual draft or a new batch selection.

The 64 MiB original quota includes retained photo history; replacing or archiving does not reclaim storage. Each original is capped at 12 MiB, with up to 50 replacements per draft. Confirmed intake photos stay locked. Backups remain manual and no R2 migration is included. Physical iPhone/Safari camera and HEIC acceptance is outstanding.

The database schema is unchanged. A v0.2 workspace using archived/history data and v2 backups requires v0.2 or later; take a backup before upgrading and do not downgrade in place.

## Launch state

The owner approved the v0.1 Core Dev launch and continued development. Its reviewed commit remains unchanged. The Core Dev HTTPS address exists, but the application has not deployed because Railway still lacks repository access. This v0.2 milestone is separate from the approved v0.1 deployment pin. See [release preparation](../deployment/BTCORE-CORE-DEV.md).
