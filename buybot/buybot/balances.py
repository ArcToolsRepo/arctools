"""Native USDC balance snapshots for every wallet the index has seen (plus watched wallets).
Multicall3.getEthBalance in chunks via the relay. Gives: whales by balance, biggest balance moves
(inflows/outflows that never touched a DEX), and the `balance` rule for the alert engine."""
from __future__ import annotations

import asyncio
import logging
import os
import time

import aiohttp
from aiohttp import web
from sqlalchemy import bindparam, text

from . import db
from .insider import RELAY_RPC

log = logging.getLogger("balances")

MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
SNAP_EVERY = int(os.getenv("BALANCE_SNAP_SEC", "600"))
MAX_WALLETS = int(os.getenv("BALANCE_MAX_WALLETS", "8000"))
HIST_MIN_DELTA = float(os.getenv("BALANCE_HIST_MIN", "500"))   # store a history row only for moves >= $500
CHUNK = 200
API_CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type"}

EXCLUDED = {a.lower() for a in [
    "0x8366a39cc670b4001a1121b8f6a443a643e40951", "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77",
    "0x1eaad48260eecc7624666f1dfec202b2d75257fe", "0x2726aec64d8a9bc41b9940dda5d21c889458b348",
    "0x7d49f880c7bdae4fd44d52c3dbfb43534e83dabd", "0x48ada931c2c220b074c39449b7e70860a3b4c277",
    "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead",
    "0xa42c4beee84ced9f2ea15b3981b8a321943b7bec", "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d",
]}


async def init_tables():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS wallet_balance (
        wallet VARCHAR(64) PRIMARY KEY, balance DOUBLE PRECISION, prev DOUBLE PRECISION, ts BIGINT, first_seen BIGINT)"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS balance_hist (
        wallet VARCHAR(64) NOT NULL, ts BIGINT NOT NULL, balance DOUBLE PRECISION, delta DOUBLE PRECISION,
        PRIMARY KEY (wallet, ts))"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS balance_hist_ts ON balance_hist (ts)"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS wallet_balance_bal ON wallet_balance (balance)"))


def _sel_get_eth_balance(addr: str) -> str:
    return "0x4d2301cc" + addr[2:].lower().rjust(64, "0")


async def _multicall_balances(wallets: list[str]) -> dict[str, float]:
    """Multicall3.tryAggregate(false, [(MULTICALL3, getEthBalance(w))...]) in chunks of CHUNK."""
    from eth_abi import decode, encode
    out: dict[str, float] = {}
    sel = bytes.fromhex("bce38bd7")  # tryAggregate(bool,(address,bytes)[])
    async with aiohttp.ClientSession() as s:
        for i in range(0, len(wallets), CHUNK):
            batch = wallets[i:i + CHUNK]
            calls = [(MULTICALL3, bytes.fromhex(_sel_get_eth_balance(w)[2:])) for w in batch]
            data = "0x" + (sel + encode(["bool", "(address,bytes)[]"], [False, calls])).hex()
            try:
                async with s.post(RELAY_RPC, headers={"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "X-Priority": "high"}, json={"id": 1, "jsonrpc": "2.0", "method": "eth_call",
                                                  "params": [{"to": MULTICALL3, "data": data}, "latest"]},
                                  timeout=aiohttp.ClientTimeout(total=40)) as r:
                    res = (await r.json()).get("result")
                if not res or res == "0x":
                    continue
                (results,) = decode(["(bool,bytes)[]"], bytes.fromhex(res[2:]))
                for w, (ok, ret) in zip(batch, results):
                    if ok and len(ret) >= 32:
                        out[w] = int.from_bytes(ret[:32], "big") / 1e18
            except Exception as e:  # noqa
                log.warning("multicall balances chunk %s: %s", i, e)
            await asyncio.sleep(0.15)
    return out


