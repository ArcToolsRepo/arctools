"""Live price for Uniswap v4 pools that have no (recent) swaps.

A launch on Minara / pools.trade / creo / Hopium creates a v4 pool at a fixed opening price; until somebody trades, our
swap index knows nothing and the Terminal shows "—". The pool itself knows: slot0 holds sqrtPriceX96. We read it straight
from the PoolManager with extsload(keccak256(abi.encode(poolId, POOLS_SLOT))) — no StateView contract needed — in
batches of 100 against our own node, every 10 minutes, for USDC-quoted pools whose token had no swap in 24 h.

Result lands in v4_pools.state_price1m (USDC per 1M tokens) + state_ts; the venue-tokens / list endpoints use it as the
price of last resort after the last indexed swap."""
import asyncio
import logging
import os
import time

import aiohttp
from eth_abi import encode
from sqlalchemy import text
from web3 import Web3

from . import db

log = logging.getLogger("v4state")
POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
POOLS_SLOT = 6
SEL_EXTSLOAD = Web3.keccak(text="extsload(bytes32)")[:4].hex()
NODE = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
NATIVE = "0x0000000000000000000000000000000000000000"
USDC = "0x3600000000000000000000000000000000000000"
Q96 = 2 ** 96


def slot0_key(pool_id: str) -> str:
    return "0x" + Web3.keccak(encode(["bytes32", "uint256"], [bytes.fromhex(pool_id[2:]), POOLS_SLOT])).hex().replace("0x", "")


def price1m_from_sqrt(sqrt_price_x96: int, token_is_currency1: bool, usdc_dec: int) -> float | None:
    """USDC per 1M tokens from slot0. r = (sqrtP/2^96)^2 = raw currency1 per raw currency0."""
    if sqrt_price_x96 <= 0:
        return None
    r = (sqrt_price_x96 / Q96) ** 2
    if token_is_currency1:      # quote = currency0: raw quote per raw token = 1/r
        quote_per_token_raw = 1 / r
    else:                       # token = currency0: raw quote per raw token = r
        quote_per_token_raw = r
    quote_per_token = quote_per_token_raw * (10 ** 18) / (10 ** usdc_dec)
    p = quote_per_token * 1_000_000
    return p if 1e-12 < p < 1e15 else None


async def init():
    for col, typ in (("state_price1m", "DOUBLE PRECISION"), ("state_ts", "BIGINT")):
        await db.execute(text(f"ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS {col} {typ}"))
    asyncio.create_task(state_loop(), name="v4-state")


