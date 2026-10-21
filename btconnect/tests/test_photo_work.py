"""Blocking photo work never outlives cancellation or races a queued writer."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import threading

import anyio
import pytest

from btco_ebay.blocking import BlockingWork
from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.photos import PhotoStore
from test_connector import env as env, connect, tool
from test_listings import original
from test_photo_pipeline import file, call_error


@pytest.mark.parametrize('fail', [False, True])
def test_repeated_cancellation_drains_worker_and_keeps_capacity(fail):
    async def run():
        work = BlockingWork()
        started, release, finished = asyncio.Event(), threading.Event(), threading.Event()
        loop, seen = asyncio.get_running_loop(), []
        def blocking():
            loop.call_soon_threadsafe(started.set)
            assert release.wait(2)
            finished.set()
            if fail:
                raise ValueError('synthetic worker failure')
            return 1
        first = asyncio.create_task(work.run(blocking))
        await asyncio.wait_for(started.wait(), 1)
        queued = asyncio.create_task(work.run(lambda: seen.append('cancelled queue')))
        await asyncio.sleep(0)
        queued.cancel()
        with pytest.raises(asyncio.CancelledError):
            await queued
        first.cancel()
        await asyncio.sleep(0)
        first.cancel()
        second = asyncio.create_task(work.run(lambda: seen.append('next')))
        await asyncio.sleep(0)
        assert not first.done() and not second.done() and not seen
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert finished.is_set()
        await second
        assert seen == ['next']
    asyncio.run(run())


def test_anyio_cancellation_drains_without_blocking_event_loop():
    async def run():
        work, release, finished = BlockingWork(), threading.Event(), threading.Event()
        loop = asyncio.get_running_loop()
        with anyio.CancelScope() as scope:
            def blocking():
                loop.call_soon_threadsafe(scope.cancel)
                assert release.wait(2)
                finished.set()
            async def unblock():
                await asyncio.sleep(0.02)
                release.set()
            helper = asyncio.create_task(unblock())
            await work.run(blocking)
        await helper
        assert scope.cancelled_caught and finished.is_set()
        assert await work.run(lambda: 42) == 42
    asyncio.run(run())


@pytest.mark.parametrize('route', ['single', 'batch', 'raw'])
def test_photo_worker_allows_health_requests_during_processing(env, monkeypatch, route):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE+' '+WRITE_SCOPE)
    token, data = tokens['access_token'], original('red')
    async def fetch(*a, **kw):
        return data
    monkeypatch.setattr('btco_ebay.listing_tools.download_original', fetch)
    started, release = threading.Event(), threading.Event()
    normal = PhotoStore.put
    def delayed(self, *a, **kw):
        started.set()
        assert release.wait(2)
        return normal(self, *a, **kw)
    monkeypatch.setattr(PhotoStore, 'put', delayed)
    if route == 'raw':
        ticket = tool(client, token, 'begin_photo_upload', {'sha256_hex': sha256(data).hexdigest(),
            'size_bytes': len(data), 'role': 'front'})
    def ingest():
        if route == 'single':
            return tool(client, token, 'ingest_original_photo', {'file': file('one'), 'role': 'front'})
        if route == 'batch':
            return tool(client, token, 'ingest_original_photos', {'files': [file('one')],
                'photo_inputs': [{'file_index': 0, 'role': 'front'}]})
        return client.post('/photos/upload', content=data, headers={
            'Authorization': 'Bearer '+ticket['upload_token'], 'Content-Type': 'image/jpeg'})
    with ThreadPoolExecutor(max_workers=2) as executor:
        pending = executor.submit(ingest)
        try:
            assert started.wait(1)
            health = executor.submit(client.get, '/health')
            assert health.result(timeout=1).status_code == 200
            assert not pending.done()
        finally:
            release.set()
        result = pending.result(timeout=2)
    if route == 'raw':
        assert result.status_code == 201
        stored = result.json()
    elif route == 'batch':
        assert result['complete']
        stored = result['results'][0]
    else:
        stored = result
    assert PhotoStore(provider.store).get('seller-123', stored['photo']) == data


def test_revocation_during_photo_processing_prevents_object_write(env, monkeypatch):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE+' '+WRITE_SCOPE)
    family = asyncio.run(provider.load_access_token(tokens['access_token'])).family
    data, started, release = original('green'), threading.Event(), threading.Event()
    async def fetch(*a, **kw):
        return data
    monkeypatch.setattr('btco_ebay.listing_tools.download_original', fetch)
    normal = PhotoStore.put
    def delayed(self, *a, **kw):
        started.set()
        assert release.wait(2)
        return normal(self, *a, **kw)
    monkeypatch.setattr(PhotoStore, 'put', delayed)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(call_error, client, tokens['access_token'], 'ingest_original_photo',
            {'file': file('one'), 'role': 'front'})
        try:
            assert started.wait(1)
            provider.store.delete_family(family)
        finally:
            release.set()
        assert 'expired' in str(future.result(timeout=2))
    assert not list(PhotoStore(provider.store).root.rglob('*.jpeg'))
