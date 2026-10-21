"""Vault persistence. Listing observations never establish CDP identity or stock."""
import csv
import io
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

DDL = """
CREATE TABLE IF NOT EXISTS items (
 id INTEGER PRIMARY KEY, master_sku TEXT UNIQUE, title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
 id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id),
 channel TEXT NOT NULL, external_id TEXT NOT NULL, source_sku TEXT,
 title TEXT NOT NULL, price_cents INTEGER, quantity INTEGER,
 status TEXT NOT NULL DEFAULT 'active', last_seen TEXT NOT NULL,
 UNIQUE(channel, external_id)
);
CREATE TABLE IF NOT EXISTS review_flags (
 listing_id INTEGER NOT NULL REFERENCES listings(id),
 reason TEXT NOT NULL, observed_at TEXT NOT NULL,
 PRIMARY KEY(listing_id, reason)
);
"""


def connect(path=":memory:"):
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(DDL)
    return db


def money_cents(value):
    if value is None or value == "":
        return None
    try:
        amount = Decimal(str(value).replace("$", "").replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError("Invalid price") from exc
    if not amount.is_finite() or amount < 0 or amount > 100000000:
        raise ValueError("Price outside supported range")
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise ValueError("Price must have at most two decimal places")
    return int(cents)


def quantity(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not str(value).isdigit() or int(value) > 1000000:
        raise ValueError("Invalid listing quantity")
    return int(value)


def register_cdp_item(db, master_sku, title):
    """Explicit reviewed CDP input only. Preserve the exact supplied SKU bytes."""
    if not isinstance(master_sku, str) or not master_sku.strip() or len(master_sku) > 4000:
        raise ValueError("A confirmed nonempty CDP master SKU is required")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Title is required")
    with db:
        existing = db.execute("SELECT id FROM items WHERE master_sku=?", (master_sku,)).fetchone()
        if existing:
            return existing[0]
        return db.execute("INSERT INTO items(master_sku,title) VALUES(?,?)", (master_sku, title)).lastrowid


def _flag(db, listing_id, reason, now):
    db.execute("INSERT OR IGNORE INTO review_flags VALUES(?,?,?)", (listing_id, reason, now))


def _apply_records(db, records, full_snapshot, now):
    """Caller owns transaction; no implicit commits so imports can roll back."""
    created = updated = missing = 0
    for listing_id, sku, title, price, qty in records:
        existing = db.execute("SELECT * FROM listings WHERE channel='ebay' AND external_id=?", (listing_id,)).fetchone()
        if existing:
            if existing['source_sku'] != (sku or None):
                _flag(db, existing['id'], 'listing_sku_changed', now)
            db.execute("""UPDATE listings SET source_sku=?,title=?,price_cents=?,quantity=?,
                       status='active',last_seen=? WHERE id=?""",
                       (sku or None, title, price, qty, now, existing['id']))
            updated += 1
        else:
            item = db.execute("SELECT id FROM items WHERE master_sku=?", (sku,)).fetchone() if sku else None
            # A reused marketplace alias does not prove the same physical copy.
            collisions = db.execute("SELECT id FROM listings WHERE source_sku=? AND source_sku<>''", (sku,)).fetchall() if sku else []
            item_id = item['id'] if item and not collisions else db.execute(
                "INSERT INTO items(master_sku,title) VALUES(NULL,?)", (title,)).lastrowid
            row_id = db.execute("""INSERT INTO listings
                (item_id,channel,external_id,source_sku,title,price_cents,quantity,last_seen)
                VALUES (?,'ebay',?,?,?,?,?,?)""", (item_id, listing_id, sku or None, title, price, qty, now)).lastrowid
            if collisions:
                for other in [row_id] + [r[0] for r in collisions]:
                    _flag(db, other, 'duplicate_marketplace_sku', now)
            created += 1
    if full_snapshot:
        seen = {r[0] for r in records}
        for row in db.execute("SELECT id,external_id FROM listings WHERE channel='ebay'").fetchall():
            if row['external_id'] not in seen:
                # Absence is evidence for review, never an inferred sale/deletion.
                db.execute("UPDATE listings SET status='missing' WHERE id=?", (row['id'],))
                _flag(db, row['id'], 'not_observed_in_complete_collection', now)
                missing += 1
    return {'processed': len(records), 'created': created, 'updated': updated, 'missing': missing}


def import_ebay_csv(db, content, full_snapshot=False):
    reader = csv.DictReader(io.StringIO(content.lstrip('\ufeff')))
    if not set(reader.fieldnames or []) & {'Item number', 'Item ID', 'Listing ID'}:
        raise ValueError('Missing eBay listing ID column')
    def get(row, *keys):
        return next((row[k] for k in keys if row.get(k) not in (None, '')), '')
    records = []
    for row in reader:
        if not any(row.values()):
            continue
        listing_id = get(row, 'Item number', 'Item ID', 'Listing ID').strip()
        if not listing_id.isdigit() or not 9 <= len(listing_id) <= 15:
            raise ValueError('Invalid or missing eBay listing ID')
        sku = get(row, 'Custom label (SKU)', 'Custom label', 'SKU')
        title = get(row, 'Title', 'Item title').strip()
        if not title:
            raise ValueError('Listing title is required')
        currency = get(row, 'Currency', 'Currency code')
        if currency and currency != 'USD':
            raise ValueError('Only USD reports are supported')
        records.append((listing_id, sku, title, money_cents(get(row, 'Current price', 'Price')),
                        quantity(get(row, 'Available quantity', 'Quantity'))))
    ids = [r[0] for r in records]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate listing IDs')
    if full_snapshot and not ids:
        raise ValueError('Empty full CSV snapshot refused')
    with db:
        return _apply_records(db, records, full_snapshot, datetime.now(timezone.utc).isoformat())


def overview(db):
    return {
        'items': db.execute('SELECT count(*) FROM items').fetchone()[0],
        'active_ebay_listings': db.execute("SELECT count(*) FROM listings WHERE channel='ebay' AND status='active'").fetchone()[0],
        'ebay_only': db.execute("SELECT count(*) FROM items i WHERE master_sku IS NULL AND EXISTS (SELECT 1 FROM listings l WHERE l.item_id=i.id AND channel='ebay')").fetchone()[0],
        'review_flags': db.execute('SELECT count(*) FROM review_flags').fetchone()[0],
    }
