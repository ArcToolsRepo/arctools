"""ArcClaim relayer + read API + claim page.

A payment link holds native USDC in the ArcClaim contract behind a one-time key. The key signs the recipient address;
this module submits the claim transaction from the treasury key so the recipient needs no gas and no prior wallet.
It also refunds expired links to their senders (anyone may call refund(); the money can only go back to the sender)
and serves the standalone claim page at /claim/ — reachable as arctools.fun/bot/claim/ through the site's proxy,
so the site itself is untouched. The link key travels in the URL fragment (#) and never reaches any server.

GET  /api/claim/{id}          -> {id, sender, amount, expiry, expired, status, recipient?, tx?}
POST /api/claim/submit        {id, recipient, sig} -> {tx, paid, fee, recipient}
GET  /api/claim-stats         -> counters
GET  /claim/                  -> HTML page (reads #<id>.<key>)"""
import asyncio
import logging
import os
import time

from aiohttp import web
from eth_abi import encode, decode
from eth_account import Account
from sqlalchemy import text
from web3 import Web3

from . import db
from .orders import _rpc, KEEPER_KEY, CHAIN_ID

log = logging.getLogger("claims")

CLAIM = "0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
FEE_BPS = 200
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type"}
SEL = {k: Web3.keccak(text=v)[:4].hex() for k, v in {
    "links": "links(uint256)", "claim": "claim(uint256,address,bytes)", "refund": "refund(uint256)",
    "nextId": "nextId()", "claimDigest": "claimDigest(uint256,address)"}.items()}
TOPIC_CLAIMED = "0x" + Web3.keccak(text="Claimed(uint256,address,uint256,uint256)").hex().replace("0x", "")

_nonce_lock = asyncio.Lock()      # the treasury key also drives the orders keeper: one sender, one queue
_stats = {"claims": 0, "refunds": 0, "failed": 0, "fees_usdc": 0.0, "paid_usdc": 0.0}
_inflight: set[int] = set()


