"""Run the existing batch publisher on GitHub Actions, without a hosted API.

No runtime URL, Railway token, Core database connection, or AI key is used.
The live worker requires an independently recovered journal and seller grant.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from types import SimpleNamespace

from .ebay import Ebay, IDENTITY_URL
from .github_journal import GitHubAPI, GitHubJournal, CheckpointStore, JournalUnavailable
from .listing_batches import ListingBatches
from .listing_store import ListingStore
from .photos import PhotoStore
from .publishing import Publisher
from .selling import Selling

REQUIRED = ("GITHUB_TOKEN", "GITHUB_REPOSITORY", "BTCO_WORKER_ARCHIVE_KEY",
            "TOKEN_ENCRYPTION_KEY", "BTCO_WORKER_SELLER_ID")
SELLER_REQUIRED = ("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "BTCO_WORKER_GRANT_FAMILY", "GITHUB_SHA")


def preflight(env, operation):
    names = REQUIRED + (SELLER_REQUIRED if operation in ("prepare", "publish") else ())
    missing = [name for name in names if not env.get(name)]
    if operation in ("prepare", "publish") and env.get("BTCO_WORKER_HANDOFF") != "github-only":
        missing.append("BTCO_WORKER_HANDOFF=github-only")
    return missing


def progress(review):
    return json.dumps([(x["draft_id"], x["publication"], x.get("last_attempt"))
                       for x in review["listings"]], sort_keys=True)


def require_verified_source(api, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Exact tested worker commit is required")
    runs = api("GET", "/actions/workflows/ci.yml/runs?event=push&head_sha=" + sha + "&per_page=20")["workflow_runs"]
    exact = sorted((r for r in runs if r.get("head_sha") == sha and r.get("event") == "push"),
                   key=lambda r: r["id"], reverse=True)
    if not exact or exact[0].get("status") != "completed" or exact[0].get("conclusion") != "success":
        raise ValueError("Connector validation must pass on this exact worker commit")


async def run_batch(engine, seller, family, batch_id, operation, revision="", approve=False,
                    actor="", max_calls=25):
    if not re.fullmatch(r"btco-batch-[a-z0-9-]{1,80}", batch_id):
        raise ValueError("A saved batch identifier is required")
    if operation not in ("review", "prepare", "publish") or not 1 <= max_calls <= 25:
        raise ValueError("Unsupported worker operation")
    review = engine.review(seller, batch_id)
    if operation == "review":
        return review
    if operation == "prepare":
        for _ in range(max_calls):
            before = json.dumps(review, sort_keys=True)
            review = await engine.prepare(seller, family, batch_id, max_items=20, timeout=35)
            if not review["preparation_pending"] or json.dumps(review, sort_keys=True) == before:
                break
        return review
    if not re.fullmatch(r"[0-9a-f]{64}", revision) or revision != review["review_revision"]:
        raise ValueError("Publish requires the exact complete reviewed revision")
    if approve:
        if not actor or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", actor):
            raise ValueError("Owner approval must have a GitHub actor")
        engine.approve(seller, batch_id, revision,
            "GitHub operator " + actor + " explicitly selected publish, checked owner_approved, "
            "and supplied the exact complete review revision " + revision)
    elif not review["approval_current"]:
        raise ValueError("This exact review has no saved owner approval")
    for _ in range(max_calls):
        before = progress(review)
        review = await engine.publish(seller, family, batch_id, revision, max_items=1, timeout=40)
        eligible = [x for x in review["listings"] if not x["publication"]["all_checks_verified"]
                    and (x.get("last_attempt") or {}).get("disposition") != "owner_action"
                    and (x.get("last_attempt") or {}).get("retry_after", 0) <= time.time()]
        if not eligible or progress(review) == before:
            break
    return review


async def execute(env, operation, batch_id, revision, approve, output):
    missing = preflight(env, operation)
    if missing:
        raise ValueError("Missing independent worker configuration: " + ", ".join(missing))
    if approve and env.get("GITHUB_ACTOR") != "shopballardtradingco-rgb":
        raise ValueError("Only the repository owner may grant new listing approval")
    api = GitHubAPI(env["GITHUB_REPOSITORY"], env["GITHUB_TOKEN"])
    try:
        if operation in ("prepare", "publish"):
            require_verified_source(api, env["GITHUB_SHA"])
        with tempfile.TemporaryDirectory(prefix="btco-private-worker-") as root:
            journal = GitHubJournal(api, root, env["BTCO_WORKER_ARCHIVE_KEY"])
            journal.restore()
            store = CheckpointStore(journal, env["TOKEN_ENCRYPTION_KEY"])
            photos = PhotoStore(store)
            repo = ListingStore(store, photos)
            seller = env["BTCO_WORKER_SELLER_ID"]
            if operation == "review":
                review = await run_batch(ListingBatches(repo, None), seller, None, batch_id, operation)
            else:
                family = env["BTCO_WORKER_GRANT_FAMILY"]
                grant = store.get("grant", family)
                if not grant or grant.get("user_id") != seller or grant.get("username", "").casefold() != "ballardtradingco":
                    raise ValueError("Matching independently recovered eBay seller authorization is required")
                # Existing grant refresh only. No hosted callback or new OAuth flow is invented.
                settings = SimpleNamespace(client_id=env["EBAY_CLIENT_ID"], client_secret=env["EBAY_CLIENT_SECRET"])
                ebay = Ebay(settings, store)
                selling = Selling(ebay)
                engine = ListingBatches(repo, Publisher(repo, selling, enabled=operation == "publish"))
                async with ebay.http.lifespan():
                    identity = await ebay.get(family, IDENTITY_URL)
                    if identity.get("userId") != seller or identity.get("username", "").casefold() != "ballardtradingco":
                        raise ValueError("Live eBay seller identity does not match the recovered journal")
                    review = await run_batch(engine, seller, family, batch_id, operation,
                        revision, approve, env.get("GITHUB_ACTOR", ""))
            # Full private review and exact revision are delivered as a private artifact,
            # never printed in Actions logs or placed in the public source checkpoint.
            target = Path(output)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_text(json.dumps(review, indent=2) + "\n")
            target.chmod(0o600)
            return {"operation": operation, "total": review["total_items"],
                    "verified": review["verified_count"], "exceptions": len(review["exceptions"]),
                    "journal_commit": journal.head}
    finally:
        api.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("doctor", "review", "prepare", "publish"))
    parser.add_argument("--batch-id", default=os.environ.get("BTCO_WORKER_BATCH_ID", ""))
    parser.add_argument("--revision", default=os.environ.get("BTCO_WORKER_REVIEW_REVISION", ""))
    parser.add_argument("--output", default="private-review/review.json")
    args = parser.parse_args()
    try:
        if args.operation == "doctor":
            missing = preflight(os.environ, "publish")
            print(json.dumps({"configuration_complete": not missing, "missing_configuration_names": missing,
                              "journal_and_seller_verified": False, "live_publication_attempted": False}))
            return 2 if missing else 0
        result = asyncio.run(execute(os.environ, args.operation, args.batch_id, args.revision,
            os.environ.get("BTCO_WORKER_OWNER_APPROVED") == "true", args.output))
        print(json.dumps(result))
        return 0
    except JournalUnavailable:
        print("Independent journal unavailable or unconfirmed. Worker stopped; restore the latest checkpoint before retrying.", file=sys.stderr)
    except Exception:
        # Do not serialize arbitrary remote errors, private draft text or credentials.
        print("Worker stopped. Check required configuration, seller identity, saved batch and exact review revision. No automatic retry was started.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
