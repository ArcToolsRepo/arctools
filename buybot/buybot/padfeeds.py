"""Launchpad front-end feeds: sharc.fun and creo.family.

Both publish a plain public list of what they launched on Arc. Their tokens land in ordinary Uniswap pools, so our
own index already prices them — what the chain does not carry is who launched them and what they look like. This
loop fills exactly that: source label, name, artwork, socials and (for sharc) the bonding-curve fill.

Same isolation rule as faze.py: one HTTP call per feed every 60 s, never on the ingest path, and any feed that is
down simply leaves the last known metadata in place.

creo.family is worth a note: it launches through the o1 Launchpad factory on Arc — the same factory UBI.fun uses.
On-chain the two are indistinguishable (no front-end field in the launch event), so the only honest way to tell
them apart is each front-end's own list, which is what we read here.
"""
from __future__ import annotations

import asyncio
import logging
import time

import aiohttp
from sqlalchemy import text

from . import db

log = logging.getLogger("padfeeds")

UA = {"User-Agent": "ArcTools/1.0 (+https://arctools.fun)", "Accept": "application/json"}
_live: dict[str, dict] = {}                 # mint -> curve/live stats for the Terminal (sharc only, for now)


def live_rows() -> dict[str, dict]:
    return _live


async def _upsert(token: str, pad: str, symbol: str | None, name: str | None, logo: str | None,
                  twitter: str | None, telegram: str | None, website: str | None,
                  deployer: str | None, created: int) -> None:
    await db.execute(text(
        "INSERT INTO pad_tokens (token, pad, factory, tx, ts, symbol) VALUES (:t, :p, NULL, NULL, :ts, :s) "
        "ON CONFLICT (token) DO UPDATE SET pad = EXCLUDED.pad, symbol = COALESCE(EXCLUDED.symbol, pad_tokens.symbol)"
    ).bindparams(t=token, p=pad, ts=created, s=(symbol or None)))
    await db.execute(text("""
        INSERT INTO social_tokens (token, symbol, name, launchpad, deployer, x_handle, tg_handle, domain, logo, deploy_ts, updated)
        VALUES (:t, :s, :n, :p, :d, :tw, :tg, :w, :l, :c, :u)
        ON CONFLICT (token) DO UPDATE SET
            symbol = COALESCE(EXCLUDED.symbol, social_tokens.symbol),
            name = COALESCE(EXCLUDED.name, social_tokens.name),
            launchpad = EXCLUDED.launchpad,
            deployer = COALESCE(EXCLUDED.deployer, social_tokens.deployer),
            x_handle = COALESCE(EXCLUDED.x_handle, social_tokens.x_handle),
            tg_handle = COALESCE(EXCLUDED.tg_handle, social_tokens.tg_handle),
            domain = COALESCE(EXCLUDED.domain, social_tokens.domain),
            logo = COALESCE(EXCLUDED.logo, social_tokens.logo),
            updated = EXCLUDED.updated
    """).bindparams(t=token, s=symbol, n=name, p=pad, d=(deployer or "").lower() or None,
                    tw=twitter, tg=telegram, w=website, l=logo, c=created, u=int(time.time())))


def _meta_socials(meta: dict | None) -> tuple[str | None, str | None, str | None, str | None]:
    """(logo, twitter, telegram, website) out of a free-form metadata blob."""
    if not isinstance(meta, dict):
        return None, None, None, None
    pick = lambda *keys: next((meta[k] for k in keys if isinstance(meta.get(k), str) and meta[k].strip()), None)  # noqa: E731
    logo = pick("image", "imageUrl", "logo", "icon", "avatar")
    if isinstance(logo, str) and logo.startswith("ipfs://"):
        logo = "https://ipfs.io/ipfs/" + logo[7:]
    return logo, pick("twitter", "x"), pick("telegram", "tg"), pick("website", "site", "url")



def _ipfs(u: str) -> str:
    return "https://ipfs.io/ipfs/" + u[7:] if u.startswith("ipfs://") else u


