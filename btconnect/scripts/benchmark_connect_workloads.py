"""Synthetic large-original and 100-item workloads; no paid or external requests."""
import argparse
import asyncio
import io
import json
import os
from pathlib import Path
import random
import statistics
import subprocess
import sys
import tempfile
import threading
import time


async def measure(operation):
    delays, memory, stop = [], [], threading.Event()
    def rss():
        return int(Path('/proc/self/statm').read_text().split()[1])*os.sysconf('SC_PAGE_SIZE')
    def sample():
        while not stop.wait(0.002):
            memory.append(rss())
    memory.append(rss())
    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    async def heartbeat():
        previous = time.perf_counter()
        while not stop.is_set():
            await asyncio.sleep(0.005)
            now = time.perf_counter()
            delays.append(max(0, now-previous-0.005))
            previous = now
    ticker = asyncio.create_task(heartbeat())
    await asyncio.sleep(0)
    start = time.perf_counter()
    try:
        result = await operation()
        elapsed = time.perf_counter()-start
    finally:
        memory.append(rss())
        stop.set()
        await ticker
        sampler.join()
    return result, {'elapsed_seconds': elapsed, 'max_event_loop_delay_seconds': max(delays, default=0),
        'starting_rss_bytes': memory[0], 'sampled_peak_rss_bytes': max(memory)}


def worker(args):
    root = Path(args.worker_root).resolve()
    sys.path[:0] = [str(root), str(root/'tests')]
    from hashlib import sha256
    from types import SimpleNamespace
    from cryptography.fernet import Fernet
    from PIL import Image
    from btco_ebay.config import Settings, SCOPE, WRITE_SCOPE
    from btco_ebay.server import build_app
    import btco_ebay.listing_tools as listing_tools
    from btco_ebay.photos import PhotoStore
    from test_listings import bundle
    import test_listing_batches as fixtures
    def unique(color):
        output = io.BytesIO()
        Image.new('RGB', (600, 800), tuple(c % 256 for c in color)).save(output, format='PNG')
        return output.getvalue()
    fixtures.original = unique
    results = []
    async def run():
        for kind in ('100_ready', '100_unresolved'):
            samples = []
            for _ in range(args.repeats):
                with tempfile.TemporaryDirectory() as folder:
                    batches, fake, payload = fixtures.setup(bundle.__wrapped__(Path(folder)), count=100)
                    if kind == '100_unresolved':
                        for entry in payload['items']:
                            entry.pop('draft')
                            entry['unresolved_reason'] = 'Synthetic missing evidence; requires owner review.'
                    batches.submit('seller', payload)
                    writes, encrypted_bytes, writing = 0, 0, False
                    normal_write, normal_encrypt = batches.write, batches.store.cipher.encrypt
                    def encrypt(data):
                        nonlocal encrypted_bytes
                        if writing:
                            encrypted_bytes += len(data)
                        return normal_encrypt(data)
                    def write(row, db=None):
                        nonlocal writes, writing
                        writes += 1
                        writing = True
                        try:
                            return normal_write(row, db)
                        finally:
                            writing = False
                    batches.write, batches.store.cipher.encrypt = write, encrypt
                    async def operation():
                        calls = 0
                        while True:
                            review = await batches.prepare('seller', 'family', payload['batch_id'])
                            calls += 1
                            if not review['continue_preparation']:
                                return review, calls
                    (review, calls), sample = await measure(operation)
                    assert not fake.calls and not review['approval_current']
                    assert len(review['listings' if kind=='100_ready' else 'exceptions']) == 100
                    sample.update(batch_writes=writes, batch_json_bytes_encrypted=encrypted_bytes,
                                  preparation_calls=calls, policy_validation_calls=len(fake.policy_reads))
                    samples.append(sample)
            results.append({'operation': kind, 'samples': samples})

        # 12-megapixel noisy JPEG stresses decode/crypto; never represents an item.
        image = Image.frombytes('RGB', (3000, 4000), random.Random(42).randbytes(36_000_000))
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=88)
        data = output.getvalue()
        del image, output
        samples = []
        for _ in range(args.repeats):
            with tempfile.TemporaryDirectory() as folder:
                settings = Settings('https://connector.example', 'synthetic', 'synthetic', 'synthetic',
                    Fernet.generate_key().decode(), str(Path(folder)/'records.sqlite3'))
                _, provider, mcp = build_app(settings)
                provider.store.put('grant', 'family', {'user_id': 'seller'})
                listing_tools.get_access_token = lambda: SimpleNamespace(family='family', scopes=[SCOPE, WRITE_SCOPE])
                async def fetch(*a, **kw):
                    return data
                listing_tools.download_original = fetch
                async def operation():
                    return await mcp.call_tool('ingest_original_photo', {'file': {
                        'download_url': 'https://files.oaiusercontent.com/synthetic', 'file_id': 'synthetic'}, 'role': 'front'})
                result, sample = await measure(operation)
                record = result[1] if isinstance(result, tuple) else json.loads(result[0].text)
                assert record['storage_sha256_verified'] and record['photo']['sha256_hex'] == sha256(data).hexdigest()
                assert PhotoStore(provider.store).get('seller', record['photo']) == data
                samples.append(sample)
        results.append({'operation': '12mp_original_ingest', 'input_bytes': len(data), 'samples': samples})
    asyncio.run(run())
    for row in results:
        row['median_seconds'] = statistics.median(x['elapsed_seconds'] for x in row['samples'])
        row['median_max_event_loop_delay_seconds'] = statistics.median(x['max_event_loop_delay_seconds'] for x in row['samples'])
        row['max_sampled_rss_bytes'] = max(x['sampled_peak_rss_bytes'] for x in row['samples'])
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-root')
    parser.add_argument('--worker-root')
    parser.add_argument('--repeats', type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 10:
        parser.error('Use 1–10 repetitions')
    if args.worker_root:
        print(json.dumps(worker(args)))
        return
    if not args.baseline_root:
        parser.error('--baseline-root is required')
    runs = {}
    for name, root in (('baseline', args.baseline_root), ('candidate', Path(__file__).resolve().parents[1])):
        runs[name] = json.loads(subprocess.check_output([sys.executable, str(Path(__file__).resolve()),
            '--worker-root', str(root), '--repeats', str(args.repeats)], text=True))
    print(json.dumps({'scope': 'synthetic in-process MCP ingestion and service-level batches; not live productivity',
        'baseline_github_commit': 'e94834fbb2f2c732799af39e7893037ffe609631',
        'heartbeat_period_ms': 5, 'rss_sampling_ms': 2, 'repeats': args.repeats, 'runs': runs}, indent=2))


if __name__ == '__main__':
    main()
