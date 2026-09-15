"""Limit / take-profit / stop-loss orders for the website — keeper + HTTP API.

Non-custodial: the maker signs an EIP-712 Order in the browser and grants ArcOrders an allowance. We only decide WHEN
to call ArcOrders.execute(); the contract refuses any fill worse than the maker's signed minRate (see ArcOrders.sol).

Trigger semantics (price = USDC per token, from our swap index; mcap = price × total supply):
  limit  (buy)  → fire when price <= trigger_price
  tp     (sell) → fire when price >= trigger_price
  sl     (sell) → fire when price <= trigger_price
Route legs come from the website's /api/swaproute (same router the Quick Buy uses).
"""
import asyncio
import json
import logging
import os
import time

import aiohttp
from sqlalchemy import text

from . import db

log = logging.getLogger("orders")

ORDERS_ADDR = os.getenv("ORDERS_ADDR", "0x1abE31ba5d3c496635EFd35CB0B7f7d86BA30aF2")
KEEPER_KEY = os.getenv("KEEPER_KEY", "")
USDC_FACADE = "0x3600000000000000000000000000000000000000"
SITE = os.getenv("SITE_ORIGIN", "https://arctools.fun")
RPCS = ["https://rpc.arc-scan.org", "https://rpc-production-ba7a.up.railway.app", "https://sharc.fun/rpc"]
SEND_AUTH = os.getenv("RPC_SEND_AUTH", "")
CHAIN_ID = 5042
LOOP_S = 8
MAX_ATTEMPTS = 40           # a "slippage"/route failure is not fatal — the market moves; we retry on later ticks

DOMAIN = {"name": "ArcOrders", "version": "1", "chainId": CHAIN_ID, "verifyingContract": ORDERS_ADDR}
ORDER_TYPES = {"Order": [
    {"name": "maker", "type": "address"}, {"name": "token", "type": "address"}, {"name": "isBuy", "type": "bool"},
    {"name": "amountIn", "type": "uint256"}, {"name": "minRate", "type": "uint256"}, {"name": "expiry", "type": "uint256"},
    {"name": "salt", "type": "uint256"}]}

ABI = json.load(open(os.path.join(os.path.dirname(__file__), "orders_abi.json")))


def keeper_address() -> str | None:
    if not KEEPER_KEY:
        return None
    from eth_account import Account
    return Account.from_key(KEEPER_KEY).address


async def init():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS orders (
        hash VARCHAR(66) PRIMARY KEY, maker VARCHAR(64) NOT NULL, token VARCHAR(64) NOT NULL, is_buy BOOLEAN NOT NULL,
        amount_in TEXT NOT NULL, min_rate TEXT NOT NULL, expiry BIGINT NOT NULL, salt TEXT NOT NULL, sig TEXT NOT NULL,
        kind VARCHAR(8) NOT NULL, trigger_price DOUBLE PRECISION NOT NULL, trigger_mcap DOUBLE PRECISION, symbol VARCHAR(32),
        status VARCHAR(12) NOT NULL DEFAULT 'open', note TEXT, attempts INTEGER DEFAULT 0, created_ts BIGINT, updated_ts BIGINT,
        fill_tx VARCHAR(80), fill_out TEXT, fill_price DOUBLE PRECISION, fill_ts BIGINT)"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS orders_maker ON orders (maker, status)"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS orders_token ON orders (token, status)"))
    if KEEPER_KEY:
        asyncio.create_task(keeper_loop(), name="orders-keeper")
        log.info("orders keeper %s on %s", keeper_address(), ORDERS_ADDR)
    else:
        log.warning("orders: KEEPER_KEY missing — API only, no execution")


# ---------------------------------------------------------------- helpers
def _row(r) -> dict:
    d = dict(r)
    d["is_buy"] = bool(d["is_buy"])
    return d


def order_hash(o: dict) -> str:
    from eth_account.messages import encode_typed_data
    from eth_utils import keccak
    msg = encode_typed_data(domain_data=DOMAIN, message_types=ORDER_TYPES, message_data=o)
    return "0x" + keccak(b"\x19\x01" + msg.header + msg.body).hex()


