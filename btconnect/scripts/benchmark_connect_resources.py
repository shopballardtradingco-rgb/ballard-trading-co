"""Offline comparison: real loopback TLS, encrypted SQLite, no external traffic.

Measures the previous performance candidate and this candidate in separate
processes. Never uses production inventory, credentials, photos or paid services.
"""
import argparse
import asyncio
from contextlib import asynccontextmanager
import json
from pathlib import Path
import re
import statistics
import subprocess
import sys
import tempfile
import time


def worker(args):
    root = Path(args.worker_root).resolve()
    candidate_tests = Path(__file__).resolve().parents[1] / 'tests'
    sys.path[:0] = [str(root), str(root / 'tests'), str(candidate_tests)]
    from cryptography.fernet import Fernet
    from types import SimpleNamespace
    from btco_ebay.config import TRADING_SCOPE
    from btco_ebay.ebay import Ebay, ORDER_URL
    from btco_ebay.listing_store import ListingStore
    from btco_ebay.photos import PhotoStore
    from btco_ebay.publishing import Publisher
    from btco_ebay.selling import Selling
    from btco_ebay.store import Store, digest
    from local_tls import LocalTLS
    from test_inventory import listing, response

    results = []
    for size in (1000, 10000):
        with tempfile.TemporaryDirectory() as temp:
            store = Store(str(Path(temp) / 'records.sqlite3'), Fernet.generate_key().decode())
            repo = ListingStore(store, PhotoStore(store))
            with store.tx() as db:
                for i in range(size):
                    identifier = f'draft-{i:05d}'
                    store.put('listing', repo.key('owner', identifier), {'draft_id': identifier, 'payload': 'x'*200}, db=db)
                    if i % 10 == 0:
                        store.put('token', str(i), {'value': 'synthetic'}, expires=time.time()+3600, db=db)
                db.executemany('INSERT INTO listing_claims VALUES(?,?,?,?)', [
                    (digest('owner'), kind, digest(str(i)), f'draft-{i:05d}')
                    for i in range(size) for kind in ('sku', 'item', 'photo')])
            iterations = 100
            for operation in ('journal_write', 'draft_catalog_page'):
                samples = []
                for _ in range(args.repeats):
                    start = time.perf_counter()
                    for i in range(iterations):
                        if operation == 'journal_write':
                            store.put('benchmark', 'journal', {'iteration': i})
                        else:
                            rows, cursor = repo.list('owner', f'draft-{int(size*0.8):05d}', 20)
                            assert len(rows) == 20 and cursor == f'draft-{int(size*0.8)+20:05d}'
                    samples.append((time.perf_counter()-start)/iterations)
                results.append({'operation': operation, 'saved_drafts': size,
                    'median_seconds': statistics.median(samples), 'samples_seconds': samples,
                    'database_bytes': Path(store.path).stat().st_size})

    @asynccontextmanager
    async def lifetime(ebay):
        if hasattr(ebay, 'http'):
            async with ebay.http.lifespan():
                yield
        else:
            yield

    async def network():
        for operation in ('20_sequential_report_reads', '3597_item_active_scan'):
            samples, connections, clients, requests, peaks = [], [], [], [], []
            for _ in range(args.repeats):
                with tempfile.TemporaryDirectory() as temp:
                    folder = Path(temp)
                    def upstream(method, path, body):
                        if method == 'GET':
                            return 200, {}, b'{"orders":[],"total":0}'
                        assert path == '/ws/api.dll' and method == 'POST'
                        page = int(re.search(rb'<PageNumber>(\d+)</PageNumber>', body)[1])
                        offset = (page-1)*200
                        rows = [listing(123456789000+i) for i in range(offset, min(offset+200, 3597))]
                        return 200, {}, response(rows, total=3597, pages=18)
                    server = LocalTLS(folder / 'tls', upstream)
                    store = Store(str(folder / 'records.sqlite3'), Fernet.generate_key().decode())
                    store.put('grant', 'family', {'access_token': 'synthetic', 'expires_at': time.time()+3600,
                        'refresh_expires_at': time.time()+7200, 'username': 'owner', 'user_id': 'owner',
                        'consented_scopes': [TRADING_SCOPE]})
                    ebay = Ebay(SimpleNamespace(), store)
                    async with server.serve():
                        with server.route_clients():
                            start = time.perf_counter()
                            async with lifetime(ebay):
                                if operation == '20_sequential_report_reads':
                                    for _ in range(20):
                                        assert await ebay.get('family', ORDER_URL) == {'orders': [], 'total': 0}
                                else:
                                    rows = await Publisher(None, Selling(ebay)).active('family')
                                    assert len(rows) == 3597 and len({r['item_id'] for r in rows}) == 3597
                            samples.append(time.perf_counter()-start)
                    connections.append(server.connections)
                    clients.append(server.clients)
                    requests.append(server.requests)
                    peaks.append(server.peak)
                    assert not server.writers and not server.tasks
            results.append({'operation': operation, 'median_seconds': statistics.median(samples),
                'samples_seconds': samples, 'tls_connections_per_sample': connections,
                'http_clients_per_sample': clients, 'requests_per_sample': requests,
                'peak_server_requests_per_sample': peaks})
    asyncio.run(network())
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-root')
    parser.add_argument('--worker-root')
    parser.add_argument('--repeats', type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 20:
        parser.error('Use 1–20 repetitions')
    if args.worker_root:
        print(json.dumps(worker(args)))
        return
    if not args.baseline_root:
        parser.error('--baseline-root is required')
    runs = {}
    for name, root in (('baseline', args.baseline_root), ('candidate', Path(__file__).resolve().parents[1])):
        output = subprocess.check_output([sys.executable, str(Path(__file__).resolve()),
            '--worker-root', str(root), '--repeats', str(args.repeats)], text=True)
        runs[name] = json.loads(output)
    comparisons = []
    for before, after in zip(runs['baseline'], runs['candidate']):
        assert (before['operation'], before.get('saved_drafts')) == (after['operation'], after.get('saved_drafts'))
        comparisons.append({'operation': before['operation'], 'saved_drafts': before.get('saved_drafts'),
            'baseline_seconds': before['median_seconds'], 'candidate_seconds': after['median_seconds'],
            'reduction_percent': 100*(1-after['median_seconds']/before['median_seconds'])})
    print(json.dumps({'scope': 'encrypted SQLite and real local TLS; no simulated latency; not live eBay or owner time',
        'baseline_github_commit': '51171adbebb7d0a033e1666ae6a2a068426b4c35',
        'repeats': args.repeats, 'comparisons': comparisons, 'runs': runs}, indent=2))


if __name__ == '__main__':
    main()
