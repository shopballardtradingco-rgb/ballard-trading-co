"""Receive host-authorized original files without a client-to-Railway upload.

Signed download URLs are ephemeral secrets: never persist or echo them. Only
OpenAI-owned download hosts are accepted; redirects and ambient proxy/auth are
disabled. The existing PhotoStore still validates and encrypts unchanged bytes.
"""

import asyncio
import logging
import re
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field

from .photos import MAX_PHOTO_BYTES


class OpenAIFile(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    download_url: str = Field(min_length=1, max_length=16000, repr=False)
    file_id: str = Field(min_length=1, max_length=200)
    # All four fields must be declared; only URL and ID are required by the host.
    mime_type: str = ""
    file_name: str = ""


def validate_download_url(value):
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        allowed = (
            re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.oaiusercontent\.com", host)
            or re.fullmatch(r"oais(?:dmnt|dsor)pr[a-z0-9]*\.blob\.core\.windows\.net", host)
            or re.fullmatch(r"oaisdmntpr[a-z0-9-]*aws\.s3\.[a-z0-9-]+\.amazonaws\.com", host)
        )
        if (url.scheme != "https" or not allowed or url.username or url.password
                or url.port not in (None, 443) or url.fragment
                or any(ord(c) < 33 or ord(c) > 126 for c in value)
                or "\\" in value):
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("Use the original file's temporary ChatGPT download reference") from None
    return value


async def download_original(file, size_bytes=None, *, transport=None, client=None):
    if size_bytes is not None and (type(size_bytes) is not int or not 0 < size_bytes <= MAX_PHOTO_BYTES):
        raise ValueError("Photograph exceeds the 12 MB limit")
    url = validate_download_url(file.download_url)
    if file.mime_type not in ("", "image/jpeg", "image/png", "application/octet-stream"):
        raise ValueError("Use an original JPEG or PNG")
    # httpx INFO and httpcore DEBUG logs include signed URLs. Do not emit them.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    async def receive(client):
        async with client.stream("GET", url, headers={"Accept-Encoding": "identity"},
                                 follow_redirects=False) as response:
            if response.status_code != 200:
                raise ValueError("Original file download failed; request a fresh file reference")
            if response.headers.get("content-encoding", "identity") != "identity":
                raise ValueError("Compressed transfer cannot verify original bytes")
            mime = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if mime not in ("image/jpeg", "image/png", "application/octet-stream"):
                raise ValueError("Original download is not JPEG/PNG bytes")
            length = response.headers.get("content-length")
            if length is not None:
                if not length.isdecimal() or not 0 < int(length) <= MAX_PHOTO_BYTES:
                    raise ValueError("Photograph exceeds the 12 MB limit or has an invalid size")
                if size_bytes is not None and int(length) != size_bytes:
                    raise ValueError("Photo size mismatch")
            expected_size = size_bytes if size_bytes is not None else (int(length) if length else None)
            limit = expected_size if expected_size is not None else MAX_PHOTO_BYTES
            data = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=65536):
                if len(data) + len(chunk) > limit:
                    raise ValueError("Photo size mismatch")
                data.extend(chunk)
            if not data or (expected_size is not None and len(data) != expected_size):
                raise ValueError("Photo size mismatch")
            return bytes(data)
    try:
        async with asyncio.timeout(60):
            if client is not None:
                return await receive(client)
            async with httpx.AsyncClient(timeout=30, follow_redirects=False,
                                         trust_env=False, transport=transport) as owned_client:
                return await receive(owned_client)
    except (httpx.HTTPError, TimeoutError):
        raise ValueError("Original file download interrupted; request a fresh file reference") from None
