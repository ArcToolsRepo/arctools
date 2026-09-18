"""DexScreener as an identity source — the one place token owners actually fill in their own metadata.

"Enhanced Token Info" on DexScreener is set by whoever controls the token (they pay for it), which makes it the
closest thing to a signed statement of ownership that exists off-chain: logo, website, X and Telegram, all from the
project itself. That is exactly what our anonymous Uniswap V3/V4 rows are missing.

It is also cheap to read: the token endpoint accepts 30 addresses per request, so the whole active set can be swept
in a few minutes instead of one lookup at a time.

Two things are stored beyond the metadata:
  * ds_url       — the pair page, so the site can link straight to it
  * ds_enhanced  — whether the owner has filled the info in; the Terminal shows that as a small "DEX ✓" badge,
                   which doubles as a trust signal (somebody stood behind this token publicly)
"""
from __future__ import annotations

import asyncio
import logging
import time

import aiohttp
from sqlalchemy import text

from . import db
from .logos import _verify

log = logging.getLogger("dexscreener")

API = "https://api.dexscreener.com/latest/dex/tokens/"
BATCH = 30                     # addresses per request, per their docs
CHAIN = "arc"
stats = {"checked": 0, "enhanced": 0, "logos": 0, "socials": 0, "pairs": 0}


async def init() -> None:
    for stmt in ("ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS ds_enhanced SMALLINT DEFAULT 0",
                 "ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS ds_url VARCHAR(220)",
                 "ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS ds_checked BIGINT",
                 "CREATE INDEX IF NOT EXISTS social_tokens_ds ON social_tokens (ds_checked)"):
        try:
            await db.execute(text(stmt))
        except Exception:  # noqa
            pass


def _pick(pairs: list[dict], token: str) -> dict:
    """Best pair for this token: the one whose info block is filled, else the deepest liquidity."""
    # info (image, socials) describes the pair's BASE token. A pair where our token is the QUOTE side carries the other
    # coin's artwork — that is how BTCBR ended up wearing DUKE's logo. Base side only.
    mine = [p for p in pairs if (p.get("baseToken") or {}).get("address", "").lower() == token]
    if not mine:
        return {}
    with_info = [p for p in mine if (p.get("info") or {}).get("imageUrl") or (p.get("info") or {}).get("socials")]
    pool = with_info or mine
    return max(pool, key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0))


_NUM_ONLY = __import__("re").compile(r"^\d+$")


# tabs and sub-pages of a profile, never an account name
_RESERVED = {"i", "home", "share", "intent", "search", "hashtag", "explore", "status", "with_replies",
             "media", "likes", "photo", "following", "followers", "joinchat", "s", "c"}


def _handle(url: str) -> str | None:
    """The ACCOUNT from an X/Telegram link — the first path segment, not the last.

    Taking the last segment was wrong: `x.com/circle/with_replies` yielded the handle "with_replies", and it only
    failed safe on `x.com/<name>/status/<id>` because a tweet id happens to be numeric.

    A link to one specific post is also refused outright. An owner pasting `x.com/circle/status/…` into their
    DexScreener info is citing somebody else's tweet, not declaring their own account, and crediting the token to
    @circle would be exactly the false attribution we refuse to publish."""
    raw = (url or "").split("?")[0].split("#")[0].rstrip("/")
    if "/status/" in raw or "/statuses/" in raw:
        return None
    path = raw.split("//")[-1].split("/", 1)
    seg = path[1] if len(path) > 1 else ""
    h = seg.split("/")[0].lstrip("@")
    if not h or _NUM_ONLY.match(h) or h.lower() in _RESERVED or h.startswith("+"):
        return None
    return h[:64]


def _from_pair(p: dict) -> dict:
    info = p.get("info") or {}
    out: dict = {"ds_url": (p.get("url") or "")[:220]}
    if info.get("imageUrl"):
        out["logo"] = str(info["imageUrl"])[:300]
    for s in (info.get("socials") or []):
        kind = (s.get("type") or "").lower()
        url = s.get("url") or ""
        if kind == "twitter":
            if h := _handle(url):
                out["x_handle"] = h
        elif kind == "telegram":
            if h := _handle(url):
                out["tg_handle"] = h
    sites = info.get("websites") or []
    if sites and sites[0].get("url"):
        out["domain"] = str(sites[0]["url"])[:160]
    # "enhanced" = the owner filled the info in, which is what the badge reports
    out["ds_enhanced"] = 1 if (out.get("logo") or out.get("x_handle") or out.get("tg_handle") or out.get("domain")) else 0
    return out


