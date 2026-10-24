"""Authenticated listing tools and a bounded, one-use raw-photo upload endpoint."""

import asyncio
import base64
import hashlib
import json
import secrets
import time
from functools import wraps
from typing import Annotated, Literal
import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.types import ToolAnnotations, CallToolResult, TextContent, ImageContent
from starlette.responses import JSONResponse
from .config import SCOPE, WRITE_SCOPE, LISTING_EBAY_SCOPES
from .photos import PhotoStore, MAX_PHOTO_BYTES
from .listing_store import ListingStore
from .selling import Selling, SellingError
from .publishing import Publisher, inventory_matches, offer_matches, publication_outcome
from .photo_transfer import OpenAIFile, download_original
from .listing_drafts import parse_listing, ListingDraft, PolicySelection, fingerprint
from .receipts import ReceiptSigner
from .shipping_profiles import gemini_single_comic_profile
from .listing_batches import ListingBatches, BatchInput, BatchId, compact_review
from .comic_intake import ComicIntake, ComicObservations, compile_intake
from .comic_research import (ComicResearch, ResearchInput, ResearchId,
                             ReviewedResearchIntake, reviewed_intake)

from .listing_validation import (NEW_INTERIOR_DISCLOSURE, REQUIRED_DISCLOSURES, validate_new_standards)

PhotoRole = Literal["front", "back", "detail"]
PhotoChecksum = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
PhotoSize = Annotated[int, Field(strict=True, ge=1, le=MAX_PHOTO_BYTES)]
MAX_PHOTO_BATCH = 10


class PhotoTransferInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    role: PhotoRole
    file_index: int | None = Field(default=None, strict=True, ge=0, lt=MAX_PHOTO_BATCH,
                                 description="Zero-based position in the files array. Use this for ChatGPT attachments.")
    file_id: str | None = Field(default=None, min_length=1, max_length=200,
                               description="Legacy exact server file ID only; omit when using file_index.")
    sha256_hex: PhotoChecksum | None = None
    size_bytes: PhotoSize | None = None


def map_photo_inputs(files, photo_inputs):
    """Bind metadata before I/O without relying on host/model file-ID equality."""
    by_id = {file.file_id: index for index, file in enumerate(files)}
    if len(by_id) != len(files) or len(photo_inputs) != len(files):
        raise ValueError("Use one distinct attachment and one photo_inputs entry per file")
    mapped = []
    for entry in photo_inputs:
        if (entry.file_index is None) == (entry.file_id is None):
            raise ValueError("Set exactly one file_index (preferred) or legacy file_id per photo_inputs entry")
        index = entry.file_index if entry.file_index is not None else by_id.get(entry.file_id)
        if index is None:
            raise ValueError("Photo file IDs do not match host IDs. Use zero-based file_index in files, "
                             "or ingest_original_photo separately; do not guess file IDs")
        if not 0 <= index < len(files):
            raise ValueError("Photo file_index must identify an entry in files")
        mapped.append((index, entry))
    if len({index for index, _ in mapped}) != len(files):
        raise ValueError("Each position in files must be mapped exactly once")
    return mapped



