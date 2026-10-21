"""Durable checkpoints remain exact while redundant batch writes are removed."""
import asyncio
from io import BytesIO

import pytest
from PIL import Image

from test_listings import bundle as bundle
from test_listing_batches import setup


def hundred(bundle, monkeypatch):
    # Lossless colors avoid both RGB clamping and JPEG quantization collisions.
    def unique(color):
        out = BytesIO()
        Image.new('RGB', (600, 800), tuple(c % 256 for c in color)).save(out, format='PNG')
        return out.getvalue()
    monkeypatch.setattr('test_listing_batches.original', unique)
    return setup(bundle, count=100)


def test_100_drafts_have_one_checkpoint_per_attempt_and_recover_after_cancel(bundle, monkeypatch):
    batches, fake, payload = hundred(bundle, monkeypatch)
    batches.submit('seller', payload)
    written = []
    normal = batches.write
    def write(row, db=None):
        normal(row, db)
        written.append(len(row['results']))
        if written == [1]:
            # Deliver cancellation at the actual durable boundary, independent
            # of how many awaited photo checks preceded the checkpoint.
            asyncio.get_running_loop().call_soon(asyncio.current_task().cancel)
    monkeypatch.setattr(batches, 'write', write)
    async def run():
        # First item must be durable before the yield delivers cancellation.
        task = asyncio.create_task(batches.prepare('seller', 'family', payload['batch_id']))
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(batches.review('seller', payload['batch_id'])['listings']) == 1
        while True:
            review = await batches.prepare('seller', 'family', payload['batch_id'])
            if not review['continue_preparation']:
                break
        assert len(review['listings']) == 100 and not review['exceptions']
    asyncio.run(run())
    assert written == list(range(1, 101)) and not fake.calls
    row = batches.get('seller', payload['batch_id'])
    assert row['preparation_metrics']['attempts'] == 100
    assert row['preparation_metrics']['calls'] == 6  # cancelled first call + five bounded resumes
    assert not row['approval'] and not row['publication_started']


def test_100_unresolved_items_need_one_write_and_preserve_review(bundle, monkeypatch):
    batches, _, payload = hundred(bundle, monkeypatch)
    for entry in payload['items']:
        entry.pop('draft')
        entry['unresolved_reason'] = 'Synthetic missing evidence requires owner review.'
    batches.submit('seller', payload)
    normal, writes = batches.write, []
    def write(row, db=None):
        writes.append(1)
        normal(row, db)
    monkeypatch.setattr(batches, 'write', write)
    async def run():
        first = await batches.prepare('seller', 'family', payload['batch_id'])
        assert len(writes) == 1 and len(first['exceptions']) == 100
        second = await batches.prepare('seller', 'family', payload['batch_id'])
        assert len(writes) == 2 and second['review_revision'] == first['review_revision']
        assert first['exceptions'] == second['exceptions']
    asyncio.run(run())


def test_larger_default_chunk_still_respects_time_budget(bundle):
    batches, fake, payload = setup(bundle)
    batches.submit('seller', payload)
    normal = fake.validate_policies
    async def slow(*args):
        await asyncio.sleep(0.1)
        return await normal(*args)
    fake.validate_policies = slow
    async def run():
        review = await batches.prepare('seller', 'family', payload['batch_id'], timeout=0.01)
        assert len(review['exceptions']) == 1 and len(review['preparation_pending']) == 2
        assert batches.get('seller', payload['batch_id'])['preparation_metrics']['attempts'] == 1
        fake.validate_policies = normal
        review = await batches.prepare('seller', 'family', payload['batch_id'])
        assert len(review['listings']) == 3 and not review['exceptions'] and not fake.calls
    asyncio.run(run())
