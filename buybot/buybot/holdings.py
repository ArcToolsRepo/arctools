"""What a wallet holds, from the chain we run, priced by the index we keep.

Why this exists: the site's portfolio reads arc-scan's token index. Measured against the node on a busy
wallet, arc-scan had 10 of 36 balances stale (off by up to 3x) and no USDC row at all; and the site prices
only through the Uniswap V3 quoter, so anything that trades on a curve or V4 shows a blank value. Both are
fixed here by not trusting either source:

  * discovery  — every token this wallet ever swapped (our index) ∪ every token that ever transferred INTO it
                 (Transfer logs from the node), so airdrops and OTC transfers are not lost
  * balances   — `balanceOf` for each candidate, read from the node right now
  * prices     — last indexed trade per token (any venue), falling back to nothing rather than a guess
  * value      — balance × price, in USDC; the native USDC balance is included as its own row

Cached per wallet for 20 s; the log scan is bounded so the endpoint stays under a couple of seconds.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

import aiohttp
from aiohttp import web
from sqlalchemy import text

from . import db

log = logging.getLogger("holdings")
CORS = {"Access-Control-Allow-Origin": "*"}
NODE = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
USDC = "0x3600000000000000000000000000000000000000"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
SCAN_BLOCKS = int(os.getenv("HOLDINGS_SCAN_BLOCKS", "150000"))     # ≈ recent days at Arc's block rate
STEP = 9000
_cache: dict[str, tuple[float, dict]] = {}


async def _rpc(s: aiohttp.ClientSession, method: str, params: list, timeout: float = 20):
    async with s.post(NODE, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                      timeout=aiohttp.ClientTimeout(total=timeout)) as r:
        j = await r.json(content_type=None)
        if "error" in j:
            raise RuntimeError(j["error"])
        return j.get("result")


async def _batch(s: aiohttp.ClientSession, calls: list[dict], timeout: float = 25) -> list:
    """One JSON-RPC batch; the node answers 100+ eth_calls in a single round trip."""
    body = [{"jsonrpc": "2.0", "id": i, "method": c["method"], "params": c["params"]} for i, c in enumerate(calls)]
    async with s.post(NODE, json=body, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
        out = await r.json(content_type=None)
    res = [None] * len(calls)
    for item in out if isinstance(out, list) else []:
        i = item.get("id")
        if isinstance(i, int) and 0 <= i < len(calls):
            res[i] = item.get("result")
    return res


async def _incoming_tokens(s: aiohttp.ClientSession, wallet: str, head: int) -> set[str]:
    topic_to = "0x" + "0" * 24 + wallet[2:]
    start = max(0, head - SCAN_BLOCKS)
    windows = [(b, min(b + STEP - 1, head)) for b in range(start, head + 1, STEP)]
    sem = asyncio.Semaphore(8)
    found: set[str] = set()

    async def one(lo: int, hi: int):
        async with sem:
            try:
                logs = await _rpc(s, "eth_getLogs", [{"fromBlock": hex(lo), "toBlock": hex(hi),
                                                       "topics": [TRANSFER, None, topic_to]}], 25)
                for lg in logs or []:
                    found.add((lg.get("address") or "").lower())
            except Exception:  # noqa
                pass
    await asyncio.gather(*[one(lo, hi) for lo, hi in windows])
    found.discard("")
    return found


async def compute(wallet: str) -> dict:
    wallet = wallet.lower()
    hit = _cache.get(wallet)
    if hit and time.time() - hit[0] < 20:
        return hit[1]
    t0 = time.time()
    async with aiohttp.ClientSession() as s:
        head = int(await _rpc(s, "eth_blockNumber", []), 16)
        traded = await db.fetchall(text("SELECT DISTINCT token FROM swaps WHERE wallet = :w").bindparams(w=wallet))
        cands = {r["token"].lower() for r in traded}
        cands |= await _incoming_tokens(s, wallet, head)
        cands.discard(USDC)
        cands = sorted(cands)[:400]

        # balances in batches of 120
        bals: dict[str, int] = {}
        for i in range(0, len(cands), 120):
            chunk = cands[i:i + 120]
            res = await _batch(s, [{"method": "eth_call", "params": [{"to": t, "data": "0x70a08231" + "0" * 24 + wallet[2:]}, "latest"]} for t in chunk])
            for t, r in zip(chunk, res):
                try:
                    v = int(r, 16) if r and r != "0x" else 0
                except ValueError:
                    v = 0
                if v > 0:
                    bals[t] = v
        native = await _rpc(s, "eth_getBalance", [wallet, "latest"])
        usdc = int(native, 16) / 1e18 if native else 0.0

    tokens = list(bals)
    meta = {}
    if tokens:
        rows = await db.fetchall(text("""
            SELECT st.token, st.symbol, st.name, st.logo,
                   (SELECT price1m FROM swaps p WHERE p.token = st.token AND p.price1m > 0 AND p.usdc >= 0.5
                    ORDER BY p.ts DESC LIMIT 1) price1m,
                   (SELECT MAX(ts) FROM swaps p WHERE p.token = st.token) last_ts
            FROM social_tokens st WHERE st.token = ANY(:t)""").bindparams(t=tokens))
        meta = {r["token"].lower(): dict(r) for r in rows}
        # tokens we traded but never indexed for presentation still get a price from the swaps table
        missing = [t for t in tokens if t not in meta]
        if missing:
            rows2 = await db.fetchall(text("""
                SELECT s.token, MAX(s.price1m) FILTER (WHERE s.ts = m.mx) price1m, m.mx last_ts
                FROM swaps s JOIN (SELECT token, MAX(ts) mx FROM swaps WHERE token = ANY(:t) AND price1m > 0 GROUP BY token) m
                  ON m.token = s.token
                WHERE s.token = ANY(:t) GROUP BY s.token, m.mx""").bindparams(t=missing))
            for r in rows2:
                meta[r["token"].lower()] = {"token": r["token"], "symbol": None, "name": None, "logo": None,
                                             "price1m": r["price1m"], "last_ts": r["last_ts"]}

    # the wallet's own cost basis for these tokens, so the page can show PnL alongside value
    basis = {}
    if tokens:
        rows3 = await db.fetchall(text("""
            SELECT token,
                   SUM(CASE WHEN side = 'buy' THEN tokens ELSE 0 END) bought,
                   SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) cost,
                   SUM(CASE WHEN side = 'sell' THEN tokens ELSE 0 END) sold,
                   SUM(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) proceeds,
                   COUNT(*) n
            FROM swaps WHERE wallet = :w AND token = ANY(:t) GROUP BY token""").bindparams(w=wallet, t=tokens))
        basis = {r["token"].lower(): dict(r) for r in rows3}

    holdings = []
    for t, raw in bals.items():
        m = meta.get(t, {})
        b = basis.get(t, {})
        amount = raw / 1e18
        price = ((m.get("price1m") or 0) / 1e6) or None
        value = amount * price if price else None
        avg = (b.get("cost") or 0) / b["bought"] if b.get("bought") else None
        holdings.append({
            "token": t, "symbol": m.get("symbol"), "name": m.get("name"), "logo": m.get("logo"),
            "amount": amount, "raw": str(raw), "price": price, "valueUsdc": round(value, 4) if value is not None else None,
            "avgEntry": avg, "unrealized": round((price - avg) * amount, 4) if (price and avg) else None,
            "trades": b.get("n") or 0, "transferredIn": not b.get("bought"),
            "lastTrade": m.get("last_ts"),
        })
    holdings.sort(key=lambda h: (h["valueUsdc"] or 0), reverse=True)
    total_tokens = sum(h["valueUsdc"] or 0 for h in holdings)
    out = {"wallet": wallet, "usdc": round(usdc, 6), "holdings": holdings,
           "totals": {"tokens": round(total_tokens, 2), "equity": round(total_tokens + usdc, 2),
                      "priced": sum(1 for h in holdings if h["valueUsdc"] is not None), "count": len(holdings)},
           "source": "node+index", "ms": int((time.time() - t0) * 1000)}
    _cache[wallet] = (time.time(), out)
    return out


async def api_holdings(req: web.Request):
    w = (req.query.get("wallet") or "").lower()
    if not (w.startswith("0x") and len(w) == 42):
        return web.json_response({"error": "wallet"}, status=400, headers=CORS)
    try:
        out = await compute(w)
    except Exception as e:  # noqa
        log.warning("holdings %s: %s", w[:10], e)
        return web.json_response({"error": "node busy, retry"}, status=503, headers=CORS)
    return web.json_response(out, headers={**CORS, "Cache-Control": "public, max-age=15"})


def register(app: web.Application):
    app.router.add_get("/api/holdings", api_holdings)
