"""Existing encrypted records remain usable when additive indexes are installed."""
import time

from cryptography.fernet import Fernet

from btco_ebay.listing_store import ListingStore
from btco_ebay.photos import PhotoStore
from btco_ebay.store import Store, digest


def test_existing_database_upgrade_keeps_data_and_expiry_cleanup_bounded(tmp_path):
    key = Fernet.generate_key().decode()
    path = str(tmp_path / 'old.sqlite3')
    old = Store(path, key)
    with old.tx() as db:
        db.execute('DROP INDEX expiry_idx')  # The previous release has no expiry index.
        for i in range(10000):
            old.put('saved', str(i), {'seller': 'owner', 'value': i}, db=db)
        old.put('token', 'valid', {'value': 'valid'}, expires=time.time()+3600, db=db)
        old.put('token', 'expired', {'value': 'expired'}, expires=time.time()-1, db=db)
        before = db.execute('SELECT data FROM records WHERE kind=? AND id=?', ('saved', digest('9999'))).fetchone()[0]
    upgraded = Store(path, key)
    assert upgraded.get('saved', '9999')['value'] == 9999
    assert upgraded.get('token', 'expired') is None
    assert upgraded.get('token', 'valid') == {'value': 'valid'}
    with upgraded.read() as db:
        assert before == db.execute('SELECT data FROM records WHERE kind=? AND id=?', ('saved', digest('9999'))).fetchone()[0]
    # Count virtual-machine work rather than asserting machine-dependent timings.
    import sqlite3
    with sqlite3.connect(path) as db:
        steps = []
        db.set_progress_handler(lambda: steps.append(1) or 0, 100)
        db.execute('DELETE FROM records WHERE expires > 0 AND expires < ?', (time.time(),))
        assert len(steps) < 10  # Full scan would visit all 10,000 permanent records.
    assert Store(path, key).get('token', 'valid')  # Repeated startup is idempotent.


def test_draft_catalog_upgrade_is_ordered_seller_bound_and_bounded(tmp_path):
    store = Store(str(tmp_path / 'old.sqlite3'), Fernet.generate_key().decode())
    repo = ListingStore(store, PhotoStore(store))
    with store.tx() as db:
        db.execute('DROP INDEX listing_catalog_idx')
        db.executemany('INSERT INTO listing_claims VALUES(?,?,?,?)', [
            (digest(seller), kind, digest(str(i)), f'draft-{i:05d}')
            for seller in ('owner', 'someone-else') for i in range(10000) for kind in ('item', 'sku', 'photo')])
        for i in range(8001, 8022):
            store.put('listing', repo.key('owner', f'draft-{i:05d}'), {'draft_id': f'draft-{i:05d}'}, db=db)
    upgraded = ListingStore(store, PhotoStore(store))
    rows, cursor = upgraded.list('owner', 'draft-08000', 20)
    assert [r['draft_id'] for r in rows] == [f'draft-{i:05d}' for i in range(8001, 8021)]
    assert cursor == 'draft-08020'
    with store.read() as db:
        steps = []
        db.set_progress_handler(lambda: steps.append(1) or 0, 100)
        ids = list(db.execute('SELECT DISTINCT draft_id FROM listing_claims WHERE seller=? AND draft_id>? ORDER BY draft_id LIMIT ?',
            (digest('owner'), 'draft-08000', 21)))
        assert len(ids) == 21 and len(steps) < 30
        assert db.execute('SELECT COUNT(*) FROM listing_claims').fetchone()[0] == 60000