async def snapshot_once() -> int:
    rows = await db.fetchall(text(
        "SELECT wallet FROM (SELECT wallet, MAX(ts) AS t FROM swaps GROUP BY wallet) x ORDER BY t DESC LIMIT :n").bindparams(n=MAX_WALLETS))
    wallets = [r["wallet"].lower() for r in rows if r["wallet"] and r["wallet"].lower() not in EXCLUDED]
    try:
        extra = await db.fetchall(text("SELECT DISTINCT wallet FROM watchlist"))
        wallets += [r["wallet"].lower() for r in extra]
        extra2 = await db.fetchall(text("SELECT DISTINCT recipient AS wallet FROM bridge_mints WHERE amount >= 100"))
        wallets += [r["wallet"].lower() for r in extra2]
    except Exception:  # noqa
        pass
    wallets = sorted(set(wallets))
    bals = await _multicall_balances(wallets)
    now = int(time.time())
    prev = {r["wallet"]: float(r["balance"] or 0) for r in await db.fetchall(text("SELECT wallet, balance FROM wallet_balance"))}
    up_rows, hist_rows = [], []
    for w, b in bals.items():
        p = prev.get(w)
        up_rows.append({"w": w, "b": b, "p": p if p is not None else b, "ts": now})
        if p is not None and abs(b - p) >= HIST_MIN_DELTA:
            hist_rows.append({"w": w, "ts": now, "b": b, "d": b - p})
    await db.execute_many(text(
        "INSERT INTO wallet_balance (wallet, balance, prev, ts, first_seen) VALUES (:w, :b, :p, :ts, :ts) "
        "ON CONFLICT (wallet) DO UPDATE SET prev = wallet_balance.balance, balance = EXCLUDED.balance, ts = EXCLUDED.ts"), up_rows)
    if hist_rows:
        await db.execute_many(text(
            "INSERT INTO balance_hist (wallet, ts, balance, delta) VALUES (:w, :ts, :b, :d) ON CONFLICT DO NOTHING"), hist_rows)
    await db.execute(text("DELETE FROM balance_hist WHERE ts < :c").bindparams(c=now - 14 * 86400))
    return len(bals)


async def snapshot_loop():
    await asyncio.sleep(90)
    await init_tables()
    while True:
        try:
            t0 = time.time()
            n = await snapshot_once()
            log.info("balance snapshot: %s wallets in %.0fs", n, time.time() - t0)
        except Exception as e:  # noqa
            log.warning("balance snapshot: %s", e)
        await asyncio.sleep(SNAP_EVERY)


# ---------------- API ----------------

async def api_rich(request: web.Request) -> web.Response:
    """Whales by native USDC balance (wallets known to the index), with 30d PnL when ranked."""
    limit = min(200, int(request.query.get("limit", "50")))
    rows = await db.fetchall(text("""
        SELECT b.wallet, b.balance, b.prev, b.ts, ws.pnl_total, ws.winrate, ws.closed,
               (SELECT COUNT(*) FROM swaps s WHERE s.wallet = b.wallet) AS swaps,
               (SELECT MAX(ts) FROM swaps s WHERE s.wallet = b.wallet) AS last_trade
        FROM wallet_balance b LEFT JOIN wallet_stats ws ON ws.wallet = b.wallet AND ws.range = '30d'
        ORDER BY b.balance DESC LIMIT :l""").bindparams(l=limit))
    tot = await db.fetchone(text("SELECT COUNT(*) AS n, SUM(balance) AS s, MAX(ts) AS ts FROM wallet_balance"))
    return web.json_response({"rows": [dict(r) for r in rows], "wallets": int(tot["n"] or 0),
                              "total_usdc": float(tot["s"] or 0), "snapshot_ts": int(tot["ts"] or 0)}, headers=API_CORS)


async def api_balance_moves(request: web.Request) -> web.Response:
    """Largest native-USDC balance changes between snapshots (deposits/withdrawals/CEX flows, not only DEX).

    This is a whole-table scan with a correlated COUNT per row and took 14 s at hours=336 — the Profile page
    waited on it before painting. Cached for 90 s behind a single flight, so one slow query serves everyone."""
    from .watchlist import _cached, _resp_body
    body = await _cached("balmoves:" + request.query_string, 90, lambda: _resp_body(_api_balance_moves_impl(request)))
    return web.Response(body=body, content_type="application/json",
                        headers={**API_CORS, "Cache-Control": "public, max-age=60, stale-while-revalidate=180"})


async def _api_balance_moves_impl(request: web.Request) -> web.Response:
    hours = min(336, int(request.query.get("hours", "24")))
    min_abs = float(request.query.get("min_usd", "1000"))
    rows = await db.fetchall(text("""
        SELECT h.wallet, h.ts, h.balance, h.delta, ws.pnl_total,
               COALESCE(ws.trades, 0) AS swaps
        FROM balance_hist h LEFT JOIN wallet_stats ws ON ws.wallet = h.wallet AND ws.range = '30d'
        WHERE h.ts > :s AND ABS(h.delta) >= :m ORDER BY ABS(h.delta) DESC LIMIT 100""").bindparams(s=int(time.time()) - hours * 3600, m=min_abs))
    return web.json_response({"hours": hours, "rows": [dict(r) for r in rows]}, headers=API_CORS)
