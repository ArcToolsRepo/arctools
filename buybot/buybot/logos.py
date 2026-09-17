"""Logo hunter — finds a logo for every token that trades but has none in social_tokens.

Order of attempts (cheap → expensive), all against our own Arc node:
  1. token contract getters: image() logo() logoURI() imageURI() metadataURI() tokenURI() uri() metadata() contractURI()
     — a string; either an image URL / ipfs://… or a JSON (or data:application/json) whose image/logo/imageUrl field is the logo
  2. the creation transaction: every log's data and the tx input are scanned for printable URLs / ipfs CIDs ending in an
     image extension or hosted on a known launchpad CDN (Minara, Klik/IPFS, Tolly, Arguspad, RadarDex …)
  3. the pad's own token page (og:image) for pads we know the URL pattern of
  4. X avatar of the project handle (unavatar) — last resort, only if the token has an X handle
Every candidate is verified (HEAD/GET, image/* content-type, ≥ 200 B). Result → social_tokens.logo; misses are stamped
(logo_checked) and retried after 6 h. The site merges social_tokens.logo through /api/token-meta.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

import aiohttp
from sqlalchemy import text

from . import db

log = logging.getLogger("logos")
NODE = os.getenv("PRIMARY_RPC", "http://89.68.166.52:8545")
RELAY = os.getenv("RELAY_URL", "https://rpc-production-ba7a.up.railway.app")
HDR = {"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "X-Priority": "high"}
UA = {"User-Agent": "Mozilla/5.0 (compatible; ArcTools/1.0; +https://arctools.fun)"}
GATEWAYS = ["https://ipfs.io/ipfs/", "https://cloudflare-ipfs.com/ipfs/", "https://gateway.pinata.cloud/ipfs/"]
SELECTORS = {  # name → 4-byte selector (keccak of the signature)
    "image()": "0x0bf3e5ff", "logo()": "0x1c6a5b6f", "logoURI()": "0x5a3e1a19", "imageURI()": "0x0f9e7c9c", "imageUrl()": "0x3f2c8d9e",
    "metadataURI()": "0x03ee438c", "tokenURI()": "0xc87b56dd", "uri()": "0xeac989f8", "metadata()": "0x392f37e9", "contractURI()": "0xe8a3d485",
    "description()": "0x7284e416",
}
IMG_EXT = re.compile(r"\.(png|jpe?g|webp|gif|svg|avif)(\?|$)", re.I)
URL_RE = re.compile(r"(https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{8,300})")
IPFS_RE = re.compile(r"(?:ipfs://|/ipfs/)(Qm[1-9A-HJ-NP-Za-km-z]{44}|ba[a-z2-7]{50,})(/[A-Za-z0-9._%-]+)*")
CDN_HINT = ("static.minara.ai", "arguspad", "tollylabs", "tolly", "radardex", "klik", "ubi.fun", "lift.fun", "ellipse", "sashimi", "eve.fun",
            "pinata", "ipfs", "arweave", "cloudfront", "imgur", "pump", "supabase", "storage.googleapis", "vercel", "r2.dev", "cdn")
PAD_PAGES = {  # launchpad → token page pattern (og:image)
    "argus": "https://arguspad.io/token/{t}", "arguspad": "https://arguspad.io/token/{t}",
    "klik": "https://klik.finance/token/{t}", "ubi": "https://ubi.fun/token/{t}", "tolly": "https://tolly.fun/token/{t}",
    "minara": "https://minara.fun/token/{t}", "lift": "https://lift.fun/token/{t}", "sashimi": "https://sashimi.fun/token/{t}",
    "eve": "https://www.eve.fun/token/{t}", "dyor": "https://dyorswap.finance/token/{t}", "long": "https://long.supply/token/{t}",
}
stats = {"checked": 0, "found": 0, "by": {}}


def _sel(sig: str) -> str:
    from web3 import Web3
    h = Web3.keccak(text=sig).hex()
    h = h if h.startswith("0x") else "0x" + h
    return h[:10]


async def _rpc(s: aiohttp.ClientSession, method: str, params: list, timeout: float = 12):
    for url in (NODE, RELAY):
        try:
            async with s.post(url, headers=HDR, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                              timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                j = await r.json(content_type=None)
                if isinstance(j, dict) and "result" in j:
                    return j["result"]
        except Exception:  # noqa
            continue
    return None


def _decode_string(hexres: str | None) -> str | None:
    if not hexres or hexres == "0x" or len(hexres) < 130:
        return None
    try:
        body = hexres[2:]
        off = int(body[:64], 16) * 2
        n = int(body[off:off + 64], 16) * 2
        raw = bytes.fromhex(body[off + 64:off + 64 + n])
        s = raw.decode("utf-8", "ignore").strip("\x00 ")
        return s or None
    except Exception:  # noqa
        return None


def _ipfs_to_http(u: str) -> str:
    m = IPFS_RE.search(u)
    if m:
        return GATEWAYS[0] + m.group(1) + (m.group(2) or "")
    return u


async def _verify(s: aiohttp.ClientSession, url: str) -> bool:
    """True when the URL serves an image (content-type image/* or magic bytes), ≥ 200 B."""
    try:
        async with s.get(url, headers=UA, timeout=aiohttp.ClientTimeout(total=8), allow_redirects=True) as r:
            if r.status != 200:
                return False
            ct = (r.headers.get("Content-Type") or "").lower()
            head = await r.content.read(512)
            if ct.startswith("image/") and len(head) >= 100:
                return True
            magic = head[:12]
            return magic.startswith((b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"RIFF")) or b"<svg" in head[:300].lower()
    except Exception:  # noqa
        return False



GATEWAYS = ("https://ipfs.io/ipfs/", "https://cloudflare-ipfs.com/ipfs/", "https://dweb.link/ipfs/")


async def verify_any(s: aiohttp.ClientSession, url: str) -> str | None:
    """First URL that really serves an image. For an ipfs:// asset try several gateways: one gateway being down
    must not cost us a logo we have already located."""
    if not url:
        return None
    cands = [url]
    if "/ipfs/" in url:
        cid = url.split("/ipfs/", 1)[1]
        cands = [g + cid for g in GATEWAYS]
    for u in cands:
        try:
            if await _verify(s, u):
                return u
        except Exception:  # noqa
            continue
    return None


async def _from_json_meta(s: aiohttp.ClientSession, u: str) -> str | None:
    """u is a metadata URL / data: URI → image field."""
    try:
        if u.startswith("data:application/json"):
            payload = u.split(",", 1)[1]
            if ";base64" in u.split(",", 1)[0]:
                import base64
                payload = base64.b64decode(payload).decode("utf-8", "ignore")
            j = json.loads(payload)
        else:
            async with s.get(_ipfs_to_http(u), headers=UA, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    return None
                txt = await r.text()
                j = json.loads(txt)
        for k in ("image", "logo", "logoURI", "imageUrl", "image_url", "icon", "avatar", "imageURI", "logo_url"):
            v = j.get(k) if isinstance(j, dict) else None
            if isinstance(v, str) and len(v) > 8:
                return _ipfs_to_http(v)
    except Exception:  # noqa
        return None
    return None


async def try_contract(s: aiohttp.ClientSession, token: str) -> str | None:
    calls = [{"jsonrpc": "2.0", "id": i, "method": "eth_call", "params": [{"to": token, "data": _sel(sig)}, "latest"]} for i, sig in enumerate(SELECTORS)]
    try:
        async with s.post(NODE, headers=HDR, json=calls, timeout=aiohttp.ClientTimeout(total=12)) as r:
            res = await r.json(content_type=None)
    except Exception:  # noqa
        return None
    if not isinstance(res, list):
        return None
    strings = []
    for x in res:
        v = _decode_string(x.get("result")) if isinstance(x, dict) else None
        if v:
            strings.append(v)
    for v in strings:
        cand = _ipfs_to_http(v)
        if IMG_EXT.search(cand) or (cand.startswith("http") and any(h in cand for h in CDN_HINT)):
            if await _verify(s, cand):
                return cand
        if cand.startswith(("http", "data:application/json")) or IPFS_RE.search(v):
            img = await _from_json_meta(s, v)
            if img and await _verify(s, img):
                return img
        for m in URL_RE.finditer(v):                    # description() with a link in it
            u = m.group(1)
            if IMG_EXT.search(u) and await _verify(s, u):
                return u
    return None


async def _creation_block(s: aiohttp.ClientSession, token: str, head: int) -> int | None:
    lo, hi = 1, head
    if (await _rpc(s, "eth_getCode", [token, hex(hi)])) in (None, "0x"):
        return None
    while lo < hi:
        mid = (lo + hi) // 2
        c = await _rpc(s, "eth_getCode", [token, hex(mid)])
        if c and c != "0x":
            hi = mid
        else:
            lo = mid + 1
    return lo


async def _creation_tx_hash(s: aiohttp.ClientSession, token: str) -> str | None:
    """Cheap sources first: our pad registry (tx of the launch), arc-scan's creation record; the 25-call
    getCode binary search on the node only as a last resort."""
    try:
        r = await db.fetchone(text("SELECT tx FROM pad_tokens WHERE token = :t").bindparams(t=token))
        if r and r["tx"]:
            return r["tx"]
    except Exception:  # noqa
        pass
    try:
        async with s.get(f"https://api.arc-scan.org/v1/address/{token}", headers=UA, timeout=aiohttp.ClientTimeout(total=8)) as r:
            if r.status == 200:
                j = await r.json(content_type=None)
                cr = j.get("creation") or {}
                h = cr.get("tx_hash") or cr.get("transaction_hash") or cr.get("hash")
                if h:
                    return h
    except Exception:  # noqa
        pass
    head_hex = await _rpc(s, "eth_blockNumber", [])
    if not head_hex:
        return None
    b = await _creation_block(s, token, int(head_hex, 16))
    if not b:
        return None
    logs = await _rpc(s, "eth_getLogs", [{"fromBlock": hex(b), "toBlock": hex(b), "address": token}]) or []
    return logs[0]["transactionHash"] if logs else None


async def try_creation_tx(s: aiohttp.ClientSession, token: str) -> str | None:
    txh = await _creation_tx_hash(s, token)
    if not txh:
        return None
    rc = await _rpc(s, "eth_getTransactionReceipt", [txh]) or {}
    tx = await _rpc(s, "eth_getTransactionByHash", [txh]) or {}
    blobs = []
    for lg in rc.get("logs") or []:
        try:
            blobs.append(bytes.fromhex((lg.get("data") or "0x")[2:]))
        except Exception:  # noqa
            pass
    try:
        blobs.append(bytes.fromhex((tx.get("input") or "0x")[2:]))
    except Exception:  # noqa
        pass
    cands: list[str] = []
    for blob in blobs:
        txt = blob.decode("latin-1")
        for m in URL_RE.finditer(txt):
            cands.append(m.group(1).rstrip("\x00"))
        for m in IPFS_RE.finditer(txt):
            cands.append(GATEWAYS[0] + m.group(1) + (m.group(2) or ""))
    # images first, then JSON metadata
    for u in cands:
        u = u.strip("\x00\"' ")
        if IMG_EXT.search(u) or any(h in u for h in ("static.minara.ai", "token-logos", "/logo", "/image")):
            if await _verify(s, u):
                return u
    for u in cands:
        img = await _from_json_meta(s, u)
        if img and await _verify(s, img):
            return img
    return None


async def try_pad_page(s: aiohttp.ClientSession, token: str, launchpad: str | None) -> str | None:
    pat = PAD_PAGES.get((launchpad or "").lower())
    if not pat:
        return None
    try:
        async with s.get(pat.format(t=token), headers=UA, timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status != 200:
                return None
            html = (await r.text())[:400_000]
    except Exception:  # noqa
        return None
    m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', html, re.I) or \
        re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html, re.I)
    if m:
        u = m.group(1)
        # generic site banners are not a token logo: require the token address or an obvious per-token path
        if token[2:10].lower() in u.lower() or "/token" in u or "logo" in u or "ipfs" in u:
            if await _verify(s, u):
                return u
    return None


async def try_x_avatar(s: aiohttp.ClientSession, x_handle: str | None) -> str | None:
    if not x_handle:
        return None
    u = f"https://unavatar.io/x/{x_handle.lstrip('@')}?fallback=false"
    return u if await _verify(s, u) else None


async def resolve(s: aiohttp.ClientSession, token: str, launchpad: str | None, x_handle: str | None) -> tuple[str | None, str]:
    from .bytelogo import from_bytecode
    for name, fn in (("contract", lambda: try_contract(s, token)), ("bytecode", lambda: from_bytecode(s, token)),
                     ("creation", lambda: try_creation_tx(s, token)),
                     ("padpage", lambda: try_pad_page(s, token, launchpad)), ("x", lambda: try_x_avatar(s, x_handle))):
        try:
            u = await asyncio.wait_for(fn(), 15)
        except Exception:  # noqa
            u = None
        if u:
            return u[:300], name
    return None, "none"


async def init():
    for stmt in ("ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS logo VARCHAR(300)",
                 "ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS logo_checked BIGINT",
                 "ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS logo_src VARCHAR(16)"):
        try:
            await db.execute(text(stmt))
        except Exception:  # noqa
            pass


async def hunt_once(limit: int = 400) -> tuple[int, int]:
    """Tokens that traded in the last 7 days, no logo, not checked in the last 24 h — most volume first.

    A token whose logo we DID find gets logo_checked pushed ten years out by identity.py, so it never comes back
    into this queue: one successful lookup per token, for good."""
    now = int(time.time())
    rows = await db.fetchall(text("""
        WITH act AS (SELECT token, SUM(usdc) v FROM swaps WHERE ts > :since GROUP BY token)
        SELECT a.token, st.launchpad, st.x_handle, a.v
        FROM act a LEFT JOIN social_tokens st ON st.token = a.token
        WHERE (st.logo IS NULL OR st.logo = '') AND COALESCE(st.logo_checked, 0) < :recheck
          AND a.token <> '0x3600000000000000000000000000000000000000'
        ORDER BY a.v DESC LIMIT :l""").bindparams(since=now - 7 * 86400, recheck=now - 24 * 3600, l=limit))
    if not rows:
        return 0, 0
    found = 0
    sem = asyncio.Semaphore(40)      # fetches/verifies
    writes: list[dict] = []
    async with aiohttp.ClientSession() as s:
        async def one(r):
            nonlocal found
            async with sem:
                u, src = await resolve(s, r["token"], r["launchpad"], r["x_handle"])
                if not u:
                    try:        # last resort: the contract's own getters (bytecode is already tried above)
                        from .contract_socials import read_contract
                        got = await read_contract(s, r["token"])
                        if got.get("logo") and await _verify(s, got["logo"]):
                            u, src = got["logo"], "contract"
                    except Exception:  # noqa
                        pass
            stats["checked"] += 1
            if u:
                found += 1; stats["found"] += 1; stats["by"][src] = stats["by"].get(src, 0) + 1
            writes.append({"t": r["token"], "u": u, "src": src})
        await asyncio.gather(*[one(r) for r in rows])
    for i in range(0, len(writes), 100):     # one statement per 100 tokens keeps the ingest connection free
        chunk = writes[i:i + 100]
        vals = ", ".join(f"(:t{j}, '', '', 0, :n, :u{j}, :n, :src{j})" for j in range(len(chunk)))
        par = {"n": now}
        for j, w in enumerate(chunk):
            par[f"t{j}"], par[f"u{j}"], par[f"src{j}"] = w["t"], w["u"], w["src"]
        await db.execute(text(f"""
            INSERT INTO social_tokens (token, symbol, name, mcap, updated, logo, logo_checked, logo_src)
            VALUES {vals}
            ON CONFLICT (token) DO UPDATE SET logo = COALESCE(EXCLUDED.logo, social_tokens.logo), logo_checked = EXCLUDED.logo_checked,
                                            logo_src = CASE WHEN EXCLUDED.logo IS NULL THEN social_tokens.logo_src ELSE EXCLUDED.logo_src END
        """).bindparams(**par))
    return len(rows), found


async def hunt_loop():
    await init()
    await asyncio.sleep(90)
    while True:
        try:
            from .insider import _lag
            if (_lag.get("blocks") or 0) > 25:            # the live index has priority on DB + node
                await asyncio.sleep(30); continue
            n, f = await hunt_once()
            if n:
                log.info("logos: %s/%s found (%s)", f, n, stats["by"])
        except Exception as e:  # noqa
            log.warning("logos: %s", e)
        await asyncio.sleep(25)     # 400 tokens per pass, one pass every 25 s


async def api_logo_stats(_req):
    from aiohttp import web
    r = await db.fetchone(text("""
        WITH act AS (SELECT DISTINCT token FROM swaps WHERE ts > :since)
        SELECT COUNT(*) n, COUNT(st.logo) FILTER (WHERE st.logo <> '') has FROM act a LEFT JOIN social_tokens st ON st.token = a.token
    """).bindparams(since=int(time.time()) - 7 * 86400))
    by = await db.fetchall(text("SELECT logo_src, COUNT(*) n FROM social_tokens WHERE logo IS NOT NULL AND logo <> '' GROUP BY logo_src"))
    return web.json_response({"active_7d": r["n"], "with_logo": r["has"], "coverage": round(100 * (r["has"] or 0) / max(1, r["n"]), 1),
                              "by_source": {x["logo_src"] or "lists": x["n"] for x in by}, "session": stats}, headers={"Access-Control-Allow-Origin": "*"})


def register(app):
    app.router.add_get("/api/logo-stats", api_logo_stats)
