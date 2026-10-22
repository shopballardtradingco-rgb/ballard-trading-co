"""Import a private Core handoff into the recovered GitHub publisher journal.

Run only after the documented single-writer handoff, with the same private
configuration used to seed the journal. This command never contacts eBay.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess

from btco_ebay.core_handoff import import_input
from btco_ebay.github_journal import GitHubAPI, GitHubJournal, CheckpointStore, JournalUnavailable
from btco_ebay.github_worker import require_verified_source
from btco_ebay.listing_store import ListingStore
from btco_ebay.photos import PhotoStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--tested-commit", required=True)
    args = parser.parse_args()
    api = None
    try:
        if os.environ.get("BTCO_WORKER_HANDOFF") != "github-only":
            raise ValueError("Confirmed single-writer handoff required")
        root = Path(__file__).resolve().parents[1]
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=normal",
                                         "--", "btco_ebay", "scripts"], cwd=root, text=True)
        if head != args.tested_commit or dirty:
            raise ValueError("Run the clean canonical checkout of the exact tested commit")
        path = Path(args.input)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 140_000_000:
            raise ValueError("Bounded private handoff file required")
        payload = json.loads(path.read_text())
        api = GitHubAPI(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"])
        require_verified_source(api, args.tested_commit)
        with tempfile.TemporaryDirectory(prefix="btco-private-import-") as root:
            journal = GitHubJournal(api, root, os.environ["BTCO_WORKER_ARCHIVE_KEY"])
            journal.restore()  # Never initialize an empty replacement journal.
            store = CheckpointStore(journal, os.environ["TOKEN_ENCRYPTION_KEY"])
            repo = ListingStore(store, PhotoStore(store))
            result = import_input(repo, os.environ["BTCO_WORKER_SELLER_ID"], payload)
            print(json.dumps({**result, "journal_commit": journal.head}))
        return 0
    except (Exception, JournalUnavailable):
        print("Core import stopped. Check the private handoff, tested source and recovered journal; no listing was approved or published.", file=sys.stderr)
        return 1
    finally:
        if api:
            api.close()


if __name__ == "__main__":
    raise SystemExit(main())
