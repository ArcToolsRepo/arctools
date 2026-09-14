"""
Referral ledger shared by the sniper bot and the website.

  * a referrer gets a short code (per Telegram id or per wallet)
  * a new user is bound to a code once: /start ref_<code> in the sniper, or ?ref=<code> on the site
  * every fee-bearing trade of a bound user credits the referrer REF_SHARE of the platform fee
    (sniper 1% per trade, site 1.5% per swap) — reported by the sniper / site right after the tx confirms
  * payouts: summed per code and paid in native USDC to the referrer's payout wallet (weekly, manual for now:
    /api/ref/pending lists what is owed; /api/ref/paid records a payout tx)

HTTP API (CORS open for reads; credit/pending/paid need X-Ref-Auth = REF_AUTH):
  GET  /api/ref/code?tg=<id>|wallet=<0x>          -> {code, link_bot, link_site}
  POST /api/ref/bind    {subject_kind, subject_id, code}
  POST /api/ref/credit  {subject_kind, subject_id, source, tx, fee_usd}
  GET  /api/ref/stats?code=|tg=|wallet=            -> {code, referred, trades, fees_usd, earned_usd, paid_usd, pending_usd, recent}
  POST /api/ref/payout-wallet {tg|wallet, payout_wallet}
  GET  /api/ref/pending   (auth)                    -> [{code, owner, payout_wallet, pending_usd}]
  POST /api/ref/paid      (auth) {code, usd, tx}
"""
import hashlib
import logging
import os
import time

from aiohttp import web
from sqlalchemy import text

from . import db

log = logging.getLogger("ref")
REF_SHARE = float(os.environ.get("REF_SHARE", "0.25"))
REF_AUTH = os.environ.get("REF_AUTH", "")
BOT = "https://t.me/ArcSniper_bot"
SITE = "https://arctools.fun"
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Ref-Auth",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


async def init_tables():
    for s in (
        "CREATE TABLE IF NOT EXISTS ref_codes (code VARCHAR(12) PRIMARY KEY, owner_kind VARCHAR(8), owner_id VARCHAR(64), payout_wallet VARCHAR(64), created_at BIGINT)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ref_codes_owner ON ref_codes (owner_kind, owner_id)",
        "CREATE TABLE IF NOT EXISTS ref_bindings (subject_kind VARCHAR(8), subject_id VARCHAR(64), code VARCHAR(12), created_at BIGINT, PRIMARY KEY (subject_kind, subject_id))",
        "CREATE TABLE IF NOT EXISTS ref_credits (id SERIAL PRIMARY KEY, code VARCHAR(12), subject_kind VARCHAR(8), subject_id VARCHAR(64), source VARCHAR(8), tx VARCHAR(80) UNIQUE, fee_usd DOUBLE PRECISION, share_usd DOUBLE PRECISION, ts BIGINT)",
        "CREATE INDEX IF NOT EXISTS ref_credits_code ON ref_credits (code, ts)",
        "CREATE TABLE IF NOT EXISTS ref_payouts (id SERIAL PRIMARY KEY, code VARCHAR(12), usd DOUBLE PRECISION, tx VARCHAR(80), ts BIGINT)",
    ):
        await db.execute(text(s))


def _mk_code(kind: str, ident: str) -> str:
    h = hashlib.sha256(f"arctools-ref:{kind}:{ident.lower()}".encode()).digest()
    return "".join(ALPHA[b % 32] for b in h[:6])


def _owner(q) -> tuple[str, str] | None:
    if q.get("tg") and str(q.get("tg")).isdigit():
        return "tg", str(q.get("tg"))
    w = (q.get("wallet") or "").lower()
    if w.startswith("0x") and len(w) == 42:
        return "wallet", w
    return None


async def get_or_create_code(kind: str, ident: str) -> str:
    r = await db.fetchone(text("SELECT code FROM ref_codes WHERE owner_kind = :k AND owner_id = :i").bindparams(k=kind, i=ident))
    if r:
        return r["code"]
    code = _mk_code(kind, ident)
    await db.execute(text("INSERT INTO ref_codes (code, owner_kind, owner_id, payout_wallet, created_at) VALUES (:c, :k, :i, :p, :t) ON CONFLICT DO NOTHING")
                     .bindparams(c=code, k=kind, i=ident, p=(ident if kind == "wallet" else None), t=int(time.time())))
    return code


