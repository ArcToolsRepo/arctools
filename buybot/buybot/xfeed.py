"""The Arc feed: what Arc people are posting on X, and what crypto media is publishing — one merged stream.

Two collectors, one endpoint:

  * feed_loop   — walks the accounts we already track in `kols` (highest followers first, rotating so every
                  account comes round) and reads their timeline. Replies are dropped: a reply is half a
                  conversation and reads like noise out of context. Originals, quotes and threads stay.
  * news_loop   — plain RSS from four crypto outlets. No key, no quota, and the same ticker matcher runs over
                  each headline, so a news item about an Arc token also gets a buy button.

Ticker matching reuses kols._match_tokens, which is deliberately strict: a bare cashtag only counts when the
post also carries Arc context, because $CAT exists on every chain and a wrong buy button is worse than none.

Budget: twitterapi.io allows roughly one request per five seconds on our plan, so the timeline sweep takes a
handful of accounts per pass and comes back every few minutes rather than hammering the quota.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import aiohttp
from sqlalchemy import text

from . import db

log = logging.getLogger("xfeed")
CORS = {"Access-Control-Allow-Origin": "*"}

NEWS_SOURCES = [
    ("CoinDesk", "https://feeds.feedburner.com/CoinDesk"),
    ("Cointelegraph", "https://cointelegraph.com/rss"),
    ("Decrypt", "https://decrypt.co/feed"),
    ("The Block", "https://www.theblock.co/rss.xml"),
]
# a headline only enters the feed when it is about this market, not about a football club's token deal
NEWS_KEEP = re.compile(
    r"\b(bitcoin|btc|ethereum|eth|solana|sol|usdc|usdt|stablecoin|circle|arc\b|defi|dex|token|memecoin|"
    r"altcoin|crypto|blockchain|onchain|on-chain|etf|sec|airdrop|liquidity|exchange|binance|coinbase)\b", re.I)
TAGS = re.compile(r"<[^>]+>")

_rot = {"i": 0}
_last = {"news": {}, "x": 0}

# these are outlets, not Arc voices — their RSS already feeds the News tab
MEDIA = {"cointelegraph", "coindesk", "coinmarketcap", "theblock__", "decryptmedia", "binance", "binancewallet",
         "bitcoinmagazine", "watcherguru", "wublockchain", "cryptonews", "beincrypto", "forbescrypto", "bloomberg",
         "reuters", "cnbc", "blockworks_", "dlnews", "defiantnews", "theblockpro", "okx", "bybit_official",
         "bitgetwallet", "bitget_global", "kucoincom", "gate_io", "mexc_official", "htx_global"}
# the accounts that ARE the ecosystem, kept regardless of what our discovery thinks
CORE = ["arc", "circle", "jerallaire", "arcalphaa", "arcarmy_", "radardex"]


async def init():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS x_feed (
        tweet_id VARCHAR(32) PRIMARY KEY, handle VARCHAR(64), name TEXT, avatar TEXT, followers BIGINT DEFAULT 0,
        body TEXT, url TEXT, ts BIGINT, token VARCHAR(64), match_kind VARCHAR(12), likes INT DEFAULT 0, reposts INT DEFAULT 0)"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS news_feed (
        id VARCHAR(64) PRIMARY KEY, source VARCHAR(32), title TEXT, url TEXT, ts BIGINT, body TEXT,
        token VARCHAR(64), match_kind VARCHAR(12))"""))
    for stmt in ("CREATE INDEX IF NOT EXISTS x_feed_ts ON x_feed (ts DESC)",
                 "CREATE INDEX IF NOT EXISTS news_feed_ts ON news_feed (ts DESC)"):
        try:
            await db.execute(text(stmt))
        except Exception:  # noqa
            pass


def _ts(created: str | None) -> int:
    if not created:
        return int(time.time())
    try:
        return int(parsedate_to_datetime(created).timestamp())
    except Exception:  # noqa
        return int(time.time())