def recover_maker(o: dict, sig: str) -> str:
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    return Account.recover_message(encode_typed_data(domain_data=DOMAIN, message_types=ORDER_TYPES, message_data=o), signature=sig)


async def _rpc(method: str, params: list, send: bool = False):
    last = None
    async with aiohttp.ClientSession() as s:
        for url in RPCS:
            hdr = {"X-Priority": "high", "X-Relay-Key": os.getenv("RELAY_KEY", "")}
            if send and "railway" in url:
                if not SEND_AUTH:
                    continue
                hdr["X-Send-Auth"] = SEND_AUTH
            for _ in range(2):
                try:
                    async with s.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, headers=hdr,
                                      timeout=aiohttp.ClientTimeout(total=20)) as r:
                        j = await r.json(content_type=None)
                    if "result" in j:
                        return j["result"]
                    last = j.get("error")
                    msg = str(last).lower()
                    if "revert" in msg or "nonce" in msg or "already known" in msg or "insufficient funds" in msg or "execution" in msg:
                        raise RuntimeError(str(last))
                except RuntimeError:
                    raise
                except Exception as e:  # noqa
                    last = str(e)
    raise RuntimeError(f"rpc {method}: {str(last)[:160]}")


async def _erc20_u256(token: str, data: str) -> int:
    r = await _rpc("eth_call", [{"to": token, "data": data}, "latest"])
    return int(r, 16) if r and r != "0x" else 0


def _p32(a: str) -> str:
    return a.lower().replace("0x", "").rjust(64, "0")