async def bind(kind: str, ident: str, code: str) -> str:
    """Returns 'bound' | 'already' | 'self' | 'unknown'."""
    code = (code or "").upper().strip()
    owner = await db.fetchone(text("SELECT owner_kind, owner_id FROM ref_codes WHERE code = :c").bindparams(c=code))
    if not owner:
        return "unknown"
    if owner["owner_kind"] == kind and owner["owner_id"].lower() == ident.lower():
        return "self"
    ex = await db.fetchone(text("SELECT code FROM ref_bindings WHERE subject_kind = :k AND subject_id = :i").bindparams(k=kind, i=ident))
    if ex:
        return "already"
    await db.execute(text("INSERT INTO ref_bindings (subject_kind, subject_id, code, created_at) VALUES (:k, :i, :c, :t) ON CONFLICT DO NOTHING")
                     .bindparams(k=kind, i=ident, c=code, t=int(time.time())))
    return "bound"


async def credit(kind: str, ident: str, source: str, tx: str, fee_usd: float) -> float:
    """Credit the referrer of (kind, ident) for a trade; returns share credited (0 when unbound / duplicate)."""
    b = await db.fetchone(text("SELECT code FROM ref_bindings WHERE subject_kind = :k AND subject_id = :i").bindparams(k=kind, i=ident.lower()))
    if not b or fee_usd <= 0:
        return 0.0
    share = round(fee_usd * REF_SHARE, 6)
    try:
        await db.execute(text("INSERT INTO ref_credits (code, subject_kind, subject_id, source, tx, fee_usd, share_usd, ts) VALUES (:c, :k, :i, :s, :tx, :f, :sh, :t)")
                         .bindparams(c=b["code"], k=kind, i=ident.lower(), s=source[:8], tx=tx.lower(), f=fee_usd, sh=share, t=int(time.time())))
    except Exception:  # duplicate tx
        return 0.0
    return share


async def stats_for_code(code: str) -> dict:
    code = code.upper()
    o = await db.fetchone(text("SELECT owner_kind, owner_id, payout_wallet FROM ref_codes WHERE code = :c").bindparams(c=code))
    if not o:
        return {"code": code, "error": "unknown code"}
    ref = await db.fetchone(text("SELECT COUNT(*) AS n FROM ref_bindings WHERE code = :c").bindparams(c=code))
    cr = await db.fetchone(text("SELECT COUNT(*) AS n, COALESCE(SUM(fee_usd),0) AS fees, COALESCE(SUM(share_usd),0) AS earned FROM ref_credits WHERE code = :c").bindparams(c=code))
    pd = await db.fetchone(text("SELECT COALESCE(SUM(usd),0) AS paid FROM ref_payouts WHERE code = :c").bindparams(c=code))
    recent = await db.fetchall(text("SELECT source, tx, fee_usd, share_usd, ts FROM ref_credits WHERE code = :c ORDER BY ts DESC LIMIT 10").bindparams(c=code))
    earned = float(cr["earned"] or 0); paid = float(pd["paid"] or 0)
    return {"code": code, "owner_kind": o["owner_kind"], "payout_wallet": o["payout_wallet"], "share": REF_SHARE,
            "referred": int(ref["n"] or 0), "trades": int(cr["n"] or 0), "fees_usd": round(float(cr["fees"] or 0), 4),
            "earned_usd": round(earned, 4), "paid_usd": round(paid, 4), "pending_usd": round(earned - paid, 4),
            "recent": [dict(r) for r in recent], "link_bot": f"{BOT}?start=ref_{code}", "link_site": f"{SITE}/?ref={code}"}


# ---------------- HTTP ----------------

def _auth(req: web.Request) -> bool:
    return bool(REF_AUTH) and req.headers.get("X-Ref-Auth") == REF_AUTH


async def api_code(req: web.Request):
    o = _owner(req.query)
    if not o:
        return web.json_response({"error": "tg or wallet required"}, status=400, headers=CORS)
    code = await get_or_create_code(*o)
    return web.json_response({"code": code, "link_bot": f"{BOT}?start=ref_{code}", "link_site": f"{SITE}/?ref={code}", "share": REF_SHARE}, headers=CORS)


async def api_bind(req: web.Request):
    j = await req.json()
    kind, ident, code = str(j.get("subject_kind", "")), str(j.get("subject_id", "")).lower(), str(j.get("code", ""))
    if kind not in ("tg", "wallet") or not ident or not code:
        return web.json_response({"error": "bad request"}, status=400, headers=CORS)
    return web.json_response({"result": await bind(kind, ident, code)}, headers=CORS)


async def api_credit(req: web.Request):
    if not _auth(req):
        return web.json_response({"error": "forbidden"}, status=403, headers=CORS)
    j = await req.json()
    share = await credit(str(j.get("subject_kind")), str(j.get("subject_id")), str(j.get("source", "site")), str(j.get("tx", "")), float(j.get("fee_usd") or 0))
    return web.json_response({"credited_usd": share}, headers=CORS)


async def api_stats(req: web.Request):
    code = req.query.get("code")
    if not code:
        o = _owner(req.query)
        if not o:
            return web.json_response({"error": "code, tg or wallet required"}, status=400, headers=CORS)
        code = await get_or_create_code(*o)
    return web.json_response(await stats_for_code(code), headers=CORS)


