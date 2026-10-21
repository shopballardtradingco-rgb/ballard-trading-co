"""Fresh photo checks stay responsive without losing locks or durable recovery."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest

from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.photos import PhotoStore
from test_connector import env as env, connect, rpc, tool
from test_listing_contract import new_draft
from test_listing_batches import setup
from test_listings import bundle as bundle


@pytest.mark.parametrize('operation', ['prepare', 'save', 'validate', 'original'])
def test_health_responds_during_stored_photo_checks(env, bundle, monkeypatch, operation):
    client, _, _, _ = env
    _, tokens = connect(env, scope=SCOPE + ' ' + WRITE_SCOPE)
    token, data = tokens['access_token'], new_draft(env, bundle)
    async def policies(*a):
        pass
    async def active(*a):
        return []
    monkeypatch.setattr('btco_ebay.selling.Selling.validate_policies', policies)
    monkeypatch.setattr('btco_ebay.selling.Selling.validate_promotion', policies)
    monkeypatch.setattr('btco_ebay.publishing.Publisher.active', active)
    started, release = threading.Event(), threading.Event()
    normal = PhotoStore.get
    def held(self, *args, **kwargs):
        started.set()
        assert release.wait(5)
        return normal(self, *args, **kwargs)
    monkeypatch.setattr(PhotoStore, 'get', held)
    def invoke():
        if operation == 'prepare':
            return tool(client, token, 'prepare_listing_batch', {'batch': {
                'batch_id': 'btco-batch-responsive', 'inventory_location': 'SYNTHETIC',
                'items': [{'item_key': 'one', 'label': 'Synthetic', 'draft': data}]}})
        if operation == 'original':
            photo = data['photos'][0]
            return rpc(client, token, 'tools/call', {'name': 'get_stored_original_photo',
                'arguments': {'object_key': photo['object_key'], 'sha256_hex': photo['sha256_hex']}}).json()['result']
        return tool(client, token, operation + '_listing_draft', {'draft': data})
    with ThreadPoolExecutor(max_workers=2) as executor:
        pending = executor.submit(invoke)
        try:
            assert started.wait(2)
            health = executor.submit(client.get, '/health')
            assert health.result(timeout=1).status_code == 200
            assert not pending.done()
        finally:
            release.set()
        result = pending.result(timeout=3)
    if operation == 'prepare':
        assert len(result['listings']) == 1 and not result['exceptions']
    elif operation == 'save':
        assert result['approval'] is None and result['draft']['photos'] == data['photos']
    elif operation == 'validate':
        assert result['valid']
    else:
        assert not result.get('isError') and any(x['type'] == 'image' for x in result['content'])


@pytest.mark.parametrize('phase', ['verify', 'save'])
def test_cancelled_photo_work_keeps_batch_lock_and_recovers_completed_save(bundle, monkeypatch, phase):
    batches, fake, payload = setup(bundle, count=1)
    batches.submit('seller', payload)
    async def run():
        started, release = asyncio.Event(), threading.Event()
        loop, calls = asyncio.get_running_loop(), []
        target, method = (batches.repo.photos, 'verify') if phase == 'verify' else (batches.repo, 'save')
        normal = getattr(target, method)
        def held(*a, **kw):
            calls.append(phase)
            loop.call_soon_threadsafe(started.set)
            assert release.wait(5)
            return normal(*a, **kw)
        monkeypatch.setattr(target, method, held)
        task = asyncio.create_task(batches.prepare('seller', 'family', payload['batch_id']))
        await asyncio.wait_for(started.wait(), 2)
        try:
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
            with pytest.raises(ValueError, match='already running'):
                await batches.prepare('seller', 'family', payload['batch_id'])
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        review = batches.review('seller', payload['batch_id'])
        assert not review['listings'] and len(review['preparation_pending']) == 1
        draft_id = payload['items'][0]['draft']['draft_id']
        saved = batches.store.get('listing', batches.repo.key('seller', draft_id))
        assert (saved is not None) == (phase == 'save')
        review = await batches.prepare('seller', 'family', payload['batch_id'])
        assert len(review['listings']) == 1 and not review['approval_current'] and not fake.calls
        if phase == 'save':
            assert calls == ['save']  # Resume adopts the unchanged durable save.
            assert review['listings'][0]['revision'] == saved['revision']
        row = batches.get('seller', payload['batch_id'])
        assert row['preparation_metrics']['per_item']['0']['cancellations'] == 1
    asyncio.run(run())


def test_photo_corruption_after_precheck_still_blocks_durable_save(bundle):
    batches, fake, payload = setup(bundle, count=1)
    batches.submit('seller', payload)
    photo = payload['items'][0]['draft']['photos'][0]
    async def corrupt_after_precheck(*args):
        (batches.repo.photos.root / photo['object_key']).write_bytes(b'corrupt encrypted original')
    fake.validate_policies = corrupt_after_precheck
    review = asyncio.run(batches.prepare('seller', 'family', payload['batch_id']))
    assert len(review['exceptions']) == 1 and not review['listings'] and not fake.calls
    assert 'integrity' in str(review['exceptions'])
    draft_id = payload['items'][0]['draft']['draft_id']
    assert batches.store.get('listing', batches.repo.key('seller', draft_id)) is None


@pytest.mark.parametrize('operation', ['prepare', 'save'])
def test_revocation_during_worker_checks_prevents_draft_commit(env, bundle, monkeypatch, operation):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + ' ' + WRITE_SCOPE)
    token = tokens['access_token']
    family = asyncio.run(provider.load_access_token(token)).family
    data = new_draft(env, bundle)
    async def policies(*a):
        pass
    async def active(*a):
        return []
    monkeypatch.setattr('btco_ebay.selling.Selling.validate_policies', policies)
    monkeypatch.setattr('btco_ebay.selling.Selling.validate_promotion', policies)
    monkeypatch.setattr('btco_ebay.publishing.Publisher.active', active)
    started, release, normal = threading.Event(), threading.Event(), PhotoStore.get
    def held(self, *a, **kw):
        started.set()
        assert release.wait(5)
        return normal(self, *a, **kw)
    monkeypatch.setattr(PhotoStore, 'get', held)
    name, args = 'save_listing_draft', {'draft': data}
    if operation == 'prepare':
        name, args = 'prepare_listing_batch', {'batch': {
            'batch_id': 'btco-batch-revoked', 'inventory_location': 'SYNTHETIC',
            'items': [{'item_key': 'one', 'label': 'Synthetic', 'draft': data}]}}
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(rpc, client, token, 'tools/call', {'name': name, 'arguments': args})
        try:
            assert started.wait(2)
            provider.store.delete_family(family)
        finally:
            release.set()
        result = pending.result(timeout=3).json()['result']
    assert 'expired during draft preparation' in str(result)
    assert provider.store.get('listing', 'seller-123:' + data['draft_id']) is None
    with provider.store.read() as db:
        assert db.execute('SELECT COUNT(*) FROM listing_claims').fetchone()[0] == 0
