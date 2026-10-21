# BTCore 0.2.2 — bulk photo storage

The bulk uploader offered 500 photos but the development database imposed a 64 MiB total quota. That prevented normal phone-photo batches.

New uploads use a dedicated private S3-compatible bucket with a 10 GiB application allowance. Original bytes are unchanged; derived previews live separately in the bucket. Existing database photos and metadata are retained. The quota remains 64 MiB if storage is not configured, avoiding a larger allowance against the small database volume.

Configuration uses provider variable references. Pre-deploy verifies real bucket write/read access and applies two nullable object-reference columns. Conditional writes and readback hashing precede each database commit. Failed uploads do not advance the workspace. Backups include both legacy and object-backed originals. File restoration streams large backups and requires an empty destination. Object-backed records require this runtime or later; do not roll back to an older runtime after saving them.

The home screen now offers Bulk upload directly, and batch previews load lazily. The per-file 12 MiB limit and mixed single/paired card workflow remain.

Validation includes an 80 MiB synthetic original batch, a backup over 100 MiB, streaming restoration and exact original hash verification, conditional-write mismatch rejection, failed-storage transaction rollback, and existing intake/auth/recovery tests. Local tests use an isolated file-backed object-store fixture. Deployment preflight verifies the real bucket without creating inventory.
