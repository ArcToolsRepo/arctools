"""Buybot self-telemetry + heartbeats from the other bots (sniper).
Feeds the watchdog `bots` check and /api/status."""
import os
import time
from collections import deque
from typing import Any, Awaitable, Callable
from aiogram import BaseMiddleware
from aiogram.types import TelegramObject
from aiohttp import web

STARTED = time.time()
_durations: deque[tuple[float, float]] = deque(maxlen=400)
_errors: deque[float] = deque(maxlen=200)
_last_update = 0.0
BEATS: dict[str, dict] = {}          # bot name -> last heartbeat payload (+ received_at)
AUTH = os.getenv("HEARTBEAT_AUTH", "")


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


def _pct(vals, p):
    if not vals:
        return None
    vals = sorted(vals)
    return vals[min(len(vals) - 1, int(round((len(vals) - 1) * p)))]


def self_snapshot() -> dict:
    now = time.time()
    recent = [ms for ts, ms in _durations if now - ts < 900]
    return {"bot": "buybot", "ts": int(now), "uptime_s": int(now - STARTED), "updates_15m": len(recent),
            "last_update_age_s": int(now - _last_update) if _last_update else None,
            "p50_ms": _pct(recent, 0.5), "p95_ms": _pct(recent, 0.95), "max_ms": max(recent) if recent else None,
            "errors_15m": sum(1 for t in _errors if now - t < 900)}


async def api_heartbeat(req: web.Request):
    if not AUTH or req.headers.get("X-Heartbeat-Auth") != AUTH:
        return web.json_response({"error": "auth"}, status=403)
    try:
        j = await req.json()
    except Exception:  # noqa
        return web.json_response({"error": "bad json"}, status=400)
    name = str(j.get("bot") or "unknown")[:24]
    j["received_at"] = int(time.time())
    BEATS[name] = j
    return web.json_response({"ok": True})


def all_bots() -> dict:
    out = {"buybot": self_snapshot()}
    for k, v in BEATS.items():
        out[k] = dict(v, heartbeat_age_s=int(time.time() - v.get("received_at", 0)))
    return out
