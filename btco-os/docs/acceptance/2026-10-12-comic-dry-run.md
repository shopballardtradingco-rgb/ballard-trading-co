# Elementals original-photo controlled test — October 12, 2026

Result: passed in an isolated local instance of connector 0.3.0, corresponding to canonical connector commit `c04970df98dbca950937e5a6bb8fe8f5f66b3286`. The original Elementals #6 front and back photographs were used. All eBay responses were simulated. This is not live publication acceptance.

## Original-photo checks

- Both original JPEGs passed the actual MCP upload-ticket and HTTP ingestion routes: 847,590 and 899,607 bytes, each 1152 × 1536 pixels.
- Encrypted objects decrypted to the exact original bytes, including after recreating the application against its test storage. Stored files had mode 0600 and contained no plaintext original image.
- Reuploading through a new ticket returned the same object reference without creating a duplicate object. Reusing a consumed ticket was rejected.
- Public object-path access and reads as a different seller were rejected.
- The real eBay Media adapter produced multipart requests containing the unchanged original bytes, inspected by a mock transport. No request reached live eBay.
- Source-photo hashes were unchanged after testing. Temporary encrypted objects, keys, and databases were removed; this test did not ingest photos into production storage.

## Approval and retry checks

A draft containing only the known Elementals identity, $8 price, and original photo references was rejected because required reviewed listing fields were absent. No condition details or approved description were invented. No real listing approval was recorded. Publication with the disabled gate was rejected before any eBay mutation.

Focused synthetic approval, duplicate-claim, material-change, uncertain-write, and delayed-visibility regressions also passed: **19 passed, 21 deselected**.

```sh
python -m pytest -q tests/test_listings.py -k 'lost_success or unknown_write or every_material or approval_hash or duplicate_claims or missing_approval or delayed_visibility'
```

## Production boundary and remaining work

Authenticated production status still reported connector 0.3.0, read-only mode, and publication disabled. No new account permissions, production image uploads, live eBay writes, or Vault writes occurred during this test.

Live acceptance still requires approved eBay listing permissions, recovery of the exact previously approved descriptions and complete reviewed listing material, production photo ingestion, and receipt-to-Vault reconciliation. No pilot item ID or live URL exists from this test.
