"""faze.fun metadata sync.

faze runs its own bonding curve on Arc, so the trades themselves are indexed natively (two curve topics decoded in
insider.py). What the chain does not carry is presentation: ticker, name, artwork and socials live in the coin's
metadata document. This loop pulls the public launchpad API (https://faze.fun/api/v1) and fills pad_tokens, exactly
like the other pads — so a faze coin shows up in the Terminal with its logo, name and source chip.

Deliberately isolated from the ingest hot path: one HTTP call every 45 s, its own failure handling, and nothing
here can stall block processing. If faze's API is down we simply keep the metadata we already have.
"""
from __future__ import annotations

import asyncio
import logging
import time

import aiohttp
from sqlalchemy import text

from . import db

log = logging.getLogger("faze")

API = "https://faze.fun/api/v1/launchpad/coins"
PAD = "faze.fun"
CURVE = "0x6a62919ccbf0c19e0c4e084f986b582b4492dda4"
_meta_cache: dict[str, dict] = {}          # mint -> resolved metadata document
_live: dict[str, dict] = {}                # mint -> latest API row (curve stage stats for the Terminal)


def live_rows() -> dict[str, dict]:
    """Curve-stage stats keyed by lowercase mint, served to the site through /api/faze."""
    return _live


async def _metadata(session: aiohttp.ClientSession, uri: str) -> dict:
    """Resolve a coin's metadata document (name/description/image/socials); cached forever, it is immutable."""
    if uri in _meta_cache:
        return _meta_cache[uri]
    try:
        async with session.get(uri, timeout=aiohttp.ClientTimeout(total=12)) as r:
            doc = await r.json(content_type=None) if r.status == 200 else {}
    except Exception:  # noqa
        doc = {}
    if doc:
        _meta_cache[uri] = doc
    return doc


def _image(doc: dict) -> str | None:
    for k in ("image", "imageUrl", "image_url", "icon", "logo", "artwork"):
        v = doc.get(k)
        if isinstance(v, str) and v.startswith(("http://", "https://")):
            return v
        if isinstance(v, str) and v.startswith("ipfs://"):
            return "https://ipfs.io/ipfs/" + v[7:]
    return None


def _socials(doc: dict) -> tuple[str | None, str | None, str | None]:
    tw = doc.get("twitter") or doc.get("x") or (doc.get("links") or {}).get("twitter")
    tg = doc.get("telegram") or (doc.get("links") or {}).get("telegram")
    web = doc.get("website") or (doc.get("links") or {}).get("website")
    clean = lambda v: v if isinstance(v, str) and v.strip() else None            # noqa: E731
    return clean(tw), clean(tg), clean(web)


async def sync_once() -> int:
    """One pass over the faze coin list: upsert every coin into pad_tokens with its artwork and socials."""
    rows, cursor, pages = [], None, 0
    async with aiohttp.ClientSession(headers={"Accept": "application/json"}) as s:
        while pages < 6:                                                          # <= 600 coins per pass
            url = f"{API}?limit=100" + (f"&cursor={cursor}" if cursor else "")
            try:
                async with s.get(url, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    if r.status != 200:
                        log.warning("faze api %s", r.status)
                        break
                    j = await r.json(content_type=None)
            except Exception as e:  # noqa
                log.warning("faze api: %s", str(e)[:90])
                break
            coins = j.get("coins") or []
            rows += coins
            cursor = j.get("nextCursor")
            pages += 1
            if not cursor or not coins:
                break

        n = 0
        for c in rows:
            mint = (c.get("mint") or "").lower()
            if not mint.startswith("0x") or len(mint) != 42:
                continue
            _live[mint] = c
            doc = await _metadata(s, c["metadataUri"]) if c.get("metadataUri") else {}
            tw, tg, web = _socials(doc)
            created = int((c.get("createdAtMs") or 0) / 1000) or int(time.time())
            try:
                # registry row (source chip + launch time) …
                await db.execute(text(
                    "INSERT INTO pad_tokens (token, pad, factory, tx, ts, symbol) VALUES (:t, :p, :f, NULL, :ts, :s) "
                    "ON CONFLICT (token) DO UPDATE SET pad = EXCLUDED.pad, symbol = COALESCE(EXCLUDED.symbol, pad_tokens.symbol)"
                ).bindparams(t=mint, p=PAD, f=CURVE, ts=created, s=(c.get("ticker") or None)[:64] if c.get("ticker") else None))
                # … and presentation (name, artwork, socials) where the rest of the site reads it from
                await db.execute(text("""
                    INSERT INTO social_tokens (token, symbol, name, launchpad, deployer, x_handle, tg_handle, domain, logo, deploy_ts, updated)
                    VALUES (:t, :s, :n, :p, :d, :tw, :tg, :w, :l, :c, :u)
                    ON CONFLICT (token) DO UPDATE SET
                        symbol = COALESCE(EXCLUDED.symbol, social_tokens.symbol),
                        name = COALESCE(EXCLUDED.name, social_tokens.name),
                        launchpad = EXCLUDED.launchpad,
                        x_handle = COALESCE(EXCLUDED.x_handle, social_tokens.x_handle),
                        tg_handle = COALESCE(EXCLUDED.tg_handle, social_tokens.tg_handle),
                        domain = COALESCE(EXCLUDED.domain, social_tokens.domain),
                        logo = COALESCE(EXCLUDED.logo, social_tokens.logo),
                        updated = EXCLUDED.updated
                """).bindparams(t=mint, s=(c.get("ticker") or None), n=(c.get("name") or None), p=PAD,
                                d=(c.get("creatorWallet") or "").lower() or None, tw=tw, tg=tg, w=web,
                                l=_image(doc), c=created, u=int(time.time())))
                n += 1
            except Exception as e:  # noqa
                log.warning("faze upsert %s: %s", mint[:10], str(e)[:80])
                break                                                             # DB unhappy: stop, retry next pass
    return n


async def faze_loop() -> None:
    await asyncio.sleep(25)
    while True:
        try:
            n = await sync_once()
            if n:
                log.info("faze: %s coins synced (%s cached metadata docs)", n, len(_meta_cache))
        except Exception as e:  # noqa
            log.warning("faze loop: %s", str(e)[:120])
        await asyncio.sleep(45)
