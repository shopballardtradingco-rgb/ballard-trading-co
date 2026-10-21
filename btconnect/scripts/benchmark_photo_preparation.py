"""Measure fresh photo checks in five-draft preparation; no external requests."""
import argparse
import asyncio
from hashlib import sha256
import json
from pathlib import Path
import platform
import random
import statistics
import subprocess
import sys
import tempfile
import time

from benchmark_connect_workloads import measure


def worker(args):
    root = Path(args.worker_root).resolve()
    sys.path[:0] = [str(root), str(root / 'tests')]
    from test_listings import bundle
    from test_listing_batches import setup
    samples = []
    async def run():
        for _ in range(args.repeats):
            with tempfile.TemporaryDirectory() as folder:
                batches, fake, payload = setup(bundle.__wrapped__(Path(folder)), count=5)
                batches.store.put('grant', 'family', {'user_id': 'seller'}, family='family')
                sizes = []
                for i, entry in enumerate(payload['items']):
                    entry['draft']['photos'] = []
                    for j, role in enumerate(('front', 'back')):
                        data = (Path(args.fixtures) / f'{i*2+j}.jpeg').read_bytes()
                        sizes.append(len(data))
                        photo = batches.repo.photos.put('seller', data, sha256(data).hexdigest(), role)
                        entry['draft']['photos'].append(photo.model_dump())
                del data
                batches.submit('seller', payload)
                reads, bytes_read, read_seconds = 0, 0, 0
                normal = batches.repo.photos.get
                def get(*a, **kw):
                    nonlocal reads, bytes_read, read_seconds
                    started = time.perf_counter()
                    result = normal(*a, **kw)
                    read_seconds += time.perf_counter() - started
                    reads += 1
                    bytes_read += len(result)
                    return result
                batches.repo.photos.get = get
                async def operation():
                    return await batches.prepare('seller', 'family', payload['batch_id'])
                review, sample = await measure(operation)
                assert len(review['listings']) == 5 and not review['exceptions']
                assert not review['continue_preparation'] and not review['approval_current'] and not fake.calls
                assert reads == 20 and bytes_read == 2 * sum(sizes)
                sample.update(photo_reads=reads, original_bytes_read=bytes_read,
                              photo_read_seconds=read_seconds, policy_reads=len(fake.policy_reads))
                samples.append(sample)
    asyncio.run(run())
    return {'samples': samples,
        'median_seconds': statistics.median(x['elapsed_seconds'] for x in samples),
        'median_max_event_loop_delay_seconds': statistics.median(x['max_event_loop_delay_seconds'] for x in samples),
        'max_sampled_rss_bytes': max(x['sampled_peak_rss_bytes'] for x in samples)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-root')
    parser.add_argument('--worker-root')
    parser.add_argument('--fixtures')
    parser.add_argument('--repeats', type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 10:
        parser.error('Use 1–10 repetitions')
    if args.worker_root:
        if not args.fixtures:
            parser.error('--fixtures is required for a worker')
        print(json.dumps(worker(args)))
        return
    if not args.baseline_root:
        parser.error('--baseline-root is required')
    from PIL import Image
    from importlib.metadata import version
    result = {'baseline_github_commit': '656c0edca45cefe7ed99342bc8b6405cda42fdd9',
        'scope': 'synthetic five-draft service preparation; fake upstream reads; not owner productivity',
        'environment': {'python': platform.python_version(), 'pillow': version('Pillow'),
                        'cryptography': version('cryptography'), 'system': platform.system()},
        'repeats': args.repeats, 'heartbeat_period_ms': 5, 'rss_sampling_ms': 2, 'workloads': []}
    with tempfile.TemporaryDirectory() as folder:
        for label, dimensions in [('small', (600, 800)), ('12mp', (3000, 4000))]:
            fixtures = []
            for index in range(10):
                image = Image.frombytes('RGB', dimensions,
                    random.Random(index).randbytes(dimensions[0] * dimensions[1] * 3))
                path = Path(folder) / f'{index}.jpeg'
                try:
                    image.save(path, format='JPEG', quality=88)
                finally:
                    image.close()
                raw = path.read_bytes()
                fixtures.append({'bytes': len(raw), 'sha256': sha256(raw).hexdigest()})
            runs = {}
            for name, root in [('baseline', args.baseline_root), ('candidate', Path(__file__).resolve().parents[1])]:
                runs[name] = json.loads(subprocess.check_output([sys.executable, str(Path(__file__).resolve()),
                    '--worker-root', str(root), '--fixtures', folder, '--repeats', str(args.repeats)], text=True))
            result['workloads'].append({'label': label, 'dimensions': dimensions,
                                       'jpeg_quality': 88, 'fixtures': fixtures, 'runs': runs})
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
