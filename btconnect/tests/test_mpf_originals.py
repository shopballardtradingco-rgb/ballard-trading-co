"""Phone JPEG/MPF originals survive the real raw-upload boundary unchanged."""
from hashlib import sha256
from io import BytesIO

from PIL import Image
import pytest

from btco_ebay.config import SCOPE, WRITE_SCOPE
from btco_ebay.photos import PhotoStore
from test_connector import env, connect, tool


def original(frames=2, format="MPO"):
    pictures = [Image.new("RGB", (800, 600), (10 + i * 30, 40, 80)) for i in range(frames)]
    out = BytesIO()
    pictures[0].save(out, format=format, save_all=True, append_images=pictures[1:])
    for picture in pictures:
        picture.close()
    return out.getvalue()


def test_raw_upload_retains_complete_mpf_original_and_checksum(env):
    client, provider, _, _ = env
    _, tokens = connect(env, scope=SCOPE + " " + WRITE_SCOPE)
    data = original()
    with Image.open(BytesIO(data)) as photo:
        assert photo.format == "MPO" and photo.n_frames == 2
    digest = sha256(data).hexdigest()
    ticket = tool(client, tokens["access_token"], "begin_photo_upload",
                  {"role": "front", "sha256_hex": digest, "size_bytes": len(data)})
    response = client.post("/photos/upload", content=data,
                           headers={"Authorization": "Bearer " + ticket["upload_token"],
                                    "Content-Type": "application/octet-stream"})
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["storage_sha256_verified"] and saved["photo"]["sha256_hex"] == digest
    assert saved["photo"]["object_key"].endswith(".jpeg")
    photos = PhotoStore(provider.store)
    assert photos.get("seller-123", saved["photo"]) == data
    assert photos.put("seller-123", data, digest, "front").object_key == saved["photo"]["object_key"]


@pytest.mark.parametrize("data", [original(frames=3), original(format="PNG"), original()[:-200]])
def test_unsupported_sequence_or_corrupt_auxiliary_is_not_stored(env, data):
    photos = PhotoStore(env[1].store)
    with pytest.raises(ValueError):
        photos.put("seller-123", data, sha256(data).hexdigest(), "front")
    assert not list(photos.root.rglob("*.jpeg"))