async def sync_account(handle: str, maps: dict) -> int:
    """One account's recent timeline into x_feed. Returns how many rows were new to us."""
    from . import kols
    j = await kols._get("/twitter/user/last_tweets", userName=handle)
    data = (j or {}).get("data") or {}
    tweets = (data.get("tweets") if isinstance(data, dict) else None) or (j or {}).get("tweets") or []
    kept = 0
    for t in tweets[:20]:
        if not isinstance(t, dict) or not t.get("id") or t.get("isReply"):
            continue
        body = (t.get("text") or "").strip()
        if len(body) < 8:
            continue
        a = t.get("author") or {}
        if (a.get("userName") or handle).lower() in MEDIA:
            continue
        hits = kols._match_tokens(body, maps)
        ca, kind = (hits[0] if hits else (None, None))
        await db.execute(text("""
            INSERT INTO x_feed (tweet_id, handle, name, avatar, followers, body, url, ts, token, match_kind, likes, reposts)
            VALUES (:i, :h, :n, :a, :f, :b, :u, :ts, :ca, :k, :l, :r)
            ON CONFLICT (tweet_id) DO UPDATE SET likes = EXCLUDED.likes, reposts = EXCLUDED.reposts,
                                                 token = COALESCE(EXCLUDED.token, x_feed.token)
        """).bindparams(i=str(t["id"]), h=(a.get("userName") or handle).lower(), n=a.get("name") or handle,
                        a=a.get("profilePicture") or "", f=int(a.get("followers") or 0), b=body[:600],
                        u=t.get("url") or f"https://x.com/{handle}/status/{t['id']}", ts=_ts(t.get("createdAt")),
                        ca=ca, k=kind, l=int(t.get("likeCount") or 0), r=int(t.get("retweetCount") or 0)))
        kept += 1
    return kept


async def purge_media():
    if MEDIA:
        await db.execute(text("DELETE FROM x_feed WHERE handle = ANY(:h)").bindparams(h=list(MEDIA)))


async def feed_loop():
    """Timelines of the accounts we track, a few per pass so the quota lasts all day."""
    await init()
    await asyncio.sleep(60)
    from . import kols
    while True:
        try:
            if not kols.enabled():
                await asyncio.sleep(600); continue
            # an Arc voice is someone who actually posts about Arc tokens, or whose profile says Arc/Circle —
            # ranked by how much they talk about this chain, not by global follower count
            await purge_media()
            rows = await db.fetchall(text("""
                WITH m AS (SELECT kol, COUNT(*) n FROM kol_mentions GROUP BY kol)
                SELECT k.handle, COALESCE(m.n, 0) mentions, COALESCE(k.followers, 0) followers
                FROM kols k
                LEFT JOIN m ON m.kol = k.handle
                LEFT JOIN x_accounts a ON a.handle = k.handle
                WHERE COALESCE(k.followers, 0) > 3000
                  AND (m.n IS NOT NULL
                       OR COALESCE(a.description, '') ~* '(\marc\M|arc chain|arc network|circle)'
                       OR COALESCE(k.name, '') ~* '(\marc\M)')
                ORDER BY COALESCE(m.n, 0) DESC, k.followers DESC LIMIT 150"""))
            handles = [r["handle"] for r in rows if r["handle"] not in MEDIA]
            for h in CORE:                     # ecosystem anchors always in the rotation
                if h not in handles:
                    handles.append(h)
            if handles:
                maps = await kols._token_maps()
                i = _rot["i"] % max(1, len(handles))
                batch = handles[i:i + 6] or handles[:6]
                _rot["i"] = (i + 6) % max(1, len(handles))
                got = 0
                for h in batch:
                    try:
                        got += await sync_account(h, maps)
                    except Exception as e:  # noqa
                        log.debug("xfeed %s: %s", h, e)
                if got:
                    log.info("xfeed: %s posts from %s accounts", got, len(batch))
            await db.execute(text("DELETE FROM x_feed WHERE ts < :cut").bindparams(cut=int(time.time()) - 7 * 86400))
        except Exception as e:  # noqa
            log.warning("xfeed: %s", e)
        await asyncio.sleep(120)


async def news_once() -> int:
    from . import kols
    maps = await kols._token_maps()
    new = 0
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25),
                                     headers={"User-Agent": "Mozilla/5.0 (compatible; ArcTools/1.0)"}) as s:
        for src, url in NEWS_SOURCES:
            try:
                async with s.get(url) as r:
                    if r.status != 200:
                        continue
                    xml = await r.text()
                root = ET.fromstring(xml.encode("utf-8", "ignore"))
                items = root.iter("item")
                for it in list(items)[:25]:
                    title = (it.findtext("title") or "").strip()
                    link = (it.findtext("link") or "").strip()
                    if not title or not link:
                        continue
                    desc = TAGS.sub("", it.findtext("description") or "").strip()
                    if not NEWS_KEEP.search(f"{title} {desc[:200]}"):
                        continue
                    hits = kols._match_tokens(f"{title} {desc}", maps)
                    ca, kind = (hits[0] if hits else (None, None))
                    ts = _ts(it.findtext("pubDate"))
                    res = await db.execute(text("""
                        INSERT INTO news_feed (id, source, title, url, ts, body, token, match_kind)
                        VALUES (:i, :s, :t, :u, :ts, :b, :ca, :k) ON CONFLICT (id) DO NOTHING
                    """).bindparams(i=link[:64] if len(link) <= 64 else str(abs(hash(link))), s=src, t=title[:300],
                                    u=link, ts=ts, b=desc[:400], ca=ca, k=kind))
                    new += getattr(res, "rowcount", 0) or 0
                _last["news"][src] = len(list(root.iter("item")))
            except Exception as e:  # noqa
                _last["news"][src] = f"error: {type(e).__name__}"
                log.warning("news %s: %s", src, str(e)[:120])
    await db.execute(text("DELETE FROM news_feed WHERE ts < :cut").bindparams(cut=int(time.time()) - 5 * 86400))
    return new