async def clean_bad_handles() -> int:
    """Null the handles the last-segment parser produced, and re-open those rows for a fresh read."""
    junk = sorted(_RESERVED)
    res = await db.execute(text("""
        UPDATE social_tokens SET x_handle = NULL, ds_checked = NULL
        WHERE lower(COALESCE(x_handle, '')) = ANY(:j)""").bindparams(j=junk))
    res2 = await db.execute(text("""
        UPDATE social_tokens SET tg_handle = NULL, ds_checked = NULL
        WHERE lower(COALESCE(tg_handle, '')) = ANY(:j)""").bindparams(j=junk))
    n = (getattr(res, "rowcount", 0) or 0) + (getattr(res2, "rowcount", 0) or 0)
    if n:
        log.info("dexscreener: cleared %s handles produced by the old parser", n)
    return n


async def sweep_once(limit: int = 600) -> tuple[int, int]:
    now = int(time.time())
    rows = await db.fetchall(text("""
        WITH act AS (SELECT token, SUM(usdc) v FROM swaps WHERE ts > :since GROUP BY token)
        SELECT a.token, s.logo, s.x_handle, s.tg_handle, s.domain
        FROM act a LEFT JOIN social_tokens s ON s.token = a.token
        WHERE COALESCE(s.ds_checked, 0) < :stale
          AND a.token <> '0x3600000000000000000000000000000000000000'
        ORDER BY a.v DESC LIMIT :n
    """).bindparams(since=now - 14 * 86400, stale=now - 3 * 86400, n=limit))
    if not rows:
        return 0, 0
    found = 0
    async with aiohttp.ClientSession(headers={"Accept": "application/json", "User-Agent": "ArcTools/1.0"}) as s:
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            addrs = ",".join(r["token"] for r in chunk)
            try:
                async with s.get(API + addrs, timeout=aiohttp.ClientTimeout(total=25)) as r:
                    if r.status == 429:
                        await asyncio.sleep(5)
                        continue
                    if r.status != 200:
                        log.debug("dexscreener %s", r.status)
                        continue
                    j = await r.json(content_type=None)
            except Exception as e:  # noqa
                log.debug("dexscreener batch: %s", str(e)[:80])
                continue
            pairs = [p for p in (j.get("pairs") or []) if (p.get("chainId") or "") == CHAIN]
            stats["pairs"] += len(pairs)
            for row in chunk:
                tok = row["token"]
                stats["checked"] += 1
                got = _from_pair(_pick(pairs, tok)) if pairs else {}
                logo = got.get("logo")
                if logo and not await _verify(s, logo):
                    logo = None
                if got.get("ds_enhanced"):
                    stats["enhanced"] += 1
                if logo:
                    stats["logos"] += 1
                if got.get("x_handle") or got.get("tg_handle") or got.get("domain"):
                    stats["socials"] += 1
                if logo or got.get("x_handle") or got.get("tg_handle") or got.get("domain") or got.get("ds_url"):
                    found += 1
                await db.execute(text("""
                    INSERT INTO social_tokens (token, symbol, name, logo, x_handle, tg_handle, domain,
                                               ds_enhanced, ds_url, ds_checked, updated)
                    VALUES (:t, '', '', :l, :x, :g, :w, :e, :u, :n, :n)
                    ON CONFLICT (token) DO UPDATE SET
                        logo = COALESCE(social_tokens.logo, EXCLUDED.logo),
                        x_handle = COALESCE(social_tokens.x_handle, EXCLUDED.x_handle),
                        tg_handle = COALESCE(social_tokens.tg_handle, EXCLUDED.tg_handle),
                        domain = COALESCE(social_tokens.domain, EXCLUDED.domain),
                        ds_enhanced = GREATEST(COALESCE(social_tokens.ds_enhanced, 0), EXCLUDED.ds_enhanced),
                        ds_url = COALESCE(EXCLUDED.ds_url, social_tokens.ds_url),
                        ds_checked = EXCLUDED.ds_checked,
                        updated = EXCLUDED.updated
                """).bindparams(t=tok, l=logo, x=got.get("x_handle"), g=got.get("tg_handle"), w=got.get("domain"),
                                e=got.get("ds_enhanced") or 0, u=got.get("ds_url"), n=now))
                # owner-filled artwork is as good as it gets: stop the other hunters from spending lookups on it
                if logo:
                    await db.execute(text("UPDATE social_tokens SET logo_src = COALESCE(logo_src, 'dexscreener'), "
                                          "logo_checked = :far WHERE token = :t")
                                     .bindparams(t=tok, far=now + 10 * 365 * 86400))
            await asyncio.sleep(0.25)                  # ~240 requests/min, inside their limit
    return len(rows), found


