"""Isolated original-photo ingestion measurements; synthetic files, no network."""
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

from benchmark_connect_workloads import measure


def worker(args):
    sys.path.insert(0, str(Path(args.worker_root).resolve()))
    from types import SimpleNamespace
    from cryptography.fernet import Fernet
    from btco_ebay.config import Settings, SCOPE, WRITE_SCOPE
    from btco_ebay.server import build_app
    from btco_ebay.photos import PhotoStore, MAX_PHOTO_BYTES
    import btco_ebay.listing_tools as listing_tools

    data = Path(args.photo).read_bytes()
    assert 0 < len(data) <= MAX_PHOTO_BYTES
    with tempfile.TemporaryDirectory() as folder:
        settings = Settings('https://connector.example', 'synthetic', 'synthetic', 'synthetic',
            Fernet.generate_key().decode(), str(Path(folder) / 'records.sqlite3'))
        _, provider, mcp = build_app(settings)
        provider.store.put('grant', 'family', {'user_id': 'seller'})
        listing_tools.get_access_token = lambda: SimpleNamespace(family='family', scopes=[SCOPE, WRITE_SCOPE])
        async def fetch(*a, **kw):
            return data
        listing_tools.download_original = fetch
        async def run():
            async def operation():
                return await mcp.call_tool('ingest_original_photo', {'file': {
                    'download_url': 'https://files.oaiusercontent.com/synthetic',
                    'file_id': 'synthetic'}, 'role': 'front'})
            result, sample = await measure(operation)
            # Read this executable's kernel high-water mark. getrusage can retain
            # a parent's pre-exec peak and contaminate an isolated child result.
            # Startup/input loading are included; fixture generation is not.
            status = Path('/proc/self/status').read_text().splitlines()
            sample['process_high_water_rss_bytes'] = int(next(
                line.split()[1] for line in status if line.startswith('VmHWM:'))) * 1024
            record = result[1] if isinstance(result, tuple) else json.loads(result[0].text)
            assert record['storage_sha256_verified']
            assert record['photo']['sha256_hex'] == sha256(data).hexdigest()
            assert PhotoStore(provider.store).get('seller', record['photo']) == data
            return sample
        return asyncio.run(run())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-root')
    parser.add_argument('--baseline-commit', default='88a1cfa17860d6ee13059a47e5b4ff1e0d63b51b')
    parser.add_argument('--worker-root')
    parser.add_argument('--photo')
    parser.add_argument('--repeats', type=int, default=5)
    args = parser.parse_args()
    if platform.system() != 'Linux':
        parser.error('Linux is required for comparable RSS measurements')
    if not 1 <= args.repeats <= 10:
        parser.error('Use 1–10 repetitions')
    if args.worker_root:
        if not args.photo:
            parser.error('--photo is required for a worker')
        print(json.dumps(worker(args)))
        return
    if not args.baseline_root:
        parser.error('--baseline-root is required')

    from PIL import Image, __version__ as pillow_version
    from importlib.metadata import version
    result = {'scope': 'isolated synthetic MCP original ingestion; no live calls or owner-time claim',
        'baseline_github_commit': args.baseline_commit, 'repeats': args.repeats,
        'python': platform.python_version(), 'pillow': pillow_version,
        'cryptography': version('cryptography'), 'heartbeat_period_ms': 5,
        'rss_sampling_ms': 2, 'process_per_sample': True, 'workloads': []}
    with tempfile.TemporaryDirectory() as folder:
        for label, size, quality in [('12mp', (3000, 4000), 88), ('40mp', (5000, 8000), 10)]:
            path = Path(folder) / (label + '.jpeg')
            image = Image.frombytes('RGB', size, random.Random(42).randbytes(size[0]*size[1]*3))
            try:
                image.save(path, format='JPEG', quality=quality)
            finally:
                image.close()
            row = {'label': label, 'dimensions': size, 'jpeg_quality': quality,
                   'input_bytes': path.stat().st_size, 'input_sha256': sha256(path.read_bytes()).hexdigest(),
                   'runs': {'baseline': [], 'candidate': []}}
            roots = {'baseline': args.baseline_root, 'candidate': Path(__file__).resolve().parents[1]}
            for _ in range(args.repeats):
                # Interleave versions and start a fresh process for every sample.
                for name, root in roots.items():
                    row['runs'][name].append(json.loads(subprocess.check_output([
                        sys.executable, str(Path(__file__).resolve()), '--worker-root', str(root),
                        '--photo', str(path)], text=True)))
            row['summary'] = {name: {
                'median_seconds': statistics.median(x['elapsed_seconds'] for x in samples),
                'median_max_event_loop_delay_seconds': statistics.median(x['max_event_loop_delay_seconds'] for x in samples),
                'median_sampled_peak_rss_bytes': statistics.median(x['sampled_peak_rss_bytes'] for x in samples),
                'max_sampled_peak_rss_bytes': max(x['sampled_peak_rss_bytes'] for x in samples),
                'max_process_high_water_rss_bytes': max(x['process_high_water_rss_bytes'] for x in samples),
            } for name, samples in row['runs'].items()}
            result['workloads'].append(row)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