async def api_payout_wallet(req: web.Request):
    j = await req.json()
    o = _owner(j)
    pw = str(j.get("payout_wallet", "")).lower()
    if not o or not (pw.startswith("0x") and len(pw) == 42):
        return web.json_response({"error": "bad request"}, status=400, headers=CORS)
    code = await get_or_create_code(*o)
    await db.execute(text("UPDATE ref_codes SET payout_wallet = :p WHERE code = :c").bindparams(p=pw, c=code))
    return web.json_response({"code": code, "payout_wallet": pw}, headers=CORS)


async def api_pending(req: web.Request):
    if not _auth(req):
        return web.json_response({"error": "forbidden"}, status=403)
    rows = await db.fetchall(text(
        "SELECT c.code, c.owner_kind, c.owner_id, c.payout_wallet, "
        "COALESCE((SELECT SUM(share_usd) FROM ref_credits r WHERE r.code = c.code),0) - COALESCE((SELECT SUM(usd) FROM ref_payouts p WHERE p.code = c.code),0) AS pending "
        "FROM ref_codes c ORDER BY pending DESC"))
    return web.json_response({"rows": [dict(r) for r in rows if float(r["pending"] or 0) > 0.000001]})


async def api_paid(req: web.Request):
    if not _auth(req):
        return web.json_response({"error": "forbidden"}, status=403)
    j = await req.json()
    await db.execute(text("INSERT INTO ref_payouts (code, usd, tx, ts) VALUES (:c, :u, :tx, :t)")
                     .bindparams(c=str(j.get("code", "")).upper(), u=float(j.get("usd") or 0), tx=str(j.get("tx", "")), t=int(time.time())))
    return web.json_response({"ok": True})


# ---------------- claims: self-service payout in native USDC ----------------
# REF_PAYER_KEY (Railway env) = the wallet that pays referrers. Wallet owners prove identity with an EIP-191 signature of
# "ArcTools referral claim\ncode: <CODE>\nts: <unix>" (ts within 10 min); Telegram owners claim through the sniper bot,
# which calls this endpoint with X-Ref-Auth. Minimum claim MIN_CLAIM_USD, one claim per code per 10 min, the payout row is
# written BEFORE the transfer (idempotency lock) and removed if the send fails.
REF_PAYER_KEY = os.environ.get("REF_PAYER_KEY", "")
MIN_CLAIM_USD = float(os.environ.get("REF_MIN_CLAIM", "1"))
RPCS = ["https://rpc.arc-scan.org", "https://rpc-production-ba7a.up.railway.app"]
_claim_lock: dict[str, float] = {}


def payer_address() -> str | None:
    if not REF_PAYER_KEY:
        return None
    from eth_account import Account
    return Account.from_key(REF_PAYER_KEY).address


async def _rpc(method: str, params: list):
    import aiohttp
    last = None
    async with aiohttp.ClientSession() as s_:
        for url in RPCS:
            for _ in range(3):
                try:
                    async with s_.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                                       headers={"X-Priority": "high"}, timeout=aiohttp.ClientTimeout(total=15)) as r:
                        j = await r.json(content_type=None)
                    if "result" in j:
                        return j["result"]
                    last = j.get("error")
                    if last and "nonce" in str(last).lower():
                        raise RuntimeError(str(last))
                except RuntimeError:
                    raise
                except Exception as e:  # noqa
                    last = str(e)
    raise RuntimeError(f"rpc {method}: {str(last)[:120]}")


