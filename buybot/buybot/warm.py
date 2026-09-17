"""Keeps the site's KV cache hot: GET arctools.fun/api/warm every WARM_EVERY seconds."""
import asyncio
import logging
import os

import aiohttp

log = logging.getLogger("warm")
WARM_URL = os.environ.get("WARM_URL", "https://arctools.fun/api/warm")
WARM_AUTH = os.environ.get("WARM_AUTH", "")
WARM_EVERY = int(os.environ.get("WARM_EVERY", "15"))


async def trending_warm_loop():
    """Keep every timeframe the Terminal offers hot in the local cache.

    The 24 h window is the expensive one; when a user clicked it cold they waited ~20 s and the UI kept showing the
    previous list, which read as "the timeframe does nothing". Refreshed here on a rhythm, it is always warm, and
    the loop steps aside whenever the live index is behind."""
    from .insider import _lag
    await asyncio.sleep(60)
    windows = (1440, 360, 60, 15, 5, 0)
    while True:
        for mins in windows:
            try:
                if (_lag.get("blocks") or 0) > 40:          # live ingest always has priority
                    await asyncio.sleep(20)
                    continue
                async with aiohttp.ClientSession() as s:
                    async with s.get(f"http://127.0.0.1:{os.getenv('PORT', '8080')}/api/trending",
                                     params={"minutes": str(mins), "limit": "400"},
                                     timeout=aiohttp.ClientTimeout(total=90)) as r:
                        await r.read()
            except Exception as e:  # noqa
                log.debug("trending warm %s: %s", mins, e)
            await asyncio.sleep(12)


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
