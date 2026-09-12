"""Keeps the site's KV cache hot: GET arctools.fun/api/warm every WARM_EVERY seconds."""
import asyncio
import logging
import os

import aiohttp

log = logging.getLogger("warm")
WARM_URL = os.environ.get("WARM_URL", "https://arctools.fun/api/warm")
WARM_AUTH = os.environ.get("WARM_AUTH", "")
WARM_EVERY = int(os.environ.get("WARM_EVERY", "15"))


async def warm_loop():
    if not WARM_AUTH:
        log.warning("WARM_AUTH not set — site warmer disabled")
        return
    await asyncio.sleep(5)
    while True:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(WARM_URL, params={"k": WARM_AUTH}, timeout=aiohttp.ClientTimeout(total=120)) as r:
                    j = await r.json(content_type=None)
                    log.info("warm: %s", j)
        except Exception as e:  # noqa
            log.warning("warm failed: %s", e)
        await asyncio.sleep(WARM_EVERY)
