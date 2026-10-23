"""Private encrypted object storage on the existing persistent volume.

Original bytes are never resized, re-encoded, publicly served, or placed in source.
Content-addressed objects are immutable and seller-bound. The 400 MB encrypted-photo quota uses existing capacity while reserving room for the OAuth
and listing databases on the existing 500 MB volume. The independent 50 MB
free-space reserve still applies. See docs/STORAGE-BUDGET-2026-10-17.md.
"""

from contextlib import closing
import hashlib
import io
import os
from pathlib import Path
import secrets
import shutil
import time
import warnings
from PIL import Image
from .listing_drafts import Photo
from .blocking import BlockingWork

MAX_PHOTO_BYTES = 12_000_000
DEFAULT_QUOTA = 400_000_000
FREE_DISK_RESERVE_BYTES = 50_000_000


class PhotoStore:
    def __init__(self, store, root=None, quota=DEFAULT_QUOTA):
        self.store = store
        self.root = Path(root or Path(store.path).parent / "listing-objects")
        self.quota = quota
        self.work = BlockingWork()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)

    @staticmethod
    def owner_key(seller):
        return hashlib.sha256(seller.encode()).hexdigest()

    def encrypted_usage(self):
        return sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file())

    def capacity(self):
        """Read upload headroom using the same limits as put; reserve no bytes.

        Other writes can change this snapshot. Count stored ciphertext, including
        unindexed files, rather than estimating space from the photo catalog.
        """
        try:
            used = self.encrypted_usage()
            free = shutil.disk_usage(self.root).free
        except OSError:
            # Filesystem diagnostics can contain private paths. No missing
            # measurement may be interpreted as an empty store or free capacity.
            return {"status": "unavailable", "quota_bytes": self.quota,
                    "free_disk_reserve_bytes": FREE_DISK_RESERVE_BYTES,
                    "available_encrypted_bytes": None,
                    "reason": "Storage capacity could not be measured; retry the readiness check."}
        quota_remaining = max(0, self.quota - used)
        disk_remaining = max(0, free - FREE_DISK_RESERVE_BYTES)
        available = min(quota_remaining, disk_remaining)
        return {"status": "available" if available else "full",
                "quota_bytes": self.quota, "encrypted_bytes_used": used,
                "quota_remaining_bytes": quota_remaining, "disk_free_bytes": free,
                "free_disk_reserve_bytes": FREE_DISK_RESERVE_BYTES,
                "disk_upload_headroom_bytes": disk_remaining,
                "available_encrypted_bytes": available,
                "limiting_factor": "photo_quota" if quota_remaining <= disk_remaining else "disk_reserve",
                "snapshot_only": True,
                "meaning": "Encrypted-byte headroom, not original-file bytes. Uploads recheck limits; this read reserves no capacity."}

    def put(self, seller, data, expected_sha256, role, *, file_name=None, file_id=None, grant_family=None):
        if not 0 < len(data) <= MAX_PHOTO_BYTES:
            raise ValueError("Photograph exceeds the 12 MB limit")
        actual = hashlib.sha256(data).hexdigest()
        if actual != expected_sha256:
            raise ValueError("Original photo checksum mismatch")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with closing(Image.open(io.BytesIO(data))) as im:
                    if (
                        im.format not in ("JPEG", "PNG")
                        or getattr(im, "n_frames", 1) != 1
                    ):
                        raise ValueError("Use an original JPEG or single-frame PNG")
                    if (
                        max(im.size) < 500
                        or sum(im.size) > 15000
                        or im.width * im.height > 40_000_000
                    ):
                        raise ValueError(
                            "Photo dimensions are outside the supported range"
                        )
                    extension = "jpeg" if im.format == "JPEG" else "png"
                    im.verify()
                # Pillow's normal context manager closes the file, not decoded
                # pixels. Release that buffer before encryption/storage, even if
                # load fails, while preserving the untouched original bytes.
                with closing(Image.open(io.BytesIO(data))) as im:
                    im.load()  # Reject truncated/corrupt pixel data without changing the bytes.
        except (
            OSError,
            SyntaxError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ):
            raise ValueError("Invalid or unsafe original image") from None
        key = f"photos/{self.owner_key(seller)}/{actual}.{extension}"
        photo = Photo(object_key=key, sha256_hex=actual, role=role)
        path = self.root / key
        encrypted = self.store.cipher.encrypt(data)
        with self.store.tx() as db:
            if grant_family is not None:
                grant = self.store.get("grant", grant_family, db=db)
                if not grant or grant.get("user_id") != seller:
                    raise ValueError("Seller connection expired during photo transfer")
            if path.exists():
                if self.get(seller, photo) != data:
                    raise ValueError("Stored original failed integrity verification")
                self.catalog(seller, photo, len(data), file_name, file_id, db)
                return photo
            used = self.encrypted_usage()
            if (
                used + len(encrypted) > self.quota
                or shutil.disk_usage(self.root).free < len(encrypted) + FREE_DISK_RESERVE_BYTES
            ):
                raise ValueError(
                    "Photo storage capacity reached; approve additional storage before ingesting more"
                )
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temp = path.with_name(".upload-" + secrets.token_hex(16))
            try:
                fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(encrypted)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temp, path)
                directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                temp.unlink(missing_ok=True)
            self.catalog(seller, photo, len(data), file_name, file_id, db)
        return photo

    def catalog(self, seller, photo, size, file_name, file_id, db):
        row = self.store.get("photo", photo.object_key, db=db) or {
            "seller": seller, "sha256": photo.sha256_hex, "bytes": size,
            "created_at": time.time(),
        }
        row["object_key"] = photo.object_key
        row["roles"] = sorted(set(row.get("roles", [])) | {photo.role})
        # Never persist temporary download URLs. Metadata is not proof of matching.
        for field, value in (("original_filenames", file_name), ("source_file_ids", file_id)):
            if value:
                values = row.setdefault(field, [])
                if value not in values and len(values) < 20:
                    values.append(value[:255])
        self.store.put("photo", photo.object_key, row, db=db)

    def list(self, seller, after="", limit=50):
        page = self.store.list_owned("photo", seller, after, limit)
        records = []
        for row in page["records"]:
            key = row.get("object_key")
            if key is None:
                # Legacy metadata retains the checksum but not the extension/role.
                prefix = f"photos/{self.owner_key(seller)}/{row['sha256']}"
                keys = [prefix + "." + ext for ext in ("jpeg", "png")
                        if (self.root / (prefix + "." + ext)).is_file()]
                key = keys[0] if len(keys) == 1 else None
            records.append({"object_key": key, "sha256_hex": row["sha256"],
                            "size_bytes": row["bytes"], "created_at": row["created_at"],
                            "recorded_roles": row.get("roles", []),
                            "original_filenames": row.get("original_filenames", []),
                            "source_file_ids": row.get("source_file_ids", []),
                            "integrity_checked_this_read": False})
        return {"records": records, "next_cursor": page["next_cursor"]}

    def verify(self, seller, photos):
        """Freshly verify originals one at a time without retaining image bytes."""
        for photo in photos:
            self.get(seller, photo)

    def get(self, seller, photo):
        photo = Photo.model_validate(photo) if isinstance(photo, dict) else photo
        expected = f"photos/{self.owner_key(seller)}/{photo.sha256_hex}."
        if not photo.object_key.startswith(expected):
            raise ValueError("Photo belongs to a different seller or checksum")
        path = self.root / photo.object_key
        if not path.is_file() or path.is_symlink():
            raise ValueError("Original photograph is missing")
        from cryptography.fernet import InvalidToken

        try:
            data = self.store.cipher.decrypt(path.read_bytes())
        except InvalidToken:
            raise ValueError("Stored original failed integrity verification") from None
        if hashlib.sha256(data).hexdigest() != photo.sha256_hex:
            raise ValueError("Stored original failed integrity verification")
        return data

