"""Capacity checks use synthetic originals and never contact a marketplace."""
from hashlib import sha256
from types import SimpleNamespace
import pytest

from btco_ebay.photos import PhotoStore, FREE_DISK_RESERVE_BYTES
from test_connector import env as env, connect, tool
from test_listings import original


def test_capacity_counts_ciphertext_and_unindexed_files_and_replay(env, monkeypatch):
    _, provider, _, _ = env
    photos = PhotoStore(provider.store, quota=1_000_000)
    monkeypatch.setattr("btco_ebay.photos.shutil.disk_usage",
                        lambda _: SimpleNamespace(free=100_000_000))
    raw = original("red")
    photo = photos.put("seller-123", raw, sha256(raw).hexdigest(), "front")
    stored_size = (photos.root / photo.object_key).stat().st_size
    (photos.root / "unindexed-object").write_bytes(b"x" * 123)
    capacity = photos.capacity()
    assert stored_size > len(raw)
    assert capacity["encrypted_bytes_used"] == stored_size + 123
    assert capacity["available_encrypted_bytes"] == 1_000_000 - stored_size - 123
    assert capacity["limiting_factor"] == "photo_quota"
    photos.put("seller-123", raw, sha256(raw).hexdigest(), "back")
    assert photos.capacity() == capacity


def test_capacity_reserves_disk_and_clamps_exhausted_storage(env, monkeypatch):
    _, provider, _, _ = env
    photos = PhotoStore(provider.store)
    monkeypatch.setattr("btco_ebay.photos.shutil.disk_usage",
                        lambda _: SimpleNamespace(free=FREE_DISK_RESERVE_BYTES + 25))
    assert photos.capacity()["available_encrypted_bytes"] == 25
    assert photos.capacity()["limiting_factor"] == "disk_reserve"
    monkeypatch.setattr("btco_ebay.photos.shutil.disk_usage",
                        lambda _: SimpleNamespace(free=FREE_DISK_RESERVE_BYTES - 1))
    assert photos.capacity()["available_encrypted_bytes"] == 0
    assert photos.capacity()["status"] == "full"


def test_capacity_clamps_over_quota_store_without_deleting_files(env, monkeypatch):
    _, provider, _, _ = env
    photos = PhotoStore(provider.store, quota=100)
    (photos.root / "existing-original").write_bytes(b"x" * 101)
    monkeypatch.setattr("btco_ebay.photos.shutil.disk_usage",
                        lambda _: SimpleNamespace(free=100_000_000))
    assert photos.capacity()["status"] == "full"
    assert photos.capacity()["available_encrypted_bytes"] == 0
    assert (photos.root / "existing-original").read_bytes() == b"x" * 101


def test_capacity_measurement_failure_is_unknown_and_redacted(env, monkeypatch):
    _, provider, _, _ = env
    photos = PhotoStore(provider.store)
    def failed(_):
        raise OSError("private-volume-path")
    monkeypatch.setattr("btco_ebay.photos.shutil.disk_usage", failed)
    result = photos.capacity()
    assert result["status"] == "unavailable"
    assert result["available_encrypted_bytes"] is None
    assert "private-volume-path" not in str(result)
    assert "encrypted_bytes_used" not in result


def test_authenticated_readiness_exposes_capacity_without_marketplace_writes(env):
    client, provider, _, state = env
    _, tokens = connect(env)
    result = tool(client, tokens["access_token"], "get_listing_readiness")
    assert result["photo_capacity"]["quota_bytes"] == result["photo_quota_bytes"]
    assert result["photo_capacity"]["snapshot_only"] is True
    assert result["photo_capacity"]["available_encrypted_bytes"] >= 0
    assert str(provider.store.path) not in str(result)
    assert all(r.method == "GET" or "oauth2/token" in str(r.url) for r in state["requests"])


def test_expanded_ceiling_still_enforces_disk_reserve_on_real_ingestion(env, monkeypatch):
    _, provider, _, _ = env
    old = PhotoStore(provider.store, quota=300_000_000)
    current = PhotoStore(provider.store)
    monkeypatch.setattr(PhotoStore, "encrypted_usage", lambda _: 301_000_000)
    monkeypatch.setattr("btco_ebay.photos.shutil.disk_usage",
                        lambda _: SimpleNamespace(free=100_000_000))
    raw = original("red")
    with pytest.raises(ValueError, match="capacity reached"):
        old.put("seller-123", raw, sha256(raw).hexdigest(), "front")
    photo = current.put("seller-123", raw, sha256(raw).hexdigest(), "front")
    assert current.get("seller-123", photo) == raw
    monkeypatch.setattr("btco_ebay.photos.shutil.disk_usage",
                        lambda _: SimpleNamespace(free=FREE_DISK_RESERVE_BYTES))
    other = original("blue")
    with pytest.raises(ValueError, match="capacity reached"):
        current.put("seller-123", other, sha256(other).hexdigest(), "back")
    assert len(list(current.root.rglob("*.jpeg"))) == 1
