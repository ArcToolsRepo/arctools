"""ArcPredict operator — UP/DOWN rounds on Arc (contracts/ArcPredict.sol), one instance per market.

Every `interval` seconds the operator posts one price per market: it closes round N-1, locks round N and opens N+1
(`executeRound(price)`). The price is a global mark price the Arc chain cannot move — Hyperliquid mark, Binance
fallback, median when both answer — rounded to 8 decimals, and every posted value is written to `predict_prices`
with its sources so anyone can audit it against the exchanges (`/api/predict/price`).

Failure model is the contract's: if we are late by more than `bufferSeconds` the round cannot be resolved and
bettors get refunds; we never resolve with a stale price. The loop therefore fires a little AFTER lockTime/closeTime
(≥ 2 s) and gives up on a round rather than racing the buffer.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import statistics
import time

import aiohttp
from aiohttp import web
from eth_account import Account
from sqlalchemy import text
from web3 import Web3

from . import db

log = logging.getLogger("predict")

CHAIN_ID = 5042
NODE_RPC = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
DEPLOY = json.load(open(os.path.join(os.path.dirname(__file__), "..", "ArcPredict.deploy.json"))) if os.path.exists(os.path.join(os.path.dirname(__file__), "..", "ArcPredict.deploy.json")) else {"markets": {}}
ABI = json.load(open(os.path.join(os.path.dirname(__file__), "..", "ArcPredict.abi.json"))) if os.path.exists(os.path.join(os.path.dirname(__file__), "..", "ArcPredict.abi.json")) else []
MARKETS: dict[str, dict] = DEPLOY.get("markets", {})          # "BTC/USD" → {address, interval, buffer, ...}
HL_COIN = {"BTC/USD": "BTC", "ETH/USD": "ETH", "SOL/USD": "SOL"}
BINANCE = {"BTC/USD": "BTCUSDT", "ETH/USD": "ETHUSDT", "SOL/USD": "SOLUSDT"}
COINBASE = {"BTC/USD": "BTC-USD", "ETH/USD": "ETH-USD", "SOL/USD": "SOL-USD"}
KRAKEN = {"BTC/USD": "XXBTZUSD", "ETH/USD": "XETHZUSD", "SOL/USD": "SOLUSD"}
PRICE_DEC = 8

_w3 = Web3()
_state: dict = {"markets": {}, "operator": None, "last_error": None, "prices": {}}
_key = os.getenv("PREDICT_OPERATOR_KEY", "")
if not _key and os.path.exists(os.path.join(os.path.dirname(__file__), "..", ".predict_operator_key")):
    _key = open(os.path.join(os.path.dirname(__file__), "..", ".predict_operator_key")).read().strip()
_acct = Account.from_key(_key) if _key else None
_nonce_lock = asyncio.Lock()


# ───────────────────────── prices ─────────────────────────
async def _hl_marks(s: aiohttp.ClientSession) -> dict[str, float]:
    async with s.post("https://api.hyperliquid.xyz/info", json={"type": "allMids"}, timeout=aiohttp.ClientTimeout(total=6)) as r:
        j = await r.json()
    return {c: float(j[c]) for c in HL_COIN.values() if c in j}


async def _binance(s: aiohttp.ClientSession) -> dict[str, float]:
    syms = json.dumps(list(BINANCE.values()), separators=(",", ":"))
    async with s.get(f"https://api.binance.com/api/v3/ticker/price?symbols={syms}", timeout=aiohttp.ClientTimeout(total=6)) as r:
        j = await r.json()
    return {x["symbol"]: float(x["price"]) for x in j} if isinstance(j, list) else {}


async def _coinbase(s: aiohttp.ClientSession) -> dict[str, float]:
    out = {}
    async def one(m, prod):
        async with s.get(f"https://api.exchange.coinbase.com/products/{prod}/ticker", headers={"User-Agent": "arctools"}, timeout=aiohttp.ClientTimeout(total=6)) as r:
            j = await r.json()
        out[m] = float(j["price"])
    await asyncio.gather(*(one(m, p) for m, p in COINBASE.items()), return_exceptions=True)
    return out


async def _kraken(s: aiohttp.ClientSession) -> dict[str, float]:
    async with s.get("https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD", timeout=aiohttp.ClientTimeout(total=6)) as r:
        j = await r.json()
    res = j.get("result", {})
    return {m: float(res[k]["c"][0]) for m, k in KRAKEN.items() if k in res}


async def fetch_prices() -> dict[str, dict]:
    """market → {price (float), sources {hl, binance}} — median of what answered; None when nothing did."""
    out: dict[str, dict] = {}
    async with aiohttp.ClientSession() as s:
        hl, bn, cb, kr = await asyncio.gather(_hl_marks(s), _binance(s), _coinbase(s), _kraken(s), return_exceptions=True)
    hl = hl if isinstance(hl, dict) else {}; bn = bn if isinstance(bn, dict) else {}; cb = cb if isinstance(cb, dict) else {}; kr = kr if isinstance(kr, dict) else {}
    for m in MARKETS:
        src = {}
        if HL_COIN.get(m) in hl: src["hl"] = hl[HL_COIN[m]]
        if BINANCE.get(m) in bn: src["binance"] = bn[BINANCE[m]]
        if m in cb: src["coinbase"] = cb[m]
        if m in kr: src["kraken"] = kr[m]
        if not src:
            out[m] = {"price": None, "sources": src}
            continue
        vals = sorted(src.values()); med = statistics.median(vals)
        # drop a source more than 1 % off the median (stale/frozen feed); if fewer than one remains, do not post
        good = [v for v in vals if abs(v - med) / med <= 0.01]
        if not good or (len(vals) >= 2 and len(good) < 2):
            out[m] = {"price": None, "sources": src, "reason": "sources disagree"}
            continue
        out[m] = {"price": statistics.median(good), "sources": src}
    _state["prices"] = {m: {**v, "ts": int(time.time())} for m, v in out.items()}
    return out


# ───────────────────────── chain ─────────────────────────
async def _rpc(method: str, params: list):
    async with aiohttp.ClientSession() as s:
        async with s.post(NODE_RPC, json={"id": 1, "jsonrpc": "2.0", "method": method, "params": params}, timeout=aiohttp.ClientTimeout(total=25)) as r:
            j = await r.json()
    if "error" in j:
        raise RuntimeError(f"{method}: {j['error']}")
    return j.get("result")


def _c(addr: str):
    return _w3.eth.contract(address=Web3.to_checksum_address(addr), abi=ABI)


def _out_types(fn: str) -> list[str]:
    def t(o):
        return "(" + ",".join(t(x) for x in o["components"]) + ")" if o["type"].startswith("tuple") else o["type"]
    for e in ABI:
        if e.get("type") == "function" and e["name"] == fn:
            return [t(o) for o in e["outputs"]]
    raise KeyError(fn)


async def _call(addr: str, fn: str, *args) -> tuple:
    c = _c(addr)
    data = c.encode_abi(fn, args=list(args))
    raw = await _rpc("eth_call", [{"to": Web3.to_checksum_address(addr), "data": data}, "latest"])
    return _w3.codec.decode(_out_types(fn), bytes.fromhex(str(raw)[2:]))


ROUND_FIELDS = ("epoch", "startTime", "lockTime", "closeTime", "lockPrice", "closePrice", "upAmount", "downAmount", "rewardBase", "rewardAmount", "fee", "status", "winner")


async def read_round(addr: str, epoch: int) -> dict:
    r = await _call(addr, "rounds", epoch)          # public mapping getter: 13 flat outputs
    return dict(zip(ROUND_FIELDS, r))


async def read_state(addr: str) -> dict:
    ep, gs, gl, paused = await asyncio.gather(_call(addr, "currentEpoch"), _call(addr, "genesisStarted"), _call(addr, "genesisLocked"), _call(addr, "paused"))
    return {"currentEpoch": ep[0], "genesisStarted": gs[0], "genesisLocked": gl[0], "paused": paused[0]}


async def _send(addr: str, fn: str, *args) -> dict:
    if not _acct:
        raise RuntimeError("no operator key")
    c = _c(addr)
    data = c.encode_abi(fn, args=list(args))
    async with _nonce_lock:
        nonce = int(str(await _rpc("eth_getTransactionCount", [_acct.address, "pending"])), 16)
        gas_price = int(str(await _rpc("eth_gasPrice", [])), 16)
        tx = {"chainId": CHAIN_ID, "data": data, "gas": 400_000, "gasPrice": gas_price, "nonce": nonce, "to": Web3.to_checksum_address(addr), "value": 0}
        try:
            est = int(str(await _rpc("eth_estimateGas", [{"from": _acct.address, "to": tx["to"], "data": data}])), 16)
            tx["gas"] = int(est * 1.5) + 60_000
        except Exception as e:  # a revert here means the round is not ready — surface it, do not spend gas
            raise RuntimeError(f"estimate {fn}: {e}") from e
        signed = _acct.sign_transaction(tx)
        h = str(await _rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex().removeprefix("0x")]))
    for _ in range(30):
        await asyncio.sleep(1.5)
        rc = await _rpc("eth_getTransactionReceipt", [h])
        if rc:
            ok = int(str(rc.get("status") or "0x0"), 16) == 1
            return {"tx": h, "ok": ok, "gas": int(str(rc.get("gasUsed") or "0x0"), 16), "block": int(str(rc.get("blockNumber") or "0x0"), 16)}
    return {"tx": h, "ok": False, "reason": "no receipt"}


# ───────────────────────── storage ─────────────────────────
async def init() -> None:
    await db.execute(text("""CREATE TABLE IF NOT EXISTS predict_prices (
        market VARCHAR(16), epoch BIGINT, kind VARCHAR(8), price NUMERIC(24,8), sources JSONB, ts BIGINT, tx VARCHAR(80), block BIGINT,
        PRIMARY KEY (market, epoch, kind))"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS predict_rounds (
        market VARCHAR(16), epoch BIGINT, lock_time BIGINT, close_time BIGINT, lock_price NUMERIC(24,8), close_price NUMERIC(24,8),
        up_amount NUMERIC(38,0), down_amount NUMERIC(38,0), reward_amount NUMERIC(38,0), fee NUMERIC(38,0), status SMALLINT, winner SMALLINT, updated BIGINT,
        PRIMARY KEY (market, epoch))"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS predict_rounds_time ON predict_rounds (market, close_time DESC)"))
    _state["operator"] = _acct.address if _acct else None


