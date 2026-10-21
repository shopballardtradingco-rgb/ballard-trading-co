"""Synthetic research, budget and approval boundaries; no paid calls or real inventory."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import json

import httpx
import pytest

from btco_ebay.comic_research import (ComicResearch, ResearchInput, ReviewedResearchIntake,
    reviewed_intake, parse_proposal, strict_schema, MODEL, RESERVE_MICROS, usage_cost)
from btco_ebay.comic_intake import compile_intake
from btco_ebay.config import SCOPE, WRITE_SCOPE
from test_listings import bundle as bundle
from test_connector import env as env, connect, rpc, tool
from test_comic_intake import intake_from_drafts
from test_listing_batches import setup
from test_listing_contract import new_draft


TODAY = datetime.now(timezone.utc).date().isoformat()


def proposal():
    return {"collectible_type": "comic", "matching_sides": True, "confidence": "high",
        "series": "Synthetic Comic", "issue": "1", "year": 1986, "publisher": "Test Press",
        "year_evidence": {"basis": "visible_publication_date", "observed_text": "Synthetic issue date May 1986"},
        "printing": None, "variant": None, "identity_evidence": "Synthetic visible title and issue with sourced year.",
        "printing_variant_evidence": None, "condition": "USED_GOOD",
        "condition_notes": "Synthetic small crease on lower front corner.",
        "uncertainties": ["Printing and variant are unverified"],
        "suggested_price_usd": "8", "pricing_rationale": "Synthetic asking evidence only; no sold records.",
        "sources": [{"kind": "asking", "url": "https://example.test/comic", "checked_on": TODAY,
            "sold_on": None, "item_price_usd": "8", "shipping_usd": None,
            "exact_identity_match": True, "condition_comparable": False,
            "evidence": "Synthetic raw comic asking eight USD; not a verified sale."}]}


def response(p=None):
    return {"model": MODEL, "service_tier": "default", "status": "completed",
        "usage": {"input_tokens": 1000, "output_tokens": 500},
        "output": [{"type": "web_search_call", "status": "completed", "action": {
            "sources": [{"type": "url", "url": "https://example.test/comic"}]}},
            {"type": "message", "content": [{"type": "output_text",
                "text": json.dumps(proposal() if p is None else p), "annotations": []}]}]}


def service(bundle, handler=None, budget=5_000_000):
    repo, draft, _ = bundle
    calls = []
    def send(req):
        calls.append(req)
        return handler(req) if handler else httpx.Response(200, json=response())
    engine = ComicResearch(repo.store, repo.photos, "sk-synthetic-never-real", budget, httpx.MockTransport(send))
    request = ResearchInput(request_id="btco-research-test", photos=draft["photos"])
    return engine, request, calls


def run(engine, request, seller="seller"):
    return asyncio.run(engine.run(seller, request))


def test_hosted_originals_and_search_results_are_saved_without_approval(bundle):
    engine, request, calls = service(bundle)
    row = run(engine, request)
    assert row["status"] == "needs_owner_review" and row["owner_review_required"]
    assert row["approved_for_publication"] is False
    assert row["photos"] == bundle[1]["photos"]
    assert row["metrics"]["estimated_cost_micros"] == 13_000
    assert engine.status()["committed_micros"] == 13_000
    assert run(engine, request) == row and len(calls) == 1
    body = json.loads(calls[0].content)
    assert str(calls[0].url) == "https://api.openai.com/v1/responses"
    assert not body["store"] and body["max_tool_calls"] == 2
    assert body["max_output_tokens"] == 6000 and body["service_tier"] == "default"
    assert body["model"] == MODEL
    assert body["reasoning"]["effort"] == "low"
    images = [x for x in body["input"][0]["content"] if x["type"] == "input_image"]
    import base64
    assert [base64.b64decode(i["image_url"].split(",")[1]) for i in images] == bundle[2]
    assert bundle[0].list("seller")[0] == []


def test_immutable_requests_seller_scope_and_integrity_precede_spend(bundle):
    engine, request, calls = service(bundle)
    run(engine, request)
    with pytest.raises(ValueError, match="different photos"):
        run(engine, request.model_copy(update={"photos": list(reversed(request.photos))}))
    with pytest.raises(ValueError, match="not found"):
        engine.get("other", request.request_id)
    with pytest.raises(ValueError, match="different seller"):
        run(engine, request, "other")
    assert len(calls) == 1 and engine.status()["attempts"] == 1


@pytest.mark.parametrize("status", [302, 400, 401, 403, 429, 500])
def test_http_failures_are_redacted_and_never_retry_or_release_unknown_cost(bundle, status):
    engine, request, calls = service(bundle, lambda req: httpx.Response(status,
        headers={"location": "https://evil.test"}, json={"error": {"message": "PRIVATE-SENTINEL"}}))
    result = run(engine, request)
    assert result["status"] == "failed" and "PRIVATE-SENTINEL" not in json.dumps(result)
    assert run(engine, request) == result and len(calls) == 1
    assert engine.status()["committed_micros"] == RESERVE_MICROS


def test_lifetime_budget_survives_reconnect_restart_and_stops_new_requests(bundle):
    engine, request, calls = service(bundle, lambda req: httpx.Response(503), budget=2_000_000)
    run(engine, request)
    run(engine, request.model_copy(update={"request_id": "btco-research-second"}))
    engine.store.delete_family("family")
    restarted = ComicResearch(engine.store, engine.photos, engine.api_key, 2_000_000, engine.transport)
    with pytest.raises(ValueError, match="budget"):
        run(restarted, request.model_copy(update={"request_id": "btco-research-third"}))
    assert restarted.status()["committed_micros"] == 2_000_000 and len(calls) == 2


def test_concurrent_requests_cannot_spend_one_reservation_twice(bundle):
    engine, request, calls = service(bundle, budget=1_000_000)
    started, release = asyncio.Event(), asyncio.Event()
    async def handler(req):
        calls.append(req)
        started.set()
        await release.wait()
        return httpx.Response(200, json=response())
    engine.transport = httpx.MockTransport(handler)
    async def scenario():
        first = asyncio.create_task(engine.run("seller", request))
        await started.wait()
        same = await engine.run("seller", request)
        assert same["status"] == "pending"
        with pytest.raises(ValueError, match="budget"):
            await engine.run("seller", request.model_copy(update={"request_id": "btco-research-new"}))
        release.set()
        return await first
    result = asyncio.run(scenario())
    assert result["status"] == "needs_owner_review" and len(calls) == 1


def test_cancelled_request_is_uncertain_with_full_reservation(bundle):
    engine, request, calls = service(bundle)
    async def cancelled(req):
        raise asyncio.CancelledError()
    engine.transport = httpx.MockTransport(cancelled)
    with pytest.raises(asyncio.CancelledError):
        run(engine, request)
    saved = engine.get("seller", request.request_id)
    assert saved["status"] == "uncertain" and engine.status()["committed_micros"] == RESERVE_MICROS
    assert run(engine, request) == saved


@pytest.mark.parametrize("mutate", [
    lambda p: p.update(suggested_price_usd="7.99"),
    lambda p: p.update(condition="LIKE_NEW"),
])
def test_invalid_research_cannot_become_a_proposal(bundle, mutate):
    p = proposal()
    mutate(p)
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    assert run(engine, request)["status"] == "failed"


def test_sold_sources_need_real_search_and_supported_dates():
    p = proposal()
    p["sources"][0].update(kind="sold", sold_on=TODAY)
    assert parse_proposal(response(p), TODAY)["proposal"]["sources"][0]["kind"] == "sold"
    missing = response(p)
    missing["output"].pop(0)
    parsed = parse_proposal(missing, TODAY)
    assert parsed["rejected_sources"] and not parsed["proposal"]["sources"]
    assert parsed["proposal"]["suggested_price_usd"] is None


@pytest.mark.parametrize("evidence", [
    {"basis": "unverified"},
    {"basis": "visible_publication_date", "observed_text": "Copyright 1986 Test Press"},
    {"basis": "visible_publication_date", "observed_text": "May 1985"},
    {"basis": "exact_issue_reference", "source_url": "https://example.test/comic", "source_series": "Synthetic Comic", "source_issue": "2", "source_year": 1986},
    {"basis": "exact_issue_reference", "source_url": "https://invented.test/comic", "source_series": "Synthetic Comic", "source_issue": "1", "source_year": 1986},
])
def test_unsupported_year_is_removed_and_cannot_be_approved_away(bundle, evidence):
    p = proposal()
    p["year_evidence"] = evidence
    p["identity_sources"] = [{"url": "https://example.test/comic", "evidence": "Synthetic catalog record."}]
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    row = run(engine, request)
    assert row["proposal"]["year"] is None and row["proposal"]["suggested_price_usd"] is None
    assert "Publication year removed" in str(row["holds"])
    intake, _ = reviewed_intake(engine, "seller", ReviewedResearchIntake.model_validate(reviewed_payload(bundle, row)))
    assert intake.items[0].observations is None


def test_exact_issue_year_evidence_and_short_cover_date_are_supported():
    p = proposal()
    p["year_evidence"] = {"basis": "exact_issue_reference", "source_url": "https://example.test/comic",
        "source_series": "Synthetic Comic", "source_issue": "1", "source_year": 1986}
    p["identity_sources"] = [{"url": "https://example.test/comic", "evidence": "Synthetic catalog record."}]
    assert parse_proposal(response(p), TODAY)["proposal"]["year"] == 1986
    p["year_evidence"] = {"basis": "visible_publication_date", "observed_text": "May 86"}
    assert parse_proposal(response(p), TODAY)["proposal"]["year"] == 1986


def test_issue_marker_is_formatting_but_suffix_is_not():
    p = proposal()
    p["year_evidence"] = {"basis": "exact_issue_reference", "source_url": "https://example.test/comic",
        "source_series": "Synthetic Comic", "source_issue": "#1", "source_year": 1986}
    p["identity_sources"] = [{"url": "https://example.test/comic", "evidence": "Synthetic catalog record."}]
    assert parse_proposal(response(p), TODAY)["proposal"]["year"] == 1986
    p["year_evidence"]["source_issue"] = "#1A"
    assert parse_proposal(response(p), TODAY)["proposal"]["year"] is None


@pytest.mark.parametrize("evidence", ["Index page shows a current value of $4.36.", "Price guide estimate for this issue."])
def test_value_estimates_are_not_market_offers(evidence):
    p = proposal()
    p["sources"][0]["evidence"] = evidence
    parsed = parse_proposal(response(p), TODAY)
    assert not parsed["proposal"]["sources"]
    assert parsed["proposal"]["suggested_price_usd"] is None
    assert parsed["rejected_sources"][0]["group"] == "price"


@pytest.mark.parametrize("change", [
    {"uncertain_marks": ["Colored shape could be printed artwork"]},
    {"condition_notes": "A blue marker-like stain is visible on the cover."},
    {"condition_notes": "No ink or paint marks are visible on the cover."},
])
def test_mark_claims_require_explicit_condition_correction(bundle, change):
    p = proposal()
    p.update(change)
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    row = run(engine, request)
    assert row["proposal"]["condition"] is None and row["proposal"]["suggested_price_usd"] is None
    assert "owner inspection" in str(row["holds"])
    intake, _ = reviewed_intake(engine, "seller", ReviewedResearchIntake.model_validate(reviewed_payload(bundle, row)))
    assert intake.items[0].observations is None


@pytest.mark.parametrize("change", [
    {"url": "https://invented.test/sale"}, {"kind": "sold", "sold_on": None},
    {"checked_on": "2099-01-01"}, {"item_price_usd": "NaN"},
    {"item_price_usd": "$6.00"}, {"kind": "asking", "sold_on": TODAY},
])
def test_bad_market_source_preserves_identity_but_removes_price(bundle, change):
    p = proposal()
    p["sources"][0].update(change)
    engine, request, calls = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    row = run(engine, request)
    assert row["status"] == "needs_owner_review"
    assert row["proposal"]["series"] == "Synthetic Comic"
    assert row["proposal"]["sources"] == []
    assert row["proposal"]["suggested_price_usd"] is None
    assert row["rejected_sources"][0]["group"] == "price"
    assert "source(s) rejected" in str(row["holds"])
    assert not row["approved_for_publication"]
    assert run(engine, request) == row and len(calls) == 1


def test_catalog_identity_reference_does_not_become_a_market_price():
    p = proposal()
    p.update(sources=[], identity_sources=[{"url": "https://example.test/identity",
        "evidence": "Synthetic issue record showing publication year and publisher."}])
    result = response(p)
    result["output"].insert(1, {"type": "web_search_call", "status": "completed",
        "action": {"type": "open_page", "url": "https://example.test/identity"}})
    row = parse_proposal(result, TODAY)
    assert len(row["proposal"]["identity_sources"]) == 1
    assert row["proposal"]["suggested_price_usd"] is None and not row["proposal"]["sources"]


def test_unsupported_identity_reference_blocks_reviewed_bridge(bundle):
    p = proposal()
    p["identity_sources"] = [{"url": "https://invented.test/identity", "evidence": "Unsupported synthetic issue date."}]
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    row = run(engine, request)
    assert row["proposal"]["confidence"] == "low" and row["proposal"]["suggested_price_usd"] is None
    reviewed = ReviewedResearchIntake.model_validate(reviewed_payload(bundle, row))
    intake, _ = reviewed_intake(engine, "seller", reviewed)
    assert intake.items[0].observations is None


def test_unfinished_tool_attempt_is_conservatively_costed_but_not_processed(bundle):
    payload = response()
    payload["output"].insert(0, {"type": "web_search_call", "status": "searching", "action": {}})
    payload["output"].insert(0, {"type": "web_search_call", "status": "searching", "action": {}})
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=payload))
    row = run(engine, request)
    assert row["status"] == "needs_owner_review"
    assert row["metrics"]["web_calls"] == 3 and row["metrics"]["completed_web_calls"] == 1
    assert row["metrics"]["estimated_cost_micros"] == 33_000


def test_processed_tool_overrun_halts_spending_before_parsing_bad_output(bundle):
    payload = response()
    payload["output"] = [deepcopy(payload["output"][0]) for _ in range(3)]
    engine, request, calls = service(bundle, lambda req: httpx.Response(200, json=payload))
    row = run(engine, request)
    assert row["status"] == "failed" and row["budget_halted"]
    assert engine.status()["halted"]
    restarted = ComicResearch(engine.store, engine.photos, engine.api_key, 5_000_000, engine.transport)
    with pytest.raises(ValueError, match="spending halted"):
        run(restarted, request.model_copy(update={"request_id": "btco-research-next"}))
    assert len(calls) == 1


def test_unknown_or_incomplete_usage_retains_reservation_and_incomplete_response_fails(bundle):
    result = response()
    result.update(status="incomplete", usage=None)
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=result))
    assert run(engine, request)["status"] == "failed"
    assert engine.status()["committed_micros"] == RESERVE_MICROS
    assert usage_cost({}) is None


def test_strict_schema_requires_nullable_fields_and_has_no_defaults():
    schema = strict_schema()
    def check(value):
        if isinstance(value, dict):
            assert "default" not in value
            if value.get("type") == "object":
                assert not value["additionalProperties"]
                assert set(value["required"]) == set(value["properties"])
            for child in value.values(): check(child)
        elif isinstance(value, list):
            for child in value: check(child)
    check(schema)


def reviewed_payload(bundle, row):
    _, _, payload = setup(bundle, count=1)
    source = intake_from_drafts([payload["items"][0]["draft"]])
    return {"batch_id": "btco-batch-researched", "inventory_location": "TEST-BOX",
        "defaults": source["defaults"],
        "owner_review_evidence": "Owner reviewed original photos, sources, identity, condition, $8 price and $6 minimum.",
        "items": [{"request_id": row["request_id"], "revision": row["revision"],
                   "price_usd": "8", "minimum_offer_usd": "6", "master_sku": " Exact CDP SKU "}]}


def test_reviewed_bridge_preserves_approved_terms_and_still_needs_publication_approval(bundle):
    engine, request, _ = service(bundle)
    row = run(engine, request)
    reviewed = ReviewedResearchIntake.model_validate(reviewed_payload(bundle, row))
    intake, evidence = reviewed_intake(engine, "seller", reviewed)
    batch, issues = compile_intake(intake)
    assert not issues
    draft = batch.items[0].draft
    assert draft["identity"]["printing"] is None and draft["identity"]["verification_scope"] == "cover_identity"
    assert draft["inspection"]["scope"] == "exterior_only"
    assert draft["master_sku"] == " Exact CDP SKU "
    assert draft["price_usd"] == "8" and draft["best_offer"]["minimum_offer_usd"] == "6"
    assert evidence[request.request_id]["research_revision"] == row["revision"]
    stale = reviewed_payload(bundle, row)
    stale["items"][0]["revision"] = "0" * 64
    with pytest.raises(ValueError, match="Research changed"):
        reviewed_intake(engine, "seller", ReviewedResearchIntake.model_validate(stale))


@pytest.mark.parametrize("change", [{"matching_sides": False},
    {"collectible_type": "card"}, {"year": None}, {"condition": None}])
def test_uncertain_core_identity_cannot_be_approved_away(bundle, change):
    p = proposal()
    p.update(change)
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    row = run(engine, request)
    intake, _ = reviewed_intake(engine, "seller", ReviewedResearchIntake.model_validate(reviewed_payload(bundle, row)))
    batch, _ = compile_intake(intake)
    assert batch.items[0].draft is None and batch.items[0].unresolved_reason


def test_owner_review_of_complete_facts_does_not_require_high_model_confidence(bundle):
    p = proposal()
    p["confidence"] = "low"
    engine, request, _ = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    row = run(engine, request)
    intake, _ = reviewed_intake(engine, "seller", ReviewedResearchIntake.model_validate(reviewed_payload(bundle, row)))
    batch, issues = compile_intake(intake)
    assert not issues and batch.items[0].draft is not None


def test_owner_corrections_reuse_originals_without_research_or_comparison_claims(bundle):
    p = proposal()
    p.update(issue="6", year=None, condition=None, confidence="low")
    engine, request, calls = service(bundle, lambda req: httpx.Response(200, json=response(p)))
    row = run(engine, request)
    reviewed = reviewed_payload(bundle, row)
    reviewed["items"][0].update(expected_draft_revision="a"*64, corrections={
        "issue": "3", "year": 1985, "condition": "USED_GOOD",
        "condition_notes": "Owner inspected a small crease at the lower front corner.",
        "owner_correction_evidence": "Synthetic owner checked the original cover: issue 3, year 1985, Good; the colored shape is printed artwork."})
    intake, evidence = reviewed_intake(engine, "seller", ReviewedResearchIntake.model_validate(reviewed))
    batch, issues = compile_intake(intake)
    draft = batch.items[0].draft
    assert not issues and draft["identity"]["issue"] == "3" and draft["identity"]["year"] == 1985
    assert draft["photos"] == row["photos"] and draft["master_sku"] == " Exact CDP SKU "
    assert batch.items[0].expected_draft_revision == "a"*64
    pricing = batch.items[0].preparation_evidence["research"]
    assert pricing["basis"] == "owner_price" and pricing["sources"] == []
    assert evidence[request.request_id]["original_market_sources"] == p["sources"]
    assert engine.get("seller", request.request_id) == row and len(calls) == 1


@pytest.mark.parametrize("corrections", [
    {"owner_correction_evidence": " " * 20, "year": 1985},
    {"owner_correction_evidence": "Synthetic owner correction only."},
    {"owner_correction_evidence": "Synthetic owner reviewed condition.", "condition": "USED_GOOD"},
])
def test_owner_corrections_need_actual_facts_and_condition_notes(bundle, corrections):
    engine, request, _ = service(bundle)
    row = run(engine, request)
    reviewed = reviewed_payload(bundle, row)
    reviewed["items"][0]["corrections"] = corrections
    with pytest.raises(ValueError):
        ReviewedResearchIntake.model_validate(reviewed)


def test_mcp_costly_research_requires_write_scope_and_is_disabled_by_default(env):
    client, _, settings, _ = env
    _, read = connect(env)
    status = tool(client, read["access_token"], "get_comic_research")
    assert not status["budget"]["configured"]
    assert "sk-" not in repr(settings)
    args = {"request": {"request_id": "btco-research-denied", "photos": [
        {"object_key": f"photos/{'a'*64}/{c*64}.jpeg", "sha256_hex": c*64, "role": role}
        for c, role in [("a", "front"), ("b", "back")]]}}
    denied = rpc(client, read["access_token"], "tools/call", {"name": "research_comic_photos", "arguments": args}).json()["result"]
    assert denied["isError"] and "mcp/www_authenticate" in denied["_meta"]
    _, write = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    disabled = rpc(client, write["access_token"], "tools/call", {"name": "research_comic_photos", "arguments": args}).json()["result"]
    assert disabled["isError"] and "disabled" in str(disabled)


def test_mcp_reviewed_research_saves_complete_unapproved_draft(env, bundle, monkeypatch):
    client, _, _, _ = env
    draft = new_draft(env, bundle)
    row = {"request_id": "btco-research-reviewed", "revision": "a"*64,
           "status": "needs_owner_review", "proposal": proposal(), "photos": draft["photos"],
           "source_verification": "Synthetic AI proposal reviewed by the synthetic owner"}
    monkeypatch.setattr(ComicResearch, "get", lambda self, seller, request_id: deepcopy(row))
    async def nothing(*args): pass
    async def active(*args): return []
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_policies", nothing)
    monkeypatch.setattr("btco_ebay.selling.Selling.validate_promotion", nothing)
    monkeypatch.setattr("btco_ebay.publishing.Publisher.active", active)
    source = intake_from_drafts([draft])
    reviewed = {"batch_id": "btco-batch-reviewed", "inventory_location": "TEST-BOX",
        "defaults": source["defaults"], "owner_review_evidence": "Synthetic owner confirmed photos, identity, condition and proposed price and minimum.",
        "items": [{"request_id": row["request_id"], "revision": row["revision"], "price_usd": "8", "minimum_offer_usd": "6"}]}
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    result = tool(client, tokens["access_token"], "prepare_researched_comic_intake", {"reviewed": reviewed})
    assert len(result["listings"]) == 1 and not result["approval_current"]
    full = tool(client, tokens["access_token"], "get_listing_batch_review", {"batch_id": reviewed["batch_id"]})
    saved = full["listings"][0]
    assert saved["preparation_evidence"]["research_revision"] == row["revision"]
    assert saved["draft"]["inspection"]["scope"] == "exterior_only"
    assert "not independently" not in saved["draft"]["description"]
    _, read = connect(env)
    denied = rpc(client, read["access_token"], "tools/call", {
        "name": "prepare_researched_comic_intake", "arguments": {"reviewed": reviewed}}).json()["result"]
    assert denied["isError"]


def test_budget_does_not_reset_with_prompt_version(bundle, monkeypatch):
    engine, request, _ = service(bundle, lambda req: httpx.Response(503), budget=1_000_000)
    run(engine, request)
    monkeypatch.setattr("btco_ebay.comic_research.REQUEST_VERSION", "next-prompt-version")
    with pytest.raises(ValueError, match="budget"):
        run(engine, request.model_copy(update={"request_id": "btco-research-new-prompt"}))


def test_saved_request_replays_across_prompt_upgrade_without_spend(bundle, monkeypatch):
    engine, request, calls = service(bundle)
    saved = run(engine, request)
    committed = engine.status()["committed_micros"]
    monkeypatch.setattr("btco_ebay.comic_research.REQUEST_VERSION", "next-prompt-version")
    assert run(engine, request) == saved
    assert len(calls) == 1 and engine.status()["committed_micros"] == committed
    with pytest.raises(ValueError, match="different photos"):
        run(engine, request.model_copy(update={"photos": list(reversed(request.photos))}))


@pytest.mark.parametrize("value", [-1, 5_000_001, True, 1.5])
def test_pilot_budget_requires_bounded_integer_micros(bundle, value):
    with pytest.raises(ValueError, match="budget"):
        service(bundle, budget=value)
