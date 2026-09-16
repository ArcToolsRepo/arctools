"""
USDC-side liquidity per token, computed on chain via one Multicall3 round-trip.

  V3 / V2 / pad pools (insider_pools)  -> native USDC balance of the pool address (getEthBalance)
  V4 pools (v4_pools)                  -> PoolManager.extsload(slot0) + extsload(liquidity) and the
                                          virtual USDC reserve  L * 2^96 / sqrtP  (usdc = currency0)
                                          or  L * sqrtP / 2^96  (usdc = currency1)

Reported "liq" = 2 x USDC side (the usual DEX convention). Cached 60 s per token.
GET /api/liq?tokens=0x..,0x..  ->  {"liq": {token: usd}}
"""
import asyncio
import os
import logging
import time

import aiohttp
from aiohttp import web
from eth_abi import decode, encode
from eth_utils import keccak
from sqlalchemy import text

from . import db
from .balances import MULTICALL3, RELAY_RPC

log = logging.getLogger("liq")
V4_PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
POOLS_SLOT = 6            # Uniswap v4 PoolManager: mapping(PoolId => Pool.State) _pools
Q96 = 2 ** 96
TTL = 60
_cache: dict[str, tuple[float, float]] = {}


def _pool_slot(pool_id: str) -> bytes:
    return keccak(bytes.fromhex(pool_id[2:].rjust(64, "0")) + POOLS_SLOT.to_bytes(32, "big"))


async def _mc(calls: list[tuple[str, bytes]]) -> list[tuple[bool, bytes]]:
    sel = bytes.fromhex("bce38bd7")
    data = "0x" + (sel + encode(["bool", "(address,bytes)[]"], [False, calls])).hex()
    async with aiohttp.ClientSession() as s:
        async with s.post(RELAY_RPC, headers={"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "X-Priority": "high"}, json={"id": 1, "jsonrpc": "2.0", "method": "eth_call",
                                          "params": [{"to": MULTICALL3, "data": data}, "latest"]},
                          timeout=aiohttp.ClientTimeout(total=40)) as r:
            res = (await r.json()).get("result")
    if not res or res == "0x":
        return [(False, b"")] * len(calls)
    (results,) = decode(["(bool,bytes)[]"], bytes.fromhex(res[2:]))
    return list(results)


async def liquidity_for(tokens: list[str]) -> dict[str, float]:
    now = time.time()
    tokens = [t.lower() for t in tokens]
    out: dict[str, float] = {t: _cache[t][1] for t in tokens if t in _cache and now - _cache[t][0] < TTL}
    todo = [t for t in tokens if t not in out]
    if not todo:
        return out
    v3 = await db.fetchall(text("SELECT pool, token FROM insider_pools WHERE token = ANY(:t)").bindparams(t=todo))
    v4 = await db.fetchall(text("SELECT id, token, is0, usdc_dec FROM v4_pools WHERE token = ANY(:t)").bindparams(t=todo))
    calls: list[tuple[str, bytes]] = []
    meta: list[tuple[str, str, object]] = []
    for r in v3:
        calls.append((MULTICALL3, bytes.fromhex("4d2301cc" + r["pool"][2:].lower().rjust(64, "0"))))
        meta.append((r["token"].lower(), "v3", None))
    for r in v4:
        base = int.from_bytes(_pool_slot(r["id"]), "big")
        for off in (0, 3):
            calls.append((V4_PM, bytes.fromhex("1e2eaeaf") + (base + off).to_bytes(32, "big")))
        meta.append((r["token"].lower(), "v4", (int(r["is0"] or 0), int(r["usdc_dec"] or 18))))
    # tokens with no indexed pool are NOT reported (the site falls back to the launchpad API's own liquidity figure)
    stale = {t: _cache[t][1] for t in todo if t in _cache}
    if not calls:
        return out
    try:
        res = await _mc(calls)
    except Exception as e:  # noqa
        log.warning("liq multicall: %s", e)
        out.update(stale)   # RPC down: last known values beat a blank column
        return out
    acc: dict[str, float] = {}
    good: set[str] = set()   # tokens with at least one successful sub-call — only those get a fresh (cached) value
    i = 0
    for token, kind, extra in meta:
        if kind == "v3":
            ok, ret = res[i]; i += 1
            if ok and len(ret) >= 32:
                good.add(token)
                acc[token] = acc.get(token, 0.0) + int.from_bytes(ret[:32], "big") / 1e18 * 2
        else:
            (ok0, s0), (ok1, s1) = res[i], res[i + 1]; i += 2
            if not (ok0 and ok1 and len(s0) >= 32 and len(s1) >= 32):
                continue
            good.add(token)
            sqrt_p = int.from_bytes(s0[-20:], "big")            # low 160 bits of slot0
            liq = int.from_bytes(s1[-16:], "big")               # uint128 liquidity
            if sqrt_p == 0 or liq == 0:
                continue
            is0, dec = extra
            reserve = liq * Q96 // sqrt_p if is0 else liq * sqrt_p // Q96   # usdc side, in usdc base units
            acc[token] = acc.get(token, 0.0) + reserve / (10 ** dec) * 2
    for t in todo:
        if t in good:
            v = acc.get(t, 0.0)
            _cache[t] = (now, v)
            out[t] = v
        elif t in stale:
            out[t] = stale[t]   # sub-call failed (relay hiccup): keep the last good number, retry next time
    return out


