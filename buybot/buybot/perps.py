"""ArcTools Perps operator + keeper.

Prices (pull oracle, signed, served over HTTP — the UI attaches the signature to its own tx):
  kind 0 (Arc tokens): 5-minute USDC-weighted TWAP of the pool from our swap index; a print that moves the TWAP more
                       than 10 % in one refresh is ignored until the next candle confirms it. feedLive is always true.
  kind 1 (tokenized stocks): Nasdaq + CNBC quotes (regular and extended hours). Both fresh (≤ 5 min) and within 1 % of
                       each other → feedLive = true, price = mean. Otherwise feedLive = false and the price is the Arc
                       pool TWAP of the tokenized stock; the contract clamps it into ±corridor of the last live price.
Keeper: liquidates positions whose equity fell to the maintenance level (checked with the current signed price via
        eth_estimateGas → send only when it will not revert), posts a price per market every hour so funding accrues,
        indexes Opened/Closed events into perps_positions, and pauses new opens if the fund draws down ≥ 15 %.
"""
from __future__ import annotations

import asyncio, json, logging, os, time
import aiohttp
from aiohttp import web
from eth_abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import text
from web3 import Web3

from . import db

log = logging.getLogger("perps")
HERE = os.path.dirname(__file__)
NODE_RPC = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
SEND_RPCS = ["https://arctools.fun/api/rpc", "https://rpc.arc-scan.org", NODE_RPC]
CHAIN_ID = 5042; U = 10 ** 18; P8 = 10 ** 8
DEPLOY = json.load(open(os.path.join(HERE, "..", "ArcPerps.deploy.json"))) if os.path.exists(os.path.join(HERE, "..", "ArcPerps.deploy.json")) else {}
ABI = json.load(open(os.path.join(HERE, "..", "ArcPerps.abi.json"))) if os.path.exists(os.path.join(HERE, "..", "ArcPerps.abi.json")) else []
ADDR = DEPLOY.get("address"); MARKETS = DEPLOY.get("markets", [])
_key = os.getenv("PERPS_OPERATOR_KEY", ""); _acct = Account.from_key(_key) if _key else None
_admin_key = os.getenv("PERPS_ADMIN_KEY", ""); _admin = Account.from_key(_admin_key) if _admin_key else None
ALERT_TOKEN = os.environ.get("ALERT_BOT_TOKEN", ""); ADMIN_TG = os.getenv("ADMIN_TG_ID", "8351095206")
SEED_FUND = float(os.getenv("PERPS_SEED_USDC", "800"))
_w3 = Web3(); _c = _w3.eth.contract(address=Web3.to_checksum_address(ADDR), abi=ABI) if ADDR and ABI else None
CORS = {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/151", "Accept": "application/json, text/plain, */*"}
_prices: dict[int, dict] = {}            # market id → {price, feedLive, ts, sig, source, ...}
_state: dict = {"fund": None, "paused": None, "markets": {}, "last_block": 0, "liquidations": 0, "alerts": 0, "operator": _acct.address if _acct else None}
_nonce_lock = asyncio.Lock()
_stock_cache: dict[str, dict] = {}

# ───────────────────────── rpc / tx ─────────────────────────
async def _rpc(method: str, params: list, url: str = NODE_RPC):
    async with aiohttp.ClientSession() as s:
        async with s.post(url, json={"id": 1, "jsonrpc": "2.0", "method": method, "params": params}, headers=UA, timeout=aiohttp.ClientTimeout(total=25)) as r:
            j = await r.json(content_type=None)
    if "error" in j: raise RuntimeError(f"{method}: {j['error']}")
    return j.get("result")

async def _call(fn: str, *args):
    data = _c.encode_abi(fn, args=list(args)); raw = await _rpc("eth_call", [{"to": _c.address, "data": data}, "latest"])
    outs = [o for o in ABI if o.get("type") == "function" and o["name"] == fn][0]["outputs"]
    types = [("(" + ",".join(c["type"] for c in o["components"]) + ")") if o["type"].startswith("tuple") else o["type"] for o in outs]
    from eth_abi import decode; vals = decode(types, bytes.fromhex(raw[2:])); return vals[0] if len(vals) == 1 else vals

async def _send(acct, fn: str, *args, value: int = 0) -> dict:
    data = _c.encode_abi(fn, args=list(args))
    async with _nonce_lock:
        nonce = int(str(await _rpc("eth_getTransactionCount", [acct.address, "pending"])), 16); gp = int(str(await _rpc("eth_gasPrice", [])), 16)
        est = int(str(await _rpc("eth_estimateGas", [{"from": acct.address, "to": _c.address, "data": data, "value": hex(value)}])), 16)
        tx = {"chainId": CHAIN_ID, "data": data, "gas": int(est * 1.5) + 60_000, "gasPrice": int(gp * 1.2), "nonce": nonce, "to": _c.address, "value": value}
        raw = "0x" + acct.sign_transaction(tx).raw_transaction.hex().removeprefix("0x"); h = None; err = None
        for url in SEND_RPCS:
            try: h = str(await _rpc("eth_sendRawTransaction", [raw], url)); break
            except Exception as e: err = e
        if not h: raise RuntimeError(f"broadcast: {err}")
    for _ in range(40):
        await asyncio.sleep(1.5); rc = await _rpc("eth_getTransactionReceipt", [h])
        if rc: return {"tx": h, "ok": int(str(rc.get("status") or "0x0"), 16) == 1, "gas": int(str(rc.get("gasUsed") or "0x0"), 16), "block": int(str(rc.get("blockNumber") or "0x0"), 16)}
    return {"tx": h, "ok": False, "reason": "no receipt"}

async def _tg(text_: str):
    if not ALERT_TOKEN: return
    try:
        async with aiohttp.ClientSession() as s: await s.post(f"https://api.telegram.org/bot{ALERT_TOKEN}/sendMessage", json={"chat_id": ADMIN_TG, "text": text_, "disable_web_page_preview": True}, timeout=aiohttp.ClientTimeout(total=20))
        _state["alerts"] += 1
    except Exception as e: log.warning("perps tg: %s", e)

# ───────────────────────── prices ─────────────────────────
def _sign(market: int, price: int, live: bool, ts: int) -> str:
    h = Web3.keccak(abi_encode(["uint256", "address", "uint256", "uint128", "bool", "uint64"], [CHAIN_ID, _c.address, market, price, live, ts]))
    return "0x" + Account.sign_message(encode_defunct(primitive=h), private_key=_acct.key).signature.hex().removeprefix("0x")

async def _pool_twap(token: str, minutes: int = 5) -> tuple[float | None, float | None, int]:
    """(twap USD, last USD, n) from our swap index; price1m is USD × 1e6."""
    since = int(time.time()) - minutes * 60
    r = await db.fetchone(text("SELECT SUM(price1m * usdc) / NULLIF(SUM(usdc), 0) AS twap, COUNT(*) n FROM swaps WHERE token = :t AND ts > :s AND price1m > 0 AND usdc > 0").bindparams(t=token, s=since))
    last = await db.fetchone(text("SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 AND usdc > 0 ORDER BY ts DESC LIMIT 1").bindparams(t=token))
    tw = float(r["twap"]) / 1e6 if r and r["twap"] else None; lp = float(last["price1m"]) / 1e6 if last else None
    return tw, lp, int(r["n"] or 0) if r else 0

_sq_cache: dict = {}
async def _stock_quote(sym: str) -> dict | None:
    """{price, ts} from Nasdaq + CNBC when both agree and are fresh; else None. Cached 15 s (the loop runs every 5 s)."""
    now = time.time(); out = []
    c = _sq_cache.get(sym)
    if c and now - c[0] < 15: return c[1]
    res = await _stock_quote_raw(sym, now); _sq_cache[sym] = (now, res); return res

async def _stock_quote_raw(sym: str, now: float) -> dict | None:
    out = []
    async with aiohttp.ClientSession(headers={**UA, "Accept-Language": "en-US,en;q=0.9"}) as s:
        try:
            async with s.get(f"https://api.nasdaq.com/api/quote/{sym}/info?assetclass=stocks", timeout=aiohttp.ClientTimeout(total=10)) as r:
                d = (await r.json(content_type=None))["data"]; import datetime, zoneinfo
                for blk in (d.get("secondaryData"), d.get("primaryData")):   # extended hours first when present
                    if blk and blk.get("lastSalePrice") and blk.get("lastTradeTimestamp"):
                        px = float(blk["lastSalePrice"].replace("$", "").replace(",", ""))
                        tsr = blk["lastTradeTimestamp"].replace(" ET", "").replace("DATA AS OF ", "")
                        try: t = datetime.datetime.strptime(tsr, "%b %d, %Y %I:%M %p").replace(tzinfo=zoneinfo.ZoneInfo("America/New_York")).timestamp()
                        except Exception: t = 0
                        if px > 0 and t: out.append(("nasdaq", px, t)); break
        except Exception as e: log.debug("nasdaq %s: %s", sym, str(e)[:60])
        try:
            async with s.get(f"https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols={sym}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json", timeout=aiohttp.ClientTimeout(total=10)) as r:
                q = (await r.json(content_type=None))["FormattedQuoteResult"]["FormattedQuote"][0]; import datetime
                cands = []
                for blk in (q.get("ExtendedMktQuote"), q):
                    if blk and blk.get("last") and blk.get("last_time"):
                        try: t = datetime.datetime.fromisoformat(blk["last_time"]).timestamp(); cands.append((float(str(blk["last"]).replace(",", "")), t))
                        except Exception: pass
                if cands: px, t = max(cands, key=lambda x: x[1]); out.append(("cnbc", px, t))
        except Exception as e: log.debug("cnbc %s: %s", sym, str(e)[:60])
    fresh = [o for o in out if now - o[2] <= 300]
    if not fresh: return None
    if len(fresh) == 2 and abs(fresh[0][1] - fresh[1][1]) / fresh[0][1] > 0.01: return None   # sources disagree: do not sign
    px = sum(o[1] for o in fresh) / len(fresh); return {"price": px, "ts": max(o[2] for o in fresh), "sources": [o[0] for o in fresh]}

async def refresh_prices():
    now = int(time.time())
    for m in MARKETS:
        if _state["markets"].get(m["id"], {}).get("active") is False: _prices.pop(m["id"], None); continue
        try:
            src = ""; live = True; px = None
            twap, last, n = await _pool_twap(m["token"])
            if m["kind"] == 1:
                q = await _stock_quote(m["name"].split("-")[0])
                if q: px = q["price"]; src = "live:" + "+".join(q["sources"]); live = True
                else: px = twap or last; src = "pool-twap (no feed)"; live = False
            else:
                px = twap or last; src = f"pool-twap-5m n={n}"
                prev = _prices.get(m["id"])
                if prev and px and prev["price"] > 0 and abs(px * P8 - prev["price"]) / prev["price"] > 0.10 and now - prev["ts"] < 90:
                    px = prev["price"] / P8; src += " (spike held)"
            if not px or px <= 0: continue
            price = int(round(px * P8))
            _prices[m["id"]] = {"market": m["id"], "name": m["name"], "price": price, "priceUsd": px, "feedLive": live, "ts": now, "sig": _sign(m["id"], price, live, now) if _acct else None, "source": src}
        except Exception as e:
            log.warning("perps price %s: %s", m["name"], str(e)[:100])

# ───────────────────────── chain state / indexer ─────────────────────────
async def init():
    for stmt in ("""CREATE TABLE IF NOT EXISTS perps_positions (id BIGINT PRIMARY KEY, owner VARCHAR(42), market INTEGER, is_long BOOLEAN, margin NUMERIC, notional NUMERIC, entry_price NUMERIC,
                    opened_ts BIGINT, open_tx VARCHAR(66), closed_ts BIGINT, close_tx VARCHAR(66), close_price NUMERIC, pnl NUMERIC, funding NUMERIC, fee NUMERIC, payout NUMERIC, liquidated BOOLEAN, liquidator VARCHAR(42))""",
                 "CREATE INDEX IF NOT EXISTS perps_positions_owner ON perps_positions (owner)",
                 "CREATE TABLE IF NOT EXISTS perps_cursor (k VARCHAR(8) PRIMARY KEY, block BIGINT)"):
        try: await db.execute(text(stmt))
        except Exception as e: log.warning("perps init: %s", e)
    row = await db.fetchone(text("SELECT block FROM perps_cursor WHERE k = 'evt'"))
    _state["last_block"] = int(row["block"]) if row and row["block"] else int(DEPLOY.get("block", 0))

def _topic(sig: str) -> str: return "0x" + Web3.keccak(text=sig).hex().removeprefix("0x")
T_OPEN = _topic("Opened(uint256,address,uint256,bool,uint128,uint128,uint128,uint256)"); T_CLOSE = _topic("Closed(uint256,address,uint128,int256,int256,uint256,uint256,bool,address)")

async def index_events():
    head = int(str(await _rpc("eth_blockNumber", [])), 16); frm = _state["last_block"] + 1; to = min(head, frm + 20_000)
    if to < frm: return
    logs = await _rpc("eth_getLogs", [{"address": _c.address, "fromBlock": hex(frm), "toBlock": hex(to), "topics": [[T_OPEN, T_CLOSE]]}])
    from eth_abi import decode
    for lg in logs or []:
        ts_blk = int(str((await _rpc("eth_getBlockByNumber", [lg["blockNumber"], False]))["timestamp"]), 16); pid = int(lg["topics"][1], 16)
        if lg["topics"][0] == T_OPEN:
            owner = "0x" + lg["topics"][2][-40:]; market = int(lg["topics"][3], 16); is_long, margin, notional, price, fee = decode(["bool", "uint128", "uint128", "uint128", "uint256"], bytes.fromhex(lg["data"][2:]))
            await db.execute(text("INSERT INTO perps_positions (id, owner, market, is_long, margin, notional, entry_price, opened_ts, open_tx, fee) VALUES (:i,:o,:m,:l,CAST(:mg AS NUMERIC),CAST(:n AS NUMERIC),CAST(:p AS NUMERIC),:t,:x,CAST(:f AS NUMERIC)) ON CONFLICT (id) DO NOTHING")
                             .bindparams(i=pid, o=owner.lower(), m=market, l=bool(is_long), mg=str(margin), n=str(notional), p=str(price), t=ts_blk, x=lg["transactionHash"], f=str(fee)))
        else:
            owner = "0x" + lg["topics"][2][-40:]; price, pnl, funding, fee, payout, liq, liquidator = decode(["uint128", "int256", "int256", "uint256", "uint256", "bool", "address"], bytes.fromhex(lg["data"][2:]))
            await db.execute(text("UPDATE perps_positions SET closed_ts=:t, close_tx=:x, close_price=CAST(:p AS NUMERIC), pnl=CAST(:pn AS NUMERIC), funding=CAST(:fu AS NUMERIC), fee=COALESCE(fee,0)+CAST(:f AS NUMERIC), payout=CAST(:po AS NUMERIC), liquidated=:l, liquidator=:lq WHERE id=:i")
                             .bindparams(t=ts_blk, x=lg["transactionHash"], p=str(price), pn=str(pnl), fu=str(funding), f=str(fee), po=str(payout), l=bool(liq), lq=liquidator.lower(), i=pid))
            if liq: _state["liquidations"] += 1
    _state["last_block"] = to
    await db.execute(text("INSERT INTO perps_cursor (k, block) VALUES ('evt', :b) ON CONFLICT (k) DO UPDATE SET block = EXCLUDED.block").bindparams(b=to))

async def refresh_state():
    fund = int(await _call("fund")); paused = bool(await _call("paused")); _state["fund"] = fund / U; _state["paused"] = paused
    for m in MARKETS:
        r = await _call("markets", m["id"])
        _state["markets"][m["id"]] = {"longOI": int(r[11]) / U, "shortOI": int(r[12]) / U, "price": int(r[7]) / P8, "priceTs": int(r[8]), "feedLive": bool(r[9]), "lastFunding": int(r[15]), "fundingIndexLong": int(r[13]), "fundingIndexShort": int(r[14]), "active": bool(r[6]), "oiCap": int(r[5]) / U, "maxLevLive": int(r[2]), "maxLevOff": int(r[3])}
    if _acct: _state["operator_balance"] = int(str(await _rpc("eth_getBalance", [_acct.address, "latest"])), 16) / U

# ───────────────────────── keeper ─────────────────────────
async def keeper_pass():
    rows = await db.fetchall(text("SELECT id, market FROM perps_positions WHERE closed_ts IS NULL"))
    for r in rows:
        p = _prices.get(int(r["market"]))
        if not p or not p["sig"]: continue
        args = [int(r["id"]), p["price"], p["feedLive"], p["ts"], bytes.fromhex(p["sig"][2:])]
        try:
            await _rpc("eth_estimateGas", [{"from": _acct.address, "to": _c.address, "data": _c.encode_abi("liquidate", args=args)}])
        except Exception:
            continue                                   # "healthy" (or closed meanwhile): nothing to do
        try:
            res = await _send(_acct, "liquidate", *args); log.warning("perps: liquidated #%s on %s → %s", r["id"], p["name"], res.get("tx"))
            await _tg(f"⚡ ArcTools Perps: position #{r['id']} ({p['name']}) liquidated at {p['priceUsd']:.6g}. {res.get('tx')}")
        except Exception as e: log.warning("perps liquidate #%s: %s", r["id"], str(e)[:100])

_last_poke: dict[int, float] = {}
async def funding_poke():
    """Post a price per market at least hourly so funding indexes keep accruing even with no trades."""
    now = time.time()
    for m in MARKETS:
        ms = _state["markets"].get(m["id"]); p = _prices.get(m["id"])
        if not p or not p["sig"] or not ms: continue
        oi = ms["longOI"] + ms["shortOI"]
        if oi == 0 or now - _last_poke.get(m["id"], 0) < 3600: continue
        try: await _send(_acct, "postPrice", m["id"], p["price"], p["feedLive"], p["ts"], bytes.fromhex(p["sig"][2:])); _last_poke[m["id"]] = now
        except Exception as e: log.warning("perps poke %s: %s", m["name"], str(e)[:80])

_breaker_alerted = 0
async def circuit_breaker():
    global _breaker_alerted
    f = _state.get("fund")
    if f is None or SEED_FUND <= 0: return
    if f < SEED_FUND * 0.85 and not _state.get("paused"):
        if _admin:
            try: await _send(_admin, "setPaused", True); await _tg(f"🛑 ArcTools Perps PAUSED: fund {f:.2f} USDC < 85 % of seed ({SEED_FUND}). New opens blocked, closes work. Unpause manually.")
            except Exception as e: await _tg(f"🛑 ArcTools Perps: fund {f:.2f} USDC < 85 % of seed and auto-pause FAILED: {str(e)[:80]}")
        else: await _tg(f"🛑 ArcTools Perps: fund {f:.2f} USDC < 85 % of seed — no PERPS_ADMIN_KEY, pause it manually.")
    elif f < SEED_FUND * 0.90 and time.time() - _breaker_alerted > 3600:
        _breaker_alerted = time.time(); await _tg(f"⚠️ ArcTools Perps fund drawdown: {f:.2f} USDC ({(f / SEED_FUND - 1) * 100:.1f} % vs seed).")

async def operator_loop():
    if not _c or not _acct: log.warning("perps: no deploy json / operator key — idle"); return
    await init(); await asyncio.sleep(20); tick = 0
    while True:
        try: await refresh_prices()
        except Exception as e: log.warning("perps prices: %s", str(e)[:100])
        for name, step in (("state", refresh_state if tick % 2 == 0 else None), ("index", index_events), ("keeper", keeper_pass if tick % 3 == 0 else None), ("poke", funding_poke if tick % 18 == 0 else None), ("breaker", circuit_breaker if tick % 18 == 0 else None)):
            if not step: continue
            try: await step()
            except Exception as e: log.warning("perps %s: %s", name, str(e)[:160])
        tick += 1; await asyncio.sleep(5)

# ───────────────────────── API ─────────────────────────
async def api_price(req):
    m = req.query.get("market"); 
    if m is None: return web.json_response({"prices": list(_prices.values())}, headers=CORS)
    p = _prices.get(int(m)); return web.json_response(p or {"error": "no price"}, status=200 if p else 503, headers=CORS)

async def api_state(req):
    return web.json_response({"address": ADDR, "operator": _state.get("operator"), "operator_balance": _state.get("operator_balance"), "fund": _state.get("fund"), "paused": _state.get("paused"), "seed": SEED_FUND,
                              "markets": [{**m, **_state["markets"].get(m["id"], {}), "mark": (_prices.get(m["id"]) or {}).get("priceUsd"), "feedLive": (_prices.get(m["id"]) or {}).get("feedLive"), "source": (_prices.get(m["id"]) or {}).get("source")} for m in MARKETS],
                              "indexed_to": _state["last_block"], "liquidations": _state["liquidations"], "ts": int(time.time())}, headers=CORS)

async def api_positions(req):
    w = (req.query.get("wallet") or "").lower(); open_only = req.query.get("open") == "1"
    if not w.startswith("0x"): return web.json_response({"error": "wallet"}, status=400, headers=CORS)
    rows = await db.fetchall(text(f"SELECT * FROM perps_positions WHERE owner = :w {'AND closed_ts IS NULL' if open_only else ''} ORDER BY id DESC LIMIT 200").bindparams(w=w))
    out = []
    for r in rows:
        from decimal import Decimal
        d = dict(r); d = {k: (str(int(Decimal(str(v)))) if k in ("margin", "notional", "entry_price", "close_price", "pnl", "funding", "fee", "payout") and v is not None else v) for k, v in d.items()}
        p = _prices.get(int(d["market"])); d["mark"] = p["priceUsd"] if p else None; d["name"] = next((m["name"] for m in MARKETS if m["id"] == d["market"]), None); out.append(d)
    return web.json_response({"positions": out}, headers=CORS)

async def api_stats(req):
    r = await db.fetchone(text("SELECT COUNT(*) n, COUNT(*) FILTER (WHERE closed_ts IS NULL) open_n, COUNT(*) FILTER (WHERE liquidated) liq, COALESCE(SUM(fee),0) fees, COALESCE(SUM(pnl) FILTER (WHERE closed_ts IS NOT NULL),0) trader_pnl, COALESCE(SUM(notional),0) volume FROM perps_positions"))
    return web.json_response({"positions": int(r["n"]), "open": int(r["open_n"]), "liquidations": int(r["liq"]), "fees_usdc": float(r["fees"]) / 1e18, "trader_pnl_usdc": float(r["trader_pnl"]) / 1e18, "volume_usdc": float(r["volume"]) / 1e18, "fund": _state.get("fund")}, headers=CORS)

def register(app: web.Application) -> None:
    app.router.add_get("/api/perps/price", api_price); app.router.add_get("/api/perps/state", api_state)
    app.router.add_get("/api/perps/positions", api_positions); app.router.add_get("/api/perps/stats", api_stats)