def _num(v, default: float = 0.0) -> float:
    """sharc returns every number as a string ("2097036047"); creo mixes both."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return default

async def sync_sharc(s: aiohttp.ClientSession) -> int:
    async with s.get("https://sharc.fun/api/tokens", timeout=aiohttp.ClientTimeout(total=25)) as r:
        if r.status != 200:
            log.warning("sharc api %s", r.status)
            return 0
        rows = await r.json(content_type=None)
    n = 0
    for c in rows if isinstance(rows, list) else []:
        if c.get("chainKey") != "arc" or c.get("spam"):
            continue                                   # their list also carries testnet coins and flagged spam
        tok = (c.get("address") or "").lower()
        if not (tok.startswith("0x") and len(tok) == 42):
            continue
        # a curated feed still carries every coin its pad ever made; only surface ones that are alive, so the
        # Terminal does not gain 300 dead rows (search and /token keep working for the rest either way)
        trades = int(_num(c.get("tradesCount")))
        ts_age = _num(c.get("createdAt"), time.time())
        ts_age = ts_age / 1000 if ts_age > 1e11 else ts_age
        if trades == 0 and ts_age < time.time() - 7 * 86400:
            continue
        logo, tw, tg, web = _meta_socials(c.get("metadata"))
        ts_raw = _num(c.get("createdAt"), time.time())
        created = int(ts_raw / 1000) if ts_raw > 1e11 else int(ts_raw)
        try:
            price = _num(c.get("priceE18")) / 1e18
            _live[tok] = {
                "symbol": c.get("symbol"), "name": c.get("name"), "price1m": price * 1e6 if price else None,
                "mcap": _num(c.get("marketCap")) / 1e6 or None,          # their marketCap is in quote units (6-dec USDC)
                "vol24": _num(c.get("volume24h")) / 1e6 or None,
                "txs24": int(_num(c.get("tradesCount"))), "holders": int(_num(c.get("holdersCount"))),
                "progress": round(min(100.0, max(0.0, _num(c.get("progressBps")) / 100)), 2),
                "state": "graduated" if c.get("graduated") else "curve-trading",
                "url": f"https://sharc.fun/coin/{c.get('address')}",
            }
        except Exception:  # noqa
            pass
        await _upsert(tok, "sharc", c.get("symbol"), c.get("name"), logo, tw, tg, web, c.get("creator"), created)
        n += 1
    return n



PEACH_API = "https://api.peach.ag/arc/v1/launchpad/tokens"
PEACH_CURVE_SUPPLY = 8e26          # dex_supply_threshold: tokens that must sell off the curve to graduate


async def sync_peach(s: aiohttp.ClientSession) -> int:
    """peach.ag runs its own bonding curve on Arc with a proper public API: artwork on their CDN, live market cap,
    volume and how much of the curve is left before graduation. Socials are not in their payload, so those keep
    coming from the contract scanner."""
    # their API caps limit at 100 and paginates with an opaque cursor; limit=200 is a hard 400
    n, cursor, pages = 0, "", 0
    while pages < 12:                                  # up to 1200 tokens per pass; their catalogue is ~700
        try:
            params = {"limit": "100"}
            if cursor:
                params["cursor"] = cursor
            async with s.get(PEACH_API, params=params, timeout=aiohttp.ClientTimeout(total=25)) as r:
                if r.status != 200:
                    log.warning("peach api %s", r.status)
                    break
                j = await r.json(content_type=None)
        except Exception as e:  # noqa
            log.warning("peach api: %s", str(e)[:90])
            break
        items = j.get("items") or []
        if not items:
            break
        for c in items:
            tok = (c.get("token") or "").lower()
            if not (tok.startswith("0x") and len(tok) == 42):
                continue
            logo = c.get("image_url") or (_ipfs(c.get("image_uri")) if c.get("image_uri") else None)
            created = int(_num(c.get("created_at"), time.time()))
            remaining = _num(c.get("tokens_remaining_to_graduation"))
            threshold = _num(c.get("dex_supply_threshold")) or PEACH_CURVE_SUPPLY
            progress = max(0.0, min(100.0, (1 - remaining / threshold) * 100)) if threshold else 0.0
            graduated = str(c.get("status") or "").upper() not in ("BONDING", "")
            _live[tok] = {
                "symbol": c.get("symbol"), "name": c.get("name"),
                "price1m": _num(c.get("price_usd")) * 1e6 or None,
                "mcap": _num(c.get("market_cap_usd")) or None,
                "vol24": _num(c.get("buy_volume_24h_usd")) + _num(c.get("sell_volume_24h_usd")) or None,
                "txs24": int(_num(c.get("buy_trades_24h")) + _num(c.get("sell_trades_24h"))),
                "holders": int(_num(c.get("holders_count"))),
                "liq": _num(c.get("liquidity_usd")) or _num(c.get("raised_amount_usd")) or None,
                "progress": round(progress, 2),
                "state": "graduated" if graduated else "curve-trading",
                "url": f"https://www.peach.ag/arc/launchpad/{c.get('token')}",
            }
            await _upsert(tok, "peach", c.get("symbol"), c.get("name"), logo, None, None, None,
                          c.get("creator"), created)
            n += 1
        cursor = j.get("next_cursor") or ""
        pages += 1
        if not cursor or len(items) < 100:
            break
    return n


async def sync_creo(s: aiohttp.ClientSession) -> int:
    async with s.get("https://www.creo.family/api/launches", timeout=aiohttp.ClientTimeout(total=25)) as r:
        if r.status != 200:
            log.warning("creo api %s", r.status)
            return 0
        j = await r.json(content_type=None)
    n = 0
    for c in (j.get("items") or []):
        tok = (c.get("token") or "").lower()
        if not (tok.startswith("0x") and len(tok) == 42):
            continue
        ts_raw = _num(c.get("createdAt") or c.get("timestamp"))
        created = int(ts_raw / 1000 if ts_raw > 1e11 else ts_raw) or int(time.time())
        logo, tw, tg, web = _meta_socials(c)
        await _upsert(tok, "creo", c.get("symbol"), c.get("name"), c.get("logo") or logo, tw, tg, web,
                      c.get("deployer"), created)
        n += 1
    return n


async def padfeeds_loop() -> None:
    await asyncio.sleep(35)
    while True:
        async with aiohttp.ClientSession(headers=UA) as s:
            for name, fn in (("sharc", sync_sharc), ("creo", sync_creo), ("peach", sync_peach)):
                try:
                    got = await fn(s)
                    if got:
                        log.info("%s: %s tokens synced", name, got)
                except Exception as e:  # noqa
                    log.warning("%s feed: %s", name, str(e)[:110])
        await asyncio.sleep(60)