async def api_liq(req: web.Request):
    raw = req.query.get("tokens", "")
    tokens = [t.strip().lower() for t in raw.split(",") if t.strip().startswith("0x") and len(t.strip()) == 42][:150]
    if not tokens:
        return web.json_response({"liq": {}})
    try:
        liq = await asyncio.wait_for(liquidity_for(tokens), 45)
    except Exception as e:  # noqa
        return web.json_response({"liq": {}, "error": str(e)[:120]})
    return web.json_response({"liq": liq}, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30"})


def register(app: web.Application):
    app.router.add_get("/api/liq", api_liq)


# ---------------------------------------------------------------------------
# holder concentration (top-1 / top-10 share) from the arc-scan indexer, proxied here because arc-scan
# rate-limits Cloudflare egress IPs (the site worker) but not Railway.
SKIP_HOLDERS = {"0x000000000000000000000000000000000000dead", "0x0000000000000000000000000000000000000000",
                "0x1eaad48260eecc7624666f1dfec202b2d75257fe", "0x2726aec64d8a9bc41b9940dda5d21c889458b348",   # ArcPad v2/v3
                "0x8366a39cc670b4001a1121b8f6a443a643e40951",                                                   # V4 PoolManager
                "0x7d49f880c7bdae4fd44d52c3dbfb43534e83dabd", "0x48ada931c2c220b074c39449b7e70860a3b4c277",   # ARCT vaults v2/v3
                "0xa4e79c06eec23c4caaa63aa37acc6fb7f0370a12", "0xff9a8f35f683c810f6c1507f7409bf0637093707", "0x3c897c6d3c9dcc32e69dd23be78f099510a65ece", "0x43cdbf8edb8fe41dde4ba519f49499d1ed78e74a",   # fee router, aggregator
                "0x05a0158ef87e8e7bfe4e0242e11dda75f83954e1", "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77",   # V4 router, SwapRouter02
                "0x39654a85a4c05127f5fd6ed22caec077a0fb1377", "0x0dcad158e98bc24455f9e94f46709d8a5f6d1255"}   # NPM, Warp factory
_pools_cache: tuple[float, set[str]] = (0.0, set())


async def _known_pools() -> set[str]:
    """Every DEX pool we have indexed (V3/V2/pad curves): LP balances are liquidity, not holders."""
    global _pools_cache
    if time.time() - _pools_cache[0] < 300:
        return _pools_cache[1]
    try:
        rows = await db.fetchall(text("SELECT pool FROM insider_pools"))
        _pools_cache = (time.time(), {r["pool"].lower() for r in rows if r["pool"]})
    except Exception as e:  # noqa
        log.warning("known pools: %s", e)
    return _pools_cache[1]
_risk_cache: dict[str, tuple[float, dict]] = {}
_risk_sem = asyncio.Semaphore(6)


_dep_cache: dict[str, tuple[float, str | None]] = {}


async def _deployer(s: aiohttp.ClientSession, token: str) -> str | None:
    c = _dep_cache.get(token)
    if c and time.time() - c[0] < 3600:
        return c[1]
    dev = None
    try:
        async with s.get(f"https://api.radardex.pro/token/{token}", headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
                         timeout=aiohttp.ClientTimeout(total=8)) as r:
            j = await r.json(content_type=None)
        d = str((j or {}).get("deployer") or "").lower()
        if d.startswith("0x") and len(d) == 42:
            dev = d
            from .risk_score import remember_dev
            await remember_dev(token, dev, "radar")
    except Exception:  # noqa
        pass
    if not dev:
        # fallback: first wallet that ever bought it in our index (launch buyer ~= deployer on curve pads)
        try:
            r = await db.fetchone(text("SELECT wallet FROM swaps WHERE token = :t ORDER BY ts ASC, log_index ASC LIMIT 1").bindparams(t=token))
            if r and r["wallet"]:
                dev = r["wallet"].lower()
                from .risk_score import remember_dev
                await remember_dev(token, dev, "first_buyer")
        except Exception:  # noqa
            pass
    _dep_cache[token] = (time.time(), dev)
    return dev


_bundle_cache: dict[str, tuple[float, set]] = {}


async def _bundle_wallets(token: str, dev: str | None) -> set[str]:
    c = _bundle_cache.get(token)
    if c and time.time() - c[0] < 600:
        return c[1]
    # launch-block wallets never change after the first minutes → 10 min cache; this GROUP BY over every swap of the
    # token ran 13× in parallel under Terminal load
    rows = await db.fetchall(text("SELECT wallet, MIN(ts) AS t0 FROM swaps WHERE token = :t AND side = 'buy' GROUP BY wallet").bindparams(t=token))
    out = _bundle_from_rows(rows, dev); _bundle_cache[token] = (time.time(), out)
    if len(_bundle_cache) > 5000: _bundle_cache.clear()
    return out


def _bundle_from_rows(rows, dev):
    if not rows:
        return set()
    first = min(int(r["t0"]) for r in rows)
    return {r["wallet"].lower() for r in rows if int(r["t0"]) <= first + 2 and r["wallet"].lower() != dev}


async def dev_activity(token: str, dev: str | None, bundle: set[str]) -> dict:
    """Sells by the deployer and by launch-block buyers in the last 24 h (usd, count, last ts)."""
    out = {"dev_sold_usd": 0.0, "dev_sells": 0, "dev_last_sell": None, "bundle_sold_usd": 0.0, "bundle_sells": 0, "bundle_last_sell": None, "bundle_sellers": 0}
    since = int(time.time()) - 86400
    try:
        if dev:
            r = await db.fetchone(text("SELECT COALESCE(SUM(usdc),0) AS u, COUNT(*) AS n, MAX(ts) AS t FROM swaps WHERE token = :t AND wallet = :w AND side = 'sell' AND ts > :s")
                                  .bindparams(t=token, w=dev, s=since))
            out.update(dev_sold_usd=round(float(r["u"] or 0), 2), dev_sells=int(r["n"] or 0), dev_last_sell=int(r["t"]) if r["t"] else None)
        if bundle:
            from sqlalchemy import bindparam
            r = await db.fetchone(text("SELECT COALESCE(SUM(usdc),0) AS u, COUNT(*) AS n, MAX(ts) AS t, COUNT(DISTINCT wallet) AS w FROM swaps WHERE token = :t AND wallet IN :ws AND side = 'sell' AND ts > :s")
                                  .bindparams(bindparam("ws", value=sorted(bundle), expanding=True)).bindparams(t=token, s=since))
            out.update(bundle_sold_usd=round(float(r["u"] or 0), 2), bundle_sells=int(r["n"] or 0), bundle_last_sell=int(r["t"]) if r["t"] else None, bundle_sellers=int(r["w"] or 0))
    except Exception as e:  # noqa
        log.debug("dev activity %s: %s", token, e)
    return out


_risk_db_loaded = False


async def risk_cache_init():
    """Create the table and preload every persisted score into memory (one query) so the API answers instantly after a restart."""
    global _risk_db_loaded
    await db.execute(text("CREATE TABLE IF NOT EXISTS risk_cache (token VARCHAR(64) PRIMARY KEY, data TEXT, ts BIGINT)"))
    try:
        import json as _json
        rows = await db.fetchall(text("SELECT token, data, ts FROM risk_cache WHERE ts > :t").bindparams(t=int(time.time()) - 6 * 3600))
        for r in rows:
            try:
                _risk_cache.setdefault(r["token"], (float(r["ts"]), _json.loads(r["data"])))
            except Exception:  # noqa
                pass
        log.info("risk_cache: %d scores preloaded", len(rows))
    except Exception as e:  # noqa
        log.warning("risk_cache preload: %s", e)
    _risk_db_loaded = True


_risk_bg: set[str] = set()


def _risk_schedule(token: str):
    """Compute in the background (bounded); the API answers now and the next poll picks the value up."""
    if token in _risk_bg or token in _risk_inflight:
        return
    _risk_bg.add(token)

    async def _go():
        try:
            async with aiohttp.ClientSession() as s2:
                await _risk_compute(s2, token)
        except Exception as e:  # noqa
            log.debug("risk bg %s: %s", token[:10], e)
        finally:
            _risk_bg.discard(token)
    asyncio.create_task(_go())


async def _risk_one(s: aiohttp.ClientSession, token: str) -> dict:
    c = _risk_cache.get(token)
    if c and time.time() - c[0] < 60:
        return c[1]
    if c and time.time() - c[0] < 6 * 3600:
        # stale-while-revalidate: answer instantly from the ≤6 h value, refresh in the background
        if token not in _risk_inflight:
            _risk_inflight.add(token)
            async def _bg():
                try:
                    async with aiohttp.ClientSession() as s2:
                        await _risk_compute(s2, token)
                finally:
                    _risk_inflight.discard(token)
            asyncio.create_task(_bg())
        return c[1]
    return await _risk_compute(s, token)


_risk_inflight: set[str] = set()


async def _risk_compute(s: aiohttp.ClientSession, token: str) -> dict:
    out = {"holders": 0, "top10": None, "top1": None, "dev": None, "dev_pct": None, "bundle_pct": None, "bundlers": 0}
    try:
        pools = await _known_pools()
        async with _risk_sem:
            async with s.get(f"https://api.arc-scan.org/v1/tokens/{token}/holders",
                             headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsBot/1.0)"},
                             timeout=aiohttp.ClientTimeout(total=15)) as r:
                j = await r.json()
        items = [x for x in (j.get("items") or [])
                 if (a := (x.get("address") or {}).get("address", "").lower()) not in SKIP_HOLDERS and a not in pools]
        shares = [float(x.get("share") or 0) for x in items]
        share_of = {(x.get("address") or {}).get("address", "").lower(): float(x.get("share") or 0) for x in items}
        # --- dev: deployer wallet (RadarDex knows it for most tokens) and its current share
        dev = await _deployer(s, token)
        dev_pct = round(share_of.get(dev, 0.0) * 100, 2) if dev else None
        # --- bundle: wallets whose FIRST buy landed within 2 s (~4 Arc blocks) of the token's first swap
        bundle_pct, bundlers, early = None, 0, set()
        try:
            early = await _bundle_wallets(token, dev)
            bundlers = len(early)
            bundle_pct = round(sum(share_of.get(w, 0.0) for w in early) * 100, 2)
        except Exception as e:  # noqa
            log.debug("bundle %s: %s", token, e)
        # what the insiders of the launch did afterwards: dev / bundle sells in the last 24 h
        act = await dev_activity(token, dev, early)
        rugs = launches = 0
        if dev:
            try:
                from .risk_score import dev_history
                h = await dev_history(dev)
                rugs, launches = h["rugs"], h["launches"]
            except Exception:  # noqa
                pass
        out = {"holders": int(j.get("holder_count") or len(items)),
               "top10": round(sum(shares[:10]) * 100, 2) if shares else None,
               "top1": round(shares[0] * 100, 2) if shares else None,
               "dev": dev, "dev_pct": dev_pct, "bundle_pct": bundle_pct, "bundlers": bundlers,
               "bundle_wallets": sorted(early)[:30], "dev_rugs": rugs, "dev_launches": launches, **act}
        from .risk_score import score as _score
        out["score"], out["grade"], out["flags"] = _score(out)
        _risk_cache[token] = (time.time(), out)
        # persist: a buybot restart / redeploy must not empty the Score column for minutes
        try:
            import json as _json
            await db.execute(text("INSERT INTO risk_cache (token, data, ts) VALUES (:t, :d, :ts) ON CONFLICT (token) DO UPDATE SET data = :d, ts = :ts")
                             .bindparams(t=token, d=_json.dumps(out), ts=int(time.time())))
        except Exception as e:  # noqa
            log.debug("risk_cache persist %s: %s", token[:10], e)
    except Exception as e:  # noqa
        log.debug("holder risk %s: %s", token, e)
    return out


