"""Durable, seller-bound batches layered over the existing publication journal.

No background task is assumed. Every call resumes persisted work, and uncertain
eBay writes continue to use Publisher's fail-closed reconciliation.
"""
import asyncio
from contextlib import contextmanager
from copy import deepcopy
import fcntl
from pathlib import Path
import time
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator
from .listing_drafts import parse_listing, ListingDraft, fingerprint
from .listing_validation import prepare_text, validate_new_standards, validation_errors
from .publishing import publication_outcome
from .selling import SellingError
from .store import digest

BatchId = Annotated[str, Field(pattern=r"^btco-batch-[a-z0-9-]{1,80}$")]


class BatchEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    item_key: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=160)
    draft: dict | None = None
    unresolved_reason: str | None = Field(default=None, min_length=10, max_length=2000)
    expected_draft_revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    preparation_evidence: dict | None = None

    @model_validator(mode="after")
    def one_input(self):
        if not self.item_key.strip() or not self.label.strip():
            raise ValueError("Item key and label cannot be blank")
        if (self.draft is None) == (self.unresolved_reason is None):
            raise ValueError("Provide either a complete draft or an unresolved reason")
        return self


class BatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    batch_id: BatchId
    inventory_location: str = Field(min_length=1, max_length=100)
    items: list[BatchEntry] = Field(min_length=1, max_length=100)
    # This is a proposed policy until the whole review package is owner-approved.
    confirmed_rejection_retry_limit: int = Field(default=0, strict=True, ge=0, le=1)

    @model_validator(mode="after")
    def distinct_items(self):
        if not self.inventory_location.strip():
            raise ValueError("Physical inventory location cannot be blank")
        keys = [i.item_key for i in self.items]
        drafts = [i.draft.get("draft_id") for i in self.items if i.draft is not None]
        if len(set(keys)) != len(keys) or len(set(drafts)) != len(drafts):
            raise ValueError("Each physical copy and draft must appear only once")
        return self


