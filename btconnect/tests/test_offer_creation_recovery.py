"""Confirmed createOffer recovery using synthetic originals and eBay fakes."""
import asyncio
from copy import deepcopy
import json
import time
import pytest
from test_listings import bundle as bundle, publisher, run
from btco_ebay.selling import SellingError
from btco_ebay.publishing import publication_outcome

EVIDENCE = 'Owner approves one retry of this exact rejected offer creation and unchanged listing.'
ATTESTATION = json.dumps({'action': 'retry_rejected_offer_creation_once',
    'owner_approval': EVIDENCE, 'rejection': {'http_status': 400, 'codes': ['25702'],
    'source': 'Original synthetic createOffer response was HTTP 400 with code 25702.'}})


def rejected(bundle, legacy=False, status=400, codes=None):
    pub, fake, row = publisher(bundle)
    normal = fake.create_offer
    async def reject(*args):
        fake.calls.append('create')
        raise SellingError(status, ['25702'] if codes is None else codes)
    fake.create_offer = reject
    with pytest.raises(SellingError):
        run(pub, row)
    fake.create_offer = normal
    saved = pub.repo.get('seller', row['draft']['draft_id'])
    saved['job']['offer_create_requested_at'] = time.time() - 600
    saved['updated_at'] = time.time() - 600
    if legacy:
        for key in ('offer_create_requested_at', 'offer_create_failure', 'offer_create_failures'):
            saved['job'].pop(key, None)
        saved['job']['last_error'] = 'Offer creation outcome is unknown; do not create another offer'
    pub.repo.write('seller', saved)
    return pub, fake, row


def authorize(pub, row, evidence=EVIDENCE):
    return asyncio.run(pub.approve_recovery('seller', 'family', row['draft']['draft_id'], row['revision'], evidence))


@pytest.mark.parametrize('legacy', [False, True])
def test_confirmed_rejection_recovers_once_without_reupload_or_changed_approval(bundle, legacy):
    pub, fake, row = rejected(bundle, legacy)
    before = deepcopy(fake.calls)
    saved = authorize(pub, row, ATTESTATION if legacy else EVIDENCE)
    assert fake.calls == before
    assert saved['draft'] == row['draft'] and saved['approval'] == row['approval']
    assert saved['revision'] == row['revision']
    assert publication_outcome(saved)['offer_creation_recovery_authorized']
    done = run(pub, row)
    assert done['state'] == 'published'
    assert done['job']['offer_create_recovery']['consumed']
    assert fake.calls.count('create') == 2
    assert fake.calls.count('upload') == 2 and fake.calls.count('put') == 1
    assert fake.calls.count('publish') == 1
    assert run(pub, row) == done
    assert fake.calls.count('create') == 2


def test_rejection_journal_survives_guard_failure(bundle):
    pub, fake, row = rejected(bundle)
    with pytest.raises(ValueError, match='unknown'): run(pub, row)
    saved = pub.repo.get('seller', row['draft']['draft_id'])
    failure = saved['job']['offer_create_failure']
    assert failure['codes'] == ['25702'] and failure['http_status'] == 400
    assert failure['uncertain'] is False and failure['revision'] == row['revision']
    assert saved['job']['offer_create_failures'] == [failure]
    assert fake.calls.count('create') == 1


@pytest.mark.parametrize('status,codes', [(None, []), (500, ['25001']), (400, ['25713']), (429, [])])
def test_uncertain_or_other_failures_cannot_be_attested_away(bundle, status, codes):
    pub, fake, row = rejected(bundle, status=status, codes=codes)
    with pytest.raises(ValueError, match='read-back-only'): authorize(pub, row, ATTESTATION)
    assert fake.calls.count('create') == 1


def test_new_cancelled_attempt_is_not_legacy(bundle):
    pub, fake, row = rejected(bundle)
    saved = pub.repo.get('seller', row['draft']['draft_id'])
    saved['job']['offer_create_failure'] = None
    pub.repo.write('seller', saved)
    with pytest.raises(ValueError, match='read-back-only'): authorize(pub, row, ATTESTATION)


