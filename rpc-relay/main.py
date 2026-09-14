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
import random

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
        if isinstance(body, dict) and body.get("method") in BATCH_METHODS and _bq is not None:
            bf = asyncio.get_event_loop().create_future()
            await _bq.put((body, bf))
            text, status = await bf
            if status == 200 and ckey and '"error"' not in text[:200].replace(" ", ""):
                _rcache[ckey] = (time.time(), text)
                if fut and not fut.done():
                    fut.set_result(text)
            return web.Response(text=text, content_type="application/json", status=status, headers=CORS)
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


# arc-scan throttles bursts from one IP (503/429), and the fallbacks are usually dead (thirdweb 429, Infura over quota).
# So: cap concurrency towards each upstream, back off and retry the primary instead of failing over instantly,
# and put an upstream on a short cooldown after a quota/rate-limit answer so we stop wasting time on it.
UP_CONC = int(os.getenv("UPSTREAM_CONCURRENCY", "6"))
UP_TIMEOUT = float(os.getenv("UPSTREAM_TIMEOUT", "8"))
QUOTA_MARKERS = ("quota", "exceeded", "-32600")          # provider key exhausted → long cooldown
RATE_ONLY = ("rate limit", "too many", "-32005", "429")   # transient → short cooldown, try the next upstream right away
_sems = {up: asyncio.Semaphore(UP_CONC) for up in UPSTREAMS}
_cooldown: dict[str, float] = {}
_last_call: dict[str, float] = {}
MIN_GAP = {"https://5042.rpc.thirdweb.com": 1.1}   # thirdweb public endpoint: ~1 request / s before it 429s


async def _gap(up: str):
    g = MIN_GAP.get(up)
    if not g:
        return
    wait = _last_call.get(up, 0) + g - time.time()
    if wait > 0:
        await asyncio.sleep(wait)
    _last_call[up] = time.time()
_stats = {"ok": 0, "fail": 0, "retry": 0, "last_fail": ""}
_RATE_MARKERS = ("quota", "rate limit", "-32005", "-32600", "too many", "exceeded")


# ---- micro-batching -------------------------------------------------------------------------------------
# arc-scan's edge limit counts HTTP requests, not JSON-RPC calls (measured: 20 parallel batches x10 → 16 OK,
# 25 parallel singles → 17 OK). So single calls arriving within a short window are coalesced into one batch
# request; responses are split back by id. Big/slow methods stay single.
BATCH_METHODS = {"eth_call", "eth_getBalance", "eth_getCode", "eth_blockNumber", "eth_chainId", "eth_gasPrice",
                 "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getStorageAt"}
BATCH_WINDOW = float(os.getenv("BATCH_WINDOW", "0.03"))
BATCH_MAX = int(os.getenv("BATCH_MAX", "25"))
_bq: asyncio.Queue | None = None
_bstats = {"batches": 0, "items": 0, "queued": 0}
RATE_PER_S = float(os.getenv("RATE_PER_S", "4"))   # HTTP requests / s towards the primary upstream (arc-scan edge limit ≈ 5/s per client)
_bucket = {"tokens": RATE_PER_S, "ts": time.time()}


async def _take_token():
    while True:
        now = time.time()
        _bucket["tokens"] = min(RATE_PER_S, _bucket["tokens"] + (now - _bucket["ts"]) * RATE_PER_S)
        _bucket["ts"] = now
        if _bucket["tokens"] >= 1:
            _bucket["tokens"] -= 1
            return
        await asyncio.sleep((1 - _bucket["tokens"]) / RATE_PER_S)


async def _batch_worker():
    global _bq
    _bq = asyncio.Queue()
    while True:
        first = await _bq.get()
        items = [first]
        await _take_token()                 # under load this wait is what lets the batch fill up
        await asyncio.sleep(BATCH_WINDOW)
        size = len(json.dumps(first[0]))
        while not _bq.empty() and len(items) < BATCH_MAX and size < 90_000:
            nxt = _bq.get_nowait()
            items.append(nxt)
            size += len(json.dumps(nxt[0]))
        _bstats["queued"] = _bq.qsize()
        asyncio.create_task(_send_batch(items, tokened=True))


