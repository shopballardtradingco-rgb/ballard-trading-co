"""Import a reviewed Core snapshot into the existing recovered journal.

This module has no eBay client. Import never approves or publishes a listing.
Retries use the original Core batch/draft IDs and cannot replace prior inputs.
"""
import base64
import hashlib
import re

from .listing_batches import BatchInput, ListingBatches
from .listing_drafts import fingerprint, parse_listing
from .listing_validation import prepare_text, validate_new_standards
from .photos import MAX_PHOTO_BYTES, PhotoStore


def validate_input(payload, seller):
    if (not isinstance(payload, dict) or set(payload) != {
            "format", "seller", "core_batch_id", "core_revision", "core_state_sha256", "batches", "originals"}
            or payload["format"] != "btcore-publisher-input-v1" or payload["seller"] != seller
            or not re.fullmatch(r"[a-z0-9-]{1,60}", payload["core_batch_id"])
            or type(payload["core_revision"]) is not int or payload["core_revision"] < 0
            or not re.fullmatch(r"[0-9a-f]{64}", payload["core_state_sha256"])):
        raise ValueError("A matching complete Core handoff is required")
    if (not isinstance(payload["batches"], list) or not 1 <= len(payload["batches"]) <= 50
            or not isinstance(payload["originals"], list) or not 1 <= len(payload["originals"]) <= 1000):
        raise ValueError("Core handoff exceeds its bounded batch/photo count")
    batches, refs, ids, skus, count = [], {}, set(), set(), 0
    for index, item in enumerate(payload["batches"]):
        batch = BatchInput.model_validate(item).model_dump(mode="json", exclude_none=True)
        if (batch["batch_id"] != f"btco-batch-{payload['core_batch_id']}-{index}"
                or batch["confirmed_rejection_retry_limit"] != 0):
            raise ValueError("Core batch identity or retry policy changed")
        for entry in batch["items"]:
            if any(k in entry for k in ("unresolved_reason", "expected_draft_revision", "preparation_evidence")):
                raise ValueError("Core import accepts new staged inputs only")
            draft = parse_listing(prepare_text(entry["draft"])[0])
            validate_new_standards(draft)
            if (draft.product_type != "card" or draft.draft_id != "btco-card-" + entry["item_key"]
                    or draft.physical_item_id != "core:" + entry["item_key"]
                    or draft.draft_id in ids or draft.listing_sku in skus):
                raise ValueError("Core physical item or SKU identity is inconsistent")
            ids.add(draft.draft_id)
            skus.add(draft.listing_sku)
            count += 1
            for photo in draft.photos:
                expected = f"photos/{PhotoStore.owner_key(seller)}/{photo.sha256_hex}."
                if not photo.object_key.startswith(expected) or photo.sha256_hex in refs:
                    raise ValueError("Original is shared between physical copies or belongs to another seller")
                refs[photo.sha256_hex] = photo
        batches.append(batch)
    if count > 500:
        raise ValueError("Core handoff exceeds 500 cards")
    originals, total = {}, 0
    for original in payload["originals"]:
        if not isinstance(original, dict) or set(original) != {"sha256_hex", "original"}:
            raise ValueError("Unexpected original-photo input")
        sha = original["sha256_hex"]
        encoded = original["original"]
        if (sha not in refs or sha in originals or not isinstance(encoded, str)
                or len(encoded) > 4 * ((MAX_PHOTO_BYTES + 2) // 3)):
            raise ValueError("Original-photo assignment or size is invalid")
        raw = base64.b64decode(encoded, validate=True)
        total += len(raw)
        if (not raw or len(raw) > MAX_PHOTO_BYTES or total > 100_000_000
                or base64.b64encode(raw).decode() != encoded or hashlib.sha256(raw).hexdigest() != sha):
            raise ValueError("Original-photo checksum or size is invalid")
        originals[sha] = raw
    if originals.keys() != refs.keys():
        raise ValueError("Every selected original is required")
    return batches, refs, originals


def import_input(repo, seller, payload):
    batches, refs, originals = validate_input(payload, seller)
    engine = ListingBatches(repo, None)
    source_key = seller + ":" + payload["core_batch_id"]
    source = {"seller": seller, "input_sha256": fingerprint(payload),
              "core_revision": payload["core_revision"], "core_state_sha256": payload["core_state_sha256"]}
    previous_source = repo.store.get("core-handoff", source_key)
    if previous_source and previous_source != source:
        raise ValueError("A different Core snapshot was already imported for this batch")
    # Validate every existing identity before the first photo or batch mutation.
    # In particular, never turn an old/uncertain publication into a fresh draft.
    for batch in batches:
        old = repo.store.get("listing-batch", seller + ":" + batch["batch_id"])
        normalized = BatchInput.model_validate(batch).model_dump(mode="json")
        for item in normalized["items"]:
            item.pop("preparation_evidence")
        if old and old["revision"] != fingerprint(normalized):
            raise ValueError("Core batch already exists with different inputs; resume its saved review")
        for entry in batch["items"]:
            draft = parse_listing(prepare_text(entry["draft"])[0])
            existing = repo.store.get("listing", repo.key(seller, draft.draft_id))
            if existing and existing["revision"] != draft.revision():
                raise ValueError("Core draft already exists with different content; preserve its journal")
    for sha, photo in refs.items():
        stored = repo.photos.put(seller, originals[sha], sha, photo.role)
        if stored != photo:
            raise ValueError("Original encoding does not match the selected photo reference")
    results = []
    for batch in batches:
        row = engine.submit(seller, batch)  # Same revision retains all approval/progress.
        results.append({"batch_id": batch["batch_id"], "input_revision": row["revision"]})
    if not previous_source:
        repo.store.put("core-handoff", source_key, source)
    return {"batches": results, "cards": sum(len(x["items"]) for x in batches),
            "originals": len(originals), "approval_granted": False, "live_publication_attempted": False}
