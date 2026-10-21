"""Bound blocking work and drain it before releasing cancellation or its slot."""
import asyncio
from functools import partial
from anyio import CancelScope


class BlockingWork:
    def __init__(self):
        self._loop = self._slot = None

    async def run(self, function, *args, **kwargs):
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            if self._loop is not None and not self._loop.is_closed():
                raise RuntimeError("Blocking work belongs to another running event loop")
            self._loop, self._slot = loop, asyncio.Semaphore(1)
        async with self._slot:
            work = asyncio.create_task(asyncio.to_thread(partial(function, *args, **kwargs)))
            try:
                return await asyncio.shield(work)
            except asyncio.CancelledError:
                # Python cannot stop a running thread. Keep its capacity slot
                # until completion, including repeated asyncio cancellation.
                # Shield MCP/AnyIO level cancellation to avoid a busy-wait loop.
                with CancelScope(shield=True):
                    while not work.done():
                        try:
                            await asyncio.shield(work)
                        except asyncio.CancelledError:
                            continue
                        except Exception:
                            break
                # Observe failures too; cancellation must not create an unhandled
                # task exception or allow another operation to race the worker.
                if not work.cancelled():
                    work.exception()
                raise
