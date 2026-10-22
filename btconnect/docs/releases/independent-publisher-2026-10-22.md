# Independent eBay execution — October 22, 2026

The owner requested deployment through GitHub while Railway is unavailable. Moving a release branch did not deploy Core 0.7.4, and reconnecting Railway does not satisfy that requirement.

This change adds an on-demand GitHub Actions execution path for the **existing** BTConnect batch publisher. It runs Python directly on a GitHub runner; it does not call the Railway API, a Railway runtime, Core, a hosted connector or an AI provider. It keeps the same draft contracts, original-photo checks, whole-dollar prices, existing policies, exact revision approval, promotion verification and uncertain-write protection. There is no second inventory database, subscription or always-on server.

## What is deployed by merging

The `Independent eBay publisher` workflow becomes available in the existing private connector repository. Its automatic installation check reports missing configuration **names only**, without making any eBay call. A failed installation check is an explicit incomplete setup, not successful publication. Manual operations are `doctor`, `review`, `prepare` and `publish`.

`prepare` resumes a saved connector batch. Core-only staged cards can now use the [verified input handoff](core-handoff-2026-10-22.md) first. Neither step recreates missing policies or infers listing approval. The Core browser remains on its existing host. A repaired Core release and this independent execution path are separate milestones.

## Durable execution

GitHub runners are disposable. The worker restores the existing encrypted connector journal and encrypted original objects from the private orphan branch `publisher-state`. After every SQLite write, it confirms the new encrypted checkpoint in GitHub before returning to the publisher. A checkpoint failure terminates the entire process, including if the HTTP response was lost after GitHub saved it. Restart restores the authoritative branch; it never silently creates an empty journal.

Only changed database snapshots and new encrypted originals are uploaded. Originals cannot be replaced. Updates are fast-forward only, and stale runners stop on a changed branch. All workflow operations share one concurrency group; active runs are not cancelled by a new run. The publisher still reads eBay back before continuing uncertain jobs and never re-arms them automatically.

The state branch must stay private and outside the public source export. It contains operational recovery state, not source. Git history retains old encrypted checkpoints; retain independent key and data backups. Each object is capped at 20 MB and total recovered state at 450 MB. This is a bounded recovery path, not a high-volume storage service.

## Required private setup — not completed by this source change

1. Recover a consistent connector SQLite journal and its encrypted `listing-objects` directory independently. A Core logical export is not a substitute: it omits connector seller grants, approvals, offer IDs and publication journals.
2. Establish one active publication writer. Do not run the old publisher and the independent worker against separate journals. Confirm the handoff before setting the environment variable below. Do not shut down the original host or migrate inventory automatically.
3. Configure the existing private GitHub repository's `ebay-publisher` environment. Use owner approval protection. Enter secrets directly through GitHub's secure settings; never put values in chat, logs, workflow inputs, public source or issue comments. Do not reuse credentials exposed in a hosting incident; recover the journal and independently reauthorize/rotate credentials before activating live work.

| Secret | Purpose |
| --- | --- |
| `BTCO_WORKER_ARCHIVE_KEY` | Fresh Fernet key for encrypting SQLite snapshots in GitHub |
| `TOKEN_ENCRYPTION_KEY` | Matching key for the recovered connector records and original objects |
| `BTCO_WORKER_SELLER_ID` | Exact stable seller identity in the recovered journal |
| `BTCO_WORKER_GRANT_FAMILY` | Recovered/re-authorized seller grant identifier |
| `EBAY_CLIENT_ID` | Existing eBay developer application's client ID |
| `EBAY_CLIENT_SECRET` | Valid, independently secured developer credential |

Set environment variable `BTCO_WORKER_HANDOFF=github-only` only after the single-writer handoff is real. `GITHUB_TOKEN`, repository and actor are supplied by Actions; no personal access token is required for routine jobs. The owner account `shopballardtradingco-rgb` alone can grant a new approval through this worker; a resume still requires a saved exact approval.

4. On a trusted machine with those private environment values and a repository-scoped GitHub credential, seed the already-frozen recovery copy once:

   ```sh
   python -m scripts.seed_github_publisher \
     --database /private/recovery/btco.sqlite3 \
     --originals /private/recovery/listing-objects
   ```

   The helper uses SQLite's backup API, decrypts/checks stored records, verifies original hashes, encrypts the checkpoint, creates a new orphan state branch and downloads it again for verification. It refuses replacement of an existing branch. No live host or marketplace is contacted.

5. Run `doctor`, then `review` for the exact recovered batch. Download the complete private review artifact (seven-day retention). Inspect all listings, photos, prices, conditions, policies and recovery terms. Only a later explicit `publish` dispatch with that exact review revision and `owner_approved` selected may create a new approval. Deployment permission alone does not authorize it. A resume can omit that checkbox if the same revision is already approved.

The worker processes bounded one-item publication calls, continues other eligible cards after a failure, stops at retry deadlines or unchanged progress, and persists every result. A manual later run resumes the same journal and same offer identities. Report verified eBay item IDs separately from pending/unknown outcomes. No live item is used as a test without its own review approval.

## Acceptance

Synthetic tests exercise private/encrypted recovery, checkpoint rejection, lost checkpoint responses, concurrent stale workers, unsafe paths, exact approval, front-only cards, failed-first-card continuation, runner loss and no duplicate offer/publication after a lost eBay success response. The existing connector suite remains required. Real credentials, independently recovered state, execution of the verified Core input handoff with actual reviewed settings, and a separately approved live card are still operational acceptance gates. No live publisher availability is claimed by these tests.
