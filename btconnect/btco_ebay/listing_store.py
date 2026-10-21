"""Encrypted draft approvals, uniqueness reservations and publication journal."""

from contextlib import contextmanager
import fcntl
from pathlib import Path
import sqlite3
import time
from .listing_drafts import parse_listing, ListingDraft
from .store import digest


class ListingStore:
    def __init__(self, store, photos):
        self.store, self.photos = store, photos
        with store.tx() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS listing_claims (seller TEXT, kind TEXT, value TEXT, draft_id TEXT, PRIMARY KEY(seller,kind,value))"
            )
            db.execute("CREATE INDEX IF NOT EXISTS listing_catalog_idx ON listing_claims(seller,draft_id)")

    @staticmethod
    def key(seller, draft_id):
        return seller + ":" + draft_id

    @contextmanager
    def lock(self, seller):
        # OS locks release on process death; unlike an expiring lease, they cannot
        # let a second worker race an in-flight eBay request after a timeout.
        path = Path(self.store.path).parent / (".listing-" + digest(seller) + ".lock")
        fd = path.open("a+b")
        path.chmod(0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError(
                    "A listing operation is already running for this seller"
                ) from None
            yield
        finally:
            fd.close()

    def get(self, seller, draft_id, db=None):
        row = self.store.get("listing", self.key(seller, draft_id), db=db)
        if not row:
            raise ValueError("Listing draft not found for this seller")
        return row

    def write(self, seller, row, db=None):
        self.store.put(
            "listing", self.key(seller, row["draft"]["draft_id"]), row, db=db
        )

    def list(self, seller, after="", limit=20):
        if not 1 <= limit <= 100:
            raise ValueError("Use 1–100 drafts per page")
        with self.store.read() as db:
            ids = [r[0] for r in db.execute(
                "SELECT DISTINCT draft_id FROM listing_claims WHERE seller=? AND draft_id>? ORDER BY draft_id LIMIT ?",
                (digest(seller), after, limit + 1))]
            rows = [self.get(seller, identifier, db) for identifier in ids[:limit]]
        return rows, ids[limit - 1] if len(ids) > limit else None

    def save(self, seller, data, expected_revision=None, *, grant_family=None):
        draft = parse_listing(data)
        for photo in draft.photos:
            self.photos.get(seller, photo)
        with self.lock(seller), self.store.tx() as db:
            if grant_family is not None:
                grant = self.store.get("grant", grant_family, db=db)
                if not grant or grant.get("user_id") != seller:
                    raise ValueError("Seller connection expired during draft preparation")
            previous = self.store.get(
                "listing", self.key(seller, draft.draft_id), db=db
            )
            if previous:
                if previous["revision"] != expected_revision:
                    raise ValueError("Draft changed; reload before saving")
                if previous["job"]:
                    raise ValueError(
                        "Publication has started; resolve it before changing this draft"
                    )
                if (
                    previous["draft"].get("master_sku") is not None
                    and previous["draft"]["master_sku"] != draft.master_sku
                ):
                    raise ValueError("Existing CDP master SKU cannot be changed")
            elif expected_revision is not None:
                raise ValueError("Draft does not exist")
            claims = [("item", draft.physical_item_id), ("sku", draft.listing_sku)] + [
                ("photo", p.sha256_hex) for p in draft.photos
            ]
            try:
                # Claims from older revisions remain reserved to prevent the same
                # photographed physical copy from being published under a new ID.
                for kind, value in claims:
                    row = db.execute(
                        "SELECT draft_id FROM listing_claims WHERE seller=? AND kind=? AND value=?",
                        (digest(seller), kind, digest(value)),
                    ).fetchone()
                    if row and row[0] != draft.draft_id:
                        raise ValueError(
                            "Physical item, SKU or photo is already assigned to another draft"
                        )
                    db.execute(
                        "INSERT OR IGNORE INTO listing_claims VALUES(?,?,?,?)",
                        (digest(seller), kind, digest(value), draft.draft_id),
                    )
            except sqlite3.IntegrityError:
                raise ValueError("Duplicate listing reservation") from None
            row = {
                "draft": draft.model_dump(mode="json"),
                "revision": draft.revision(),
                "approval": None,
                "job": {},
                "state": "draft",
                "updated_at": time.time(),
            }
            self.write(seller, row, db)
        return row

    def approve(self, seller, draft_id, revision, evidence):
        if not isinstance(evidence, str) or not 10 <= len(evidence) <= 4000:
            raise ValueError(
                "Record the explicit owner approval and its conversation/reference"
            )
        with self.lock(seller), self.store.tx() as db:
            return self.approve_in_transaction(seller, draft_id, revision, evidence, db)

    def approve_in_transaction(self, seller, draft_id, revision, evidence, db):
        # Caller holds the seller lock and transaction; permits atomic batch approval.
        row = self.get(seller, draft_id, db)
        draft = parse_listing(row["draft"])
        if row["revision"] != revision or draft.revision() != revision:
            raise ValueError("Approval revision is stale")
        if row["job"] and not self.condition_revision_pending(row):
            raise ValueError("Publication has already started")
        for photo in draft.photos:
            self.photos.get(seller, photo)
        row.update(
            approval={
                "revision": revision,
                "seller": seller,
                "evidence": evidence,
                "approved_at": time.time(),
            },
            state="approved",
        )
        self.write(seller, row, db)
        return row

    @staticmethod
    def condition_revision_pending(row):
        job = row["job"]
        return (
            job.get("phase") == "condition_review"
            and isinstance(job.get("condition_revision_from"), dict)
            and bool(job["condition_revision_from"].get("inventory"))
            and not any(job.get(key) for key in (
                "offer_attempted", "offer_id", "publish_attempted", "listing_id"
            ))
            and row["state"] != "published" and not row.get("receipt")
        )

    @staticmethod
    def approved(row, seller):
        draft = parse_listing(row["draft"])
        approval = row.get("approval") or {}
        if (
            approval.get("seller") != seller
            or approval.get("revision") != draft.revision()
            or row["revision"] != draft.revision()
        ):
            raise ValueError("This exact listing revision has not been approved")
        return draft


