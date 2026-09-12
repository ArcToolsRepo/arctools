import time
"""ArcTools RPC relay: forwards JSON-RPC to Arc nodes from Railway egress.

Cloudflare Worker IPs get 429'd by rpc.arc-scan.org and the shared Infura key
has a daily quota. Railway egress reaches arc-scan freely, so the site talks
to this relay first. Read-only: only whitelisted JSON-RPC methods pass.
"""
import asyncio
import json
import logging
import os

from aiohttp import ClientSession, ClientTimeout, web

log = logging.getLogger("arcrpc")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

UPSTREAMS = [
    "https://rpc.arc-scan.org",
    "https://5042.rpc.thirdweb.com",
    "https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8",   # shared key, often over quota
]

ALLOWED = {
    "eth_call", "eth_blockNumber", "eth_getLogs", "eth_getBalance",
    "eth_getCode", "eth_chainId", "eth_getTransactionReceipt",
    "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_gasPrice",
    "eth_getTransactionCount", "net_version", "eth_estimateGas",
}
SEND_AUTH = os.getenv("SEND_AUTH", "")   # X-Send-Auth header unlocks eth_sendRawTransaction (site trading wallet via Worker)

session: ClientSession | None = None


def method_ok(body, can_send: bool = False) -> bool:
    items = body if isinstance(body, list) else [body]
    ok = ALLOWED | ({"eth_sendRawTransaction"} if can_send else set())
    return all(isinstance(i, dict) and i.get("method") in ok for i in items)


CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Send-Auth",
    "Access-Control-Max-Age": "86400",
}