def register_listing_tools(mcp, provider, settings, store, ebay):
    photos = PhotoStore(store)
    repo = ListingStore(store, photos)
    selling = Selling(ebay)
    publisher = Publisher(repo, selling, settings.publication_enabled)
    batches = ListingBatches(repo, publisher)
    research = ComicResearch(store, photos, settings.openai_api_key, settings.ai_budget_micros)
    receipts = ReceiptSigner(store)
    read = ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=True,
    )
    write = ToolAnnotations(
        readOnlyHint=False,
        destructiveHint=False,
        idempotentHint=False,
        openWorldHint=False,
    )
    publish = ToolAnnotations(
        readOnlyHint=False,
        destructiveHint=True,
        idempotentHint=True,
        openWorldHint=True,
    )
    read_meta = {"securitySchemes": [{"type": "oauth2", "scopes": [SCOPE]}]}
    write_meta = {
        "securitySchemes": [{"type": "oauth2", "scopes": [SCOPE, WRITE_SCOPE]}]
    }

    def listing_access(fn):
        @wraps(fn)
        async def checked(*args, **kwargs):
            token = get_access_token()
            if token and WRITE_SCOPE not in token.scopes:
                message = "Reconnect BTCo eBay with btco:read and btco:listings. Account consent does not approve a listing."
                challenge = (
                    f'Bearer resource_metadata="{settings.origin}/.well-known/oauth-protected-resource/mcp", '
                    f'scope="{SCOPE} {WRITE_SCOPE}", error="insufficient_scope", '
                    'error_description="Listing access requires fresh eBay consent"'
                )
                return CallToolResult(
                    content=[TextContent(type="text", text=message)],
                    structuredContent={}, isError=True,
                    _meta={"mcp/www_authenticate": [challenge]},
                )
            return await fn(*args, **kwargs)
        return checked

    def owner(writing=False):
        token = get_access_token()
        if not token or not getattr(token, "family", None):
            raise ValueError("Connect the seller account first")
        if writing and WRITE_SCOPE not in token.scopes:
            raise ValueError(
                "Explicit btco:listings permission is required; reconnect with listing access"
            )
        grant = store.get("grant", token.family)
        if not grant:
            raise ValueError("Seller connection expired")
        return grant["user_id"], token.family


    @mcp.tool(annotations=read, meta=read_meta)
    async def get_card_listing_options(category_id: str = "261328") -> dict:
        """Read card condition descriptors and existing seller policies; no eBay writes."""
        if category_id not in ("261328", "183050", "183454"):
            raise ValueError("Select a supported trading card singles category")
        _, family = owner()
        from .listing_drafts import CardListingDraft
        return {"schema": CardListingDraft.model_json_schema(),
                "category": await selling.category_policies(family, category_id),
                "policies": await selling.policy_options(family)}

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_readiness() -> dict:
        """Read required listing permissions and storage readiness without changing eBay."""
        seller, family = owner()
        grant = store.get("grant", family)
        token = get_access_token()
        return {
            "seller": grant["username"],
            "seller_id": seller,
            "publication_enabled": settings.publication_enabled,
            "connector_listing_scope": WRITE_SCOPE in token.scopes,
            "missing_ebay_scopes": [
                s
                for s in LISTING_EBAY_SCOPES
                if s not in grant.get("consented_scopes", [])
            ],
            "photo_storage": "private encrypted persistent volume",
            "photo_quota_bytes": photos.quota,
            "photo_capacity": await photos.work.run(photos.capacity),
            "photo_transfer": {"native_file_tool": "ingest_original_photo",
                               "batch_file_tool": "ingest_original_photos",
                               "max_batch_files": MAX_PHOTO_BATCH,
                               "batch_mapping": "photo_inputs[].file_index is the zero-based position in files; do not repeat host file IDs",
                               "raw_upload_helper": "scripts/upload_original.py",
                               "original_checksum_required": False,
                               "supplied_checksums_enforced": True,
                               "storage_checksum_verified": True,
                               "tool_discovery": "If native tools are absent, refresh the existing connector's tools; do not recreate the connection."},
            "shipping_estimate_profiles": [gemini_single_comic_profile()],
            "requirements": [
                "exact draft and photo revision approval",
                "verified identity and condition evidence",
                "reviewed business policies and combined shipping",
                "duplicate checks",
                "live item read-back",
            ],
            "promotion": "Fixed 5% in an existing reviewed manual CPS campaign or existing automatic 5% campaign; automatic inclusion is read back without campaign/ad writes",
            "batch_workflow": {
                "research_originals": "research_comic_photos",
                "saved_research": "get_comic_research",
                "discover_research": "list_comic_research",
                "compose_reviewed_research": "prepare_researched_comic_intake",
                "compose_from_evidence": "prepare_comic_intake",
                "intake_contract": "get_comic_intake_contract",
                "prepare": "prepare_listing_batch", "resume_preparation": "resume_listing_batch",
                "discover": "list_listing_batches", "status": "get_listing_batch",
                "review": "get_listing_batch_review", "approve": "approve_listing_batch",
                "publish_and_resume": "publish_approved_batch",
                "stored_photos": "list_stored_photos", "inspect_original": "get_stored_original_photo",
                "saved_drafts": "list_saved_listing_drafts",
                "owner_interaction": "One complete review and explicit publication approval; isolate genuine exceptions.",
            },
        }

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def begin_photo_upload(
        sha256_hex: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")],
        size_bytes: Annotated[int, Field(ge=1, le=MAX_PHOTO_BYTES)],
        role: Literal["front", "back", "detail"],
    ) -> dict:
        """Issue a 10-minute single-use upload ticket for ORIGINAL JPEG/PNG bytes.
        Send bytes by POST to upload_url with Authorization: Bearer upload_token.
        Keep the token private. No URL ingestion, image generation or eBay upload occurs.
        """
        seller, family = owner(True)
        ticket = secrets.token_urlsafe(40)
        store.put(
            "photo-upload",
            ticket,
            {
                "seller": seller,
                "family": family,
                "sha256": sha256_hex,
                "size": size_bytes,
                "role": role,
            },
            time.time() + 600,
            family,
        )
        return {
            "upload_url": settings.origin + "/photos/upload",
            "upload_token": ticket,
            "expires_in": 600,
        }

    @mcp.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                    idempotentHint=True, openWorldHint=True),
        meta={**write_meta, "openai/fileParams": ["file"]},
    )
    @listing_access
    async def ingest_original_photo(
        file: OpenAIFile,
        role: PhotoRole,
        sha256_hex: PhotoChecksum | None = None,
        size_bytes: PhotoSize | None = None,
    ) -> dict:
        """Store one ORIGINAL uploaded JPEG/PNG through ChatGPT's file input.
        SHA-256 and size are computed from downloaded bytes and verified after storage.
        Supply an independently computed checksum/size when available; never invent them.
        Use the host-provided file reference; never an artwork URL or local path.
        No eBay write or listing approval occurs. Signed URLs stay private.
        Repeating the same original returns the same seller-bound photo reference.
        """
        seller, family = owner(True)
        data = await download_original(file, size_bytes)
        return await photos.work.run(persist_original, seller, family, file, data, role, sha256_hex, size_bytes)

    def persist_original(seller, family, file, data, role, sha256_hex, size_bytes):
        # Revocation while downloading must not authorize a subsequent write.
        if not store.get("grant", family):
            raise ValueError("Seller connection expired during photo transfer")
        if size_bytes is not None and len(data) != size_bytes:
            raise ValueError("Photo size mismatch")
        checksum = hashlib.sha256(data).hexdigest()
        photo = photos.put(seller, data, sha256_hex or checksum, role,
                           file_name=file.file_name, file_id=file.file_id, grant_family=family)
        # Verify durable storage independently before returning the reference.
        if photos.get(seller, photo) != data:
            raise ValueError("Stored original failed integrity verification")
        return {"photo": photo.model_dump(), "size_bytes": len(data),
                "file_id": file.file_id, "original_bytes_verified": True,
                "storage_sha256_verified": True,
                "source_sha256_verified": sha256_hex is not None}

    @mcp.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                    idempotentHint=True, openWorldHint=True),
        meta={**write_meta, "openai/fileParams": ["files"]},
    )
    @listing_access
    async def ingest_original_photos(
        files: Annotated[list[OpenAIFile], Field(min_length=1, max_length=MAX_PHOTO_BATCH)],
        photo_inputs: Annotated[list[PhotoTransferInput], Field(min_length=1, max_length=MAX_PHOTO_BATCH)],
    ) -> dict:
        """Store up to ten original conversation attachments in one call, without eBay writes.
        Set photo_inputs[].file_index to the zero-based position in files (0, 1, ...),
        with its front/back/detail role. Map every file exactly once. Do not copy attachment
        reference strings into file_id: ChatGPT resolves file references before this call.
        Legacy exact server file_id mapping is supported only when file_index is omitted.
        Optional independent SHA-256/size values are enforced; omit unavailable values.
        Results preserve photo_inputs order, file_index and host file_id, with verified photo refs
        for each individual listing draft. Retry failed files only. Never approve or publish here.
        """
        seller, family = owner(True)
        mapped = map_photo_inputs(files, photo_inputs)
        # Validate each destination before its I/O; one bad file must not block
        # unrelated originals. Ambiguous file/role mappings still fail as a unit.
        from .photo_transfer import validate_download_url
        semaphore = asyncio.Semaphore(3)
        async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False,
                                     limits=httpx.Limits(max_connections=3)) as client:
            async def transfer(index, entry):
                file = files[index]
                identity = {"file_index": index, "file_id": file.file_id, "role": entry.role}
                async with semaphore:
                    try:
                        validate_download_url(file.download_url)
                        data = await download_original(file, entry.size_bytes, client=client)
                        result = await photos.work.run(persist_original, seller, family, file, data,
                                                       entry.role, entry.sha256_hex, entry.size_bytes)
                        return {"status": "stored", **identity, **result}
                    except ValueError as error:
                        return {"status": "failed", **identity, "error": str(error)}
                    except Exception:
                        return {"status": "failed", **identity,
                                "error": "Photo transfer did not complete; retry this file"}
            results = await asyncio.gather(*(transfer(index, entry) for index, entry in mapped))
        return {"complete": all(r["status"] == "stored" for r in results), "results": results}

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_contract() -> dict:
        """Read the complete nested ListingDraft JSON schema and new-comic standards.
        Schema examples are not inventory or permission to publish.
        """
        owner()
        return {"schema": ListingDraft.model_json_schema(),
                "standards": {"best_offer": {"five_dollar_listings": {"enabled": False, "minimum_offer_usd": None},
                                            "other_listings": {"enabled": True, "minimum_offer_usd": "asking price minus 2, unless reviewed otherwise"}},
                              "condition": ["USED_GOOD", "USED_ACCEPTABLE"],
                              "packed_parcel": "Required measured or owner-authorized estimate",
                              "interior_disclosure": NEW_INTERIOR_DISCLOSURE,
                              "required_text_by_field": REQUIRED_DISCLOSURES,
                              "identity_verification": {
                                  "cover_identity": "Verify series, issue, year and publisher with evidence; leave unknown printing and variant null.",
                                  "full_identity": "Also requires evidence for printing and variant; never guess them."},
                              "historical_examples": "Already listed; never reuse for a live test"}}

    @mcp.tool(annotations=read, meta=read_meta)
    async def list_stored_photos(cursor: str = "", limit: Annotated[int, Field(ge=1, le=100)] = 50) -> dict:
        """Recover this seller's original photo references without re-uploading.
        Follow next_cursor. Legacy roles/filenames may be unknown; inspect originals
        and never infer front/back matching from listing order or filenames alone.
        """
        seller, _ = owner()
        return photos.list(seller, cursor, limit)

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_stored_original_photo(object_key: str, sha256_hex: PhotoChecksum) -> CallToolResult:
        """Privately inspect this seller's stored ORIGINAL bytes after checksum verification.
        No public URL, image generation, re-encoding, new upload or eBay write.
        Use visual inspection to confirm identity and front/back matching.
        """
        seller, _ = owner()
        return await photos.work.run(read_original, seller, object_key, sha256_hex)

    def read_original(seller, object_key, sha256_hex):
        data = photos.get(seller, {"object_key": object_key, "sha256_hex": sha256_hex, "role": "detail"})
        return CallToolResult(content=[
            TextContent(type="text", text=json.dumps({"object_key": object_key, "sha256_hex": sha256_hex,
                                                     "size_bytes": len(data), "storage_sha256_verified": True})),
            ImageContent(type="image", mimeType="image/jpeg" if object_key.endswith(".jpeg") else "image/png",
                         data=base64.b64encode(data).decode())])

    @mcp.tool(annotations=read, meta=read_meta)
    async def list_listing_batches(cursor: str = "", limit: Annotated[int, Field(ge=1, le=100)] = 20) -> dict:
        """Find this seller's durable batches after a new chat or interruption. Follow next_cursor."""
        seller, _ = owner()
        page = store.list_owned("listing-batch", seller, cursor, limit)
        return {"records": [{"batch_id": r["input"]["batch_id"], "batch_revision": r["revision"],
                             "inventory_location": r["input"]["inventory_location"],
                             "total_items": len(r["input"]["items"]), "updated_at": r["updated_at"]}
                            for r in page["records"]], "next_cursor": page["next_cursor"]}

    @mcp.tool(annotations=read, meta=read_meta)
    async def list_saved_listing_drafts(cursor: str = "", limit: Annotated[int, Field(ge=1, le=100)] = 20) -> dict:
        """Find saved drafts and exact original-photo matches, including pre-batch records.
        Follow next_cursor. Read get_listing_draft for full content. Historical publication
        records do not prove current active status. Never republish old inventory as a test.
        """
        seller, _ = owner()
        rows, next_cursor = repo.list(seller, cursor, limit)
        return {"records": [{"draft_id": r["draft"]["draft_id"], "revision": r["revision"],
                             "title": r["draft"]["title"], "price_usd": r["draft"]["price_usd"],
                             "physical_item_id": r["draft"]["physical_item_id"],
                             "photos": r["draft"]["photos"], "publication": publication_outcome(r)}
                            for r in rows], "next_cursor": next_cursor}

    @mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                        idempotentHint=True, openWorldHint=True), meta=write_meta)
    @listing_access
    async def research_comic_photos(request: ResearchInput) -> dict:
        """Analyze stored original comic photos and research cited prices on the hosted service.
        Requires configured owner-authorized OpenAI access and a nonrenewing pilot budget.
        Sends seller-owned original photos to OpenAI; no browser/files in Work are needed.
        Use a stable request ID. Repeating it returns saved success/failure/pending status
        without another paid request. A new ID is a separately budgeted retry, never automatic.
        Read all uncertainty, actual photos and sources with the owner. AI output is a proposal,
        not verified identity, sold-sale authentication, approval, inventory or an eBay write.
        Unknown/card/mismatched photos remain held. Do not invent or silently upgrade details.
        """
        seller, _ = owner(True)
        return await research.run(seller, request)

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_comic_research(request_id: ResearchId | None = None) -> dict:
        """Read exact saved research or hosted AI configuration/budget, without a paid request.
        Display source URLs as clickable links, sold vs asking labels, and every limitation.
        A pending/uncertain request must not be automatically retried with a new identifier.
        """
        seller, _ = owner()
        return {"budget": research.status(),
                **({"research": research.get(seller, request_id)} if request_id else {})}

    @mcp.tool(annotations=read, meta=read_meta)
    async def list_comic_research(cursor: str = "", limit: Annotated[int, Field(ge=1, le=100)] = 20) -> dict:
        """Recover this seller's saved research after a new chat, without another paid call.
        Follow next_cursor; get_comic_research returns the full exact revision and photos.
        Failed/pending/uncertain attempts remain visible and are never retried here.
        """
        seller, _ = owner()
        page = store.list_owned("comic-research", seller, cursor, limit)
        return {"records": [{"request_id": r["request_id"], "revision": r.get("revision"),
            "status": r["status"], "series": (r.get("proposal") or {}).get("series"),
            "issue": (r.get("proposal") or {}).get("issue"), "started_at": r["started_at"],
            "photo_count": len(r["photos"])} for r in page["records"]],
            "next_cursor": page["next_cursor"]}

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def prepare_researched_comic_intake(
        reviewed: ReviewedResearchIntake, expected_revision: str | None = None,
    ) -> dict:
        """Compose drafts from saved research ONLY after owner confirmation of its exact revision.
        First show actual photos, proposed identity/condition, all uncertainty, linked sources,
        proposed prices and offer floors. Record the owner's real confirmation in
        owner_review_evidence; research completion/confidence is never that confirmation.
        Use each item's corrections for the owner's actual identity/condition corrections;
        original photos and unchanged facts stay on the server. Condition corrections require
        reviewed notes. AI confidence alone does not block owner-confirmed complete facts.
        Corrections discard AI price comparisons; the owner's explicit price is used instead.
        To revise an already prepared draft, supply its expected_draft_revision and the current
        expected_revision of the batch; changes invalidate publication approval. Shared shipping
        and policies must be reviewed. This does NOT approve or publish: display the complete
        resulting batch review and obtain explicit publication approval through existing tools.
        """
        seller, family = owner(True)
        intake, evidence = reviewed_intake(research, seller, reviewed)
        batch, issues = compile_intake(intake)
        payload = batch.model_dump(mode="json")
        for item in payload["items"]:
            item["preparation_evidence"] = {**(item.get("preparation_evidence") or {}),
                                            **evidence[item["item_key"]]}
        batches.submit(seller, payload, expected_revision)
        result = compact_review(await batches.prepare(seller, family, batch.batch_id))
        result["intake_issues"] = issues
        return result

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def prepare_comic_intake(intake: ComicIntake, expected_revision: str | None = None) -> dict:
        """Assemble and save comic drafts on BTConnect from inspected photos and researched facts.
        Supply shared shipping/policy settings once, and per-comic observations, proposed price,
        explicit offer minimum and source evidence. This tool does NOT identify images or fetch
        sold comps: use verified evidence from the conversation; never invent missing facts.
        Missing/invalid observations remain isolated exceptions. Asking prices stay labeled asking.
        Store original photos through native ingest tools first; no local files or Work scripts.
        Reuse stable photo-based IDs, durable batches and existing safeguards. No approval or
        eBay writes. Continue resume_listing_batch while continue_preparation is true, then read
        the complete get_listing_batch_review including pricing evidence before owner approval.
        """
        seller, family = owner(True)
        batch, issues = compile_intake(intake)
        batches.submit(seller, batch.model_dump(mode="json"), expected_revision)
        result = compact_review(await batches.prepare(seller, family, batch.batch_id))
        result["intake_issues"] = issues
        return result

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_comic_intake_contract() -> dict:
        """Read the hosted comic assembly schema. Examples are not inventory or approval."""
        owner()
        return {"schema": ComicIntake.model_json_schema(),
                "observations_schema": ComicObservations.model_json_schema(),
                "hosted_research_schema": ResearchInput.model_json_schema(),
                "reviewed_research_schema": ReviewedResearchIntake.model_json_schema(),
                "hosted_research": research.status(),
                "execution": "hosted deterministic assembly; caller supplies identity and pricing evidence",
                "research": "Evidence is saved for owner review, not independently verified by this service.",
                "owner_corrections": "Correct saved research in prepare_researched_comic_intake; no re-upload, paid retry or full-draft retyping required.",
                "work_independence": "Native attachments, stored evidence, draft assembly, review, approval, publication and local receipts execute on this service; hosted AI is optional.",
                "cards": "Use get_card_listing_options for card-specific contracts; this intake schema is for comics. Cards use the existing draft/batch publisher.",
                "approval": "Use existing complete batch review and explicit exact-revision approval."}

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def prepare_listing_batch(batch: BatchInput, expected_revision: str | None = None) -> dict:
        """Persist and prepare a whole comic batch without approving or publishing.
        Research identities and inspect matched original photos first. Supply complete
        drafts or explicit unresolved reasons. Keep physical inventory_location exact.
        Required exterior disclosures are appended BEFORE review; nothing is invented.
        Price, inspection evidence, photos, shipping authorization and policies are never guessed.
        Current policies and active duplicates are checked; valid items save despite other errors.
        A repeated identical batch resumes safely. Edits require expected batch revision.
        Bounded to 20 attempts or 35 seconds. Continue resume_listing_batch while
        continue_preparation is true. Never re-upload stored photos.
        """
        seller, family = owner(True)
        batches.submit(seller, batch.model_dump(mode="json"), expected_revision)
        return compact_review(await batches.prepare(seller, family, batch.batch_id))

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def resume_listing_batch(batch_id: BatchId) -> dict:
        """Resume saved draft preparation without resubmitting photos or data and without eBay writes.
        Complete pending items before rechecking exceptions; reuse unchanged prepared drafts.
        Preparation timestamps are historical; publication rechecks current policies and duplicates.
        Continue while continue_preparation is true. An approved batch is returned unchanged.
        """
        seller, family = owner(True)
        return compact_review(await batches.prepare(seller, family, batch_id))

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_batch(batch_id: BatchId) -> dict:
        """Read current durable batch status, prices, exact revisions, exceptions and saved live item IDs.
        Publication evidence is historical, not a fresh eBay status lookup. No eBay writes.
        """
        seller, _ = owner()
        return compact_review(batches.review(seller, batch_id))

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_batch_review(batch_id: BatchId, offset: Annotated[int, Field(ge=0)] = 0,
                                       limit: Annotated[int, Field(ge=1, le=20)] = 10,
                                       expected_review_revision: str | None = None) -> dict:
        """Read full saved drafts and original-photo matches for ONE consolidated owner review.
        Fetch every page with the same review_revision before asking for approval.
        Display full descriptions, prices, photos, shipping, location, exceptions and retry policy.
        An incomplete title/price summary is not approval of this package.
        """
        seller, _ = owner()
        review = batches.review(seller, batch_id)
        if expected_review_revision is not None and expected_review_revision != review["review_revision"]:
            raise ValueError("Review changed between pages; retrieve the current complete package")
        total = len(review["listings"])
        review["listings"] = review["listings"][offset:offset + limit]
        review.update(total_review_listings=total, offset=offset,
                      next_offset=offset + limit if offset + limit < total else None)
        return review

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def approve_listing_batch(batch_id: BatchId, review_revision: str,
                                    owner_approval_evidence: str) -> dict:
        """ONLY after owner approves the complete displayed batch review, ORIGINAL photos,
        exact revisions and recovery policy. Development permission is NEVER listing approval.
        Atomically record one approval across eligible drafts; exceptions stay excluded.
        A nonzero confirmed-rejection retry allowance must be explicitly part of that review.
        This records approval only; no eBay writes.
        """
        seller, _ = owner(True)
        return batches.approve(seller, batch_id, review_revision, owner_approval_evidence)

    @mcp.tool(annotations=publish, meta=write_meta)
    @listing_access
    async def publish_approved_batch(batch_id: BatchId, review_revision: str,
                                     max_items: Annotated[int, Field(ge=1, le=10)] = 3) -> dict:
        """Publish/resume ONLY the exact owner-approved batch. Runs a bounded chunk.
        Continue eligible items automatically without asking permission between calls.
        Respect next_retry_at; no busy polling. Never restart a batch or create replacement
        offers after an uncertain outcome. A saved failure cannot block other eligible items.
        Only the explicitly approved bounded same-offer retry policy can rearm a confirmed
        rejection; unknown outcomes remain read-back-only. Return one consolidated result
        including verified item IDs, incomplete verification, promotion and exceptions.
        """
        seller, family = owner(True)
        return compact_review(await batches.publish(seller, family, batch_id, review_revision, max_items))

    @mcp.tool(annotations=read, meta=read_meta)
    async def validate_listing_draft(draft: dict) -> dict:
        """Validate a complete new draft and stored originals without saving or approving.
        Errors report field paths without echoing private input values.
        """
        seller, _ = owner()
        try:
            parsed = parse_listing(draft)
            validate_new_standards(parsed)
            await photos.work.run(photos.verify, seller, parsed.photos)
            return {"valid": True, "revision": parsed.revision(),
                    "listing_sku": parsed.listing_sku}
        except ValidationError as error:
            return {"valid": False, "errors": [
                {"path": list(e["loc"]), "type": e["type"], "message": e["msg"]}
                for e in error.errors(include_input=False, include_context=False, include_url=False)]}
        except ValueError as error:
            return {"valid": False, "errors": [{"path": [], "message": str(error)}]}

    @mcp.custom_route("/photos/upload", methods=["POST"])
    async def upload(request):
        auth = request.headers.get("authorization", "")
        ticket = auth[7:] if auth.startswith("Bearer ") else ""
        upload = store.get("photo-upload", ticket) if ticket else None
        if not upload or not store.get("grant", upload["family"]):
            return JSONResponse({"error": "Invalid upload ticket"}, status_code=401)
        if request.headers.get("content-type") not in (
            "image/jpeg",
            "image/png",
            "application/octet-stream",
        ):
            return JSONResponse(
                {"error": "Send original JPEG/PNG bytes"}, status_code=415
            )
        try:
            if int(request.headers.get("content-length", "0")) > upload["size"]:
                raise ValueError("Photo size mismatch")
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > upload["size"] or len(data) > MAX_PHOTO_BYTES:
                    raise ValueError("Photo size mismatch")
            if len(data) != upload["size"]:
                raise ValueError("Photo size mismatch")
            result = await photos.work.run(persist_upload, ticket, upload, bytes(data))
            return JSONResponse(result, status_code=201)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    def persist_upload(ticket, upload, data):
        # Atomic consume closes concurrent replay; retries request a fresh ticket.
        with store.tx() as db:
            if not store.get(
                "photo-upload", ticket, consume=True, db=db
            ) or not store.get("grant", upload["family"], db=db):
                raise ValueError("Upload ticket expired or was already used")
        photo = photos.put(
            upload["seller"], data, upload["sha256"], upload["role"], grant_family=upload["family"]
        )
        if photos.get(upload["seller"], photo) != data:
            raise ValueError("Stored original failed integrity verification")
        return {"photo": photo.model_dump(), "size_bytes": len(data),
                "storage_sha256_verified": True}

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_policy_options() -> dict:
        """Read existing policies, locations, comic category rules and promotion campaigns.
        Never create or change policies, campaigns, budgets or listings.
        """
        _, family = owner()
        return await selling.policy_options(family)

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_policy_snapshot(
        fulfillment_policy_id: str, payment_policy_id: str, return_policy_id: str
    ) -> dict:
        """Read exact selected policies and their digest for the approval draft. Review buyer-paid and combined shipping."""
        _, family = owner()
        selection = PolicySelection(
            fulfillment_policy_id=fulfillment_policy_id,
            payment_policy_id=payment_policy_id,
            return_policy_id=return_policy_id,
            snapshots_sha256="0" * 64,
            combined_shipping_evidence="Pending owner review",
        )
        policies = await selling.policies(family, selection)
        return {"policies": policies, "snapshots_sha256": fingerprint(policies)}

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def save_listing_draft(
        draft: ListingDraft, expected_revision: str | None = None
    ) -> dict:
        """Save a complete comic draft for review, preserving CDP SKU and original photo references.
        Every changed revision clears approval. Never substitute previously approved text/images.
        No eBay write occurs. Return the full draft to the owner before approval.
        """
        seller, family = owner(True)
        draft_id = draft.draft_id
        data = draft.model_dump(mode="json")
        if expected_revision is not None and repo.get(seller, draft_id)["job"]:
            return await publisher.revise_preoffer_condition(seller, family, data, expected_revision)
        validate_new_standards(draft)
        return await photos.work.run(repo.save, seller, data, expected_revision, grant_family=family)

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_campaign_snapshot(campaign_id: str) -> dict:
        """Read a reviewed existing fixed-rate US CPS campaign. Never create a campaign or change its budget."""
        _, family = owner()
        campaign = await selling.campaign(family, campaign_id)
        return {"campaign": campaign, "snapshots_sha256": fingerprint(campaign)}

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_listing_draft(draft_id: str) -> dict:
        """Read exact draft, revision, approval and durable publication status for this seller."""
        seller, family = owner()
        row = repo.get(seller, draft_id)
        row["publication_status"] = publication_outcome(row)
        # Diagnose only this seller's saved publication job. Never accept a
        # caller-supplied SKU, mutate eBay or persist remote read-back as approval.
        if row["job"].get("inventory_attempted"):
            draft = parse_listing(row["draft"])
            try:
                inventory = await selling.get_item(family, draft.listing_sku)
                expected = draft.inventory_payload([i["image_url"] for i in row["job"]["images"]])
                row["live_readback"] = {"inventory": inventory,
                                        "inventory_matches": inventory_matches(inventory, expected)}
                if row["job"].get("offer_id"):
                    offer = await selling.get_offer(family, row["job"]["offer_id"])
                    row["live_readback"].update(offer=offer, offer_matches=offer_matches(offer, draft.offer_payload()))
                    if offer.get("status") == "PUBLISHED":
                        row["publication_status"]["live_offer_status"] = "PUBLISHED"
                        row["publication_status"]["live_item_id"] = offer.get("listing", {}).get("listingId")
                        if draft.promotion_campaign_id:
                            await selling.validate_promotion(family, draft)
                            row["live_readback"]["promotion_ads"] = await selling.ads(family, draft)
            except (SellingError, ValueError) as error:
                row["live_readback_error"] = str(error)
        return row

    @mcp.tool(annotations=write, meta=write_meta)
    @listing_access
    async def approve_listing_draft(
        draft_id: str, revision: str, owner_approval_evidence: str
    ) -> dict:
        """ONLY after explicit owner approval of the entire displayed revision and ORIGINAL photos.
        Record the owner's words/reference; do not infer approval from development permission,
        a budget, a partial title/price list, or approval of different text/photos.
        This records approval but does not publish.
        For a failed saved offer, explicit owner recovery approval may authorize one
        same-offer retry after fresh unpublished-offer, content and duplicate checks.
        Uncertain new publication failures remain read-back-only.
        A confirmed createOffer HTTP 400/25702 rejection supports one explicitly
        approved creation retry after five minutes and fresh inventory/duplicate checks.
        Pre-journal legacy failures require owner_approval_evidence as JSON with action
        "retry_rejected_offer_creation_once", owner_approval (owner words/reference),
        and rejection {http_status: 400, codes: ["25702"], source: original response reference}.
        Never attest a timeout or unknown response as a rejection. Approval performs no eBay writes.
        """
        seller, family = owner(True)
        row = repo.get(seller, draft_id)
        if row["job"] and not repo.condition_revision_pending(row):
            return await publisher.approve_recovery(
                seller, family, draft_id, revision, owner_approval_evidence
            )
        return repo.approve(seller, draft_id, revision, owner_approval_evidence)

    @mcp.tool(annotations=publish, meta=write_meta)
    @listing_access
    async def publish_approved_listing(draft_id: str, revision: str) -> CallToolResult:
        """Publish only the exact saved and approved revision. Requires explicit listing permission.
        Checks original checksums, duplicates and policies, uploads original photos to eBay,
        then verifies the live item ID. Retry returns/reconciles the SAME saved offer;
        an uncertain creation/publication will never start another listing.
        Vault reconciliation and 5% promotion are separately reported, never assumed complete.
        """
        seller, family = owner(True)
        try:
            row = await publisher.run(seller, family, draft_id, revision)
            result = {**row, "publication_status": publication_outcome(row)}
            return CallToolResult(content=[TextContent(type="text", text=json.dumps(result))],
                                  structuredContent=result, isError=False)
        except Exception as error:
            # Keep item ID/stage visible even when a later verification fails.
            try:
                row = repo.get(seller, draft_id)
            except ValueError:
                row = {"job": {}, "state": "not_found"}
            message = str(error) if isinstance(error, (ValueError, SellingError)) else "Publication interrupted; inspect saved state"
            result = publication_outcome(row, message)
            return CallToolResult(content=[TextContent(type="text", text=json.dumps(result))],
                                  structuredContent=result, isError=True)

    @mcp.tool(annotations=read, meta=write_meta)
    @listing_access
    async def request_listing_access() -> dict:
        """After owner authorization, request fresh listing-account consent if needed.
        No photos, drafts, approvals, inventory or eBay listings are changed.
        """
        owner(True)
        return await get_listing_readiness()

    @mcp.tool(annotations=read, meta=read_meta)
    async def get_publication_receipt(item_id: str) -> dict:
        """Export signed, persisted publication evidence for Vault preview/apply.
        Only receipts created after verified publication are available. Historical
        verification is not a fresh live status check. Never sign caller content.
        """
        seller, _ = owner()
        return receipts.export(seller, item_id)