async def send_usdc(to: str, usd: float) -> str:
    """Native USDC transfer (USDC is the gas token on Arc, 18 decimals in msg.value). Returns tx hash."""
    from eth_account import Account
    acct = Account.from_key(REF_PAYER_KEY)
    value = int(round(usd * 1e18))
    nonce = int(await _rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
    gas_price = int(await _rpc("eth_gasPrice", []), 16)
    from eth_utils import to_checksum_address
    tx = {"to": to_checksum_address(to), "value": value, "gas": 60000, "gasPrice": int(gas_price * 1.2), "nonce": nonce, "chainId": 5042, "data": b""}
    signed = acct.sign_transaction(tx)
    raw = "0x" + signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else "0x" + signed.rawTransaction.hex()
    h = await _rpc("eth_sendRawTransaction", [raw])
    return h


async def pending_for_code(code: str) -> float:
    r = await db.fetchone(text(
        "SELECT COALESCE((SELECT SUM(share_usd) FROM ref_credits r WHERE r.code = :c),0) - COALESCE((SELECT SUM(usd) FROM ref_payouts p WHERE p.code = :c),0) AS pending"
    ).bindparams(c=code))
    return float(r["pending"] or 0)


def _verify_sig(code: str, ts: int, sig: str, expect: str) -> bool:
    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct
        if abs(time.time() - ts) > 600:
            return False
        msg = f"ArcTools referral claim\ncode: {code}\nts: {ts}"
        rec = Account.recover_message(encode_defunct(text=msg), signature=sig)
        return rec.lower() == expect.lower()
    except Exception:  # noqa
        return False


async def do_claim(code: str) -> dict:
    code = code.upper()
    if not REF_PAYER_KEY:
        return {"error": "payouts not configured"}
    o = await db.fetchone(text("SELECT owner_kind, owner_id, payout_wallet FROM ref_codes WHERE code = :c").bindparams(c=code))
    if not o:
        return {"error": "unknown code"}
    to = (o["payout_wallet"] or (o["owner_id"] if o["owner_kind"] == "wallet" else "") or "").lower()
    if not (to.startswith("0x") and len(to) == 42):
        return {"error": "set a payout wallet first"}
    if time.time() - _claim_lock.get(code, 0) < 600:
        return {"error": "a claim for this code was made in the last 10 minutes"}
    pending = round(await pending_for_code(code), 6)
    if pending < MIN_CLAIM_USD:
        return {"error": f"minimum claim is {MIN_CLAIM_USD:g} USDC", "pending_usd": pending}
    _claim_lock[code] = time.time()
    # lock the amount first (idempotency), then pay; roll back the row if the transfer never left
    await db.execute(text("INSERT INTO ref_payouts (code, usd, tx, ts) VALUES (:c, :u, :tx, :t)")
                     .bindparams(c=code, u=pending, tx=f"pending:{int(time.time())}", t=int(time.time())))
    row = await db.fetchone(text("SELECT id FROM ref_payouts WHERE code = :c ORDER BY id DESC LIMIT 1").bindparams(c=code))
    try:
        h = await send_usdc(to, pending)
    except Exception as e:  # noqa
        await db.execute(text("DELETE FROM ref_payouts WHERE id = :i").bindparams(i=row["id"]))
        _claim_lock.pop(code, None)
        log.warning("claim %s failed: %s", code, e)
        return {"error": f"transfer failed: {str(e)[:100]}"}
    await db.execute(text("UPDATE ref_payouts SET tx = :tx WHERE id = :i").bindparams(tx=h, i=row["id"]))
    log.info("claim %s: %.4f USDC -> %s tx %s", code, pending, to, h)
    return {"ok": True, "code": code, "usd": pending, "to": to, "tx": h}


async def api_claim(req: web.Request):
    """POST {wallet, ts, sig} (self-signed) | {tg} with X-Ref-Auth (sniper bot) | {code} with X-Ref-Auth (admin)."""
    j = await req.json()
    if _auth(req) and (j.get("tg") or j.get("code")):
        code = str(j["code"]).upper() if j.get("code") else await get_or_create_code("tg", str(j["tg"]))
        return web.json_response(await do_claim(code), headers=CORS)
    w = str(j.get("wallet", "")).lower()
    if not (w.startswith("0x") and len(w) == 42):
        return web.json_response({"error": "wallet required"}, status=400, headers=CORS)
    code = await get_or_create_code("wallet", w)
    if not _verify_sig(code, int(j.get("ts") or 0), str(j.get("sig", "")), w):
        return web.json_response({"error": "bad signature"}, status=403, headers=CORS)
    return web.json_response(await do_claim(code), headers=CORS)


async def api_claim_info(_):
    """GET → payer address + its balance (so the site can show 'payouts funded')."""
    addr = payer_address()
    bal = None
    if addr:
        try:
            bal = int(await _rpc("eth_getBalance", [addr, "latest"]), 16) / 1e18
        except Exception:  # noqa
            bal = None
    return web.json_response({"payer": addr, "balance_usd": bal, "min_claim_usd": MIN_CLAIM_USD}, headers=CORS)


async def api_options(_):
    return web.Response(status=204, headers=CORS)


def register(app: web.Application):
    app.router.add_get("/api/ref/code", api_code)
    app.router.add_post("/api/ref/bind", api_bind)
    app.router.add_post("/api/ref/credit", api_credit)
    app.router.add_get("/api/ref/stats", api_stats)
    app.router.add_post("/api/ref/payout-wallet", api_payout_wallet)
    app.router.add_get("/api/ref/pending", api_pending)
    app.router.add_post("/api/ref/paid", api_paid)
    app.router.add_post("/api/ref/claim", api_claim)
    app.router.add_get("/api/ref/claim-info", api_claim_info)
    for p in ("/api/ref/bind", "/api/ref/credit", "/api/ref/payout-wallet", "/api/ref/paid", "/api/ref/claim"):
        app.router.add_route("OPTIONS", p, api_options)
