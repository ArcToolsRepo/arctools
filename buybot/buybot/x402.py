"""x402 settlement relayer.

The site Worker verifies a signed EIP-3009 authorization (USDC facade on Arc = Circle FiatTokenV2) and serves the data;
this module receives the verified payment and pulls the USDC on-chain with `transferWithAuthorization`, paying the gas
from a dedicated relayer key. Every payment is recorded in `x402_payments`; a payer whose settlement fails (balance spent
between verify and settle) is denylisted for 24 h — the Worker checks that list before the fast path.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import aiohttp
from aiohttp import web
from eth_account import Account
from sqlalchemy import text

from . import db

log = logging.getLogger("x402")

CHAIN_ID = 5042
NODE_RPC = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
USDC = "0x3600000000000000000000000000000000000000"
TREASURY = "0xb35c471b31d636b96f95b84e7a27d69b63235c0d"
SEL_TWA = "e3ee160e"      # transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
SEL_AUTH_STATE = "e94a0102"
AUTH = os.getenv("X402_SETTLE_AUTH", "")
_key = os.getenv("X402_RELAYER_KEY", "")
if not _key and os.path.exists(os.path.join(os.path.dirname(__file__), "..", ".x402_relayer_key")):
    _key = open(os.path.join(os.path.dirname(__file__), "..", ".x402_relayer_key")).read().strip()
_acct = Account.from_key(_key) if _key else None
_nonce_lock = asyncio.Lock()
_state: dict = {"relayer": _acct.address if _acct else None, "settled": 0, "failed": 0, "last_error": None}
_deny: dict[str, float] = {}     # payer → until ts (mirrored in DB for restarts)


def _pad(h: str) -> str:
    return h.lower().replace("0x", "").rjust(64, "0")


async def _rpc(method: str, params: list):
    async with aiohttp.ClientSession() as s:
        async with s.post(NODE_RPC, json={"id": 1, "jsonrpc": "2.0", "method": method, "params": params}, timeout=aiohttp.ClientTimeout(total=25)) as r:
            j = await r.json()
    if "error" in j:
        raise RuntimeError(f"{method}: {j['error']}")
    return j.get("result")


async def init() -> None:
    await db.execute(text("""CREATE TABLE IF NOT EXISTS x402_payments (
        key VARCHAR(80) PRIMARY KEY, payer VARCHAR(50), endpoint VARCHAR(32), amount BIGINT, nonce VARCHAR(80),
        status VARCHAR(12), tx VARCHAR(80), reason TEXT, ts BIGINT, settled_ts BIGINT)"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS x402_payments_ts ON x402_payments (ts DESC)"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS x402_payments_payer ON x402_payments (payer, ts DESC)"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS x402_deny (payer VARCHAR(50) PRIMARY KEY, until_ts BIGINT, reason TEXT)"))
    rows = await db.fetchall(text("SELECT payer, until_ts FROM x402_deny WHERE until_ts > :t").bindparams(t=int(time.time())))
    for r in rows:
        _deny[r["payer"]] = float(r["until_ts"])


def _calldata(a: dict, sig: str) -> str:
    s = sig.lower().replace("0x", "")
    r, s_, v = s[:64], s[64:128], int(s[128:130], 16)
    if v >= 27: v -= 27
    v += 27   # FiatTokenV2 expects 27/28
    return "0x" + SEL_TWA + _pad(a["from"]) + _pad(a["to"]) + _pad(hex(int(a["value"]))) + _pad(hex(int(a["validAfter"]))) + _pad(hex(int(a["validBefore"]))) + _pad(a["nonce"]) + _pad(hex(v)) + r + s_


async def _settle(key: str, payer: str, a: dict, sig: str) -> dict:
    """submit transferWithAuthorization; returns {ok, tx|reason}"""
    if not _acct:
        return {"ok": False, "reason": "no relayer key"}
    data = _calldata(a, sig)
    try:
        async with _nonce_lock:
            nonce = int(str(await _rpc("eth_getTransactionCount", [_acct.address, "pending"])), 16)
            gas_price = int(str(await _rpc("eth_gasPrice", [])), 16)
            try:
                est = int(str(await _rpc("eth_estimateGas", [{"from": _acct.address, "to": USDC, "data": data}])), 16)
            except Exception as e:  # revert at estimate = the authorization is no longer settleable (balance gone / nonce used / expired)
                return {"ok": False, "reason": f"estimate: {str(e)[:160]}"}
            tx = {"chainId": CHAIN_ID, "data": data, "gas": int(est * 1.4) + 30_000, "gasPrice": gas_price, "nonce": nonce, "to": USDC, "value": 0}
            signed = _acct.sign_transaction(tx)
            h = str(await _rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex().removeprefix("0x")]))
        for _ in range(30):
            await asyncio.sleep(1.0)
            rc = await _rpc("eth_getTransactionReceipt", [h])
            if rc:
                ok = int(str(rc.get("status") or "0x0"), 16) == 1
                return {"ok": ok, "tx": h, "block": int(str(rc.get("blockNumber") or "0x0"), 16), "gas": int(str(rc.get("gasUsed") or "0x0"), 16), **({} if ok else {"reason": "reverted"})}
        return {"ok": False, "tx": h, "reason": "no receipt in 30 s"}
    except Exception as e:  # noqa
        return {"ok": False, "reason": str(e)[:200]}


