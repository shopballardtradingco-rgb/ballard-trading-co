"""Explicit same-offer recovery; fixtures never contact live eBay."""
import asyncio
from copy import deepcopy
import time

import httpx
import pytest

from test_listings import bundle as bundle, publisher, run
from test_connector import env as env, connect, rpc
from test_listing_http import selling_adapter
from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.publishing import publication_outcome, Publisher
from btco_ebay.selling import SellingError


EVIDENCE = "Owner explicitly approves recovery of this exact saved revision and original photos."


def rejected(bundle, *, legacy=False, uncertain=False):
    pub, fake, row = publisher(bundle)
    normal_publish = fake.publish

    async def fail(family, offer_id):
        fake.calls.append("publish")
        raise SellingError(None if uncertain else 400, [] if uncertain else ["25604"])

    fake.publish = fail
    with pytest.raises(SellingError):
        run(pub, row)
    fake.publish = normal_publish
    saved = pub.repo.get("seller", row["draft"]["draft_id"])
    saved["job"]["publish_requested_at"] = time.time() - 600
    saved["updated_at"] = time.time() - 600
    if legacy:
        for key in ("publish_requested_at", "publish_failure", "publish_failures"):
            saved["job"].pop(key, None)
        saved["job"]["last_error"] = "Publication outcome is unresolved; only read-back recovery is allowed"
    pub.repo.write("seller", saved)
    return pub, fake, row


def authorize(pub, row, evidence=EVIDENCE):
    return asyncio.run(pub.approve_recovery("seller", "family", row["draft"]["draft_id"],
                                            row["revision"], evidence))


@pytest.mark.parametrize("legacy", [False, True])
def test_recovery_preserves_same_offer_content_and_originals(bundle, legacy):
    pub, fake, row = rejected(bundle, legacy=legacy)
    before = deepcopy(fake.calls)
    recovered = authorize(pub, row)
    assert fake.calls == before  # approval performs no eBay writes
    assert recovered["draft"] == row["draft"]
    assert recovered["revision"] == row["revision"]
    assert recovered["approval"] == row["approval"]
    assert recovered["job"]["publish_attempted"] is True
    assert recovered["job"]["publish_recovery"]["evidence"] == EVIDENCE
    assert recovered["job"]["publish_recovery"]["legacy_failure_journal"] == legacy
    assert publication_outcome(recovered)["recovery_authorized"]
    complete = run(pub, row)
    assert complete["state"] == "published"
    assert complete["job"]["offer_id"] == "123"
    assert complete["job"]["publish_recovery"]["consumed"] is True
    assert fake.calls.count("publish") == 2
    assert fake.calls.count("create") == fake.calls.count("put") == 1
    assert fake.calls.count("upload") == 2
    assert run(pub, row) == complete
    assert fake.calls.count("publish") == 2


def test_rejection_diagnostics_survive_later_guard_errors(bundle):
    pub, fake, row = rejected(bundle)
    with pytest.raises(ValueError, match="unresolved"):
        run(pub, row)
    saved = pub.repo.get("seller", row["draft"]["draft_id"])
    failure = saved["job"]["publish_failure"]
    assert failure["http_status"] == 400 and failure["codes"] == ["25604"]
    assert failure["uncertain"] is False
    assert failure["offer_id"] == "123" and failure["revision"] == row["revision"]
    assert saved["job"]["publish_failures"] == [failure]
    assert publication_outcome(saved)["publish_failure"] == failure
    assert fake.calls.count("publish") == 1


def test_new_uncertain_failure_cannot_receive_recovery_approval(bundle):
    pub, fake, row = rejected(bundle, uncertain=True)
    with pytest.raises(ValueError, match="Uncertain"):
        authorize(pub, row)
    assert fake.calls.count("publish") == 1


def test_new_untyped_interruption_is_not_treated_as_legacy(bundle):
    pub, fake, row = rejected(bundle)
    saved = pub.repo.get("seller", row["draft"]["draft_id"])
    saved["job"]["publish_failure"] = None
    pub.repo.write("seller", saved)
    with pytest.raises(ValueError, match="Uncertain"):
        authorize(pub, row)
    assert fake.calls.count("publish") == 1