async def news_loop():
    await init()
    await asyncio.sleep(30)
    while True:
        try:
            n = await news_once()
            log.info("news: %s new headlines | sources %s", n, _last["news"])
        except Exception as e:  # noqa
            log.warning("news: %s", e)
        await asyncio.sleep(420)


async def api_feed(req):
    from aiohttp import web
    kind = (req.query.get("kind") or "all").lower()
    limit = max(5, min(60, int(req.query.get("limit") or 30)))
    out: list[dict] = []
    if kind in ("all", "x"):
        rows = await db.fetchall(text("""
            SELECT f.tweet_id id, f.handle, f.name, f.avatar, f.followers, f.body, f.url, f.ts, f.token, f.match_kind,
                   f.likes, f.reposts, st.symbol, st.logo
            FROM x_feed f LEFT JOIN social_tokens st ON st.token = f.token
            ORDER BY f.ts DESC LIMIT :l""").bindparams(l=limit))
        out += [{"kind": "x", **dict(r)} for r in rows]
        # mentions the alert scanner already proved: same shape, token guaranteed
        men = await db.fetchall(text("""
            SELECT m.tweet_id id, m.kol handle, COALESCE(a.name, m.kol) name, COALESCE(a.avatar, '') avatar,
                   COALESCE(a.followers, 0) followers, m.text body, m.url, m.ts, m.token, 'mention' match_kind,
                   0 likes, 0 reposts, st.symbol, st.logo
            FROM kol_mentions m
            LEFT JOIN x_accounts a ON a.handle = m.kol
            LEFT JOIN social_tokens st ON st.token = m.token
            WHERE m.token IS NOT NULL
            ORDER BY m.ts DESC LIMIT :l""").bindparams(l=limit))
        seen = {r.get("id") for r in out}
        out += [{"kind": "x", **dict(r)} for r in men if r["id"] not in seen]
    if kind in ("all", "news"):
        rows = await db.fetchall(text("""
            SELECT n.id, n.source, n.title, n.url, n.ts, n.body, n.token, n.match_kind, st.symbol, st.logo
            FROM news_feed n LEFT JOIN social_tokens st ON st.token = n.token
            ORDER BY n.ts DESC LIMIT :l""").bindparams(l=limit))
        out += [{"kind": "news", **dict(r)} for r in rows]
    out.sort(key=lambda r: r.get("ts") or 0, reverse=True)
    seen_txt: set[str] = set()
    dedup: list[dict] = []
    for r in out:
        sig = ((r.get("title") or r.get("body") or "")[:80]).strip().lower()
        if sig and sig in seen_txt:
            continue
        seen_txt.add(sig)
        dedup.append(r)
    out = dedup
    return web.json_response({"rows": out[:limit], "count": len(out[:limit])},
                             headers={**CORS, "Cache-Control": "public, max-age=30"})


async def api_feed_stats(_req):
    from aiohttp import web
    x = await db.fetchone(text("SELECT COUNT(*) n, COUNT(token) with_token, MAX(ts) newest FROM x_feed"))
    nw = await db.fetchone(text("SELECT COUNT(*) n, COUNT(token) with_token, MAX(ts) newest FROM news_feed"))
    top = await db.fetchall(text("SELECT handle, COUNT(*) n FROM x_feed GROUP BY handle ORDER BY n DESC LIMIT 10"))
    return web.json_response({"x": dict(x or {}), "news": dict(nw or {}), "sources": _last["news"],
                              "accounts": [dict(r) for r in top]}, headers=CORS)


def register(app):
    app.router.add_get("/api/feed", api_feed)
    app.router.add_get("/api/feed-stats", api_feed_stats)
