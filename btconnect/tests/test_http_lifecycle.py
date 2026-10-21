"""Connection reuse must not change authorization, retries or resource cleanup."""
import asyncio
import time
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet
from starlette.testclient import TestClient

from btco_ebay.config import ACCOUNT_SCOPE, INVENTORY_SCOPE, TRADING_SCOPE, Settings
from btco_ebay.ebay import Ebay, EbayError, ORDER_URL
from btco_ebay.inventory import active_listings, MAX_RESPONSE_BYTES
from btco_ebay.selling import Selling, SellingError, INVENTORY
from btco_ebay.server import build_app
from btco_ebay.store import Store
from local_tls import LocalTLS
from test_inventory import response as inventory_response


def ebay_fixture(tmp_path, transport=None):
    store = Store(str(tmp_path / 'records.sqlite3'), Fernet.generate_key().decode())
    for family in ('a', 'b'):
        store.put('grant', family, {'access_token': f'synthetic-{family}',
            'expires_at': time.time()+3600, 'refresh_expires_at': time.time()+7200,
            'username': family, 'user_id': family,
            'consented_scopes': [ACCOUNT_SCOPE, INVENTORY_SCOPE, TRADING_SCOPE]})
    return Ebay(SimpleNamespace(), store, transport)


def test_real_tls_reuse_and_pool_bound(tmp_path):
    async def run():
        async def respond(method, path, body):
            await asyncio.sleep(0.01)
            return 200, {}, b'{}'
        server = LocalTLS(tmp_path / 'tls', respond)
        ebay = ebay_fixture(tmp_path)
        async with server.serve():
            with server.route_clients():
                async with ebay.http.lifespan():
                    for _ in range(12):
                        await ebay.get('a', ORDER_URL)
                    assert server.connections == 1 and server.clients == 1
                    await asyncio.gather(*(ebay.get('a', ORDER_URL) for _ in range(20)))
                    assert server.peak <= 8 and server.connections <= 8
                assert ebay.http._client is None
        assert not server.writers and not server.tasks and server.requests == 32
    asyncio.run(run())


def test_shared_pool_does_not_share_auth_cookies_or_cache_grants(tmp_path):
    async def run():
        seen = []
        def upstream(request):
            seen.append(request)
            assert 'cookie' not in request.headers
            return httpx.Response(200, json={}, headers={'Set-Cookie': 'private=never-replay; Path=/; Secure'})
        ebay = ebay_fixture(tmp_path, httpx.MockTransport(upstream))
        selling = Selling(ebay)
        async with ebay.http.lifespan():
            await ebay.get('a', ORDER_URL)
            await selling._request('b', 'GET', INVENTORY+'/inventory_item/x')
            grant = ebay.store.get('grant', 'a')
            grant['access_token'] = 'synthetic-new'
            ebay.store.put('grant', 'a', grant)
            await ebay.get('a', ORDER_URL)
            assert [r.headers['authorization'] for r in seen] == ['Bearer synthetic-a', 'Bearer synthetic-b', 'Bearer synthetic-new']
            assert [r.extensions['timeout']['read'] for r in seen] == [20, 45, 20]
            assert not ebay.http._client.cookies
            with ebay.store.tx() as db:
                from btco_ebay.store import digest
                db.execute('DELETE FROM records WHERE kind=? AND id=?', ('grant', digest('a')))
            with pytest.raises(EbayError, match='missing'):
                await ebay.get('a', ORDER_URL)
            grant = ebay.store.get('grant', 'b')
            grant['consented_scopes'] = []
            ebay.store.put('grant', 'b', grant)
            with pytest.raises(ValueError, match='consent'):
                await selling._request('b', 'GET', INVENTORY+'/inventory_item/x')
            assert len(seen) == 3
    asyncio.run(run())


@pytest.mark.parametrize('status', [302, 429, 503, None])
def test_pool_never_follows_redirects_or_retries_mutations(tmp_path, status):
    async def run():
        requests = []
        def upstream(request):
            requests.append(request)
            if status is None:
                raise httpx.ReadError('private failure')
            return httpx.Response(status, headers={'Location': 'https://untrusted.invalid'}, json={'private': 'secret'})
        ebay = ebay_fixture(tmp_path, httpx.MockTransport(upstream))
        async with ebay.http.lifespan():
            with pytest.raises(SellingError) as error:
                await Selling(ebay)._request('a', 'POST', INVENTORY+'/offer', json={})
            assert error.value.status == status and len(requests) == 1
            assert 'secret' not in str(error.value) and 'private' not in str(error.value)
    asyncio.run(run())


def test_stream_limits_and_cancellation_close_responses_without_closing_pool(tmp_path):
    async def run():
        started = asyncio.Event()
        streams = []
        class Stream(httpx.AsyncByteStream):
            def __init__(self, mode):
                self.mode, self.closed = mode, False
            async def __aiter__(self):
                if self.mode == 'large':
                    yield b'x'*(MAX_RESPONSE_BYTES+1)
                elif self.mode == 'wait':
                    started.set()
                    await asyncio.Event().wait()
                else:
                    yield inventory_response()
            async def aclose(self):
                self.closed = True
        modes = iter(['large', 'wait', 'ok'])
        def upstream(request):
            assert request.extensions['timeout']['read'] == 30
            stream = Stream(next(modes))
            streams.append(stream)
            return httpx.Response(200, stream=stream)
        ebay = ebay_fixture(tmp_path, httpx.MockTransport(upstream))
        async with ebay.http.lifespan():
            with pytest.raises(EbayError, match='limit'):
                await active_listings(ebay, 'a', 1)
            task = asyncio.create_task(active_listings(ebay, 'a', 1))
            await started.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            result = await active_listings(ebay, 'a', 1)
            assert result['returned'] == 1 and all(s.closed for s in streams)
    asyncio.run(run())


def test_asgi_lifespan_owns_pool_and_closes_after_failure(tmp_path):
    class Transport(httpx.MockTransport):
        def __init__(self):
            super().__init__(lambda request: httpx.Response(200, json={}))
            self.closed = 0
        async def aclose(self):
            self.closed += 1
    transport = Transport()
    settings = Settings('https://connector.example', 'test', 'test', 'test',
        Fernet.generate_key().decode(), str(tmp_path / 'records.sqlite3'))
    app, provider, _ = build_app(settings, transport)
    assert provider.ebay.http._client is None
    with pytest.raises(RuntimeError, match='synthetic failure'):
        with TestClient(app, base_url=settings.origin) as client:
            pool = provider.ebay.http._client
            assert pool is not None and not pool.is_closed
            assert client.get('/health').status_code == 200
            assert client.get('/.well-known/oauth-authorization-server').status_code == 200
            assert transport.closed == 0
            raise RuntimeError('synthetic failure')
    assert pool.is_closed and transport.closed == 1 and provider.ebay.http._client is None


def test_standalone_clients_close_and_never_cross_event_loops(tmp_path):
    ebay = ebay_fixture(tmp_path, httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    async def once():
        async with ebay.http.client() as client:
            assert not client.is_closed
        assert client.is_closed
    asyncio.run(once())
    asyncio.run(once())
    async def run():
        async with ebay.http.lifespan():
            parent = ebay.http._client
            async def child_loop():
                async with ebay.http.client() as client:
                    assert client is not parent
            await asyncio.to_thread(lambda: asyncio.run(child_loop()))
            assert not parent.is_closed
    asyncio.run(run())
