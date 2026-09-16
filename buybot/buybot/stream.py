"""Live swap stream (Server-Sent Events).

The ingest publishes every swap row it writes (live windows land every few seconds when the index is at head); token
pages subscribe to GET /api/stream?token=0x… and receive

  event: trade   data: {tx, ts, wallet, side, usdc, tokens, price1m, venue, block, log_index}
  event: hb      data: {ts, lag}                (every 15 s — keeps proxies from closing the socket)

GET /api/stream (no token) streams every swap ≥ $5 — the Terminal's live toasts. Bounded per-client queue: a slow
client drops old events instead of stalling the publisher.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from aiohttp import web

log = logging.getLogger("stream")

_subs: dict[str, set[asyncio.Queue]] = {}        # token (lower) or "*" → queues
MAXQ = 500
stats = {"clients": 0, "published": 0, "dropped": 0}


def publish(rows: list[dict]) -> None:
    """Called by the ingest after a batch is written. Never blocks."""
    if not rows or not _subs:
        return
    for r in rows:
        tok = (r.get("token") or "").lower()
        payload = None
        for key in (tok, "*"):
            qs = _subs.get(key)
            if not qs:
                continue
            if key == "*" and float(r.get("usdc") or 0) < 5:
                continue
            if payload is None:
                # symbol from the in-memory cache so live toasts show ARCT, not 0x4135…6e6 (never a DB hit here)
                try:
                    from .insider import _sym_cache
                    sym = _sym_cache.get(tok)
                except Exception:  # noqa
                    sym = None
                payload = json.dumps({k: r.get(k) for k in ("tx", "ts", "wallet", "side", "usdc", "tokens", "price1m", "venue", "block", "log_index")} | {"token": tok, "symbol": sym, "pub": round(time.time(), 2)})
            for q in list(qs):
                if q.full():                           # slow client: drop the OLDEST event, keep the newest
                    try:
                        q.get_nowait(); stats["dropped"] += 1
                    except Exception:  # noqa
                        pass
                try:
                    q.put_nowait(("trade", payload)); stats["published"] += 1
                except asyncio.QueueFull:
                    stats["dropped"] += 1


async def api_stream(request: web.Request) -> web.StreamResponse:
    token = (request.query.get("token") or "").lower()
    key = token if (token.startswith("0x") and len(token) == 42) else "*"
    resp = web.StreamResponse(status=200, headers={
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive",
        "X-Accel-Buffering": "no", "Access-Control-Allow-Origin": "*",
    })
    await resp.prepare(request)
    q: asyncio.Queue = asyncio.Queue(maxsize=MAXQ)
    _subs.setdefault(key, set()).add(q); stats["clients"] += 1
    try:
        await resp.write(b"retry: 3000\nevent: hello\ndata: " + json.dumps({"token": key, "ts": int(time.time())}).encode() + b"\n\n")
        while True:
            try:
                ev, data = await asyncio.wait_for(q.get(), timeout=15)
                # coalesce: a hot token prints 10-30 swaps/s — one "trades" frame every 300 ms instead of a frame per swap
                batch = [data]
                deadline = time.monotonic() + (1.0 if key == "*" else 0.3)   # firehose clients get 1 frame/s
                while len(batch) < 400:
                    left = deadline - time.monotonic()
                    if left <= 0:
                        break
                    try:
                        _, more = await asyncio.wait_for(q.get(), timeout=left)
                        batch.append(more)
                    except asyncio.TimeoutError:
                        break
                if len(batch) == 1:
                    await resp.write(f"event: {ev}\ndata: {data}\n\n".encode())
                else:
                    await resp.write(("event: trades\ndata: [" + ",".join(batch) + "]\n\n").encode())
            except asyncio.TimeoutError:
                from .insider import _lag
                await resp.write(f"event: hb\ndata: {json.dumps({'ts': int(time.time()), 'lag': _lag.get('blocks')})}\n\n".encode())
    except (asyncio.CancelledError, ConnectionResetError, RuntimeError):
        pass
    except Exception as e:  # noqa
        log.debug("stream closed: %s", e)
    finally:
        s = _subs.get(key)
        if s:
            s.discard(q)
            if not s:
                _subs.pop(key, None)
        stats["clients"] -= 1
    return resp


async def api_stream_stats(_req):
    from . import live_candles
    return web.json_response({**stats, "topics": {k: len(v) for k, v in _subs.items()}, "live_candles": live_candles.snapshot()}, headers={"Access-Control-Allow-Origin": "*"})


def register(app: web.Application):
    app.router.add_get("/api/stream", api_stream)
    app.router.add_get("/api/stream-stats", api_stream_stats)
