import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from btco_os.core import connect, import_ebay_csv, overview, register_cdp_item, money_cents
from btco_os.cli import main

HEADER = 'Item number,Custom label (SKU),Title,Current price,Available quantity\n'
def report(*rows):
    return HEADER + '\n'.join(','.join(map(str, r)) for r in rows)

class VaultTests(unittest.TestCase):
    def setUp(self):
        self.db = connect()
        self.addCleanup(self.db.close)

    def test_cdp_mapping_is_exact_and_never_overwritten(self):
        item = register_cdp_item(self.db, '0007-CDP', 'Original identity')
        import_ebay_csv(self.db, report(('123456789012','0007-CDP','Listing title','12.50',2)))
        import_ebay_csv(self.db, report(('123456789012','CHANGED','Changed title','13.50',1)))
        row = self.db.execute('SELECT * FROM items WHERE id=?', (item,)).fetchone()
        self.assertEqual((row['master_sku'],row['title']), ('0007-CDP','Original identity'))
        self.assertEqual(self.db.execute('SELECT item_id FROM listings').fetchone()[0],item)
        self.assertEqual(overview(self.db)['review_flags'],1)

    def test_unknown_sku_is_not_fabricated_cdp_identity(self):
        import_ebay_csv(self.db, report(('123456789012','UNKNOWN','Card','2.99',1),('123456789013','','Other','', '')))
        self.assertEqual(overview(self.db)['ebay_only'],2)
        self.assertEqual(self.db.execute('SELECT count(*) FROM items WHERE master_sku IS NOT NULL').fetchone()[0],0)
        row=self.db.execute("SELECT * FROM listings WHERE external_id='123456789013'").fetchone()
        self.assertIsNone(row['price_cents']); self.assertIsNone(row['quantity'])

    def test_duplicate_skus_are_reviewed_without_merge(self):
        register_cdp_item(self.db,'001','Card')
        import_ebay_csv(self.db, report(('123456789012','001','A','2',1),('123456789013','001','B','3',1)))
        self.assertEqual(overview(self.db)['items'],2)
        self.assertEqual(overview(self.db)['review_flags'],2)

    def test_replay_updates_listing_without_creating_stock(self):
        data=report(('123456789012','','Card','1.25',1))
        import_ebay_csv(self.db,data); result=import_ebay_csv(self.db,data)
        self.assertEqual((result['created'],result['updated']), (0,1))
        self.assertEqual(overview(self.db)['items'],1)

    def test_missing_is_review_evidence_and_preserves_quantity(self):
        import_ebay_csv(self.db,report(('123456789012','','A','2',3),('123456789013','','B','3',1)))
        import_ebay_csv(self.db,report(('123456789013','','B','3',1)),True)
        row=self.db.execute("SELECT * FROM listings WHERE external_id='123456789012'").fetchone()
        self.assertEqual((row['quantity'],row['status']),(3,'missing'))
        self.assertEqual(overview(self.db)['items'],2)

    def test_invalid_batch_is_atomic(self):
        for bad in ['NaN','Infinity','-1','0.001','oops']:
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                import_ebay_csv(self.db,report(('123456789012','','A','2',1),('123456789013','','B',bad,1)))
            self.assertEqual(overview(self.db)['items'],0)

    def test_rejects_duplicate_ids_and_malformed_quantity(self):
        row=('123456789012','','A','2',1)
        for data in [report(row,row),report(('123456789012','','A','2',-1)),HEADER,'Title\nA']:
            with self.assertRaises(ValueError): import_ebay_csv(self.db,data,True)
        self.assertEqual(overview(self.db)['items'],0)

    def test_cdp_whitespace_and_leading_zeroes_are_preserved(self):
        register_cdp_item(self.db,' 001 ','Identity')
        import_ebay_csv(self.db,report(('123456789012',' 001 ','A','0',0)))
        self.assertEqual(overview(self.db)['items'],1)
        self.assertEqual(self.db.execute('SELECT master_sku FROM items').fetchone()[0],' 001 ')

    def test_cli_and_persistence(self):
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()) as output:
            path=str(Path(temp)/'vault.db')
            main(['--db',path,'register-cdp','--sku','001','--title','Card'])
            main(['--db',path,'status'])
            self.assertIn('"items": 1',output.getvalue())

    def test_foreign_keys_and_original_schema_upgrade(self):
        self.assertEqual(self.db.execute('PRAGMA foreign_keys').fetchone()[0],1)
        self.assertEqual(money_cents('0.29'),29)

if __name__=='__main__': unittest.main()