async def api_holder_risk(req: web.Request):
    """GET /api/holder-risk?tokens=a,b,c[&wait=1]
    Default: answers immediately with everything cached (≤6 h, refreshed in the background) and schedules the rest —
    the caller polls again in a few seconds. wait=1 = old blocking behaviour (used by the sniper)."""
    raw = req.query.get("tokens", "")
    tokens = [t.strip().lower() for t in raw.split(",") if t.strip().startswith("0x") and len(t.strip()) == 42][:60]
    if not tokens:
        return web.json_response({"risk": {}, "pending": []}, headers={"Access-Control-Allow-Origin": "*"})
    if req.query.get("wait"):
        async with aiohttp.ClientSession() as s:
            res = await asyncio.gather(*[_risk_one(s, t) for t in tokens])
        return web.json_response({"risk": dict(zip(tokens, res)), "pending": []},
                                 headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60"})
    out: dict[str, dict] = {}
    pending: list[str] = []
    now = time.time()
    for t in tokens:
        c = _risk_cache.get(t)
        if c and now - c[0] < 6 * 3600:
            out[t] = c[1]
            if now - c[0] > 60:
                _risk_schedule(t)
        else:
            pending.append(t)
            _risk_schedule(t)
    # give very small batches a moment — most first-page requests come back complete in one round-trip
    if pending and len(pending) <= 4:
        for _ in range(12):
            await asyncio.sleep(0.25)
            done = [t for t in pending if t in _risk_cache]
            for t in done:
                out[t] = _risk_cache[t][1]; pending.remove(t)
            if not pending:
                break
    return web.json_response({"risk": out, "pending": pending},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})