async def relay(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad json"}, status=400, headers=CORS)
    can_send = bool(SEND_AUTH) and request.headers.get("X-Send-Auth") == SEND_AUTH
    if not method_ok(body, can_send):
        return web.json_response(
            {"jsonrpc": "2.0", "id": None,
             "error": {"code": -32601, "message": "method not allowed (read-only relay)"}},
            status=403, headers=CORS)
    payload = json.dumps(body)
    # short read cache + in-flight dedupe: the site's edge isolates and the bots ask the same questions within
    # the same second (multicalls, getCode, blockNumber). One upstream call serves all of them.
    ckey = None
    if isinstance(body, dict) and body.get("method") in CACHEABLE:
        ckey = body["method"] + json.dumps(body.get("params"), sort_keys=True, separators=(",", ":"))
        hit = _rcache.get(ckey)
        if hit and time.time() - hit[0] < CACHE_TTL.get(body["method"], 2.0):
            txt = hit[1]
            if isinstance(body.get("id"), (int, str)):
                txt = _reid(txt, body["id"])
            return web.Response(text=txt, content_type="application/json", headers={**CORS, "X-Relay-Cache": "hit"})
        fut = _inflight.get(ckey)
        if fut is not None:
            txt = await fut
            if txt is not None:
                return web.Response(text=_reid(txt, body.get("id")), content_type="application/json", headers={**CORS, "X-Relay-Cache": "join"})
        loop = asyncio.get_event_loop(); fut = loop.create_future(); _inflight[ckey] = fut
    try:
        return await _upstream(payload, ckey, fut if ckey else None, body.get("id") if isinstance(body, dict) else None)
    finally:
        if ckey and not fut.done():
            fut.set_result(None)
        _inflight.pop(ckey, None)


CACHEABLE = {"eth_call", "eth_getCode", "eth_getBalance", "eth_blockNumber", "eth_getLogs", "eth_getTransactionReceipt",
             "eth_getBlockByNumber", "eth_chainId", "eth_gasPrice", "eth_getStorageAt"}
CACHE_TTL = {"eth_blockNumber": 0.8, "eth_gasPrice": 5.0, "eth_chainId": 3600.0, "eth_getCode": 600.0, "eth_getLogs": 3.0,
             "eth_getTransactionReceipt": 30.0, "eth_call": 2.0, "eth_getBalance": 2.0, "eth_getBlockByNumber": 2.0, "eth_getStorageAt": 2.0}
_rcache: dict[str, tuple[float, str]] = {}
_inflight: dict[str, asyncio.Future] = {}


def _reid(txt: str, rid):
    """Swap the JSON-RPC id in a cached response (cheap string op; ids are always at the top level)."""
    try:
        d = json.loads(txt); d["id"] = rid; return json.dumps(d, separators=(",", ":"))
    except Exception:  # noqa
        return txt


async def _upstream(payload: str, ckey, fut, rid) -> web.Response:
    last_status, last_text = 502, "no upstream"
    if len(_rcache) > 20000:
        now = time.time()
        for k in [k for k, v in _rcache.items() if now - v[0] > 600][:10000]:
            _rcache.pop(k, None)
    for attempt in range(3):
        for up in UPSTREAMS:
            try:
                async with session.post(up, data=payload,
                                        headers={"Content-Type": "application/json"}) as r:
                    text = await r.text()
                    if r.status == 200 and '"error"' not in text[:200].replace(" ", ""):
                        if ckey:
                            _rcache[ckey] = (time.time(), text)
                            if fut and not fut.done():
                                fut.set_result(text)
                        return web.Response(text=text, content_type="application/json", headers=CORS)
                    # 200 with rpc error object: still return it unless quota/rate
                    low = text[:300].lower()
                    if r.status == 200 and not any(s in low for s in ("quota", "rate limit", "-32005", "-32600", "too many")):
                        return web.Response(text=text, content_type="application/json", headers=CORS)
                    last_status, last_text = r.status, text[:300]
            except Exception as e:  # noqa
                last_status, last_text = 502, str(e)[:200]
        await asyncio.sleep(0.25 * (attempt + 1))
    return web.Response(text=last_text or "upstream failed",
                        status=last_status if last_status >= 400 else 502, headers=CORS)


async def options_ok(_):
    return web.Response(status=204, headers=CORS)


# ---- gas faucet: the site (authed) asks us to send launch gas to a wallet ----
FAUCET_KEY = os.getenv("FAUCET_KEY", "")
FAUCET_AUTH = os.getenv("FAUCET_AUTH", "")
FAUCET_AMOUNT_WEI = int(0.2e18)  # 0.2 native USDC covers a token launch
CHAIN_ID = 5042


async def faucet(request: web.Request) -> web.Response:
    if not FAUCET_KEY or not FAUCET_AUTH:
        return web.json_response({"ok": False, "reason": "faucet disabled"}, status=503)
    if request.headers.get("X-Faucet-Auth") != FAUCET_AUTH:
        return web.json_response({"ok": False, "reason": "unauthorized"}, status=401)
    try:
        body = await request.json()
        wallet = str(body.get("wallet", ""))
        assert wallet.startswith("0x") and len(wallet) == 42
        int(wallet, 16)
    except Exception:
        return web.json_response({"ok": False, "reason": "bad wallet"}, status=400)
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider("https://rpc.arc-scan.org", request_kwargs={"timeout": 20}))
        acct = w3.eth.account.from_key(FAUCET_KEY)
        if w3.eth.get_balance(acct.address) < FAUCET_AMOUNT_WEI + int(0.01e18):
            return web.json_response({"ok": False, "reason": "faucet empty"}, status=503)
        tx = {"chainId": CHAIN_ID, "from": acct.address,
              "to": Web3.to_checksum_address(wallet), "value": FAUCET_AMOUNT_WEI,
              "gas": 30_000, "gasPrice": int(w3.eth.gas_price * 1.2),
              "nonce": w3.eth.get_transaction_count(acct.address)}
        signed = acct.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.rawTransaction)
        r = w3.eth.wait_for_transaction_receipt(h, timeout=60)
        if r["status"] != 1:
            return web.json_response({"ok": False, "reason": "tx reverted"}, status=502)
        return web.json_response({"ok": True, "tx": h.hex()})
    except Exception as e:  # noqa
        log.warning("faucet: %s", e)
        return web.json_response({"ok": False, "reason": "send failed"}, status=502)


async def health(_):
    return web.json_response({"ok": True})


async def on_startup(app):
    global session
    session = ClientSession(timeout=ClientTimeout(total=25))


async def on_cleanup(app):
    if session:
        await session.close()


app = web.Application(client_max_size=4 * 1024 * 1024)
app.router.add_post("/", relay)
app.router.add_options("/", options_ok)
app.router.add_post("/faucet", faucet)
app.router.add_get("/health", health)
app.on_startup.append(on_startup)
app.on_cleanup.append(on_cleanup)

if __name__ == "__main__":
    web.run_app(app, port=int(os.getenv("PORT", "8080")))
