"""Decoded pixels must be released before encryption, including failed decodes."""
from hashlib import sha256
from io import BytesIO

from cryptography.fernet import Fernet
from PIL import Image
import pytest

from btco_ebay.photos import PhotoStore
from btco_ebay.store import Store


@pytest.mark.parametrize('format', ['JPEG', 'PNG'])
def test_decoded_pixels_released_before_encryption_and_original_preserved(tmp_path, monkeypatch, format):
    output = BytesIO()
    with Image.new('RGB', (600, 800), 'green') as image:
        image.save(output, format=format)
    data = output.getvalue()
    photos = PhotoStore(Store(str(tmp_path / 'photos.sqlite3'), Fernet.generate_key().decode()))
    opened, encryptions = [], []
    normal_open, normal_encrypt = Image.open, photos.store.cipher.encrypt
    def tracked_open(*args, **kwargs):
        image = normal_open(*args, **kwargs)
        opened.append(image)
        return image
    def encrypt(raw):
        # Holding a reference proves cleanup is explicit, not incidental GC.
        assert len(opened) == 2
        with pytest.raises(ValueError, match='closed image'):
            opened[-1].getpixel((0, 0))
        encryptions.append(len(raw))
        return normal_encrypt(raw)
    monkeypatch.setattr(Image, 'open', tracked_open)
    monkeypatch.setattr(photos.store.cipher, 'encrypt', encrypt)
    photo = photos.put('seller', data, sha256(data).hexdigest(), 'front')
    assert encryptions and encryptions[0] == len(data)
    assert photos.get('seller', photo) == data


def test_failed_decode_releases_pixels_and_never_stores_photo(tmp_path, monkeypatch):
    output = BytesIO()
    with Image.new('RGB', (600, 800), 'green') as image:
        image.save(output, format='JPEG')
    data = output.getvalue()
    photos = PhotoStore(Store(str(tmp_path / 'photos.sqlite3'), Fernet.generate_key().decode()))
    normal_open, opened = Image.open, []
    def tracked_open(*args, **kwargs):
        image = normal_open(*args, **kwargs)
        opened.append(image)
        if len(opened) == 2:
            normal_load = image.load
            def failed_load(*a, **kw):
                normal_load(*a, **kw)
                raise OSError('Synthetic decoder failure after allocation')
            image.load = failed_load
        return image
    monkeypatch.setattr(Image, 'open', tracked_open)
    with pytest.raises(ValueError, match='Invalid or unsafe'):
        photos.put('seller', data, sha256(data).hexdigest(), 'front')
    with pytest.raises(ValueError, match='closed image'):
        opened[-1].getpixel((0, 0))
    assert not list(photos.root.rglob('*.jpeg'))
    assert photos.list('seller')['records'] == []