async def ds_loop() -> None:
    await init()
    try:
        await clean_bad_handles()   # one-off repair of handles the old last-segment parser invented
    except Exception as e:  # noqa
        log.warning("dexscreener cleanup: %s", e)
    await asyncio.sleep(70)
    while True:
        try:
            from .insider import _lag
            if (_lag.get("blocks") or 0) > 25:
                await asyncio.sleep(20)
                continue
            n, f = await sweep_once()
            if n:
                log.info("dexscreener: %s checked, %s with data (%s)", n, f, stats)
        except Exception as e:  # noqa
            log.warning("dexscreener loop: %s", str(e)[:120])
        await asyncio.sleep(25)


async def api_ds_stats(request):
    from aiohttp import web
    row = await db.fetchone(text("""
        SELECT count(*) FILTER (WHERE ds_checked IS NOT NULL) AS checked,
               count(*) FILTER (WHERE ds_enhanced = 1) AS enhanced,
               count(*) FILTER (WHERE logo_src = 'dexscreener') AS logos
        FROM social_tokens"""))
    # the badge says the owner filled the info in; when that row still has no artwork or links we want to see
    # which tokens they are, because that combination means the badge is claiming more than the data supports
    gap = await db.fetchall(text("""
        SELECT token, symbol, x_handle, tg_handle, domain, ds_url
        FROM social_tokens
        WHERE ds_enhanced = 1 AND COALESCE(logo, '') = ''
          AND COALESCE(x_handle, '') = '' AND COALESCE(tg_handle, '') = '' AND COALESCE(domain, '') = ''
        LIMIT 12"""))
    gap_n = await db.fetchone(text("""
        SELECT count(*) n FROM social_tokens WHERE ds_enhanced = 1 AND COALESCE(logo, '') = ''
          AND COALESCE(x_handle, '') = '' AND COALESCE(tg_handle, '') = '' AND COALESCE(domain, '') = ''"""))
    nologo = await db.fetchone(text("SELECT count(*) n FROM social_tokens WHERE ds_enhanced = 1 AND COALESCE(logo, '') = ''"))
    sample = await db.fetchall(text("""
        SELECT token, symbol, COALESCE(logo, '') logo, COALESCE(x_handle, '') x_handle,
               COALESCE(tg_handle, '') tg_handle, COALESCE(domain, '') domain, logo_src
        FROM social_tokens WHERE ds_enhanced = 1 ORDER BY ds_checked DESC LIMIT 10"""))
    return web.json_response({"session": stats, "totals": dict(row) if row else {},
                              "badge_without_logo": (nologo or {}).get("n"),
                              "badge_without_anything": (gap_n or {}).get("n"),
                              "examples": [dict(r) for r in gap], "badge_sample": [dict(r) for r in sample]},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})


async def clean_quote_side_logos() -> dict:
    """One-off repair for the quote-side bug: every token whose logo/socials came from DexScreener is re-fetched; if no
    base-token pair on Arc carries that image, the logo (and DS socials) are cleared so the hunters can start over."""
    rows = await db.fetchall(text("SELECT token, logo FROM social_tokens WHERE logo LIKE 'https://cdn.dexscreener.com/%'"))
    fixed = 0; checked = 0
    async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (compatible; ArcTools/1.0)"}) as s:
        for i in range(0, len(rows), 30):
            chunk = rows[i:i + 30]
            try:
                async with s.get(API + ",".join(r["token"] for r in chunk), timeout=aiohttp.ClientTimeout(total=25)) as r:
                    if r.status != 200:
                        await asyncio.sleep(3); continue
                    j = await r.json(content_type=None)
            except Exception:  # noqa
                continue
            pairs = [p for p in (j.get("pairs") or []) if (p.get("chainId") or "") == CHAIN]
            for row in chunk:
                checked += 1
                own = {((p.get("info") or {}).get("imageUrl") or "").split("?")[0] for p in pairs
                       if (p.get("baseToken") or {}).get("address", "").lower() == row["token"]}
                if (row["logo"] or "").split("?")[0] not in own:
                    await db.execute(text("""UPDATE social_tokens SET logo = NULL, logo_src = NULL, logo_checked = 0,
                        x_handle = CASE WHEN ds_enhanced = 1 THEN NULL ELSE x_handle END, tg_handle = CASE WHEN ds_enhanced = 1 THEN NULL ELSE tg_handle END,
                        domain = CASE WHEN ds_enhanced = 1 THEN NULL ELSE domain END, ds_enhanced = 0 WHERE token = :t""").bindparams(t=row["token"]))
                    fixed += 1
            await asyncio.sleep(1.2)
    return {"checked": checked, "cleared": fixed}