class ListingBatches:
    def __init__(self, repo, publisher):
        self.repo, self.publisher, self.store = repo, publisher, repo.store

    @contextmanager
    def lock(self, seller, batch_id):
        path = Path(self.store.path).parent / (".batch-" + digest(seller + ":" + batch_id) + ".lock")
        with path.open("a+b") as fd:
            path.chmod(0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("This batch is already running; read its saved status") from None
            yield

    def get(self, seller, batch_id, db=None):
        row = self.store.get("listing-batch", seller + ":" + batch_id, db=db)
        if not row or row.get("seller") != seller:
            raise ValueError("Batch not found for this seller")
        return row

    def write(self, row, db=None):
        row["updated_at"] = time.time()
        self.store.put("listing-batch", row["seller"] + ":" + row["input"]["batch_id"], row, db=db)

    def submit(self, seller, payload, expected_revision=None):
        data = BatchInput.model_validate(payload).model_dump(mode="json")
        # Preserve the exact historical batch serialization when no new evidence is supplied.
        for item in data["items"]:
            if item["preparation_evidence"] is None:
                item.pop("preparation_evidence")
        revision = fingerprint(data)
        with self.lock(seller, data["batch_id"]), self.store.tx() as db:
            old = self.store.get("listing-batch", seller + ":" + data["batch_id"], db=db)
            if old:
                if old["revision"] == revision:
                    return old  # lost response/retry cannot clear an approval or progress
                if old["revision"] != expected_revision:
                    raise ValueError("Batch changed; retrieve its revision before editing")
                if old.get("publication_started") and any(
                    self.repo.get(seller, result["draft_id"], db)["job"]
                    for result in old["results"].values() if result.get("status") == "ready"
                ):
                    raise ValueError("Publication started; resolve this batch before replacing its inputs")
            elif expected_revision is not None:
                raise ValueError("Batch does not exist")
            row = {"seller": seller, "input": data, "revision": revision,
                   "results": {}, "approval": None, "publication_started": False,
                   "publication_results": {}, "created_at": old["created_at"] if old else time.time()}
            self.write(row, db)
            return row

    async def prepare(self, seller, family, batch_id, max_items=20, timeout=35):
        if not 1 <= max_items <= 20 or timeout <= 0:
            raise ValueError("Use 1–20 preparation items and a positive time budget")
        with self.lock(seller, batch_id):
            row = self.get(seller, batch_id)
            if row.get("approval") or row.get("publication_started"):
                return self.review(seller, batch_id)
            # Save each item immediately. Cancellation leaves the remaining inputs recoverable.
            checks = {}
            async def check_once(key, check):
                if key not in checks:
                    try:
                        checks[key] = await check()
                    except Exception as error:
                        checks[key] = error
                if isinstance(checks[key], Exception):
                    raise checks[key]
                return checks[key]
            started = time.monotonic()
            metrics = row.setdefault("preparation_metrics", {
                "calls": 0, "attempts": 0, "failures": 0, "elapsed_seconds": 0,
                "per_item": {},
            })
            metrics["calls"] += 1
            dirty = True  # Persist this call even when no item needs preparation.
            # Finish new items before retrying exceptions. A permanently invalid
            # early item cannot starve later books when calls have small budgets.
            entries = sorted(row["input"]["items"], key=lambda e: e["item_key"] in row["results"])
            processed = 0
            for entry in entries:
                key = entry["item_key"]
                if entry["draft"] is None:
                    unresolved = {"status": "unresolved", "reason": entry["unresolved_reason"]}
                    if row["results"].get(key) != unresolved:
                        row["results"][key] = unresolved
                        dirty = True
                    continue
                prior = row["results"].get(key, {})
                if prior.get("status") == "ready":
                    current = self.repo.get(seller, prior["draft_id"])
                    if current["revision"] == prior["revision"]:
                        # Cached preparation only. Publisher still makes fresh policy,
                        # original-photo, content and duplicate checks before writes.
                        continue
                remaining = timeout - (time.monotonic() - started)
                if processed >= max_items or remaining <= 0:
                    break
                processed += 1
                item_start = time.monotonic()
                per_item = metrics["per_item"].setdefault(key, {"attempts": 0, "failures": 0, "elapsed_seconds": 0})
                per_item["attempts"] += 1
                metrics["attempts"] += 1
                try:
                    async with asyncio.timeout(remaining):
                        await self._prepare_entry(seller, family, row, entry, check_once)
                except asyncio.CancelledError:
                    per_item["cancellations"] = per_item.get("cancellations", 0) + 1
                    raise
                except Exception as error:
                    row["results"][key] = {"status": "exception", "errors": validation_errors(error)}
                    per_item["failures"] += 1
                    metrics["failures"] += 1
                finally:
                    # Includes cancelled attempts; successful earlier items stay durable.
                    elapsed = time.monotonic() - item_start
                    per_item["elapsed_seconds"] += elapsed
                    metrics["elapsed_seconds"] += elapsed
                    self.write(row)
                    dirty = False
                # Shared checks may complete synchronously for later items. Yield
                # between durable checkpoints so health/status work can run.
                await asyncio.sleep(0)
            if dirty:
                self.write(row)
            return self.review(seller, batch_id)

    async def _prepare_entry(self, seller, family, row, entry, check_once):
        key = entry["item_key"]
        data, additions = prepare_text(entry["draft"])
        draft = parse_listing(data)
        validate_new_standards(draft)
        await self.repo.photos.work.run(self.repo.photos.verify, seller, draft.photos)
        # Include every draft field read by validate_policies/category;
        # a shared digest alone must not skip a different condition/location.
        policy_key = fingerprint([draft.policies.model_dump(), draft.merchant_location_key,
                                  draft.category_id, draft.condition, draft.best_offer.enabled,
                                  draft.packed_parcel is not None,
                                  [d.model_dump() for d in getattr(draft, "condition_descriptors", [])]])
        await check_once(("policies", policy_key),
                         lambda: self.publisher.selling.validate_policies(family, draft))
        campaign_key = fingerprint([draft.promotion_campaign_id, draft.promotion_campaign_sha256,
                                    draft.promotion_mode])
        await check_once(("campaign", campaign_key),
                         lambda: self.publisher.selling.validate_promotion(family, draft))
        existing = self.store.get("listing", self.repo.key(seller, draft.draft_id))
        active = await check_once("active", lambda: self.publisher.active(family))
        own_id = (existing.get("job") or {}).get("listing_id") if existing else None
        if any(item.get("item_id") != own_id and
               (item.get("sku") == draft.listing_sku or
                item.get("title", "").strip().casefold() == draft.title.strip().casefold())
               for item in active):
            raise ValueError("Possible active duplicate requires review")
        if existing and existing["revision"] == draft.revision():
            # Adopt only unchanged saved drafts; don't erase previous approvals or journals.
            saved = existing
        else:
            # Save includes a second fresh photo check and atomic claims. Drain
            # in-flight work before cancellation releases the outer batch lock.
            saved = await self.repo.photos.work.run(
                self.repo.save, seller, draft.model_dump(mode="json"), entry["expected_draft_revision"],
                grant_family=family)
        row["results"][key] = {"status": "ready", "draft_id": draft.draft_id,
                               "revision": saved["revision"], "text_additions": additions,
                               "validated_at": time.time()}

    def review(self, seller, batch_id, db=None):
        if db is None:
            # All drafts and the batch belong to one consistent snapshot, with
            # one connection instead of one write transaction per saved item.
            with self.store.read() as snapshot:
                return self.review(seller, batch_id, snapshot)
        row = self.get(seller, batch_id, db)
        listings, exceptions, pending = [], [], []
        for entry in row["input"]["items"]:
            key = entry["item_key"]
            result = row["results"].get(key)
            if result is None:
                pending.append({"item_key": key, "label": entry["label"]})
                continue
            if result["status"] != "ready":
                exceptions.append({"item_key": key, "label": entry["label"], **result})
                if entry.get("preparation_evidence") is not None:
                    exceptions[-1]["preparation_evidence"] = entry["preparation_evidence"]
                continue
            current = self.repo.get(seller, result["draft_id"], db)
            if current["revision"] != result["revision"]:
                exceptions.append({"item_key": key, "label": entry["label"], "status": "stale",
                                   "reason": "Saved draft changed; prepare and review its new revision"})
                continue
            listings.append({"item_key": key, "label": entry["label"],
                             "draft_id": result["draft_id"], "revision": result["revision"],
                             "draft": current["draft"],
                             "inventory_location": row["input"]["inventory_location"],
                             "text_additions": result["text_additions"],
                             "publication": publication_outcome(current),
                             "promotion": current.get("receipt", {}).get("promotion", {"status": "unverified"}),
                             "last_attempt": row["publication_results"].get(key)})
            if entry.get("preparation_evidence") is not None:
                listings[-1]["preparation_evidence"] = entry["preparation_evidence"]
            listings[-1]["preparation_validated_at"] = result.get("validated_at")
            listings[-1]["listing_sku"] = parse_listing(current["draft"]).listing_sku
        policy = {"confirmed_rejection_retry_limit": row["input"]["confirmed_rejection_retry_limit"],
                  "terms": "At most one retry of the SAME unchanged offer after a confirmed HTTP 400 rejection, a five-minute wait and fresh duplicate/content/policy checks. Never retry an uncertain publish or change approved content."}
        review_revision = fingerprint({
            "batch_revision": row["revision"],
            "listings": [{"item_key": x["item_key"], "draft_id": x["draft_id"], "revision": x["revision"],
                          "inventory_location": x["inventory_location"]} for x in listings],
            # Input evidence is already bound by batch_revision; avoid duplicating
            # private correction inputs in the review digest or historical schema.
            "exceptions": [{k: v for k, v in x.items() if k != "preparation_evidence"}
                           for x in exceptions], "pending": pending, "recovery_policy": policy,
        })
        return {"batch_id": batch_id, "batch_revision": row["revision"],
                "review_revision": review_revision, "inventory_location": row["input"]["inventory_location"],
                "listings": listings, "exceptions": exceptions, "preparation_pending": pending,
                "recovery_policy": policy,
                "approval_current": bool(row["approval"] and row["approval"]["review_revision"] == review_revision),
                "total_items": len(row["input"]["items"]),
                "asking_total_usd": str(sum(int(x["draft"]["price_usd"]) for x in listings)),
                "preparation_metrics": row.get("preparation_metrics"),
                "continue_preparation": bool(pending),
                "verified_count": sum(x["publication"]["all_checks_verified"] for x in listings),
                "publication_started": row["publication_started"]}

    def approve(self, seller, batch_id, review_revision, evidence):
        if not isinstance(evidence, str) or not 10 <= len(evidence.strip()) <= 4000:
            raise ValueError("Record explicit owner approval of the entire batch review and its recovery policy")
        with self.lock(seller, batch_id), self.repo.lock(seller), self.store.tx() as db:
            row = self.get(seller, batch_id, db)
            review = self.review(seller, batch_id, db)
            if review["review_revision"] != review_revision:
                raise ValueError("Batch approval is stale; retrieve the complete current review")
            if review["preparation_pending"] or not review["listings"]:
                raise ValueError("Finish preparation before requesting batch approval")
            if review["approval_current"]:
                return {"batch_id": batch_id, "review_revision": review_revision, "approved": True}
            for item in review["listings"]:
                current = self.repo.get(seller, item["draft_id"], db)
                if current["job"]:
                    # Existing approved jobs can be resumed, never reapproved or rewritten here.
                    self.repo.approved(current, seller)
                else:
                    self.repo.approve_in_transaction(seller, item["draft_id"], item["revision"], evidence, db)
            row["approval"] = {"seller": seller, "review_revision": review_revision,
                               "evidence": evidence, "approved_at": time.time(),
                               "recovery_policy": review["recovery_policy"]}
            self.write(row, db)
        return {"batch_id": batch_id, "review_revision": review_revision, "approved": True}

    async def publish(self, seller, family, batch_id, review_revision, max_items=3, timeout=40):
        if not 1 <= max_items <= 10:
            raise ValueError("Use 1–10 items per bounded publication call")
        with self.lock(seller, batch_id):
            row = self.get(seller, batch_id)
            review = self.review(seller, batch_id)
            if not review["approval_current"] or review["review_revision"] != review_revision:
                raise ValueError("This exact batch review has not been approved")
            if not self.publisher.enabled:
                raise ValueError("Live publication is disabled; batch remains editable before any eBay writes")
            if self.publisher.selling.require(family)["user_id"] != seller:
                raise ValueError("Seller identity mismatch")
            row["publication_started"] = True
            self.write(row)
            # Prioritize never-attempted items so an exception cannot starve the rest.
            todo = [i for i in review["listings"] if not i["publication"]["all_checks_verified"]]
            todo = [i for i in todo if (i["last_attempt"] or {}).get("disposition") != "owner_action"
                    and (i["last_attempt"] or {}).get("retry_after", 0) <= time.time()]
            todo.sort(key=lambda i: (i["item_key"] in row["publication_results"],
                                     row["publication_results"].get(i["item_key"], {}).get("at", 0)))
            processed = []
            deadline = time.monotonic() + timeout
            for item in todo[:max_items]:
                if time.monotonic() >= deadline:
                    break
                key = item["item_key"]
                last = row["publication_results"].get(key, {})
                if last.get("disposition") == "owner_action":
                    continue
                if last.get("retry_after", 0) > time.time():
                    continue
                try:
                    async with asyncio.timeout(max(0.01, deadline - time.monotonic())):
                        current = self.repo.get(seller, item["draft_id"])
                        job = current["job"]
                        failure = job.get("publish_failure") or {}
                        policy = row["approval"]["recovery_policy"]
                        if (policy["confirmed_rejection_retry_limit"] == 1 and
                            failure.get("uncertain") is False and failure.get("http_status") == 400 and
                            not job.get("publish_recovery") and not job.get("recovery_history")):
                            due = job.get("publish_requested_at", 0) + 300
                            if due > time.time():
                                row["publication_results"][key] = {"disposition": "retry_later",
                                    "retry_after": due, "at": time.time(),
                                    "reason": "Wait for the approved same-offer recovery checks"}
                                self.write(row)
                                continue
                            await self.publisher.approve_recovery(
                                seller, family, item["draft_id"], item["revision"],
                                row["approval"]["evidence"])
                        await self.publisher.run(seller, family, item["draft_id"], item["revision"])
                    row["publication_results"][key] = {"disposition": "verified", "at": time.time()}
                except Exception as error:
                    current = self.repo.get(seller, item["draft_id"])
                    job = current["job"]
                    failure = job.get("publish_failure") or {}
                    # Read-back retries may resume existing journaled work, never rearm writes.
                    retryable = (isinstance(error, (SellingError, TimeoutError)) or
                                 job.get("phase") in ("images", "verify", "promotion"))
                    confirmed = (row["approval"]["recovery_policy"]["confirmed_rejection_retry_limit"] == 1
                                 and failure.get("http_status") == 400
                                 and failure.get("uncertain") is False
                                 and not job.get("publish_recovery") and not job.get("recovery_history"))
                    attempts = last.get("attempts", 0) + 1
                    disposition = "retry_later" if confirmed or (retryable and attempts < 3) else "owner_action"
                    row["publication_results"][key] = {
                        "disposition": disposition, "attempts": attempts, "at": time.time(),
                        "retry_after": job.get("publish_requested_at", 0) + 300 if confirmed else time.time() + 5,
                        "errors": validation_errors(error)}
                self.write(row)
                processed.append(key)
            final = self.review(seller, batch_id)
            remaining = [i for i in final["listings"] if not i["publication"]["all_checks_verified"]]
            actionable = [i for i in remaining if (i["last_attempt"] or {}).get("disposition") != "owner_action"]
            final.update(processed_item_keys=processed,
                         continue_automatically=bool(actionable),
                         next_retry_at=min(((i["last_attempt"] or {}).get("retry_after", 0)
                                            for i in actionable), default=None),
                         complete=not remaining and not final["exceptions"] and not final["preparation_pending"])
            final["eligible_complete"] = not remaining and not final["preparation_pending"]
            return final


def compact_review(review):
    """Keep full buyer-facing text in paginated review; status stays small."""
    result = deepcopy(review)
    for item in result["exceptions"]:
        item.pop("preparation_evidence", None)
    for item in result["listings"]:
        draft = item.pop("draft")
        evidence = item.pop("preparation_evidence", None)
        if evidence:
            item["research_basis"] = evidence.get("research", {}).get("basis")
        item.update(title=draft["title"], price_usd=draft["price_usd"],
                    physical_item_id=draft["physical_item_id"])
    return result