async def risk_warm_loop():
    """Keep holder-risk warm for what the Terminal shows (top 200 by activity + ArcToolsPad + newest), so the SCORE and
    DEV/BUNDLE columns render without the "…" wait. Runs every 45 s, 6 tokens at a time (arc-scan is rate limited)."""
    await asyncio.sleep(60)
    while True:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get("https://arctools.fun/api/tokens", headers={"User-Agent": "ArcTools-buybot/1.0"}, timeout=aiohttp.ClientTimeout(total=60)) as r:
                    j = await r.json()
                toks = j.get("tokens") or []
                want = [t["token"].lower() for t in toks if t.get("pad") == "ArcToolsPad"]
                want += [t["token"].lower() for t in toks[:220]]
                # everything the Terminal can show (all sources, ~1.5k rows) — slow lane, oldest cache first
                try:
                    async with s.get("https://arctools.fun/api/tokens?full=1", headers={"User-Agent": "ArcTools-buybot/1.0"}, timeout=aiohttp.ClientTimeout(total=90)) as r2:
                        full = (await r2.json()).get("tokens") or []
                    rest = [t["token"].lower() for t in full if (t.get("mcapUsd") or 0) > 0]
                    rest.sort(key=lambda t: _risk_cache.get(t, (0,))[0])
                    want += rest[:400]
                except Exception as e:  # noqa
                    log.debug("risk warm full list: %s", e)
                want = list(dict.fromkeys(want))
                for i in range(0, len(want), 6):
                    await asyncio.gather(*[_risk_one(s, t) for t in want[i:i + 6]], return_exceptions=True)
                    await asyncio.sleep(0.3)
            log.info("risk warm: %d tokens", len(want))
        except Exception as e:  # noqa
            log.warning("risk warm: %s", e)
        await asyncio.sleep(45)


