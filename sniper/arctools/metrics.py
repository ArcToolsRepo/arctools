"""Bot speed & stability telemetry.

* aiogram outer middleware → duration of every handled update (ring buffer, p50/p95/max)
* buy recorder → ok/fail counts + median time-to-receipt over the last hour
* Telegram API ping (getMe) and RPC quarantine state
* heartbeat → POST {INSIDER_API}/api/bot-heartbeat every 30 s; the buybot's watchdog turns it into the
  `bots` check on /api/status ("System: Running" pill on the site).
"""
import asyncio
import logging
import os
import time
from collections import deque
from typing import Any, Awaitable, Callable

import aiohttp
from aiogram import BaseMiddleware
from aiogram.types import TelegramObject

log = logging.getLogger("metrics")

STARTED = time.time()
_durations: deque[tuple[float, float]] = deque(maxlen=400)      # (ts, ms)
_buys: deque[tuple[float, bool, float]] = deque(maxlen=200)    # (ts, ok, seconds to receipt)
_errors: deque[float] = deque(maxlen=200)                      # handler exceptions
_last_update = 0.0
_tg_ping_ms: float | None = None


class TimingMiddleware(BaseMiddleware):
    async def __call__(self, handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
                       event: TelegramObject, data: dict[str, Any]) -> Any:
        global _last_update
        t = time.perf_counter()
        try:
            return await handler(event, data)
        except Exception:
            _errors.append(time.time())
            raise
        finally:
            _last_update = time.time()
            _durations.append((_last_update, (time.perf_counter() - t) * 1000))


def record_buy(ok: bool, seconds: float):
    _buys.append((time.time(), ok, seconds))


def _pct(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    vals = sorted(vals)
    return vals[min(len(vals) - 1, int(round((len(vals) - 1) * p)))]


def snapshot() -> dict:
    now = time.time()
    recent = [ms for ts, ms in _durations if now - ts < 900]
    buys = [b for b in _buys if now - b[0] < 3600]
    ok_buys = [b for b in buys if b[1]]
    rpc_down = []
    try:
        from .chain import CHAIN
        rpc_down = [CHAIN.urls[i].split("/")[2] for i, until in CHAIN._down.items() if until > now]
    except Exception:  # noqa
        pass
    return {
        "bot": "sniper", "ts": int(now), "uptime_s": int(now - STARTED),
        "updates_15m": len(recent), "last_update_age_s": int(now - _last_update) if _last_update else None,
        "p50_ms": _pct(recent, 0.5), "p95_ms": _pct(recent, 0.95), "max_ms": max(recent) if recent else None,
        "errors_15m": sum(1 for t in _errors if now - t < 900),
        "buys_1h": len(buys), "buys_ok_1h": len(ok_buys),
        "buy_median_s": _pct([b[2] for b in ok_buys], 0.5),
        "tg_ping_ms": _tg_ping_ms, "rpc_quarantined": rpc_down,
    }


async def heartbeat_loop(bot):
    global _tg_ping_ms
    api = os.getenv("INSIDER_API", "https://bot-production-4200.up.railway.app").rstrip("/")
    auth = os.getenv("HEARTBEAT_AUTH", "")
    await asyncio.sleep(5)
    while True:
        try:
            t = time.perf_counter()
            await bot.get_me()
            _tg_ping_ms = round((time.perf_counter() - t) * 1000, 1)
        except Exception as e:  # noqa
            _tg_ping_ms = None
            log.warning("tg ping failed: %s", e)
        if auth:
            try:
                async with aiohttp.ClientSession() as s:
                    await s.post(f"{api}/api/bot-heartbeat", json=snapshot(), headers={"X-Heartbeat-Auth": auth},
                                 timeout=aiohttp.ClientTimeout(total=8))
            except Exception as e:  # noqa
                log.debug("heartbeat: %s", e)
        await asyncio.sleep(30)