async def init():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS claim_events (
        id BIGINT, kind VARCHAR(12), recipient VARCHAR(64), amount NUMERIC, fee NUMERIC, tx VARCHAR(80), ts BIGINT,
        PRIMARY KEY (id, kind))"""))
    if KEEPER_KEY:
        asyncio.create_task(refund_loop(), name="claim-refunds")
    else:
        log.warning("claims: KEEPER_KEY missing — read API only")


async def read_link(link_id: int) -> dict | None:
    r = await _rpc("eth_call", [{"to": CLAIM, "data": SEL["links"] + encode(["uint256"], [link_id]).hex()}, "latest"])
    if not r or r == "0x":
        return None
    sender, key, amount, expiry, status = decode(["address", "address", "uint128", "uint64", "uint8"], bytes.fromhex(r[2:]))
    if int(sender, 16) == 0:
        return None
    out = {"id": link_id, "sender": sender, "claimKey": key, "amount": f"{amount / 1e18:.6f}", "expiry": int(expiry),
           "expired": time.time() >= expiry, "status": {0: "open", 1: "claimed", 2: "refunded"}[status],
           "feeBps": FEE_BPS, "contract": CLAIM}
    ev = await db.fetchone(text("SELECT recipient, tx, amount FROM claim_events WHERE id=:i AND kind='claimed'").bindparams(i=link_id))
    if ev:
        out["recipient"] = ev["recipient"]; out["tx"] = ev["tx"]; out["paid"] = f"{float(ev['amount']):.6f}"
    return out


async def _send(data: str) -> str:
    acct = Account.from_key(KEEPER_KEY)
    call = {"from": acct.address, "to": CLAIM, "data": data}
    await _rpc("eth_call", [call, "latest"])                   # simulate first: a clear revert instead of a burnt fee
    async with _nonce_lock:
        gas = int(await _rpc("eth_estimateGas", [call]), 16)
        nonce = int(await _rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
        gp = int(await _rpc("eth_gasPrice", []), 16)
        tx = {"to": CLAIM, "value": 0, "gas": int(gas * 1.3) + 20_000, "gasPrice": int(gp * 1.2), "nonce": nonce, "chainId": CHAIN_ID, "data": data}
        signed = acct.sign_transaction(tx)
        raw = signed.raw_transaction if hasattr(signed, "raw_transaction") else signed.rawTransaction
        h = await _rpc("eth_sendRawTransaction", ["0x" + raw.hex()], send=True)
    for _ in range(40):
        await asyncio.sleep(1.5)
        try:
            rc = await _rpc("eth_getTransactionReceipt", [h])
        except Exception:  # noqa
            rc = None
        if rc:
            if int(rc.get("status", "0x0"), 16) != 1:
                raise RuntimeError(f"reverted {h}")
            return h
    raise RuntimeError(f"no receipt for {h}")


def _friendly(err: str) -> str:
    e = err.lower()
    if "notopen" in e or "0x" in e and "not" in e:
        return "this link was already collected or refunded"
    if "expired" in e:
        return "this link has expired"
    if "badsignature" in e:
        return "the link code is not valid for that wallet"
    return err[:140]


async def api_submit(req: web.Request) -> web.Response:
    if not KEEPER_KEY:
        return web.json_response({"error": "relayer offline"}, status=503, headers=CORS)
    try:
        j = await req.json()
        link_id = int(j["id"]); recipient = Web3.to_checksum_address(j["recipient"]); sig = j["sig"]
        sig_b = bytes.fromhex(sig[2:] if sig.startswith("0x") else sig)
        assert len(sig_b) == 65
    except Exception:  # noqa
        return web.json_response({"error": "bad request"}, status=400, headers=CORS)
    link = await read_link(link_id)
    if not link:
        return web.json_response({"error": "unknown link"}, status=404, headers=CORS)
    if link["status"] != "open":
        return web.json_response({"error": f"link already {link['status']}", "link": link}, status=409, headers=CORS)
    if link["expired"]:
        return web.json_response({"error": "link expired", "link": link}, status=409, headers=CORS)
    # verify locally before spending gas: the key must have signed exactly (id, recipient)
    inner = Web3.keccak(encode(["string", "uint256", "address", "uint256", "address"], ["ArcClaim", CHAIN_ID, CLAIM, link_id, recipient]))
    from eth_account.messages import encode_defunct
    try:
        signer = Account.recover_message(encode_defunct(primitive=inner), signature=sig_b)
    except Exception:  # noqa
        signer = None
    if not signer or signer.lower() != link["claimKey"].lower():
        return web.json_response({"error": "the link code is not valid for that wallet"}, status=400, headers=CORS)
    if link_id in _inflight:
        return web.json_response({"error": "collection already in progress"}, status=409, headers=CORS)
    _inflight.add(link_id)
    try:
        data = SEL["claim"] + encode(["uint256", "address", "bytes"], [link_id, recipient, sig_b]).hex()
        h = await _send(data)
    except Exception as e:  # noqa
        _stats["failed"] += 1
        return web.json_response({"error": _friendly(str(e))}, status=500, headers=CORS)
    finally:
        _inflight.discard(link_id)
    amount = float(link["amount"]); fee = amount * FEE_BPS / 10_000; paid = amount - fee
    _stats["claims"] += 1; _stats["fees_usdc"] += fee; _stats["paid_usdc"] += paid
    await db.execute(text("""INSERT INTO claim_events (id, kind, recipient, amount, fee, tx, ts) VALUES (:i,'claimed',:r,:a,:f,:t,:ts)
                             ON CONFLICT (id, kind) DO NOTHING""").bindparams(i=link_id, r=recipient, a=paid, f=fee, t=h, ts=int(time.time())))
    return web.json_response({"tx": h, "paid": f"{paid:.6f}", "fee": f"{fee:.6f}", "recipient": recipient, "id": link_id}, headers=CORS)


async def api_link(req: web.Request) -> web.Response:
    try:
        link_id = int(req.match_info["id"])
    except ValueError:
        return web.json_response({"error": "bad id"}, status=400, headers=CORS)
    link = await read_link(link_id)
    if not link:
        return web.json_response({"error": "unknown link"}, status=404, headers=CORS)
    return web.json_response(link, headers={**CORS, "Cache-Control": "no-store"})


DEPLOY_BLOCK = 21478169
TOPIC_CREATED = "0x" + Web3.keccak(text="Created(uint256,address,address,uint256,uint64)").hex().replace("0x", "")
_sender_cache: dict[str, tuple[float, list]] = {}


async def api_by_sender(req: web.Request) -> web.Response:
    """Links a wallet created, newest first, each with its live on-chain state. Source: Created logs (sender is indexed)."""
    w = (req.query.get("wallet") or "").lower()
    if not Web3.is_address(w):
        return web.json_response({"error": "bad wallet"}, status=400, headers=CORS)
    hit = _sender_cache.get(w)
    if hit and time.time() - hit[0] < 20:
        return web.json_response({"wallet": w, "links": hit[1]}, headers={**CORS, "Cache-Control": "no-store"})
    latest = int(await _rpc("eth_blockNumber", []), 16)
    logs = []
    frm = DEPLOY_BLOCK
    while frm <= latest:                                   # our node has no range cap, but stay polite: 200k per call
        to = min(latest, frm + 200_000)
        logs += await _rpc("eth_getLogs", [{"address": CLAIM, "fromBlock": hex(frm), "toBlock": hex(to),
                                            "topics": [TOPIC_CREATED, None, "0x" + w[2:].rjust(64, "0")]}])
        frm = to + 1
    ids = sorted({int(l["topics"][1], 16) for l in logs}, reverse=True)[:100]
    out = []
    for i in ids:
        l = await read_link(i)
        if l:
            out.append(l)
    _sender_cache[w] = (time.time(), out)
    return web.json_response({"wallet": w, "links": out}, headers={**CORS, "Cache-Control": "no-store"})


async def api_stats(req: web.Request) -> web.Response:
    n = await db.fetchone(text("SELECT COUNT(*) FILTER (WHERE kind='claimed') c, COUNT(*) FILTER (WHERE kind='refunded') r, "
                               "COALESCE(SUM(fee) FILTER (WHERE kind='claimed'),0) fees, COALESCE(SUM(amount) FILTER (WHERE kind='claimed'),0) paid FROM claim_events"))
    nxt = await _rpc("eth_call", [{"to": CLAIM, "data": SEL["nextId"]}, "latest"])
    return web.json_response({"contract": CLAIM, "treasury": TREASURY, "feeBps": FEE_BPS, "links_created": int(nxt, 16) - 1,
                              "claimed": int(n["c"]), "refunded": int(n["r"]), "fees_usdc": float(n["fees"]), "paid_usdc": float(n["paid"]),
                              "relayer": bool(KEEPER_KEY), "session": _stats}, headers=CORS)


async def refund_loop():
    """Every 10 min: walk open links past expiry and send the money back to their senders. Gas is ours; it is part
    of the 2 % — a link nobody collected must not sit in the contract until the sender remembers it."""
    await asyncio.sleep(60)
    while True:
        try:
            nxt = int(await _rpc("eth_call", [{"to": CLAIM, "data": SEL["nextId"]}, "latest"]), 16)
            done = {int(r["id"]) for r in await db.fetchall(text("SELECT id FROM claim_events"))}
            for link_id in range(1, nxt):
                if link_id in done:
                    continue
                link = await read_link(link_id)
                if not link:
                    continue
                if link["status"] == "claimed":       # claimed outside our relayer (someone called the contract directly)
                    await db.execute(text("INSERT INTO claim_events (id, kind, recipient, amount, fee, tx, ts) VALUES (:i,'claimed',NULL,:a,:f,NULL,:ts) ON CONFLICT DO NOTHING")
                                     .bindparams(i=link_id, a=float(link["amount"]) * (1 - FEE_BPS / 10_000), f=float(link["amount"]) * FEE_BPS / 10_000, ts=int(time.time())))
                    continue
                if link["status"] == "refunded":
                    await db.execute(text("INSERT INTO claim_events (id, kind, recipient, amount, fee, tx, ts) VALUES (:i,'refunded',:s,:a,0,NULL,:ts) ON CONFLICT DO NOTHING")
                                     .bindparams(i=link_id, s=link["sender"], a=float(link["amount"]), ts=int(time.time())))
                    continue
                if link["expired"]:
                    try:
                        h = await _send(SEL["refund"] + encode(["uint256"], [link_id]).hex())
                        _stats["refunds"] += 1
                        await db.execute(text("INSERT INTO claim_events (id, kind, recipient, amount, fee, tx, ts) VALUES (:i,'refunded',:s,:a,0,:t,:ts) ON CONFLICT DO NOTHING")
                                         .bindparams(i=link_id, s=link["sender"], a=float(link["amount"]), t=h, ts=int(time.time())))
                        log.info("claims: refunded link %s (%s USDC) to %s %s", link_id, link["amount"], link["sender"], h)
                    except Exception as e:  # noqa
                        log.warning("claims: refund %s failed: %s", link_id, str(e)[:120])
        except Exception as e:  # noqa
            log.warning("claims: refund loop: %s", str(e)[:160])
        await asyncio.sleep(600)


_HERE = os.path.dirname(__file__)
# arctools.fun serves /bot/* under a CSP of script-src 'self' 'unsafe-inline' — no CDN. The signing library is inlined.
PAGE = open(os.path.join(_HERE, "claim_page.html"), encoding="utf-8").read().replace(
    "/*ETHERS*/", open(os.path.join(_HERE, "ethers.umd.min.js"), encoding="utf-8").read().replace("</script>", "<\\/script>"))


async def page(req: web.Request) -> web.Response:
    return web.Response(text=PAGE, content_type="text/html", headers={"Cache-Control": "no-store"})


def register(app: web.Application):
    app.router.add_get("/api/claim/{id:\\d+}", api_link)
    app.router.add_post("/api/claim/submit", api_submit)
    app.router.add_route("OPTIONS", "/api/claim/submit", lambda r: web.Response(headers=CORS))
    app.router.add_get("/api/claim-stats", api_stats)
    app.router.add_get("/api/claim/by-sender", api_by_sender)
    app.router.add_get("/claim/", page)
    app.router.add_get("/claim", page)