async def _send_batch(items: list[tuple[dict, asyncio.Future]], tokened: bool = False):
    try:
        await _send_batch_inner(items, tokened)
    except Exception as e:  # noqa
        log.warning("batch: %s", e)
    finally:
        for _, fut in items:
            if not fut.done():
                fut.set_result(('{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"relay batch error"}}', 502))


async def _send_batch_inner(items: list[tuple[dict, asyncio.Future]], tokened: bool = False):
    _bstats["batches"] += 1; _bstats["items"] += len(items)
    if len(items) == 1:
        body, fut = items[0]
        text, status = await _post_raw(json.dumps(body), tokened)
        if not fut.done():
            fut.set_result((text, status))
        return
    req = []
    for i, (body, _) in enumerate(items):
        req.append({**body, "id": i + 1})
    text, status = await _post_raw(json.dumps(req), tokened)
    parsed = None
    if status == 200:
        try:
            parsed = json.loads(text)
        except Exception:  # noqa
            parsed = None
    if status == 413 or (status == 200 and not isinstance(parsed, list)):
        # too large for the upstream or a non-array answer → send one by one
        for body, fut in items:
            t, st = await _post_raw(json.dumps(body))
            if not fut.done():
                fut.set_result((t, st))
        return
    if not isinstance(parsed, list):
        # batch itself failed (rate limit / transport) → resolve everybody with that failure
        for _, fut in items:
            if not fut.done():
                fut.set_result((text, status if status != 200 else 502))
        return
    by_id = {r.get("id"): r for r in parsed if isinstance(r, dict)}
    for i, (body, fut) in enumerate(items):
        r = by_id.get(i + 1)
        if r is None:
            r = {"jsonrpc": "2.0", "id": body.get("id"), "error": {"code": -32603, "message": "missing in batch response"}}
        else:
            r = {**r, "id": body.get("id")}
        if not fut.done():
            fut.set_result((json.dumps(r, separators=(",", ":")), 200))


async def _post_raw(payload: str, tokened: bool = False) -> tuple[str, int]:
    """One HTTP request to the upstreams with backoff on 429/503; returns (text, http_status). status 200 may still be an rpc error."""
    last_status, last_text = 502, "no upstream"
    for attempt in range(4):
        all_cool = all(_cooldown.get(u, 0) > time.time() for u in UPSTREAMS)
        for up in UPSTREAMS:
            if _cooldown.get(up, 0) > time.time() and not all_cool:
                continue
            try:
                if up == UPSTREAMS[0] and not (tokened and attempt == 0):
                    await _take_token()
                await _gap(up)
                async with _sems[up]:
                    async with session.post(up, data=payload, headers={"Content-Type": "application/json"}, timeout=ClientTimeout(total=UP_TIMEOUT)) as r:
                        text = await r.text()
                low = text[:300].lower()
                rate = r.status in (429, 503) or (r.status == 200 and '"error"' in text[:200].replace(" ", "") and any(m in low for m in _RATE_MARKERS))
                if r.status == 200 and not rate:
                    _stats["ok"] += 1
                    return text, 200
                last_status, last_text = r.status, text[:300]
                if rate:
                    # 503 from the primary = their edge hiccup → no cooldown, just try the others and come back;
                    # 429 → 5 s (primary) / 60 s (fallbacks); provider quota exhausted → 10 min
                    quota = any(m in low for m in QUOTA_MARKERS)
                    if quota:
                        _cooldown[up] = time.time() + 600
                    elif r.status != 503 or up != UPSTREAMS[0]:
                        _cooldown[up] = time.time() + (5 if up == UPSTREAMS[0] else 60)
                # any failure (rate limit, 5xx, "could not complete") → next upstream immediately
            except Exception as e:  # noqa
                last_status, last_text = 502, str(e)[:200]
        if attempt < 3:
            _stats["retry"] += 1
            await asyncio.sleep(0.4 * (attempt + 1) + random.random() * 0.2)
    _stats["fail"] += 1
    _stats["last_fail"] = f"{last_status} {last_text[:120]}"
    if _stats["fail"] % 20 == 1:
        log.warning("upstream failed (%s fails / %s ok): %s", _stats["fail"], _stats["ok"], _stats["last_fail"])
    return last_text or "upstream failed", (last_status if last_status >= 400 else 502)


