"""Launchpad registry — who launched which token.

Many Arc launchpads (Lift, eve.fun, Ellipse, Sashimi, aka.fun …) create the token AND seed a Uniswap V3 pool in the same
transaction, so their tokens already trade through our aggregator; what is missing is the *label* ("launched on Lift")
and the venue link. This module watches each factory's transactions, pulls the receipt, takes every fresh ERC-20 mint
(Transfer from 0x0, excluding the V3 position NFT) as the launched token and stores token → pad.

  GET /api/pad-tokens            → {tokens: {<token>: {pad, url, twitter, ts, tx, factory}}, pads: [...]}
  GET /api/pad-tokens?pad=lift   → same, one pad
Config-only extension: add a factory address to FACTORIES.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

import aiohttp
from aiohttp import web
from sqlalchemy import text

from . import db

log = logging.getLogger("pads")
CORS = {"Access-Control-Allow-Origin": "*"}
RELAY = os.getenv("RELAY_URL", "https://rpc-production-ba7a.up.railway.app")
NODE = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")   # own reth node: no rate limit → symbols resolve on first sight
SCAN = "https://api.arc-scan.org/v1"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
V3_POS_NFT = "0x39654a85a4c05127f5fd6ed22caec077a0fb1377"

# name → (label, url, twitter, [factory addresses], note)
FACTORIES: dict[str, dict] = {
    "lift":     {"label": "Lift",        "url": "https://lift.fun",      "twitter": "liftdotfun",      "factories": ["0x3f29dd25d1f6ad3d09d1d4a880f8a869e3039153"], "model": "instant V3 pool"},
    "eve":      {"label": "eve.fun",     "url": "https://www.eve.fun",   "twitter": "eve_dot_fun",     "factories": ["0x05bf9d713e1f58779ad4dd8d6fef4c7529c7323a", "0xd51e6217bb3bc7586866713854ea75b7beff1009"], "model": "instant V3 pool"},
    "ellipse":  {"label": "Ellipse",     "url": "https://ellipse.fun",   "twitter": "rwarcdotfun",     "factories": ["0x3daea5925dc688b7636065439d0b84760f285602"], "model": "V3 pool quoted in bridged CRCL / GLD / USDT"},
    "sashimi":  {"label": "Sashimi",     "url": "https://sashimi.fun",   "twitter": "sashimidotfun",   "factories": ["0x0d85ac76baaed7a46cb5133b57bce7d8f9a44d58", "0x5b7bf9bd9c35a845ec1d469ed58616e7076a6f5c"], "model": "bonding curve"},
    "aka":      {"label": "aka.fun",     "url": "https://aka.fun",       "twitter": "akadotfun",       "factories": ["0x268b41c0614d066dfc858455cb8f733deb3b04cc"], "model": "DN404"},
    "arcane":   {"label": "Arcane",      "url": "https://arcane.fi",     "twitter": "Arcanedotfi",     "factories": ["0x2dca1c5acdcf362c6b61d91ec4661a410fe4e178", "0x86dfced95ad9231f3cbe0c73d4cb9d555357301c"], "model": "AMM"},
    # --- found 16.09 by walking token-creation txs of un-attributed V3/V4 tokens (marketing/src/find_factories.py) ---
    "klik":     {"label": "Klik",        "url": "https://klik.finance",  "twitter": "klikfinance",     "factories": ["0x7e5aeacff30dabedc729a0456f99f3f80aa2217c"], "model": "instant V4 pool, hook 0xf73a3f56…"},
    "minara":   {"label": "Minara",      "url": "https://minara.fun",    "twitter": "minarafun",       "factories": ["0xb6c6f77ee74af874a183bfd77dd0176d1ac91de6"], "model": "Uniswap liquidityLauncher → V4 pool (uerc20Factory 0xff99d8f6…, hook 0xb6a65950…); mainnet since 16.09"},
    "pools":    {"label": "pools.trade", "url": "https://pools.trade",   "twitter": None,              "factories": ["0x0000ffffbe8efe702c8703ae3477ff5de3d319c0"], "model": "Uniswap liquidityLauncher → V4 pool (same uerc20Factory as Minara)"},
    "arguspad": {"label": "Arguspad",    "url": "https://arguspad.io",   "twitter": "arguspad",        "factories": ["0xb021be536808f551b31789422fd28a6c9c6e97da"], "model": "token factory (ARGUS-quoted V4 pools)"},
    "tolly":    {"label": "Tolly",       "url": "https://tolly.fun",     "twitter": "tollylabs",       "factories": ["0xcad7ee36ac193bf2eddb7b3e2736c5bdb8269c8b"], "model": "instant V3 pool + locker 0x712fee0e…"},
    "faze":     {"label": "faze.fun",    "url": "https://faze.fun",     "twitter": "fazedotfun",     "factories": ["0x6a62919ccbf0c19e0c4e084f986b582b4492dda4", "0x47e7936ae9891e61c5123db720593c05de7120cc", "0x7c8de42426a058b778dce8530537cd62ef0178c4"], "model": "own bonding curve, graduates into a locked Uniswap V4 pool (LP NFT burned)"},
    "sharc":    {"label": "sharc.fun",   "url": "https://sharc.fun",    "twitter": "sharcdotfun",    "factories": [], "model": "multichain curve launchpad (tokens attributed from their public feed while it existed)", "status": "site offline since 18.09.2026 — sharc.fun is a GoDaddy parking page, /api/tokens 404; 308 tokens remain on-chain, no live prices"},
    "creo":     {"label": "creo.family", "url": "https://creo.family",  "twitter": "creodotfamily",  "factories": [], "model": "cinematic AI launchpad; launches through the o1 Launchpad factory on Arc, attributed from their own feed"},
    "peach":    {"label": "peach.ag",    "url": "https://www.peach.ag/arc/launchpad", "twitter": "peachdotag", "factories": ["0x7e462d220b6b0a4c55b205b613133dc1c1cc9dc1", "0x7b9720bc177e8b6f96962e9b15891f27108cad40", "0x173c4bdd5cf95a935d2b5636c573c5f4df062044"], "model": "own bonding curve in USDC, graduates into a locked Uniswap V4 pool"},
    # --- 18.09: hopium.gg, "stock-paired launchpad": token + Uniswap v4 pool + locked position in one tx; pairs are USDC or
    # long.supply stock tokens; trading fee 3-10 % of which 2 % is theirs. Tokens expose logo()/description()/website() on-chain.
    "hopium":   {"label": "Hopium",      "url": "https://hopium.gg",     "twitter": "hopium_gg",       "factories": ["0x0727fe8a5c7073e5b5882bc5ba8d73a427cbe3aa"], "model": "instant V4 pool quoted in USDC or a stock token, liquidity locked (hook 0xc75076a1…, locker 0xa306b48e…)"},
    # --- 22.09: foci.family — Uniswap v4 launch with its own hook; factory event 0xdcacba5e… (token, pool-ish, creator)
    "foci":     {"label": "foci.family", "url": "https://foci.family", "twitter": "focidotfamily",    "factories": ["0x5c5c202271e1300bd5ce43a4f5c1cea8efd57b63"], "model": "instant V4 pool with hook 0xf847790b…, USDC-quoted", "hooks": ["0xf847790b6fa5da300bb3f56f10d743e71e98e044"]},
    # --- 23.09: wonk.fun — Uniswap v4 launch with the "cook" hook; launcherFactory event 0x4bc3e1c7… (token, hook, creator; name/symbol in data)
    "wonk":     {"label": "wonk.fun", "url": "https://wonk.fun", "twitter": "wonk_fun", "telegram": "wonkdotfun", "factories": ["0x34f3da4d04394173ded7b0f430af114a0ff27952"], "model": "bonding curve on V4 hook 0x21bdc377… → graduates to a live V4 pool, USDC-quoted", "hooks": ["0x21bdc377265e2a26ba336f24381e67e768253044"]},
    "ubi":      {"label": "UBI.fun",     "url": "https://ubi.fun",       "twitter": "ubidotfun",       "factories": ["0xee3e862efde6dcd6df5648af0e2731b9d1df4605", "0xe07f7ca66ec795592385018dd998f0b50b8a2834"], "model": "V4 pool, hooks 0x20eead6d… / 0xc780c0f4…"},
}

# Launchpads we have already reverse-engineered but that are NOT on Arc mainnet yet (or show no real tokens). Kept out of
# FACTORIES so the Terminal never lists tokens nobody can buy. Going live = move the entry into FACTORIES and fill "factories".
PENDING_FACTORIES: dict[str, dict] = {
    # 22.09: solonpad.fun — Uniswap v4 launch (memeHook 0x9d1a376d…, launchDeployer 0xe70e060f…, launchLocker 0x3e93df00…,
    # graduationExecutor 0xb39af010…). Contracts live on Arc, ZERO launches yet (no pool with the hook, no deployer event).
    # The hook is already in venues.V4_HOOKS, so the first pool is labelled "solonpad.fun" the moment it appears.
    "solonpad": {"label": "solonpad.fun", "url": "https://solonpad.fun", "twitter": "Solonlabs1", "factories": [], "model": "Uniswap v4 launch with hook, USDC-quoted", "hooks": ["0x9d1a376de8525a2cd622b5c2ce99984f8432e044"], "status": "contracts deployed, 0 launches (22.09)"},
    "arcfun":   {"label": "Arcfun",      "url": "https://arcfun.app",    "twitter": None, "factories": [], "model": "USDC bonding curve → DEX", "status": "site shows placeholder tokens only (16.09)"},
    "o1":       {"label": "o1 Launchpad", "url": "https://o1launchpad.com", "twitter": "o1_exchange", "factories": [], "model": "single-sided Uniswap v4 launch, crypto- and stock-paired markets", "status": "docs name Arc as a creation target, but the public API needs an x-api-key and lists only Base 8453 / Monad 143 / Robinhood 4663; no Arc factory confirmed on-chain yet (16.09)"},
    "arclaunch":{"label": "ARCLaunch",   "url": "https://arclaunch.fun", "twitter": None, "factories": [], "model": "?", "status": "no tokens / contracts visible (16.09)"},
}


async def init():
    await db.execute(text("CREATE TABLE IF NOT EXISTS pad_tokens (token VARCHAR(64) PRIMARY KEY, pad VARCHAR(24), factory VARCHAR(64), tx VARCHAR(80), ts BIGINT, symbol VARCHAR(64))"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS pad_tokens_pad ON pad_tokens (pad)"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS pad_cursor (factory VARCHAR(64) PRIMARY KEY, last_hash VARCHAR(80), ts BIGINT)"))
    asyncio.create_task(registry_loop(), name="pads-registry")


async def _rpc(s: aiohttp.ClientSession, method: str, params: list):
    for url in (NODE, RELAY):
        try:
            async with s.post(url, headers={"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "X-Priority": "high"},
                              json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=aiohttp.ClientTimeout(total=12)) as r:
                j = await r.json(content_type=None)
                if isinstance(j, dict) and "result" in j:
                    return j["result"]
        except Exception:  # noqa - next endpoint
            continue
    return None


async def _symbol(s: aiohttp.ClientSession, token: str) -> str | None:
    try:
        r = await _rpc(s, "eth_call", [{"to": token, "data": "0x95d89b41"}, "latest"])
        if not r or len(r) < 130:
            return None
        n = int(r[66:130], 16)
        return bytes.fromhex(r[130:130 + n * 2]).decode("utf-8", "ignore")[:32] or None
    except Exception:  # noqa
        return None


async def scan_factory(s: aiohttp.ClientSession, pad: str, factory: str, full: bool = False) -> int:
    cur = await db.fetchone(text("SELECT last_hash FROM pad_cursor WHERE factory = :f").bindparams(f=factory))
    last = cur["last_hash"] if cur else None
    found = 0
    cursor = None
    newest = None
    for page in range(30 if full or not last else 3):
        url = f"{SCAN}/address/{factory}/txs?limit=100" + (f"&cursor={cursor}" if cursor else "")
        async with s.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; ArcTools/1.0)"}, timeout=aiohttp.ClientTimeout(total=30)) as r:
            j = await r.json(content_type=None)
        items = j.get("items") or []
        if not items:
            break
        if newest is None:
            newest = items[0]["hash"]
        stop = False
        for t in items:
            if t["hash"] == last:
                stop = True
                break
            if str(t.get("status", "")).lower() not in ("success", "1", "true", "ok"):
                continue
            rc = await _rpc(s, "eth_getTransactionReceipt", [t["hash"]]) or {}
            logs = rc.get("logs") or []
            mints = []
            for l in logs:
                tp = l.get("topics") or []
                if len(tp) >= 3 and tp[0] == TRANSFER and int(tp[1], 16) == 0 and l["address"].lower() != V3_POS_NFT:
                    if l["address"].lower() not in mints:
                        mints.append(l["address"].lower())
            for tok in mints[:1]:      # the launched token is the first fresh mint in the tx
                sym = await _symbol(s, tok)
                await db.execute(text("INSERT INTO pad_tokens (token, pad, factory, tx, ts, symbol) VALUES (:t, :p, :f, :h, :ts, :s) ON CONFLICT (token) DO NOTHING")
                                 .bindparams(t=tok, p=pad, f=factory, h=t["hash"], ts=int(t["timestamp"]), s=sym))
                # a token that failed its logo check as an anonymous V4/V3 token gets a fresh look now that we know its pad:
                # launchpads upload artwork a moment after the launch tx, so the first check often ran too early
                await db.execute(text("UPDATE social_tokens SET logo_checked = 0 WHERE token = :t AND (logo IS NULL OR logo = '')").bindparams(t=tok))
                found += 1
        if stop:
            break
        cursor = (j.get("page") or {}).get("next")
        if not cursor:
            break
    if newest:
        await db.execute(text("INSERT INTO pad_cursor (factory, last_hash, ts) VALUES (:f, :h, :ts) ON CONFLICT (factory) DO UPDATE SET last_hash = EXCLUDED.last_hash, ts = EXCLUDED.ts")
                         .bindparams(f=factory, h=newest, ts=int(time.time())))
    return found


async def audit_registry() -> int:
    """Drop registry rows that are not tokens at all.

    Two kinds sneak in: a front-end feed that hands us a placeholder address (creo's API returned the classic
    0x1234…7890), and contracts that answer symbol() with empty bytes and have no code behind them. Both show up
    in the list as a nameless "?" row, which is exactly what the data-quality check is meant to catch — so they
    have to leave the registry rather than have the check taught to ignore them."""
    rows = await db.fetchall(text(
        "SELECT token FROM pad_tokens WHERE symbol IS NULL OR symbol = '' OR symbol = '?' LIMIT 300"))
    if not rows:
        return 0
    gone = []
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
        for r in rows:
            tok = r["token"]
            try:
                code = await _rpc(s, "eth_getCode", [tok, "latest"])
            except Exception:  # noqa
                continue
            if not isinstance(code, str) or len(code) <= 4:      # no contract there
                gone.append(tok); continue
            sym = await _symbol(s, tok)
            if not sym:                                          # a contract that will not name itself
                gone.append(tok)
    if gone:
        await db.execute(text("DELETE FROM pad_tokens WHERE token = ANY(:t)").bindparams(t=gone))
        log.info("registry audit: dropped %s non-token rows", len(gone))
    return len(gone)


async def registry_loop():
    await asyncio.sleep(45)
    first = True
    while True:
        try:
            async with aiohttp.ClientSession() as s:
                for pad, cfg in FACTORIES.items():
                    for f in cfg["factories"]:
                        try:
                            n = await scan_factory(s, pad, f, full=first)
                            if n:
                                log.info("pads: %s +%s tokens from %s", pad, n, f[:10])
                        except Exception as e:  # noqa
                            log.warning("pads %s %s: %s", pad, f[:10], e)
        except Exception as e:  # noqa
            log.warning("pads loop: %s", e)
        first = False
        # registry rows created without a symbol (RPC hiccup at discovery) → fill them, newest first, 40 per pass
        try:
            rows = await db.fetchall(text("SELECT token FROM pad_tokens WHERE symbol IS NULL OR symbol = '' ORDER BY ts DESC LIMIT 40"))
            if rows:
                async with aiohttp.ClientSession() as s:
                    fixed = 0
                    for r in rows:
                        sym = await _symbol(s, r["token"])
                        if sym:
                            await db.execute(text("UPDATE pad_tokens SET symbol = :s WHERE token = :t").bindparams(s=sym, t=r["token"])); fixed += 1
                        else:
                            await db.execute(text("UPDATE pad_tokens SET symbol = '?' WHERE token = :t").bindparams(t=r["token"]))   # no symbol() on-chain
                    log.info("pads: symbols filled %s/%s", fixed, len(rows))
        except Exception as e:  # noqa
            log.warning("pads symbol backfill: %s", e)
        try:
            await audit_registry()          # keep placeholder / unnamed entries out of the public list
        except Exception as e:  # noqa
            log.debug("registry audit: %s", e)
        await asyncio.sleep(180)


async def api_pad_tokens(req: web.Request):
    from .watchlist import _cached, _resp_body
    body = await _cached("pads:" + req.query_string, 60, lambda: _resp_body(_api_pad_tokens_impl(req)))
    return web.Response(body=body, content_type="application/json", headers={**CORS, "Cache-Control": "public, max-age=30"})


async def _api_pad_tokens_impl(req: web.Request):
    pad = req.query.get("pad")
    # left-join the presentation row so a registry token carries its artwork and name, not just a ticker
    rows = await db.fetchall(text(
        "SELECT p.token, p.pad, p.factory, p.tx, p.ts, COALESCE(p.symbol, s.symbol) AS symbol, "
        "COALESCE(NULLIF(s.name, ''), NULLIF(p.symbol, ''), s.symbol) AS name, s.logo "
        "FROM pad_tokens p LEFT JOIN social_tokens s ON s.token = p.token"
        # a row nobody can name is not shown: the symbol backfill writes '?' when the contract answers
        # symbol() with nothing, and a "?" row is noise in the table and a false alarm in the quality check
        " WHERE COALESCE(NULLIF(p.symbol, ''), NULLIF(s.symbol, ''), '?') <> '?'"
        + (" AND p.pad = :p" if pad else "") + " ORDER BY p.ts DESC").bindparams(**({"p": pad} if pad else {})))
    out = {}
    for r in rows:
        cfg = FACTORIES.get(r["pad"], {})
        out[r["token"]] = {"pad": cfg.get("label", r["pad"]), "padId": r["pad"], "url": cfg.get("url"), "twitter": cfg.get("twitter"), "ts": r["ts"], "tx": r["tx"], "factory": r["factory"], "symbol": r["symbol"], "name": r["name"], "logo": r["logo"]}
    pads = [{"id": k, **{kk: vv for kk, vv in v.items() if kk != "factories"}, "factories": v["factories"], "count": sum(1 for r in rows if r["pad"] == k)} for k, v in FACTORIES.items()]
    return web.json_response({"tokens": out, "pads": pads}, headers={**CORS, "Cache-Control": "public, max-age=60"})


def register(app: web.Application):
    app.router.add_get("/api/pad-tokens", api_pad_tokens)