async def allowance_ok(o: dict) -> tuple[bool, str]:
    """Maker must hold the input and have approved ArcOrders for it (buys: amountIn + fee in USDC facade)."""
    spender = _p32(ORDERS_ADDR); maker = _p32(o["maker"])
    if o["is_buy"]:
        # USDC facade is 6-decimals over the 18-decimals native balance: 1 facade unit = 1e12 wei
        need = (int(o["amount_in"]) * 101 // 100 + 10**12 - 1) // 10**12
        tok = USDC_FACADE; what = "USDC"; dec = 1e6
    else:
        need = int(o["amount_in"]); tok = o["token"]; what = o.get("symbol") or "tokens"; dec = 1e18
    bal, alw = await asyncio.gather(_erc20_u256(tok, "0x70a08231" + maker), _erc20_u256(tok, "0xdd62ed3e" + maker + spender))
    if bal < need:
        return False, f"waiting: wallet holds too little {what} ({bal / dec:,.4f}, needs {need / dec:,.4f})"
    if alw < need:
        return False, f"waiting: approve {what} for ArcOrders"
    return True, ""


async def current_price(token: str) -> float | None:
    """USDC per token from the freshest indexed swap (price1m = USDC per 1M tokens)."""
    r = await db.fetchone(text("SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 AND usdc >= 0.2 ORDER BY ts DESC LIMIT 1").bindparams(t=token.lower()))
    return float(r["price1m"]) / 1e6 if r else None


def triggered(o: dict, price: float) -> bool:
    k = o["kind"]; tp = float(o["trigger_price"])
    if k == "limit":
        return price <= tp
    if k == "tp":
        return price >= tp
    if k == "sl":
        return price <= tp
    return False


async def fetch_route(token: str, side: str, amount: str) -> dict:
    async with aiohttp.ClientSession() as s:
        async with s.get(f"{SITE}/api/swaproute", params={"token": token, "side": side, "amount": amount},
                         timeout=aiohttp.ClientTimeout(total=25)) as r:
            return await r.json(content_type=None)


def _legs_tuple(legs: list[dict]) -> list[tuple]:
    zero = "0x0000000000000000000000000000000000000000"
    out = []
    for l in legs:
        k = l.get("key") or {}
        key = (k.get("currency0", zero), k.get("currency1", zero), int(k.get("fee", 0)), int(k.get("tickSpacing", 0)), k.get("hooks", zero))
        out.append((int(l["venue"]), l.get("target") or zero, int(l.get("fee") or 0), key, int(l["amount"])))
    return out


async def execute(o: dict) -> tuple[bool, str]:
    """Route → simulate → send → wait. Returns (filled, note)."""
    from eth_account import Account
    from web3 import Web3
    acct = Account.from_key(KEEPER_KEY)
    side = "buy" if o["is_buy"] else "sell"
    try:
        route = await fetch_route(o["token"], side, o["amount_in"])
    except Exception as e:  # noqa
        return False, f"route: {str(e)[:80]}"
    legs = route.get("legs") or []
    if not legs:
        return False, f"route: {route.get('error') or 'no legs'}"
    # keep leg sums exactly equal to amountIn (router splits may round)
    diff = int(o["amount_in"]) - sum(int(l["amount"]) for l in legs)
    if diff:
        legs[0]["amount"] = str(int(legs[0]["amount"]) + diff)
    w3 = Web3()
    c = w3.eth.contract(address=Web3.to_checksum_address(ORDERS_ADDR), abi=ABI)
    order_t = (Web3.to_checksum_address(o["maker"]), Web3.to_checksum_address(o["token"]), bool(o["is_buy"]), int(o["amount_in"]),
               int(o["min_rate"]), int(o["expiry"]), int(o["salt"]))
    sig = bytes.fromhex(o["sig"][2:]) if o["sig"].startswith("0x") else bytes.fromhex(o["sig"])
    data = c.encode_abi("execute", args=[order_t, sig, _legs_tuple(legs)])
    call = {"from": acct.address, "to": ORDERS_ADDR, "data": data}
    try:
        await _rpc("eth_call", [call, "latest"])
    except RuntimeError as e:
        msg = str(e)
        reason = "slippage (market moved past your limit)" if "slippage" in msg else "closed on-chain" if "closed" in msg else \
            "expired" if "expired" in msg else msg[:120]
        return False, f"sim: {reason}"
    try:
        gas = int(await _rpc("eth_estimateGas", [call]), 16)
    except Exception:  # noqa
        gas = 900_000
    nonce = int(await _rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
    gas_price = int(await _rpc("eth_gasPrice", []), 16)
    tx = {"to": Web3.to_checksum_address(ORDERS_ADDR), "value": 0, "gas": int(gas * 1.3) + 30_000, "gasPrice": int(gas_price * 1.2),
          "nonce": nonce, "chainId": CHAIN_ID, "data": data}
    signed = acct.sign_transaction(tx)
    raw = signed.raw_transaction if hasattr(signed, "raw_transaction") else signed.rawTransaction
    h = await _rpc("eth_sendRawTransaction", ["0x" + raw.hex()], send=True)
    for _ in range(45):
        await asyncio.sleep(2)
        try:
            rc = await _rpc("eth_getTransactionReceipt", [h])
        except Exception:  # noqa
            rc = None
        if rc:
            if int(rc.get("status", "0x0"), 16) != 1:
                return False, f"reverted on-chain {h}"
            out = None
            for lg in rc.get("logs", []):
                if lg.get("address", "").lower() == ORDERS_ADDR.lower() and len(lg.get("topics", [])) == 4:
                    try:
                        ev = c.events.Filled().process_log({"topics": [bytes.fromhex(t[2:]) for t in lg["topics"]], "data": bytes.fromhex(lg["data"][2:]),
                                                            "address": lg["address"], "blockHash": b"\x00" * 32, "blockNumber": 0, "logIndex": 0,
                                                            "transactionHash": b"\x00" * 32, "transactionIndex": 0})
                        out = int(ev["args"]["amountOut"])
                    except Exception:  # noqa
                        pass
            await db.execute(text("UPDATE orders SET status='filled', fill_tx=:h, fill_out=:o, fill_ts=:ts, note=NULL, updated_ts=:ts WHERE hash=:x")
                             .bindparams(h=h, o=str(out) if out is not None else None, ts=int(time.time()), x=o["hash"]))
            return True, h
    return False, f"sent {h}, receipt pending"


# ---------------------------------------------------------------- keeper loop
async def keeper_tick():
    now = int(time.time())
    await db.execute(text("UPDATE orders SET status='expired', updated_ts=:n WHERE status='open' AND expiry < :n").bindparams(n=now))
    rows = [_row(r) for r in await db.fetchall(text("SELECT * FROM orders WHERE status='open' ORDER BY created_ts"))]
    if not rows:
        return
    prices: dict[str, float | None] = {}
    for o in rows:
        t = o["token"].lower()
        if t not in prices:
            prices[t] = await current_price(t)
        p = prices[t]
        if p is None or not triggered(o, p):
            continue
        ok, why = await allowance_ok(o)
        if not ok:
            if o.get("note") != why:
                await db.execute(text("UPDATE orders SET note=:w, updated_ts=:n WHERE hash=:h").bindparams(w=why, n=now, h=o["hash"]))
            continue
        filled, note = await execute(o)
        if filled:
            await db.execute(text("UPDATE orders SET fill_price=:p WHERE hash=:h").bindparams(p=p, h=o["hash"]))
            log.info("order %s filled %s", o["hash"][:10], note)
            asyncio.create_task(_notify_fill(o, p, note))
        else:
            att = int(o.get("attempts") or 0) + 1
            status = "failed" if (att >= MAX_ATTEMPTS and not note.startswith("sim: slippage")) or note.startswith("reverted") else "open"
            await db.execute(text("UPDATE orders SET note=:w, attempts=:a, status=:s, updated_ts=:n WHERE hash=:h")
                             .bindparams(w=note, a=att, s=status, n=now, h=o["hash"]))
            log.info("order %s not filled: %s", o["hash"][:10], note)


async def keeper_loop():
    await asyncio.sleep(15)
    while True:
        try:
            await keeper_tick()
        except Exception as e:  # noqa
            log.warning("keeper tick: %s", e)
        await asyncio.sleep(LOOP_S)


async def _notify_fill(o: dict, price: float, tx: str):
    """Site users poll /api/orders; if the maker is also a sniper-bot wallet we could ping Telegram later."""
    try:
        await db.execute(text("CREATE TABLE IF NOT EXISTS order_events (id SERIAL PRIMARY KEY, hash VARCHAR(66), maker VARCHAR(64), kind VARCHAR(8), "
                              "token VARCHAR(64), symbol VARCHAR(32), tx VARCHAR(80), price DOUBLE PRECISION, ts BIGINT, seen BOOLEAN DEFAULT FALSE)"))
        await db.execute(text("INSERT INTO order_events (hash, maker, kind, token, symbol, tx, price, ts) VALUES (:h,:m,:k,:t,:s,:x,:p,:ts)")
                         .bindparams(h=o["hash"], m=o["maker"].lower(), k=o["kind"], t=o["token"].lower(), s=o.get("symbol"), x=tx, p=price, ts=int(time.time())))
    except Exception as e:  # noqa
        log.debug("order event: %s", e)


# ---------------------------------------------------------------- HTTP API
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "content-type"
    resp.headers["Cache-Control"] = "no-store"
    return resp


async def api_config(request):
    from aiohttp import web
    return _cors(web.json_response({"orders": ORDERS_ADDR, "keeper": keeper_address(), "usdc": USDC_FACADE, "chainId": CHAIN_ID,
                                    "domain": DOMAIN, "types": ORDER_TYPES, "feeBps": 100, "active": bool(KEEPER_KEY)}))


async def api_create(request):
    from aiohttp import web
    try:
        b = await request.json()
        o = b["order"]; kind = b["kind"]
        sig = str(b["sig"]).strip().lower()
        sig = "0x" + sig.replace("0x", "")
        assert len(sig) == 132, "sig length"
        assert kind in ("limit", "tp", "sl"), "kind"
        od = {"maker": o["maker"], "token": o["token"], "isBuy": bool(o["isBuy"]), "amountIn": int(o["amountIn"]),
              "minRate": int(o["minRate"]), "expiry": int(o["expiry"]), "salt": int(o["salt"])}
        assert (kind == "limit") == od["isBuy"], "side/kind mismatch"
        assert od["amountIn"] > 0 and od["expiry"] > time.time() + 60, "amount/expiry"
        assert recover_maker(od, sig).lower() == od["maker"].lower(), "bad signature"
        h = order_hash(od)
        tp = float(b["trigger_price"]); assert tp > 0, "trigger"
        await db.execute(text(
            "INSERT INTO orders (hash, maker, token, is_buy, amount_in, min_rate, expiry, salt, sig, kind, trigger_price, trigger_mcap, symbol, status, created_ts, updated_ts) "
            "VALUES (:h,:m,:t,:b,:a,:r,:e,:s,:g,:k,:tp,:tm,:sy,'open',:n,:n) ON CONFLICT (hash) DO NOTHING").bindparams(
            h=h, m=od["maker"].lower(), t=od["token"].lower(), b=od["isBuy"], a=str(od["amountIn"]), r=str(od["minRate"]), e=od["expiry"], s=str(od["salt"]),
            g=sig, k=kind, tp=tp, tm=b.get("trigger_mcap"), sy=(b.get("symbol") or "")[:32], n=int(time.time())))
        # immediate allowance check so the UI can show "approve first" right away
        row = _row(await db.fetchone(text("SELECT * FROM orders WHERE hash=:h").bindparams(h=h)))
        ok, why = await allowance_ok(row)
        if not ok:
            await db.execute(text("UPDATE orders SET note=:w WHERE hash=:h").bindparams(w=why, h=h))
        return _cors(web.json_response({"ok": True, "hash": h, "note": None if ok else why}))
    except Exception as e:  # noqa
        return _cors(web.json_response({"ok": False, "error": str(e)[:160]}, status=400))


async def api_list(request):
    from aiohttp import web
    maker = (request.query.get("maker") or "").lower()
    token = (request.query.get("token") or "").lower()
    if not maker and not token:
        return _cors(web.json_response({"orders": []}))
    q = "SELECT * FROM orders WHERE 1=1"
    p = {}
    if maker:
        q += " AND maker=:m"; p["m"] = maker
    if token:
        q += " AND token=:t"; p["t"] = token
    q += " ORDER BY (status='open') DESC, created_ts DESC LIMIT 100"
    rows = [_row(r) for r in await db.fetchall(text(q).bindparams(**p))]
    for r in rows:
        r.pop("sig", None)
    ev = []
    if maker:
        try:
            ev = [dict(x) for x in await db.fetchall(text("SELECT * FROM order_events WHERE maker=:m AND seen=FALSE ORDER BY ts DESC LIMIT 10").bindparams(m=maker))]
            if ev:
                await db.execute(text("UPDATE order_events SET seen=TRUE WHERE maker=:m").bindparams(m=maker))
        except Exception:  # noqa
            ev = []
    return _cors(web.json_response({"orders": rows, "events": ev, "ts": int(time.time())}))


async def api_cancel(request):
    """Off-chain cancel: maker signs 'ArcTools cancel order\\nhash: <h>\\nts: <ts>' (personal_sign). The keeper stops immediately;
    the maker may additionally call cancel() on-chain for a trustless backstop."""
    from aiohttp import web
    try:
        b = await request.json()
        h = b["hash"]; ts = int(b["ts"]); sig = b["sig"]
        assert abs(time.time() - ts) < 600, "stale"
        from eth_account import Account
        from eth_account.messages import encode_defunct
        who = Account.recover_message(encode_defunct(text=f"ArcTools cancel order\nhash: {h}\nts: {ts}"), signature=sig).lower()
        r = await db.fetchone(text("SELECT maker, status FROM orders WHERE hash=:h").bindparams(h=h))
        assert r and r["maker"].lower() == who, "not your order"
        if r["status"] == "open":
            await db.execute(text("UPDATE orders SET status='cancelled', updated_ts=:n WHERE hash=:h").bindparams(n=int(time.time()), h=h))
        return _cors(web.json_response({"ok": True}))
    except Exception as e:  # noqa
        return _cors(web.json_response({"ok": False, "error": str(e)[:120]}, status=400))


async def api_options(request):
    from aiohttp import web
    return _cors(web.Response(status=204))


def register(app):
    app.router.add_get("/api/orders/config", api_config)
    app.router.add_get("/api/orders", api_list)
    app.router.add_post("/api/orders", api_create)
    app.router.add_post("/api/orders/cancel", api_cancel)
    app.router.add_options("/api/orders", api_options)
    app.router.add_options("/api/orders/cancel", api_options)