@pytest.mark.parametrize("conflict", ["duplicate", "offer_price", "inventory", "policy", "published", "missing", "images", "recent", "stale", "seller", "evidence"])
def test_recovery_checks_fail_without_writes(bundle, conflict):
    pub, fake, row = rejected(bundle)
    saved = pub.repo.get("seller", row["draft"]["draft_id"])
    if conflict == "duplicate":
        fake.duplicate = True
    elif conflict == "offer_price":
        fake.offer["pricingSummary"]["price"]["value"] = "999"
    elif conflict == "inventory":
        fake.item["product"]["title"] = "Changed"
    elif conflict == "policy":
        fake.bad_policy = True
    elif conflict == "published":
        fake.offer.update(status="PUBLISHED", listing={"listingId": "123456789123"})
    elif conflict == "missing":
        fake.offer = None
    elif conflict == "images":
        saved["job"]["images"][0]["sha256"] = "0"*64
    elif conflict == "recent":
        saved["job"]["publish_requested_at"] = time.time()
    elif conflict == "stale":
        row["revision"] = "0"*64
    elif conflict == "seller":
        fake.require = lambda family: {"user_id": "wrong-seller"}
    pub.repo.write("seller", saved)
    before = deepcopy(fake.calls)
    with pytest.raises(ValueError):
        authorize(pub, row, "" if conflict == "evidence" else EVIDENCE)
    assert fake.calls == before
    assert not pub.repo.get("seller", saved["draft"]["draft_id"])["job"].get("publish_recovery")


def test_offer_changes_between_authoritative_reads(bundle):
    pub, fake, row = rejected(bundle)
    async def changed(*args):
        return {**fake.offer, "status": "PUBLISHED", "listing": {"listingId": "123456789123"}}
    fake.get_offer = changed
    with pytest.raises(ValueError, match="changed during"):
        authorize(pub, row)
    assert fake.calls.count("publish") == 1


@pytest.mark.parametrize("change", ["expired", "consumed", "offer_id", "revision", "seller", "published_elsewhere"])
def test_recovery_authorization_is_bound_and_single_use(bundle, change):
    pub, fake, row = rejected(bundle)
    saved = authorize(pub, row)
    recovery = saved["job"]["publish_recovery"]
    if change == "expired":
        recovery["expires_at"] = time.time() - 1
    elif change == "consumed":
        recovery["consumed"] = True
    elif change in ("offer_id", "revision", "seller"):
        recovery[change] = "wrong"
    else:
        fake.duplicate = True
    pub.repo.write("seller", saved)
    with pytest.raises(ValueError):
        run(pub, row)
    assert fake.calls.count("publish") == 1


def test_recovery_timeout_never_repeats_request(bundle):
    pub, fake, row = rejected(bundle)
    authorize(pub, row)
    fake.failure = "publish-not-sent"
    with pytest.raises(SellingError):
        run(pub, row)
    fake.failure = None
    with pytest.raises(ValueError, match="unresolved"):
        run(pub, row)
    with pytest.raises(ValueError, match="Uncertain"):
        authorize(pub, row)
    assert fake.calls.count("publish") == 2 and fake.calls.count("create") == 1


def test_safe_diagnostic_reason_does_not_expose_upstream_text(env):
    def handler(request):
        return httpx.Response(400, json={"errors": [{"errorId": 25604,
            "message": "Input error. Availability not found. PRIVATE-SECRET"}]})
    selling, family = selling_adapter(env, handler)
    with pytest.raises(SellingError) as error:
        asyncio.run(selling.publish(family, "123"))
    assert error.value.diagnostic() == {"http_status": 400, "codes": ["25604"],
                                       "uncertain": False, "reasons": ["availability_not_found"]}
    assert "PRIVATE-SECRET" not in str(error.value)


def test_existing_mcp_approval_tool_routes_recovery_without_ebay_write(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    provider.store.put("listing", "seller-123:recovery-test", {
        "draft": {"draft_id": "recovery-test"}, "revision": "a"*64,
        "state": "approved", "job": {"phase": "publish", "publish_attempted": True}})
    calls = []
    async def capture(self, seller, family, draft_id, revision, evidence):
        calls.append((seller, draft_id, revision, evidence))
        return {"recovery_authorized": True, "published": False}
    monkeypatch.setattr(Publisher, "approve_recovery", capture)
    response = rpc(client, tokens["access_token"], "tools/call", {"name": "approve_listing_draft",
        "arguments": {"draft_id": "recovery-test", "revision": "a"*64,
                      "owner_approval_evidence": EVIDENCE}}).json()["result"]
    assert not response.get("isError")
    assert calls == [("seller-123", "recovery-test", "a"*64, EVIDENCE)]
