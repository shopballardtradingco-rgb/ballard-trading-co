"""Application-owned eBay connection pool; credentials stay on each request.

No response cache or retry policy lives here. Photo-download and AI clients use
separate transports and cannot borrow eBay's authenticated connections.
"""
import asyncio
from contextlib import asynccontextmanager
from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx


class _NoCookies(DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


class EbayHTTP:
    def __init__(self, transport_source):
        self._transport_source = transport_source
        self._client = self._loop = self._transport = None

    @staticmethod
    def _new_client(transport):
        return httpx.AsyncClient(
            timeout=20, follow_redirects=False, transport=transport,
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=8,
                                keepalive_expiry=15),
            cookies=CookieJar(policy=_NoCookies()),
        )

    @asynccontextmanager
    async def lifespan(self):
        """Enter once per ASGI worker; close after MCP sessions have drained."""
        if self._client is not None:
            raise RuntimeError("eBay HTTP lifespan is already running")
        transport = self._transport_source()
        async with self._new_client(transport) as client:
            self._client, self._loop, self._transport = client, asyncio.get_running_loop(), transport
            try:
                yield
            finally:
                self._client = self._loop = self._transport = None

    @asynccontextmanager
    async def client(self):
        transport = self._transport_source()
        if (self._client is not None and self._loop is asyncio.get_running_loop()
                and self._transport is transport):
            yield self._client
        else:
            # Standalone calls and tests in another loop own a short-lived client.
            # Never borrow an app client's sockets across event loops.
            async with self._new_client(transport) as client:
                yield client
