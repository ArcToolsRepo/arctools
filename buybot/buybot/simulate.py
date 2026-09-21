"""Tradability simulation ("can I actually get out?") for every token we list.

A buy quote tells you what a pool would give you. It says nothing about whether the token will let you sell
again — the oldest trap on any chain. So we run the real round trip: buy 1 USDC worth, then immediately sell
everything back, against live mainnet state.

Nothing is deployed and nothing is spent: the ArcSim probe's runtime code is injected into a throwaway address
with an `eth_call` state override (reth supports code + balance overrides), so the whole round trip executes
inside one read-only call.

Verdicts are deliberately conservative, because a false "scam" badge on an honest token is its own kind of harm:

    ok        the sell behaves as quoted and most of the money survives the round trip
    thin      the sell behaves as quoted, but the pool is so shallow that 1 USDC moves the price — amber,
              a liquidity warning, never an accusation
    trap      reality contradicts the quote: the sell reverts, returns nothing, or pays less than half of
              what the router just quoted for that exact sale — that is a hidden tax or a blocked exit
    no_route  no pool we can reach — unknown, NOT a warning (new launches land here for a few blocks)
    error     the probe itself failed (node hiccup) — never shown as a verdict

    The distinction matters and cost a rewrite: the first version called 17 tokens honeypots, and six of them
    had 78-110 real sells in the previous 24 hours. They were simply illiquid — the router had already quoted
    the bad exit, and the pool paid exactly what it promised. A warning that cannot tell a thin pool from a
    trap is worse than no warning at all.

`keep_bps` is what comes back per 10 000 spent, so the UI can say "you get ~X% back" instead of a vague label.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import time

import aiohttp
from eth_abi import decode, encode
from eth_utils import keccak
from sqlalchemy import text

from . import db

NODE = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
SITE = os.getenv("SITE_ORIGIN", "https://arctools.fun")
AGG = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"
PROBE_ADDR = "0x00000000000000000000000000000000000f00d1"
ZERO = "0x" + "0" * 40
SPEND = 10**18                       # 1 USDC round trip: big enough to price, small enough to ignore impact
OK_BPS = 8500                        # >= 85% of the money back across the round trip
HONEST_BPS = 5000                    # the sell must pay at least half of what the router quoted for it

LEG_T = "(uint8,address,uint24,(address,address,uint24,int24,address),uint256)"
SIG = f"probe(address,address,{LEG_T}[],{LEG_T}[],uint256)"
_SEL = "0x" + keccak(text=SIG).hex()[:8]

_RUNTIME: str | None = None
_state: dict[str, object] = {"checked": 0, "traps": 0, "errors": 0, "last_ts": None}


def _runtime() -> str:
    global _RUNTIME
    if _RUNTIME is None:
        p = pathlib.Path(__file__).with_name("arcsim.runtime.txt")
        _RUNTIME = "0x" + p.read_text().strip().removeprefix("0x")
    return _RUNTIME


async def init_tables() -> None:
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS token_sim (
            token     VARCHAR(42) PRIMARY KEY,
            ts        BIGINT      NOT NULL,
            verdict   VARCHAR(16) NOT NULL,
            stage     SMALLINT    NOT NULL DEFAULT 0,
            keep_bps  INTEGER     NOT NULL DEFAULT 0,
            detail    TEXT
        )"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS token_sim_verdict ON token_sim (verdict, ts DESC)"))


async def _route(session: aiohttp.ClientSession, token: str, side: str, amount: int, after_buy: int = 0) -> dict:
    try:
        async with session.get(f"{SITE}/api/swaproute?token={token}&side={side}&amount={amount}" + (f"&afterBuy={after_buy}" if after_buy else ""),
                               headers={"User-Agent": "ArcTools-sim/1.0"},
                               timeout=aiohttp.ClientTimeout(total=30)) as r:
            return await r.json() if r.status == 200 else {}
    except Exception:  # noqa
        return {}


def _legs(r: dict) -> list:
    out = []
    for l in (r.get("legs") or []):
        k = l.get("key") or {}
        out.append((
            int(l["venue"]), l.get("target") or ZERO, int(l.get("fee") or 0),
            (k.get("currency0") or ZERO, k.get("currency1") or ZERO, int(k.get("fee") or 0),
             int(k.get("tick_spacing") or 0), k.get("hooks") or ZERO),
            int(l["amount"]),
        ))
    return out


async def probe(token: str) -> dict:
    """One round trip against live state. Never raises; an infrastructure failure is reported as `error`."""
    token = token.lower()
    async with aiohttp.ClientSession() as s:
        buy = await _route(s, token, "buy", SPEND)
        buy_legs = _legs(buy)
        if not buy_legs:
            return {"detail": (buy.get("error") or "no venue")[:60], "keep_bps": 0, "stage": -1, "token": token, "verdict": "no_route"}
        expect = int(buy.get("out") or 0)
        # ArcPad curves quoted in a wrapped stock (venue 6 = padquote): the probe's USDC becomes stock on V3 first, so
        # the curve's real reserve after the buy is in stock units the router cannot see from here. v3.1 reverts a
        # sell above that reserve ("liquidity"); a first-buyer round trip always trips it. Not a trap — not probeable.
        if any(v == 6 for (v, *_r) in buy_legs):
            return {"detail": "stock-quoted curve: round trip not probeable (v3.1 reserve rule)", "keep_bps": 0, "stage": -1, "token": token, "verdict": "no_route"}
        # the probe sells into the curve it just bought from: tell the router about the buy (ArcPad real-reserve cap)
        sell = await _route(s, token, "sell", expect, after_buy=SPEND) if expect else {}
        sell_legs = _legs(sell) or [(v, t, f, k, expect) for (v, t, f, k, _) in buy_legs]
        quoted_back = int(sell.get("out") or 0)          # what the router says this exact sale is worth

        data = _SEL + encode(["address", "address", f"{LEG_T}[]", f"{LEG_T}[]", "uint256"],
                             [AGG, token, buy_legs, sell_legs, SPEND]).hex()
        payload = {"id": 1, "jsonrpc": "2.0", "method": "eth_call", "params": [
            {"data": data, "from": PROBE_ADDR, "to": PROBE_ADDR, "value": hex(SPEND)}, "latest",
            {PROBE_ADDR: {"balance": hex(10 * SPEND), "code": _runtime()}},
        ]}
        try:
            async with s.post(NODE, json=payload, timeout=aiohttp.ClientTimeout(total=45)) as r:
                j = await r.json()
        except Exception as e:  # noqa
            return {"detail": str(e)[:60], "keep_bps": 0, "stage": -2, "token": token, "verdict": "error"}

    if "error" in j:
        return {"detail": str(j["error"].get("message"))[:60], "keep_bps": 0, "stage": -2, "token": token, "verdict": "error"}
    try:
        stage, bought, returned, _sellable = decode(["uint8", "uint256", "uint256", "uint256"], bytes.fromhex(str(j["result"])[2:]))
    except Exception as e:  # noqa
        return {"detail": str(e)[:60], "keep_bps": 0, "stage": -2, "token": token, "verdict": "error"}

    return {**classify(int(stage), int(returned), int(quoted_back)), "token": token}


async def _real_sells(token: str, hours: int = 24) -> int:
    """How many sells this token actually had on chain recently, from our own index.

    This is the veto on our own simulation. Our probe can only prove that OUR router cannot complete the exit;
    people selling the token through other paths prove that the exit exists. Whenever the two disagree, the
    observed trades win — a red badge on a token that 90 wallets sold today would be a lie.
    """
    row = await db.fetchone(text(
        "SELECT COUNT(*) AS n FROM swaps WHERE token = :t AND side = 'sell' AND ts > :cut"
    ).bindparams(cut=int(time.time()) - hours * 3600, t=token.lower()))
    return int(row["n"]) if row else 0



def classify(stage: int, returned: int, quoted_back: int) -> dict:
    """The whole verdict rule in one testable place.

    `returned` is what the round trip actually paid back, `quoted_back` is what the router said the sell was
    worth. A trap is defined by the DISAGREEMENT between them, never by the size of the loss alone — an
    illiquid pool loses most of the money too, and it is not a scam.
    """
    keep = int(returned * 10_000 // SPEND)
    base = {"keep_bps": keep, "quoted_bps": int(quoted_back * 10_000 // SPEND), "stage": stage}
    if stage in (0, 1):
        return {**base, "detail": "buy reverted" if stage == 0 else "buy delivered no tokens", "verdict": "trap"}
    if stage in (2, 3):
        detail = "the sell reverted" if stage == 2 else "the sell returned nothing"
        # no quote for the sell means we never had a working exit route to begin with: that is our gap, not a trap
        return {**base, "detail": detail, "verdict": "trap" if quoted_back > 0 else "no_route"}
    if quoted_back > 0 and returned * 10_000 < quoted_back * HONEST_BPS:
        short_by = 100 - (returned * 100 // max(quoted_back, 1))
        return {**base, "detail": f"sell paid {short_by}% less than quoted", "verdict": "trap"}
    if keep < OK_BPS:
        return {**base, "detail": f"thin pool: 1 USDC round trip returns {keep / 100:.0f}%", "verdict": "thin"}
    return {**base, "detail": f"{keep / 100:.0f}% round trip", "verdict": "ok"}

async def save(r: dict) -> None:
    if r["verdict"] == "error":
        return                                    # never persist our own outage as a token's verdict
    await db.execute(text("""
        INSERT INTO token_sim (token, ts, verdict, stage, keep_bps, detail)
        VALUES (:t, :ts, :v, :s, :k, :d)
        ON CONFLICT (token) DO UPDATE SET ts = :ts, verdict = :v, stage = :s, keep_bps = :k, detail = :d
    """).bindparams(d=r.get("detail"), k=r["keep_bps"], s=r["stage"], t=r["token"], ts=int(time.time()), v=r["verdict"]))


async def cached(token: str, max_age: int = 21_600) -> dict | None:
    row = await db.fetchone(text("SELECT * FROM token_sim WHERE token = :t").bindparams(t=token.lower()))
    if not row:
        return None
    age = int(time.time()) - int(row["ts"])
    if age > max_age:
        return None
    return {"age": age, "cached": True, "detail": row["detail"], "keep_bps": int(row["keep_bps"]),
            "stage": int(row["stage"]), "token": row["token"], "verdict": row["verdict"]}


async def check(token: str, force: bool = False) -> dict:
    if not force:
        hit = await cached(token)
        if hit:
            return hit
    r = await probe(token)
    if r["verdict"] == "trap":
        sells = await _real_sells(r["token"])
        if sells > 0:
            # our router failed, the market did not: report it as a routing gap, never as a trap
            r = {**r, "detail": f"our router cannot complete the exit, but {sells} real sells landed in the last 24h",
                 "real_sells": sells, "verdict": "unrouted"}
    await save(r)
    _state["checked"] = int(_state["checked"]) + 1  # type: ignore[arg-type]
    if r["verdict"] == "trap":
        _state["traps"] = int(_state["traps"]) + 1  # type: ignore[arg-type]
    if r["verdict"] == "error":
        _state["errors"] = int(_state["errors"]) + 1  # type: ignore[arg-type]
    _state["last_ts"] = int(time.time())
    return r


async def flags() -> dict:
    """Compact map for the Terminal: 't' = exit blocked or underpaid, 'h' = thin pool, plus what came back."""
    rows = await db.fetchall(text("""
        SELECT token, verdict, keep_bps FROM token_sim
        WHERE verdict IN ('trap', 'thin') AND ts > :cut
    """).bindparams(cut=int(time.time()) - 172_800))
    return {r["token"]: ["t" if r["verdict"] == "trap" else "h", int(r["keep_bps"])] for r in rows}      # 't'/'c' + keep, kept tiny


async def _queue(limit: int) -> list[str]:
    """Tokens worth simulating now: what traders can actually see and click, never checked first."""
    rows = await db.fetchall(text("""
        WITH active AS (
            SELECT token, SUM(usdc) AS vol, MAX(ts) AS last_ts
            FROM swaps WHERE ts > :cut GROUP BY token
        )
        SELECT a.token FROM active a
        LEFT JOIN token_sim s ON s.token = a.token
        WHERE s.token IS NULL
           OR (s.verdict IN ('trap', 'thin', 'unrouted') AND s.ts < :recheck_bad)
           OR (s.verdict = 'ok' AND s.ts < :recheck_ok)
        ORDER BY (s.token IS NULL) DESC, a.vol DESC
        LIMIT :lim
    """).bindparams(cut=int(time.time()) - 86_400, lim=limit,
                    recheck_bad=int(time.time()) - 21_600, recheck_ok=int(time.time()) - 86_400))
    return [r["token"] for r in rows]


async def sim_loop() -> None:
    await init_tables()
    await asyncio.sleep(150)
    while True:
        try:
            tokens = await _queue(int(os.getenv("SIM_BATCH", "120")))
            if tokens:
                sem = asyncio.Semaphore(int(os.getenv("SIM_CONCURRENCY", "6")))

                async def one(t: str) -> None:
                    async with sem:
                        await check(t, force=True)

                await asyncio.gather(*[one(t) for t in tokens], return_exceptions=True)
                print(f"[sim] checked {len(tokens)} · traps so far {_state['traps']}", flush=True)
        except Exception as e:  # noqa
            print(f"[sim] loop error: {e}", flush=True)
        await asyncio.sleep(int(os.getenv("SIM_INTERVAL", "300")))


def register(app) -> None:  # noqa: ANN001
    from aiohttp import web

    from .insider import API_CORS

    async def api_sim(request: web.Request) -> web.Response:
        token = (request.query.get("token") or "").lower()
        if not token.startswith("0x") or len(token) != 42:
            return web.json_response({"error": "token"}, status=400, headers=API_CORS)
        try:
            out = await check(token, force=request.query.get("force") == "1")
        except Exception as e:  # noqa
            out = {"detail": str(e)[:80], "token": token, "verdict": "error"}
        return web.json_response(out, headers={**API_CORS, "Cache-Control": "public, max-age=60"})

    async def api_sim_flags(request: web.Request) -> web.Response:
        try:
            f = await flags()
        except Exception as e:  # noqa
            return web.json_response({"flags": {}, "error": str(e)[:80]}, headers=API_CORS)
        return web.json_response({"flags": f, "n": len(f)}, headers={**API_CORS, "Cache-Control": "public, max-age=120"})

    async def api_sim_stats(request: web.Request) -> web.Response:
        if request.query.get("reset") == "1":
            if request.query.get("key", "") != os.getenv("INGEST_KEY", ""):
                return web.json_response({"error": "auth"}, status=403, headers=API_CORS)
            # verdicts written by an older rule are not data, they are noise: drop them instead of ageing them out
            await db.execute(text("DELETE FROM token_sim"))
        rows = await db.fetchall(text("SELECT verdict, COUNT(*) AS n FROM token_sim GROUP BY verdict"))
        return web.json_response({"by_verdict": {r["verdict"]: int(r["n"]) for r in rows}, "session": _state},
                                 headers=API_CORS)

    app.router.add_get("/api/sim", api_sim)
    app.router.add_get("/api/sim-flags", api_sim_flags)
    app.router.add_get("/api/sim-stats", api_sim_stats)