async def _store_round(market: str, r: dict) -> None:
    await db.execute(text("""INSERT INTO predict_rounds (market, epoch, lock_time, close_time, lock_price, close_price, up_amount, down_amount, reward_amount, fee, status, winner, updated)
        VALUES (:m, :e, :lt, :ct, :lp, :cp, CAST(:ua AS NUMERIC), CAST(:da AS NUMERIC), CAST(:ra AS NUMERIC), CAST(:f AS NUMERIC), :s, :w, :u)
        ON CONFLICT (market, epoch) DO UPDATE SET lock_time=EXCLUDED.lock_time, close_time=EXCLUDED.close_time, lock_price=EXCLUDED.lock_price, close_price=EXCLUDED.close_price,
        up_amount=EXCLUDED.up_amount, down_amount=EXCLUDED.down_amount, reward_amount=EXCLUDED.reward_amount, fee=EXCLUDED.fee, status=EXCLUDED.status, winner=EXCLUDED.winner, updated=EXCLUDED.updated""")
        .bindparams(m=market, e=int(r["epoch"]), lt=int(r["lockTime"]), ct=int(r["closeTime"]), lp=r["lockPrice"] / 10 ** PRICE_DEC, cp=r["closePrice"] / 10 ** PRICE_DEC,
                    ua=str(r["upAmount"]), da=str(r["downAmount"]), ra=str(r["rewardAmount"]), f=str(r["fee"]), s=int(r["status"]), w=int(r["winner"]), u=int(time.time())))