async def _upstream(payload: str, ckey, fut, rid) -> web.Response:
    last_status, last_text = 502, "no upstream"
    if len(_rcache) > 20000:
        now = time.time()
        for k in [k for k, v in _rcache.items() if now - v[0] > 600][:10000]:
            _rcache.pop(k, None)
    for attempt in range(4):
        for up in UPSTREAMS:
            if _cooldown.get(up, 0) > time.time():
                continue
            try:
                if up == UPSTREAMS[0]:
                    await _take_token()
                await _gap(up)
                async with _sems[up]:
                    async with session.post(up, data=payload, headers={"Content-Type": "application/json"}, timeout=ClientTimeout(total=UP_TIMEOUT)) as r:
                        text = await r.text()
                if r.status == 200 and '"error"' not in text[:200].replace(" ", ""):
                    _stats["ok"] += 1
                    if ckey:
                        _rcache[ckey] = (time.time(), text)
                        if fut and not fut.done():
                            fut.set_result(text)
                    return web.Response(text=text, content_type="application/json", headers=CORS)
                low = text[:300].lower()
                rate = r.status in (429, 503) or any(m in low for m in _RATE_MARKERS)
                if r.status == 200 and not rate:
                    _stats["ok"] += 1
                    return web.Response(text=text, content_type="application/json", headers=CORS)   # genuine rpc error (revert etc.)
                last_status, last_text = r.status, text[:300]
                if rate:
                    # 503 from the primary = their edge hiccup → no cooldown, just try the others and come back;
                    # 429 → 5 s (primary) / 60 s (fallbacks); provider quota exhausted → 10 min
                    quota = any(m in low for m in QUOTA_MARKERS)
                    if quota:
                        _cooldown[up] = time.time() + 600
                    elif r.status != 503 or up != UPSTREAMS[0]:
                        _cooldown[up] = time.time() + (5 if up == UPSTREAMS[0] else 60)
            except Exception as e:  # noqa
                last_status, last_text = 502, str(e)[:200]
        if attempt < 3:
            _stats["retry"] += 1
            await asyncio.sleep(0.4 * (attempt + 1) + random.random() * 0.2)
    _stats["fail"] += 1
    _stats["last_fail"] = f"{last_status} {last_text[:120]}"
    if _stats["fail"] % 20 == 1:
        log.warning("upstream failed (%s fails / %s ok): %s", _stats["fail"], _stats["ok"], _stats["last_fail"])
    return web.Response(text=last_text or "upstream failed",
                        status=last_status if last_status >= 400 else 502, headers=CORS)


async def relay_stats(_):
    return web.json_response({**_stats, **_bstats, "cooldown": {k: round(v - time.time()) for k, v in _cooldown.items() if v > time.time()}}, headers=CORS)


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
    asyncio.create_task(_batch_worker())
    session = ClientSession(timeout=ClientTimeout(total=25))


async def on_cleanup(app):
    if session:
        await session.close()


app = web.Application(client_max_size=4 * 1024 * 1024)
app.router.add_post("/", relay)
app.router.add_options("/", options_ok)
app.router.add_post("/faucet", faucet)
app.router.add_get("/health", health)
app.router.add_get("/stats", relay_stats)
app.on_startup.append(on_startup)
app.on_cleanup.append(on_cleanup)

if __name__ == "__main__":
    web.run_app(app, port=int(os.getenv("PORT", "8080")))