async def refresh(limit: int = 20000) -> int:
    now = int(time.time())
    rows = await db.fetchall(text("""
        SELECT p.id, p.is0, p.usdc_dec FROM v4_pools p
        WHERE p.token IS NOT NULL AND (p.currency0 IN (:n, :u) OR p.currency1 IN (:n, :u))
          AND COALESCE(p.state_ts, 0) < :stale
          AND NOT EXISTS (SELECT 1 FROM swaps s WHERE s.token = p.token AND s.ts > :recent)
        ORDER BY COALESCE(p.state_ts, 0) ASC, (EXISTS (SELECT 1 FROM pad_tokens pt WHERE pt.token = p.token)) DESC, p.block DESC LIMIT :l""").bindparams(n=NATIVE, u=USDC, stale=now - 600, recent=now - 86400, l=limit))
    if not rows:
        return 0
    done = 0
    async with aiohttp.ClientSession() as s:
        for i in range(0, len(rows), 100):
            chunk = rows[i:i + 100]
            calls = [{"jsonrpc": "2.0", "id": j, "method": "eth_call",
                      "params": [{"to": POOL_MANAGER, "data": SEL_EXTSLOAD + slot0_key(r["id"])[2:]}, "latest"]} for j, r in enumerate(chunk)]
            try:
                async with s.post(NODE, json=calls, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    res = await resp.json(content_type=None)
            except Exception as e:  # noqa
                log.warning("v4state: node batch failed: %s", str(e)[:120]); continue
            by_id = {x.get("id"): x.get("result") for x in res if isinstance(x, dict)}
            vals, par = [], {"t": now}
            for j, r in enumerate(chunk):
                word = by_id.get(j)
                price = None
                if word and word != "0x" and len(word) >= 66:
                    sqrt_p = int(word, 16) & ((1 << 160) - 1)             # slot0: sqrtPriceX96 in the low 160 bits
                    # is0 = 1 means the QUOTE is currency0 (token is currency1) in our schema
                    price = price1m_from_sqrt(sqrt_p, token_is_currency1=bool(r["is0"]), usdc_dec=int(r["usdc_dec"] or 18))
                vals.append(f"(:i{j}, CAST(:p{j} AS DOUBLE PRECISION))"); par[f"i{j}"] = r["id"]; par[f"p{j}"] = price
            # one statement per batch of 100 — a hundred single-row UPDATEs made a pass take minutes
            await db.execute(text(f"UPDATE v4_pools v SET state_price1m = x.p, state_ts = :t FROM (VALUES {', '.join(vals)}) AS x(id, p) WHERE v.id = x.id").bindparams(**par))
            done += len(chunk)
    return done


async def state_loop():
    await asyncio.sleep(120)
    while True:
        try:
            n = await refresh()
            if n:
                log.info("v4state: %s pools refreshed from slot0", n)
        except Exception as e:  # noqa
            log.warning("v4state: %s", str(e)[:160])
        await asyncio.sleep(300)


async def api_stats(req):
    from aiohttp import web
    out = {}
    if req.query.get("run") and req.query.get("key") == os.getenv("INGEST_KEY", ""):
        try:
            out["refreshed"] = await refresh(int(req.query.get("limit", "500")))
        except Exception as e:  # noqa
            out["error"] = repr(e)[:300]
    r = await db.fetchone(text("SELECT COUNT(*) n, COUNT(state_ts) checked, COUNT(state_price1m) priced, MAX(state_ts) last FROM v4_pools"))
    q = await db.fetchone(text("SELECT COUNT(*) n FROM v4_pools p WHERE p.token IS NOT NULL AND (p.currency0 IN (:n, :u) OR p.currency1 IN (:n, :u))").bindparams(n=NATIVE, u=USDC))
    pad = await db.fetchone(text("""SELECT COUNT(*) n, COUNT(v.state_ts) checked, COUNT(v.state_price1m) priced
        FROM v4_pools v WHERE EXISTS (SELECT 1 FROM pad_tokens pt WHERE pt.token = v.token)"""))
    out.update({"pools": r["n"], "usdc_quoted": q["n"], "checked": r["checked"], "priced": r["priced"], "last_ts": r["last"],
                "pad_pools": dict(pad)})
    tk = (req.query.get("token") or "").lower()
    if tk:
        rows = await db.fetchall(text("SELECT id, token, is0, currency0, currency1, usdc_dec, state_price1m, state_ts FROM v4_pools WHERE token = :t").bindparams(t=tk))
        out["token_pools"] = [dict(x) for x in rows]
    return web.json_response(out)


async def api_db_stats(req):
    """Disk picture: table sizes, row counts, span of the swaps table. (relname is ambiguous in a pg_class join —
    that is why this endpoint used to 500.)"""
    from aiohttp import web
    out = {}
    try:
        rows = await db.fetchall(text("SELECT relname AS t, pg_total_relation_size(relid) AS bytes, n_live_tup AS live "
                                      "FROM pg_stat_user_tables ORDER BY 2 DESC LIMIT 15"))
        out["tables"] = [{"t": r["t"], "mb": round(int(r["bytes"]) / 1e6, 1), "rows": int(r["live"] or 0)} for r in rows]
    except Exception as e:  # noqa
        out["tables_error"] = repr(e)[:200]
    for key, q in (("db_mb", "SELECT pg_database_size(current_database()) AS v"),
                   ("swaps_min_ts", "SELECT MIN(ts) AS v FROM swaps"), ("swaps_max_ts", "SELECT MAX(ts) AS v FROM swaps")):
        try:
            r = await db.fetchone(text(q))
            out[key] = round(int(r["v"]) / 1e6) if key == "db_mb" else int(r["v"] or 0)
        except Exception as e:  # noqa
            out[key + "_error"] = repr(e)[:160]
    return web.json_response(out)


def register(app):
    app.router.add_get("/api/v4state-stats", api_stats)
    app.router.add_get("/api/db-stats", api_db_stats)
