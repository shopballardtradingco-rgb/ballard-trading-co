"""Sign persisted publication evidence; never sign caller-supplied receipts."""

import base64
import hashlib
import json
import re
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption

DOMAIN = b"BTCo publication receipt v1\0"


class ReceiptSigner:
    def __init__(self, store):
        self.store = store
        # One durable key, encrypted by Store, independent of OAuth grant lifetime.
        with store.tx() as db:
            record = store.get("signing-key", "publication-v1", db=db)
            if record is None:
                key = Ed25519PrivateKey.generate()
                raw = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
                record = {"private_key": base64.b64encode(raw).decode()}
                store.put("signing-key", "publication-v1", record, db=db)
        self.key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(record["private_key"]))
        public = self.key.public_key().public_bytes_raw()
        self.descriptor = {
            "algorithm": "Ed25519",
            "key_id": hashlib.sha256(public).hexdigest(),
            "public_key_b64": base64.b64encode(public).decode(),
        }

    def export(self, seller, item_id):
        if not re.fullmatch(r"[0-9]{9,15}", item_id):
            raise ValueError("Invalid eBay item ID")
        receipt = self.store.get("publication", seller + ":" + item_id)
        if not receipt or receipt.get("seller_id") != seller or receipt.get("item_id") != item_id:
            raise ValueError("No verified publication receipt for this seller and item")
        payload = json.dumps(receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        return {
            "schema": "btco.signed-publication.v1",
            "algorithm": "Ed25519",
            "key_id": self.descriptor["key_id"],
            "payload_b64": base64.b64encode(payload).decode(),
            "signature_b64": base64.b64encode(self.key.sign(DOMAIN + payload)).decode(),
        }