@pytest.mark.parametrize('evidence', [EVIDENCE, '{}', 'null', json.dumps({'action': 'retry_rejected_offer_creation_once',
    'owner_approval': EVIDENCE, 'rejection': {'http_status': 500, 'codes': ['25702'], 'source': 'Synthetic response reference'}})])
def test_legacy_requires_exact_confirmed_response_attestation(bundle, evidence):
    pub, fake, row = rejected(bundle, True)
    with pytest.raises(ValueError): authorize(pub, row, evidence)
    assert fake.calls.count('create') == 1


@pytest.mark.parametrize('conflict', ['duplicate', 'inventory', 'policy', 'offer', 'recent', 'images', 'stale', 'seller'])
def test_recovery_approval_checks_fail_without_ebay_writes(bundle, conflict):
    pub, fake, row = rejected(bundle)
    saved = pub.repo.get('seller', row['draft']['draft_id'])
    if conflict == 'duplicate': fake.duplicate = True
    elif conflict == 'inventory': fake.item['product']['title'] = 'Changed'
    elif conflict == 'policy': fake.bad_policy = True
    elif conflict == 'offer': fake.offer = {'offerId': '456'}
    elif conflict == 'recent': saved['job']['offer_create_requested_at'] = time.time()
    elif conflict == 'images': saved['job']['images'][0]['sha256'] = '0'*64
    elif conflict == 'stale': row['revision'] = '0'*64
    elif conflict == 'seller': fake.require = lambda family: {'user_id': 'other'}
    pub.repo.write('seller', saved)
    before = deepcopy(fake.calls)
    with pytest.raises(ValueError): authorize(pub, row)
    assert fake.calls == before


def test_offer_appearing_between_checks_blocks_authorization(bundle):
    pub, fake, row = rejected(bundle)
    count = 0
    async def offers(*args):
        nonlocal count
        count += 1
        return [] if count == 1 else [{'offerId': '456'}]
    fake.offers = offers
    with pytest.raises(ValueError, match='appeared'): authorize(pub, row)
    assert fake.calls.count('create') == 1


@pytest.mark.parametrize('change', ['inventory', 'expired', 'consumed', 'seller', 'revision', 'sku'])
def test_recovery_rechecks_at_execution(bundle, change):
    pub, fake, row = rejected(bundle)
    saved = authorize(pub, row)
    recovery = saved['job']['offer_create_recovery']
    if change == 'inventory': fake.item['product']['title'] = 'Changed'
    elif change == 'expired': recovery['expires_at'] = time.time() - 1
    elif change == 'consumed': recovery['consumed'] = True
    else: recovery[change] = 'wrong'
    pub.repo.write('seller', saved)
    with pytest.raises(ValueError): run(pub, row)
    assert fake.calls.count('create') == 1


def test_recovery_timeout_is_never_repeated_or_reauthorized(bundle):
    pub, fake, row = rejected(bundle)
    authorize(pub, row)
    fake.failure = 'create-not-sent'
    with pytest.raises(SellingError): run(pub, row)
    fake.failure = None
    with pytest.raises(ValueError, match='unknown'): run(pub, row)
    with pytest.raises(ValueError, match='consumed'): authorize(pub, row, ATTESTATION)
    assert fake.calls.count('create') == 2 and fake.calls.count('publish') == 0


def test_appearing_matching_offer_is_reused_instead_of_created(bundle):
    pub, fake, row = rejected(bundle)
    authorize(pub, row)
    async def insert_existing():
        from btco_ebay.listing_drafts import parse_listing
        await fake.create_offer('family', parse_listing(row['draft']))
    asyncio.run(insert_existing())
    before = fake.calls.count('create')
    done = run(pub, row)
    assert done['state'] == 'published' and fake.calls.count('create') == before