async def _settle_and_record(key: str, payer: str, endpoint: str, a: dict, sig: str) -> dict:
    res = await _settle(key, payer, a, sig)
    now = int(time.time())
    await db.execute(text("UPDATE x402_payments SET status=:s, tx=:x, reason=:r, settled_ts=:t WHERE key=:k")
                     .bindparams(s="settled" if res["ok"] else "failed", x=res.get("tx"), r=res.get("reason"), t=now, k=key))
    if res["ok"]:
        _state["settled"] += 1
    else:
        _state["failed"] += 1; _state["last_error"] = res.get("reason")
        until = now + 86400
        _deny[payer] = until
        await db.execute(text("INSERT INTO x402_deny (payer, until_ts, reason) VALUES (:p, :u, :r) ON CONFLICT (payer) DO UPDATE SET until_ts=EXCLUDED.until_ts, reason=EXCLUDED.reason")
                         .bindparams(p=payer, u=until, r=res.get("reason")))
        log.warning("x402 settlement failed for %s: %s", payer, res.get("reason"))
    return res


# ───────────────────────── HTTP ─────────────────────────
async def api_settle(req: web.Request) -> web.Response:
    """POST {key, endpoint, payment} from the Worker (shared secret). ?wait=1 blocks until the receipt (settle-first mode)."""
    if not AUTH or req.headers.get("X-Settle-Auth") != AUTH:
        return web.json_response({"ok": False, "reason": "forbidden"}, status=403)
    try:
        j = await req.json()
        a = j["payment"]["payload"]["authorization"]; sig = j["payment"]["payload"]["signature"]; key = j["key"]; endpoint = j.get("endpoint", "")
        payer = a["from"].lower()
    except Exception:
        return web.json_response({"ok": False, "reason": "bad body"}, status=400)
    if a["to"].lower() != TREASURY:
        return web.json_response({"ok": False, "reason": "payTo mismatch"}, status=400)
    if _deny.get(payer, 0) > time.time() and req.query.get("wait") != "1":
        return web.json_response({"ok": False, "reason": "payer denylisted; use ?wait=1 (settle-first)"}, status=402)
    # record first (idempotent on key)
    await db.execute(text("INSERT INTO x402_payments (key, payer, endpoint, amount, nonce, status, ts) VALUES (:k,:p,:e,:a,:n,'pending',:t) ON CONFLICT (key) DO NOTHING")
                     .bindparams(k=key, p=payer, e=endpoint, a=int(a["value"]), n=a["nonce"].lower(), t=int(time.time())))
    existing = await db.fetchone(text("SELECT status, tx FROM x402_payments WHERE key = :k").bindparams(k=key))
    if existing and existing["status"] == "settled":
        return web.json_response({"ok": True, "tx": existing["tx"], "replay": True})
    if req.query.get("wait") == "1":
        res = await _settle_and_record(key, payer, endpoint, a, sig)
        if res["ok"]:
            _deny.pop(payer, None)
            await db.execute(text("DELETE FROM x402_deny WHERE payer = :p").bindparams(p=payer))
        return web.json_response(res, status=200 if res["ok"] else 402)
    asyncio.create_task(_settle_and_record(key, payer, endpoint, a, sig))
    return web.json_response({"ok": True, "queued": True})


async def api_deny(req: web.Request) -> web.Response:
    """GET /api/x402/deny?payer=0x… → {denied: bool, until} — the Worker asks before the fast path"""
    p = (req.query.get("payer") or "").lower()
    until = _deny.get(p, 0)
    return web.json_response({"payer": p, "denied": until > time.time(), "until": int(until) if until else None}, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})


async def api_stats(req: web.Request) -> web.Response:
    now = int(time.time())
    tot = await db.fetchone(text("SELECT COUNT(*) n, COALESCE(SUM(amount),0) a, COUNT(DISTINCT payer) p FROM x402_payments WHERE status='settled'"))
    day = await db.fetchone(text("SELECT COUNT(*) n, COALESCE(SUM(amount),0) a, COUNT(DISTINCT payer) p FROM x402_payments WHERE status='settled' AND ts > :t").bindparams(t=now - 86400))
    by = await db.fetchall(text("SELECT endpoint, COUNT(*) n, COALESCE(SUM(amount),0) a FROM x402_payments WHERE status='settled' GROUP BY endpoint"))
    fail = await db.fetchone(text("SELECT COUNT(*) n FROM x402_payments WHERE status='failed'"))
    f = lambda x: float(x or 0) / 1e6
    return web.json_response({
        "relayer": _state["relayer"], "relayer_balance": _state.get("relayer_balance"),
        "all_time": {"calls": int(tot["n"]), "usdc": f(tot["a"]), "payers": int(tot["p"])},
        "last_24h": {"calls": int(day["n"]), "usdc": f(day["a"]), "payers": int(day["p"])},
        "by_endpoint": {r["endpoint"]: {"calls": int(r["n"]), "usdc": f(r["a"])} for r in by},
        "failed_settlements": int(fail["n"]), "denylisted_now": len([1 for u in _deny.values() if u > now]),
        "prices_usdc": {"token-stats": 0.005, "dev-audit": 0.02, "sell-sim": 0.03, "token-report": 0.04},
    }, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30"})


async def balance_loop() -> None:
    await init()
    while True:
        try:
            if _acct:
                _state["relayer_balance"] = int(str(await _rpc("eth_getBalance", [_acct.address, "latest"])), 16) / 1e18
        except Exception as e:  # noqa
            _state["last_error"] = str(e)[:120]
        await asyncio.sleep(60)


def register(app: web.Application) -> None:
    app.router.add_post("/api/x402/settle", api_settle)
    app.router.add_get("/api/x402/deny", api_deny)
    app.router.add_get("/api/x402/stats", api_stats)