async def _store_price(market: str, epoch: int, kind: str, price: float, sources: dict, tx: str, block: int) -> None:
    await db.execute(text("INSERT INTO predict_prices (market, epoch, kind, price, sources, ts, tx, block) VALUES (:m, :e, :k, :p, CAST(:s AS JSONB), :t, :x, :b) ON CONFLICT DO NOTHING")
                     .bindparams(m=market, e=epoch, k=kind, p=price, s=json.dumps(sources), t=int(time.time()), x=tx, b=block))


# ───────────────────────── operator loop ─────────────────────────
async def _tick_market(market: str, cfg: dict, prices: dict[str, dict]) -> None:
    addr = cfg["address"]
    st = await read_state(addr)
    ms = _state["markets"].setdefault(market, {"address": addr, "interval": cfg["interval"], "buffer": cfg["buffer"]})
    ms.update({"currentEpoch": st["currentEpoch"], "paused": st["paused"], "checked": int(time.time())})
    if st["paused"]:
        return
    now = int(time.time())
    if not st["genesisStarted"]:
        r = await _send(addr, "genesisStart"); ms["last"] = {"fn": "genesisStart", **r}; log.info("%s genesisStart %s", market, r)
        return
    cur = await read_round(addr, st["currentEpoch"])
    prev = await read_round(addr, st["currentEpoch"] - 1) if st["currentEpoch"] >= 2 else None
    ms["rounds"] = {str(int(r["epoch"])): {k: (str(v) if k in ("upAmount", "downAmount", "rewardBase", "rewardAmount", "fee") else int(v)) for k, v in r.items()} for r in (prev, cur) if r}
    ms["genesisStarted"] = st["genesisStarted"]; ms["genesisLocked"] = st["genesisLocked"]
    # nothing to do until the current round's lockTime; fire ≥ 2 s after it and well inside the buffer
    if now < cur["lockTime"] + 2:
        return
    if now > cur["lockTime"] + cfg["buffer"] - 5:
        # too late to lock: the contract will cancel it when we call; we still call so the schedule rolls on
        ms["late"] = ms.get("late", 0) + 1
    p = prices.get(market) or {}
    if p.get("price") is None:
        ms["last_error"] = f"no price: {p.get('reason', 'sources down')}"
        return
    price_int = int(round(p["price"] * 10 ** PRICE_DEC))
    fn = "genesisLock" if not st["genesisLocked"] else "executeRound"
    try:
        r = await _send(addr, fn, price_int)
    except Exception as e:
        ms["last_error"] = str(e)[:200]
        return
    ms["last"] = {"fn": fn, "price": p["price"], **r}
    ms.pop("last_error", None)
    if r.get("ok"):
        try:
            # lock price of the current round; close price of the previous one (same value)
            await _store_price(market, st["currentEpoch"], "lock", p["price"], p["sources"], r["tx"], r["block"])
            if fn == "executeRound":
                await _store_price(market, st["currentEpoch"] - 1, "close", p["price"], p["sources"], r["tx"], r["block"])
                await _store_round(market, await read_round(addr, st["currentEpoch"] - 1))
            await _store_round(market, await read_round(addr, st["currentEpoch"]))
            if st["currentEpoch"] >= 3: await _store_round(market, await read_round(addr, st["currentEpoch"] - 2))   # backfill a round whose write failed last time
            ms.pop("store_error", None)
        except Exception as e:  # noqa - the chain is the source of truth; the DB mirror must not stop the schedule
            ms["store_error"] = str(e)[:300]
            log.warning("predict store %s: %s", market, e)