def register_risk(app: web.Application):
    async def _boot():
        await risk_cache_init()
        await risk_warm_loop()
    asyncio.create_task(_boot(), name="risk-warm")
    from .risk_score import register as _reg_score
    _reg_score(app)
    app.router.add_get("/api/holder-risk", api_holder_risk)
    app.router.add_get("/api/venue-tokens", api_venue_tokens)
    app.router.add_get("/api/wallet-feed", api_wallet_feed)
    app.router.add_get("/api/search", api_search)
    from .watchdog import api_status
    app.router.add_get("/api/status", api_status)


_search_cache: dict[str, tuple[float, list]] = {}


async def api_search(req: web.Request):
    """GET /api/search?q=<symbol|name|0xaddress> — every ERC-20 on Arc: own swap index (symbol match, with 24h stats)
    merged with arc-scan's chain-wide token search. Cached 60 s per query."""
    q = (req.query.get("q") or "").strip()[:64]
    if len(q) < 2:
        return web.json_response({"q": q, "rows": []}, headers={"Access-Control-Allow-Origin": "*"})
    key = q.lower()
    c = _search_cache.get(key)
    if c and time.time() - c[0] < 60:
        return web.json_response({"q": q, "rows": c[1]}, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30"})
    since = int(time.time()) - 86400
    is_addr = key.startswith("0x") and len(key) == 42
    rows: dict[str, dict] = {}
    # 1) own index — anything that ever traded on Arc through the venues we index
    try:
        if is_addr:
            idx = await db.fetchall(text(
                "SELECT s.token, sym.symbol, COUNT(*) AS txs, COALESCE(SUM(s.usdc),0) AS vol, MAX(s.ts) AS last_ts, MIN(s.venue) AS venue "
                "FROM swaps s LEFT JOIN token_symbols sym ON sym.token = s.token WHERE s.token = :t GROUP BY s.token, sym.symbol").bindparams(t=key))
        else:
            idx = await db.fetchall(text(
                "SELECT s.token, sym.symbol, COUNT(*) AS txs, COALESCE(SUM(CASE WHEN s.ts > :since THEN s.usdc ELSE 0 END),0) AS vol, MAX(s.ts) AS last_ts, MIN(s.venue) AS venue "
                "FROM swaps s JOIN token_symbols sym ON sym.token = s.token WHERE LOWER(sym.symbol) LIKE :p "
                "GROUP BY s.token, sym.symbol ORDER BY vol DESC, txs DESC LIMIT 25").bindparams(p="%" + key + "%", since=since))
        for r in idx:
            d = dict(r); d["token"] = d["token"].lower(); d["source"] = "index"; d["vol"] = round(float(d["vol"] or 0), 2)
            rows[d["token"]] = d
    except Exception as e:  # noqa
        log.debug("search idx %s: %s", q, e)
    # 2) arc-scan chain-wide search (tokens only) — catches tokens that never traded on an indexed venue
    try:
        async with aiohttp.ClientSession() as s_:
            async with s_.get("https://api.arc-scan.org/v1/search", params={"q": q}, timeout=aiohttp.ClientTimeout(total=8),
                              headers={"User-Agent": "ArcTools/1.0"}) as r:
                if r.status == 200:
                    j = await r.json()
                    results = list(j.get("results") or [])
                    if j.get("type") == "token" and j.get("url") and not results:   # unique match: arc-scan returns a redirect url only
                        results.append({"type": "token", "sub": j["url"].rsplit("/", 1)[-1], "label": None})
                    for it in results[:40]:
                        if it.get("type") != "token":
                            continue
                        a = (it.get("sub") or "").lower()
                        if not (a.startswith("0x") and len(a) == 42):
                            continue
                        d = rows.setdefault(a, {"token": a, "symbol": None, "txs": 0, "vol": 0.0, "last_ts": None, "venue": None, "source": "chain"})
                        d["symbol"] = d.get("symbol") or it.get("label")
                        if not d["symbol"]:
                            try:
                                from .insider import _symbol
                                d["symbol"] = await _symbol(a) or None
                            except Exception:  # noqa
                                pass
                        d["lookalike"] = bool(it.get("unverified_lookalike"))
    except Exception as e:  # noqa
        log.debug("search arc-scan %s: %s", q, e)
    if is_addr and key not in rows:
        # unknown to both: still return the address so the UI can probe it on-chain
        rows[key] = {"token": key, "symbol": None, "txs": 0, "vol": 0.0, "last_ts": None, "venue": None, "source": "unknown"}
    out = sorted(rows.values(), key=lambda d: (-(d.get("vol") or 0), -(d.get("txs") or 0), (d.get("symbol") or "").lower() != key))
    # exact symbol matches first
    out.sort(key=lambda d: 0 if (d.get("symbol") or "").lower() == key else 1)
    out = out[:30]
    _search_cache[key] = (time.time(), out)
    if len(_search_cache) > 2000:
        for k in list(_search_cache)[:1000]:
            _search_cache.pop(k, None)
    return web.json_response({"q": q, "rows": out}, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30"})


async def api_venue_tokens(req: web.Request):
    """GET /api/venue-tokens?venue=v2 — tokens with swaps on a venue (v2 = DYORSwap / WarpDex pairs), with 24h stats."""
    venue = req.query.get("venue", "v2")[:8]
    days = min(30, int(req.query.get("days", "30")))
    rows = await db.fetchall(text(
        "SELECT s.token, sym.symbol, COUNT(*) AS txs, SUM(s.usdc) AS vol, MIN(s.ts) AS first_ts, MAX(s.ts) AS last_ts, "
        "(SELECT price1m FROM swaps x WHERE x.token = s.token AND x.price1m > 0 ORDER BY ts DESC LIMIT 1) AS price1m "
        "FROM swaps s LEFT JOIN token_symbols sym ON sym.token = s.token "
        "WHERE s.venue = :v AND s.ts > :since GROUP BY s.token, sym.symbol ORDER BY vol DESC LIMIT 300").bindparams(v=venue, since=int(time.time()) - days * 86400))
    out = [dict(r) for r in rows]
    # symbols missing from token_symbols (vanity-address V2 tokens never went through a launchpad feed): resolve on chain, cached
    from .insider import _symbol, total_supply_nowait
    async def fill(d):
        if not d.get("symbol"):
            try:
                d["symbol"] = await _symbol(d["token"]) or None
            except Exception:  # noqa
                d["symbol"] = None
        sup = total_supply_nowait(d["token"])
        d["supply"] = sup
        d["mcap"] = (float(d["price1m"]) / 1e6 * sup) if (sup and d.get("price1m")) else None
    await asyncio.gather(*[fill(d) for d in out])
    return web.json_response({"venue": venue, "rows": out},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30"})


async def api_wallet_feed(req: web.Request):
    """GET /api/wallet-feed?wallets=0x..,0x..&since=<unix> — swaps of those wallets since `since` (max 60 wallets, 2 h back).
    Cheap indexed query; the Wallets page polls it every few seconds for live buy/sell cards."""
    from sqlalchemy import bindparam
    ws = [w.strip().lower() for w in req.query.get("wallets", "").split(",") if w.strip().startswith("0x") and len(w.strip()) == 42][:60]
    if not ws:
        return web.json_response({"rows": []}, headers={"Access-Control-Allow-Origin": "*"})
    since = max(int(req.query.get("since", "0") or 0), int(time.time()) - 7200)
    rows = await db.fetchall(text(
        "SELECT s.tx, s.log_index, s.ts, s.wallet, s.token, s.side, s.usdc, s.tokens, s.price1m, s.venue, sym.symbol "
        "FROM swaps s LEFT JOIN token_symbols sym ON sym.token = s.token "
        "WHERE s.ts > :since AND s.wallet IN :ws ORDER BY s.ts DESC, s.log_index DESC LIMIT 100"
    ).bindparams(bindparam("ws", value=ws, expanding=True)).bindparams(since=since))
    return web.json_response({"rows": [dict(r) for r in rows], "now": int(time.time())},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})