async def operator_loop() -> None:
    await init()
    if not _acct:
        log.warning("predict: no operator key — loop idle")
        return
    if not MARKETS:
        log.warning("predict: no markets in ArcPredict.deploy.json")
        return
    log.info("predict operator %s markets %s", _acct.address, list(MARKETS))
    while True:
        try:
            # wake up just after the earliest lockTime among markets; poll every 2 s otherwise
            prices = await fetch_prices()
            await asyncio.gather(*(_tick_market(m, cfg, prices) for m, cfg in MARKETS.items()), return_exceptions=True)
            bal = int(str(await _rpc("eth_getBalance", [_acct.address, "latest"])), 16) / 1e18
            _state["operator_balance"] = bal
            _state["last_error"] = None if bal > 0.5 else "operator balance low"
        except Exception as e:  # noqa
            _state["last_error"] = str(e)[:200]
        await asyncio.sleep(2)


# ───────────────────────── HTTP API ─────────────────────────
CORS = {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}


async def api_state(req: web.Request) -> web.Response:
    """what the UI polls every second — served from the operator loop's memory (it reads the chain every 2 s), no RPC per request"""
    out = {"operator": _state.get("operator"), "operator_balance": _state.get("operator_balance"), "ts": int(time.time()), "markets": {}, "prices": _state.get("prices", {}), "error": _state.get("last_error")}
    for m, cfg in MARKETS.items():
        ms = _state["markets"].get(m, {})
        out["markets"][m] = {"address": cfg["address"], "interval": cfg["interval"], "buffer": cfg["buffer"], "minBet": cfg["minBet"], "maxBet": cfg["maxBet"], "feeBps": cfg["feeBps"],
                             "currentEpoch": ms.get("currentEpoch"), "paused": ms.get("paused"), "genesisStarted": ms.get("genesisStarted"), "genesisLocked": ms.get("genesisLocked"),
                             "rounds": ms.get("rounds", {}), "last": ms.get("last"), "last_error": ms.get("last_error"), "store_error": ms.get("store_error"), "checked": ms.get("checked")}
    return web.json_response(out, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=1"})


async def api_rounds(req: web.Request) -> web.Response:
    """resolved history for one market: ?market=BTC/USD&n=50"""
    m = req.query.get("market", "BTC/USD"); n = min(int(req.query.get("n", "50")), 500)
    rows = await db.fetchall(text("SELECT epoch, lock_time, close_time, lock_price, close_price, up_amount, down_amount, reward_amount, fee, status, winner FROM predict_rounds WHERE market = :m AND status IN (2,3) ORDER BY epoch DESC LIMIT :n").bindparams(m=m, n=n))
    def conv(k, v):
        if k in ("lock_price", "close_price"): return float(v)
        if k in ("up_amount", "down_amount", "reward_amount", "fee"): return str(int(v or 0))    # NUMERIC → exact integer string (no 1.00E+18)
        return int(v)
    return web.json_response({"market": m, "rounds": [{k: conv(k, v) for k, v in dict(r).items()} for r in rows]}, headers={**CORS, "Cache-Control": "public, max-age=5"})


async def api_price_log(req: web.Request) -> web.Response:
    """every posted price with its sources — the audit trail: ?market=BTC/USD&n=200"""
    m = req.query.get("market", "BTC/USD"); n = min(int(req.query.get("n", "200")), 2000)
    rows = await db.fetchall(text("SELECT epoch, kind, price, sources, ts, tx, block FROM predict_prices WHERE market = :m ORDER BY epoch DESC, kind LIMIT :n").bindparams(m=m, n=n))
    return web.json_response({"market": m, "prices": [{"epoch": int(r["epoch"]), "kind": r["kind"], "price": float(r["price"]), "sources": r["sources"], "ts": int(r["ts"]), "tx": r["tx"], "block": int(r["block"] or 0)} for r in rows]}, headers={**CORS, "Cache-Control": "public, max-age=5"})


async def api_stats(req: web.Request) -> web.Response:
    rows = await db.fetchall(text("SELECT market, COUNT(*) n, COALESCE(SUM(up_amount + down_amount),0) vol, COALESCE(SUM(fee),0) fee FROM predict_rounds WHERE status = 2 GROUP BY market"))
    tot = await db.fetchone(text("SELECT COUNT(*) n, COALESCE(SUM(up_amount + down_amount),0) vol, COALESCE(SUM(fee),0) fee FROM predict_rounds WHERE status = 2"))
    f = lambda x: float(x or 0) / 1e18
    return web.json_response({"total": {"rounds": int(tot["n"]), "volume_usdc": f(tot["vol"]), "fees_usdc": f(tot["fee"])}, "markets": {r["market"]: {"rounds": int(r["n"]), "volume_usdc": f(r["vol"]), "fees_usdc": f(r["fee"])} for r in rows}}, headers={**CORS, "Cache-Control": "public, max-age=30"})


def register(app: web.Application) -> None:
    app.router.add_get("/api/predict/state", api_state)
    app.router.add_get("/api/predict/rounds", api_rounds)
    app.router.add_get("/api/predict/price", api_price_log)
    app.router.add_get("/api/predict/stats", api_stats)
