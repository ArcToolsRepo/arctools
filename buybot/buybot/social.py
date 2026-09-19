"""Social check — kto stoi za tokenem.

Rejestr obserwacji (X user id, Telegram chat, domena, deployer) budowany z list
wszystkich launchpadow na Arcu. Po czasie daje: historie zmian handli, ponowne
uzycie tych samych kont/grup pod roznymi tokenami, wiek kont i domen, dorobek
deployera. Zadne API X/Telegram nie udostepnia historii nazw — musimy ja zbierac sami.
"""
import asyncio
import html as _html
import json
import logging
import re
import time
from urllib.parse import urlparse

import aiohttp
from aiohttp import web
from sqlalchemy import text

from . import db

log = logging.getLogger("social")

UA = {"User-Agent": "Mozilla/5.0 (compatible; ArcToolsSocialCheck/1.0)", "Accept": "application/json"}
API_CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type"}
bot = None  # ustawiane z main.py (aiogram Bot) — do getChat


async def init_tables():
    try:
        await db.execute(text("ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS logo VARCHAR(300)"))
    except Exception:  # noqa
        pass
    for s in [
        # kto (kind/key) byl podpiety pod jaki token i kiedy
        """CREATE TABLE IF NOT EXISTS social_registry (
            kind VARCHAR(10) NOT NULL, key VARCHAR(80) NOT NULL, token VARCHAR(64) NOT NULL,
            handle VARCHAR(120), symbol VARCHAR(32), first_seen BIGINT, last_seen BIGINT,
            PRIMARY KEY (kind, key, token))""",
        # historia handli per stale id (X user id / TG chat id)
        """CREATE TABLE IF NOT EXISTS social_handles (
            kind VARCHAR(10) NOT NULL, key VARCHAR(80) NOT NULL, handle VARCHAR(120) NOT NULL,
            first_seen BIGINT, last_seen BIGINT, PRIMARY KEY (kind, key, handle))""",
        """CREATE TABLE IF NOT EXISTS social_x (
            handle VARCHAR(64) PRIMARY KEY, uid VARCHAR(40), followers INTEGER, tweets INTEGER,
            joined_ts BIGINT, name VARCHAR(120), checked BIGINT, ok INTEGER DEFAULT 1)""",
        """CREATE TABLE IF NOT EXISTS social_tg (
            handle VARCHAR(64) PRIMARY KEY, chat_id VARCHAR(40), kind VARCHAR(12), members INTEGER,
            title VARCHAR(160), checked BIGINT, ok INTEGER DEFAULT 1)""",
        """CREATE TABLE IF NOT EXISTS social_domain (
            domain VARCHAR(160) PRIMARY KEY, registered_ts BIGINT, registrar VARCHAR(80), checked BIGINT, ok INTEGER DEFAULT 1)""",
        """CREATE TABLE IF NOT EXISTS social_tokens (
            token VARCHAR(64) PRIMARY KEY, symbol VARCHAR(32), name VARCHAR(80), launchpad VARCHAR(32),
            deployer VARCHAR(64), x_handle VARCHAR(64), tg_handle VARCHAR(64), domain VARCHAR(160),
            mcap DOUBLE PRECISION, deploy_ts BIGINT, updated BIGINT)""",
        "CREATE INDEX IF NOT EXISTS social_tokens_deployer ON social_tokens (deployer)",
    ]:
        await db.execute(text(s))


# ---------------- normalizacja ----------------

def x_handle(u: str | None) -> str | None:
    if not u:
        return None
    m = re.search(r"(?:x\.com|twitter\.com)/(?:#!/)?@?([A-Za-z0-9_]{1,15})", u)
    if m:
        h = m.group(1)
    elif re.fullmatch(r"@?[A-Za-z0-9_]{1,15}", u.strip()):
        h = u.strip().lstrip("@")
    else:
        return None
    return None if h.lower() in ("home", "i", "intent", "share", "search", "hashtag") else h.lower()


def tg_handle(u: str | None) -> str | None:
    if not u:
        return None
    m = re.search(r"t\.me/(?:s/)?(?!\+|joinchat)([A-Za-z0-9_]{4,64})", u)
    return m.group(1).lower() if m else None


def domain_of(u: str | None) -> str | None:
    if not u:
        return None
    try:
        host = urlparse(u if "://" in u else "https://" + u).hostname or ""
    except Exception:  # noqa
        return None
    host = host.lower().removeprefix("www.")
    if not host or "." not in host or host.endswith((".t.me", "t.me", "x.com", "twitter.com")):
        return None
    return host


# ---------------- zewnetrzne zrodla ----------------

async def _get_json(s: aiohttp.ClientSession, url: str, headers=None):
    async with s.get(url, headers=headers or UA, timeout=aiohttp.ClientTimeout(total=15)) as r:
        if r.status != 200:
            return None
        return await r.json(content_type=None)


async def fetch_x(s: aiohttp.ClientSession, handle: str) -> dict | None:
    d = await _get_json(s, f"https://api.fxtwitter.com/{handle}")
    u = (d or {}).get("user") or (d if d and "screen_name" in d else None)
    if not u:
        return None
    joined = None
    if u.get("joined"):
        try:
            joined = int(time.mktime(time.strptime(u["joined"], "%a %b %d %H:%M:%S %z %Y")))
        except Exception:  # noqa
            try:
                from email.utils import parsedate_to_datetime
                joined = int(parsedate_to_datetime(u["joined"]).timestamp())
            except Exception:  # noqa
                joined = None
    return {"followers": int(u.get("followers") or 0), "joined": joined, "name": (u.get("name") or "")[:120],
            "tweets": int(u.get("tweets") or 0), "uid": str(u.get("id") or "")}


async def fetch_x_history(s: aiohttp.ClientSession, handle: str) -> list[str]:
    d = await _get_json(s, f"https://api.memory.lol/v1/tw/{handle}")
    out: list[str] = []
    for a in (d or {}).get("accounts") or []:
        for h in (a.get("screen_names") or {}).keys():
            if h.lower() != handle.lower():
                out.append(h)
    return out[:10]


async def fetch_tg(s: aiohttp.ClientSession, handle: str) -> dict | None:
    async with s.get(f"https://t.me/{handle}", headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0)"},
                     timeout=aiohttp.ClientTimeout(total=15)) as r:
        if r.status != 200:
            return None
        h = await r.text()
    extra = re.search(r'tgme_page_extra">([^<]*)<', h)
    title = re.search(r'og:title" content="([^"]*)"', h)
    txt = (extra.group(1) if extra else "").strip()
    m = re.search(r"([\d\s\u00a0]+)\s(members|subscribers)", txt)
    members = int(re.sub(r"\D", "", m.group(1))) if m else 0
    kind = "group" if "members" in txt else "channel" if "subscribers" in txt else ("user" if "@" in txt else "unknown")
    chat_id = None
    if bot and kind in ("group", "channel"):
        try:
            c = await bot.get_chat("@" + handle)
            chat_id = str(c.id)
        except Exception:  # noqa
            chat_id = None
    return {"chat_id": chat_id, "kind": kind, "members": members, "title": _html.unescape(title.group(1) if title else "")[:160]}


async def fetch_domain(s: aiohttp.ClientSession, domain: str) -> dict | None:
    d = await _get_json(s, f"https://rdap.org/domain/{domain}")
    if not d:
        return None
    reg = None
    for e in d.get("events") or []:
        if e.get("eventAction") == "registration" and e.get("eventDate"):
            try:
                from datetime import datetime, timezone
                ds = e["eventDate"].replace("Z", "+00:00")
                if "." in ds:  # ucinamy mikrosekundy o nietypowej dlugosci
                    head, tail = ds.split(".", 1)
                    tz = tail[tail.find("+"):] if "+" in tail else ""
                    ds = head + tz
                dt = datetime.fromisoformat(ds)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                reg = int(dt.timestamp())
            except Exception:  # noqa
                reg = None
    registrar = ""
    try:
        for ent in d.get("entities") or []:
            if "registrar" in (ent.get("roles") or []):
                arr = ent.get("vcardArray") or []
                for v in (arr[1] if len(arr) > 1 and isinstance(arr[1], list) else []):
                    if isinstance(v, list) and len(v) >= 4 and v[0] == "fn":
                        registrar = str(v[3])[:80]
    except Exception:  # noqa - vCard bywa dziwny, rejestrator to tylko ozdoba
        registrar = ""
    return {"registered": reg, "registrar": registrar}


# ---------------- rejestr: zbieranie z list launchpadow ----------------

async def _token_lists(s: aiohttp.ClientSession) -> list[dict]:
    out = []
    radar = await _get_json(s, "https://api.radardex.pro/tokens")
    for t in (radar or {}).get("tokens") or []:
        if t.get("address"):
            out.append({"address": t["address"].lower(), "deployer": (t.get("deployer") or "").lower() or None,
                        "deploy_ts": t.get("deployTs"), "launchpad": t.get("launchpad"), "mcap": t.get("mcap"),
                        "name": t.get("name"), "symbol": t.get("symbol"), "telegram": t.get("telegram"),
                        "twitter": t.get("twitter"), "website": t.get("website"), "logo": t.get("logo") or t.get("image") or t.get("imageUrl")})
    tolly = await _get_json(s, "https://api.tollylabs.com/tokens", {"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    seen = {o["address"] for o in out}
    for t in (tolly or {}).get("tokens") or []:
        a = (t.get("address") or "").lower()
        if a and a not in seen:
            out.append({"address": a, "deployer": (t.get("creator") or "").lower() or None, "deploy_ts": t.get("created_ts"),
                        "launchpad": "tolly", "mcap": t.get("marketCap"), "name": t.get("name"), "symbol": t.get("symbol"),
                        "telegram": t.get("telegram"), "twitter": t.get("twitter"), "website": t.get("website"), "logo": t.get("logo") or t.get("image") or t.get("imageUrl")})
    # minara.fun (mainnet since 16.09): list API has logo + description + creator; socials live inside the description
    seen = {o["address"] for o in out}
    for offset in range(0, 600, 100):
        page = await _get_json(s, f"https://api.minara.fun/minara-fun/launches?chainId=5042&limit=100&offset={offset}",
                               {"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        items = (page or {}).get("items") or []
        for t in items:
            a = (t.get("address") or "").lower()
            if not a:
                continue
            soc = socials_from_text(t.get("description") or "")
            if a in seen:
                # already listed by RadarDex/Tolly without pad/logo → fill the gaps from Minara
                for o in out:
                    if o["address"] == a:
                        o["launchpad"] = o.get("launchpad") or "minara"; o["logo"] = o.get("logo") or t.get("imageUrl")
                        for k in ("twitter", "telegram", "website"):
                            o[k] = o.get(k) or soc.get(k)
                        break
                continue
            seen.add(a)
            out.append({"address": a, "deployer": (t.get("creator") or "").lower() or None, "deploy_ts": t.get("createdAtTimestamp"),
                        "launchpad": "minara", "mcap": t.get("marketCapUsd"), "name": t.get("name"), "symbol": t.get("symbol"),
                        "telegram": soc.get("telegram"), "twitter": soc.get("twitter"), "website": soc.get("website"), "logo": t.get("imageUrl")})
        if len(items) < 100:
            break
    # any source: a description / name that carries an @handle, x.com, t.me or a bare domain fills the gaps
    for o in out:
        if not (o.get("twitter") and o.get("telegram") and o.get("website")):
            soc = socials_from_text(" ".join(str(o.get(k) or "") for k in ("description", "name")))
            for k in ("twitter", "telegram", "website"):
                o[k] = o.get(k) or soc.get(k)
    return out


_X_RE = re.compile(r"(?:https?://)?(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{2,15})", re.I)
_TG_RE = re.compile(r"(?:https?://)?t\.me/([A-Za-z0-9_]{4,32})", re.I)
_URL_RE = re.compile(r"https?://([a-z0-9.-]+\.[a-z]{2,})", re.I)
_AT_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_]{3,15})\b")


def socials_from_text(txt: str) -> dict:
    """Pull X / Telegram / website out of free text (token descriptions, names)."""
    out: dict = {}
    if not txt:
        return out
    m = _X_RE.search(txt)
    if m and m.group(1).lower() not in ("home", "search", "i", "intent", "share", "hashtag"):
        out["twitter"] = m.group(1)
    m = _TG_RE.search(txt)
    if m:
        out["telegram"] = m.group(1)
    for m in _URL_RE.finditer(txt):
        host = m.group(1).lower()
        if not any(b in host for b in ("x.com", "twitter.com", "t.me", "minara", "static.", "ipfs", "arc-scan", "arcscan", "dexscreener", "radardex")):
            out["website"] = host
            break
    if "twitter" not in out:
        m = _AT_RE.search(txt)
        if m and m.group(1).lower() not in ("arc", "everyone", "here", "channel"):
            out["twitter"] = m.group(1)
    return out


async def _upsert_registry(kind: str, key: str, token: str, handle: str | None, symbol: str | None, now: int):
    await db.execute(text("""
        INSERT INTO social_registry (kind, key, token, handle, symbol, first_seen, last_seen)
        VALUES (:k, :key, :t, :h, :s, :n, :n)
        ON CONFLICT (kind, key, token) DO UPDATE SET last_seen = :n, handle = COALESCE(:h, social_registry.handle)
    """).bindparams(k=kind, key=key, t=token, h=handle, s=symbol, n=now))
    if handle:
        await db.execute(text("""
            INSERT INTO social_handles (kind, key, handle, first_seen, last_seen) VALUES (:k, :key, :h, :n, :n)
            ON CONFLICT (kind, key, handle) DO UPDATE SET last_seen = :n
        """).bindparams(k=kind, key=key, h=handle, n=now))


async def registry_loop():
    """Co 10 min: listy padow -> social_tokens + rejestr; rozwiazywanie X/TG/domen z cache."""
    await init_tables()
    await asyncio.sleep(30)
    while True:
        try:
            now = int(time.time())
            async with aiohttp.ClientSession() as s:
                toks = await _token_lists(s)
                for t in toks:
                    xh, th, dom = x_handle(t["twitter"]), tg_handle(t["telegram"]), domain_of(t["website"])
                    await db.execute(text("""
                        INSERT INTO social_tokens (token, symbol, name, launchpad, deployer, x_handle, tg_handle, domain, mcap, deploy_ts, updated, logo)
                        VALUES (:t, :s, :n, :l, :d, :x, :g, :w, :m, :ts, :u, :logo)
                        ON CONFLICT (token) DO UPDATE SET symbol=:s, name=:n, launchpad=COALESCE(:l, social_tokens.launchpad), logo=COALESCE(:logo, social_tokens.logo),
                          deployer=COALESCE(:d, social_tokens.deployer), x_handle=COALESCE(:x, social_tokens.x_handle),
                          tg_handle=COALESCE(:g, social_tokens.tg_handle), domain=COALESCE(:w, social_tokens.domain),
                          mcap=:m, deploy_ts=COALESCE(:ts, social_tokens.deploy_ts), updated=:u
                    """).bindparams(t=t["address"], s=(t["symbol"] or "")[:32], n=(t["name"] or "")[:80], l=t["launchpad"],
                                    d=t["deployer"], x=xh, g=th, w=dom, m=float(t["mcap"] or 0),
                                    ts=int(t["deploy_ts"]) if t.get("deploy_ts") else None, u=now, logo=(t.get("logo") or None)))
                    if t["deployer"]:
                        await _upsert_registry("deployer", t["deployer"], t["address"], None, t["symbol"], now)
                    if dom:
                        await _upsert_registry("web", dom, t["address"], dom, t["symbol"], now)
                    # X / TG: klucz = handle do czasu rozwiazania id (ponizej podmieniamy na stale id)
                    if xh:
                        await _upsert_registry("x", "h:" + xh, t["address"], xh, t["symbol"], now)
                    if th:
                        await _upsert_registry("tg", "h:" + th, t["address"], th, t["symbol"], now)

                # rozwiazywanie z cache (6h X/TG, 7d domeny), max N na przebieg — bez zalewania zrodel
                budget = 60
                for row in await db.fetchall(text(
                        "SELECT DISTINCT x_handle AS h FROM social_tokens WHERE x_handle IS NOT NULL "
                        "AND x_handle NOT IN (SELECT handle FROM social_x WHERE checked > :c) LIMIT :n"
                ).bindparams(c=now - 6 * 3600, n=budget)):
                    h = row["h"]
                    try:
                        info = await fetch_x(s, h)
                    except Exception:  # noqa
                        info = None
                    await db.execute(text("""
                        INSERT INTO social_x (handle, uid, followers, tweets, joined_ts, name, checked, ok)
                        VALUES (:h, :u, :f, :t, :j, :n, :c, :ok)
                        ON CONFLICT (handle) DO UPDATE SET uid=COALESCE(:u, social_x.uid), followers=COALESCE(:f, social_x.followers),
                          tweets=COALESCE(:t, social_x.tweets), joined_ts=COALESCE(:j, social_x.joined_ts),
                          name=COALESCE(:n, social_x.name), checked=:c, ok=:ok
                    """).bindparams(h=h, u=info["uid"] if info else None, f=info["followers"] if info else None,
                                    t=info["tweets"] if info else None, j=info["joined"] if info else None,
                                    n=info["name"] if info else None, c=now, ok=1 if info else 0))
                    if info and info["uid"]:
                        # stale id: przepinamy rejestr z klucza handle na klucz id -> wykrywamy rename
                        for r in await db.fetchall(text("SELECT token, symbol FROM social_registry WHERE kind='x' AND key=:k").bindparams(k="h:" + h)):
                            await _upsert_registry("x", "id:" + info["uid"], r["token"], h, r["symbol"], now)
                    await asyncio.sleep(0.4)
                for row in await db.fetchall(text(
                        "SELECT DISTINCT tg_handle AS h FROM social_tokens WHERE tg_handle IS NOT NULL "
                        "AND tg_handle NOT IN (SELECT handle FROM social_tg WHERE checked > :c) LIMIT :n"
                ).bindparams(c=now - 6 * 3600, n=budget)):
                    h = row["h"]
                    try:
                        info = await fetch_tg(s, h)
                    except Exception:  # noqa
                        info = None
                    await db.execute(text("""
                        INSERT INTO social_tg (handle, chat_id, kind, members, title, checked, ok) VALUES (:h, :i, :k, :m, :t, :c, :ok)
                        ON CONFLICT (handle) DO UPDATE SET chat_id=COALESCE(:i, social_tg.chat_id), kind=COALESCE(:k, social_tg.kind),
                          members=COALESCE(:m, social_tg.members), title=COALESCE(:t, social_tg.title), checked=:c, ok=:ok
                    """).bindparams(h=h, i=info["chat_id"] if info else None, k=info["kind"] if info else None,
                                    m=info["members"] if info else None, t=info["title"] if info else None, c=now, ok=1 if info else 0))
                    if info and info["chat_id"]:
                        for r in await db.fetchall(text("SELECT token, symbol FROM social_registry WHERE kind='tg' AND key=:k").bindparams(k="h:" + h)):
                            await _upsert_registry("tg", "id:" + info["chat_id"], r["token"], h, r["symbol"], now)
                    await asyncio.sleep(0.4)
                for row in await db.fetchall(text(
                        "SELECT DISTINCT domain AS d FROM social_tokens WHERE domain IS NOT NULL "
                        "AND domain NOT IN (SELECT domain FROM social_domain WHERE checked > :c) LIMIT :n"
                ).bindparams(c=now - 7 * 86400, n=budget)):
                    d = row["d"]
                    try:
                        info = await fetch_domain(s, d)
                    except Exception:  # noqa
                        info = None
                    await db.execute(text("""
                        INSERT INTO social_domain (domain, registered_ts, registrar, checked, ok) VALUES (:d, :r, :g, :c, :ok)
                        ON CONFLICT (domain) DO UPDATE SET registered_ts=COALESCE(:r, social_domain.registered_ts),
                          registrar=COALESCE(:g, social_domain.registrar), checked=:c, ok=:ok
                    """).bindparams(d=d, r=info["registered"] if info else None, g=info["registrar"] if info else None, c=now, ok=1 if info else 0))
                    await asyncio.sleep(0.3)
            n = await db.fetchone(text("SELECT COUNT(*) AS n FROM social_tokens"))
            log.info("social registry: %s tokens tracked", n["n"])
        except Exception as e:  # noqa
            log.warning("social registry: %s", e)
        await asyncio.sleep(600)


# ---------------- API ----------------

async def api_social_check(request: web.Request) -> web.Response:
    token = (request.query.get("token") or "").lower()
    if not (token.startswith("0x") and len(token) == 42):
        return web.json_response({"error": "bad token"}, status=400, headers=API_CORS)
    now = int(time.time())
    row = await db.fetchone(text("SELECT * FROM social_tokens WHERE token = :t").bindparams(t=token)) or {}
    # strona moze podac sociale wprost (tokeny z naszego pada, nieznane screenerom)
    xh = x_handle(request.query.get("x")) or row.get("x_handle")
    th = tg_handle(request.query.get("tg")) or row.get("tg_handle")
    dom = domain_of(request.query.get("web")) or row.get("domain")
    deployer = (request.query.get("deployer") or row.get("deployer") or "").lower() or None

    async with aiohttp.ClientSession() as s:
        # --- X
        x = None
        if xh:
            cx = await db.fetchone(text("SELECT * FROM social_x WHERE handle = :h").bindparams(h=xh))
            if not cx or (cx["checked"] or 0) < now - 6 * 3600:
                try:
                    info = await fetch_x(s, xh)
                except Exception:  # noqa
                    info = None
                if info:
                    await db.execute(text("""
                        INSERT INTO social_x (handle, uid, followers, tweets, joined_ts, name, checked, ok) VALUES (:h, :u, :f, :t, :j, :n, :c, 1)
                        ON CONFLICT (handle) DO UPDATE SET uid=:u, followers=:f, tweets=:t, joined_ts=:j, name=:n, checked=:c, ok=1
                    """).bindparams(h=xh, u=info["uid"], f=info["followers"], t=info["tweets"], j=info["joined"], n=info["name"], c=now))
                    cx = await db.fetchone(text("SELECT * FROM social_x WHERE handle = :h").bindparams(h=xh))
            prev: list[str] = []
            reused: list[dict] = []
            if cx and cx.get("uid"):
                hist = await db.fetchall(text("SELECT handle FROM social_handles WHERE kind='x' AND key=:k AND handle != :h ORDER BY last_seen DESC")
                                         .bindparams(k="id:" + cx["uid"], h=xh))
                prev = [r["handle"] for r in hist]
                try:
                    for h in await fetch_x_history(s, xh):
                        if h.lower() not in [p.lower() for p in prev] and h.lower() != xh:
                            prev.append(h)
                except Exception:  # noqa
                    pass
                reused = [dict(r) for r in await db.fetchall(text(
                    "SELECT r.token, r.symbol, t.mcap FROM social_registry r LEFT JOIN social_tokens t ON t.token = r.token "
                    "WHERE r.kind='x' AND r.key IN (:k1, :k2) AND r.token != :t").bindparams(k1="id:" + cx["uid"], k2="h:" + xh, t=token))]
            else:
                reused = [dict(r) for r in await db.fetchall(text(
                    "SELECT r.token, r.symbol, t.mcap FROM social_registry r LEFT JOIN social_tokens t ON t.token = r.token "
                    "WHERE r.kind='x' AND r.key = :k AND r.token != :t").bindparams(k="h:" + xh, t=token))]
            x = {"handle": xh, "ok": bool(cx and cx.get("ok")), "uid": cx.get("uid") if cx else None,
                 "name": cx.get("name") if cx else None, "followers": cx.get("followers") if cx else None,
                 "tweets": cx.get("tweets") if cx else None, "joined": cx.get("joined_ts") if cx else None,
                 "age_days": int((now - cx["joined_ts"]) / 86400) if cx and cx.get("joined_ts") else None,
                 "previous_handles": prev[:10], "reused_by": reused[:10]}

        # --- Telegram
        tg = None
        if th:
            ct = await db.fetchone(text("SELECT * FROM social_tg WHERE handle = :h").bindparams(h=th))
            if not ct or (ct["checked"] or 0) < now - 6 * 3600:
                try:
                    info = await fetch_tg(s, th)
                except Exception:  # noqa
                    info = None
                if info:
                    await db.execute(text("""
                        INSERT INTO social_tg (handle, chat_id, kind, members, title, checked, ok) VALUES (:h, :i, :k, :m, :t, :c, 1)
                        ON CONFLICT (handle) DO UPDATE SET chat_id=COALESCE(:i, social_tg.chat_id), kind=:k, members=:m, title=:t, checked=:c, ok=1
                    """).bindparams(h=th, i=info["chat_id"], k=info["kind"], m=info["members"], t=info["title"], c=now))
                    ct = await db.fetchone(text("SELECT * FROM social_tg WHERE handle = :h").bindparams(h=th))
            keys = ["h:" + th] + (["id:" + ct["chat_id"]] if ct and ct.get("chat_id") else [])
            reused = [dict(r) for r in await db.fetchall(text(
                "SELECT r.token, r.symbol, t.mcap FROM social_registry r LEFT JOIN social_tokens t ON t.token = r.token "
                "WHERE r.kind='tg' AND r.key = ANY(:ks) AND r.token != :t").bindparams(ks=keys, t=token))]
            prev = []
            if ct and ct.get("chat_id"):
                prev = [r["handle"] for r in await db.fetchall(text(
                    "SELECT handle FROM social_handles WHERE kind='tg' AND key=:k AND handle != :h ORDER BY last_seen DESC"
                ).bindparams(k="id:" + ct["chat_id"], h=th))]
            tg = {"handle": th, "ok": bool(ct and ct.get("ok")), "kind": ct.get("kind") if ct else None,
                  "members": ct.get("members") if ct else None, "title": ct.get("title") if ct else None,
                  "previous_handles": prev[:10], "reused_by": reused[:10]}

        # --- domena
        webinfo = None
        if dom:
            cd = await db.fetchone(text("SELECT * FROM social_domain WHERE domain = :d").bindparams(d=dom))
            if not cd or (cd["checked"] or 0) < now - 7 * 86400:
                try:
                    info = await fetch_domain(s, dom)
                except Exception:  # noqa
                    info = None
                if info:
                    await db.execute(text("""
                        INSERT INTO social_domain (domain, registered_ts, registrar, checked, ok) VALUES (:d, :r, :g, :c, 1)
                        ON CONFLICT (domain) DO UPDATE SET registered_ts=:r, registrar=:g, checked=:c, ok=1
                    """).bindparams(d=dom, r=info["registered"], g=info["registrar"], c=now))
                    cd = await db.fetchone(text("SELECT * FROM social_domain WHERE domain = :d").bindparams(d=dom))
            reused = [dict(r) for r in await db.fetchall(text(
                "SELECT r.token, r.symbol, t.mcap FROM social_registry r LEFT JOIN social_tokens t ON t.token = r.token "
                "WHERE r.kind='web' AND r.key=:k AND r.token != :t").bindparams(k=dom, t=token))]
            webinfo = {"domain": dom, "ok": bool(cd and cd.get("ok")), "registered": cd.get("registered_ts") if cd else None,
                       "age_days": int((now - cd["registered_ts"]) / 86400) if cd and cd.get("registered_ts") else None,
                       "registrar": cd.get("registrar") if cd else None, "reused_by": reused[:10]}

    # --- deployer: dorobek z listy tokenow + z naszego indeksu swapow (ostatnia aktywnosc)
    dep = None
    if deployer:
        others = [dict(r) for r in await db.fetchall(text(
            "SELECT token, symbol, mcap, deploy_ts FROM social_tokens WHERE deployer = :d AND token != :t ORDER BY deploy_ts DESC NULLS LAST LIMIT 20"
        ).bindparams(d=deployer, t=token))]
        for o in others:
            last = await db.fetchone(text("SELECT MAX(ts) AS ts FROM swaps WHERE token = :t").bindparams(t=o["token"]))
            o["last_trade"] = int(last["ts"]) if last and last["ts"] else None
            o["dead"] = bool((o.get("mcap") or 0) < 1000 or (o["last_trade"] and o["last_trade"] < now - 3 * 86400))
        dep = {"address": deployer, "tokens": others, "count": len(others) + 1,
               "dead": sum(1 for o in others if o["dead"])}

    for blk in (x, tg, webinfo):
        if blk and blk.get("reused_by"):
            blk["reused_by"] = _dedupe(blk["reused_by"])
    return web.json_response({"deployer": dep, "telegram": tg, "token": token, "web": webinfo, "x": x,
                              "tracked_since": row.get("updated")}, headers=API_CORS)


def _dedupe(rows: list[dict]) -> list[dict]:
    seen, out = set(), []
    for r in rows:
        if r.get("token") in seen:
            continue
        seen.add(r.get("token"))
        out.append(r)
    return out


def register(app: web.Application):
    app.router.add_get("/api/social-check", api_social_check)
    app.router.add_get("/api/token-meta", api_token_meta)



_META_CACHE: dict[str, tuple[float, dict]] = {}    # question -> (asked_at, answer); trimmed when it grows


def _pad_label(key: str | None) -> str | None:
    """Short DB key ("minara") -> the name a human reads ("Minara"). Unknown keys pass through untouched."""
    if not key:
        return None
    try:
        from .pads_registry import FACTORIES
        k = key.strip().lower()
        # the swap index and the registry do not always spell a pad the same way ("argus" vs "arguspad"),
        # so try the obvious variants before giving up and showing a raw key to a human
        for cand in (k, k + "pad", k.removesuffix("pad"), k.removesuffix(".fun"), k.split(".")[0]):
            ent = FACTORIES.get(cand)
            if ent and ent.get("label"):
                return str(ent["label"])
        for rk, ent in FACTORIES.items():
            if (rk.startswith(k) or k.startswith(rk)) and ent.get("label"):
                return str(ent["label"])
    except Exception:  # noqa
        pass
    return key[:1].upper() + key[1:] if key else key



# ---------------- real deploy time ----------------
# The site used to date a token from the first block OUR index saw it in, which makes an old token look new:
# ARCT read "3 days" when it is 10.4. The explorer keeps the full transfer history and hands us a cursor to
# the oldest one — that first transfer is the mint, so its timestamp is the token's real birth. It never
# changes, so once resolved it is stored for good.
_DEPLOY_INFLIGHT: set[str] = set()
_DEPLOY_SEEN: set[str] = set()
_DEPLOY_Q: "asyncio.Queue[str]" = asyncio.Queue()
_DEPLOY_WORKER: "asyncio.Task | None" = None


async def _arcscan(session, url: str):
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
        if r.status != 200:
            return None
        return await r.json()


async def resolve_deploy_ts(token: str) -> int | None:
    """Oldest transfer of the token = its mint. Returns a unix ts, and remembers it."""
    t = token.lower()
    if t in _DEPLOY_INFLIGHT:
        return None
    _DEPLOY_INFLIGHT.add(t)
    try:
        base = f"https://api.arc-scan.org/v1/tokens/{t}/transfers?limit=1"
        async with aiohttp.ClientSession() as sess:
            head = await _arcscan(sess, base)
            cur = (head or {}).get("oldest_cursor")
            if not cur:
                return None
            first = await _arcscan(sess, f"{base}&cursor={cur}")
            items = (first or {}).get("items") or []
            if not items:
                return None
            ts = int(items[0].get("timestamp") or 0)
            if ts <= 0:
                return None
        await db.execute(text("""
            INSERT INTO social_tokens (token, deploy_ts, updated) VALUES (:t, :ts, :u)
            ON CONFLICT (token) DO UPDATE SET deploy_ts = :ts
        """).bindparams(t=t, ts=ts, u=int(time.time())))
        return ts
    except Exception as e:  # noqa - a missing birthday must never break the list
        log.warning("deploy_ts %s failed: %s", t[:10], str(e)[:100])
        return None
    finally:
        _DEPLOY_INFLIGHT.discard(t)


async def fill_deploy_ts(tokens: list[str]) -> None:
    """Queue unknown birthdays. One worker drains the queue slowly.

    The first version spawned a task per token-meta request. The bot serves its HTTP API on the same event
    loop as the swap indexer, so a screenful of unknown tokens turned into dozens of concurrent explorer
    calls and pushed the index 73 s behind the chain. Same lesson as the ticker: never let a nice-to-have
    lookup compete with the indexer.
    """
    for t in tokens[:40]:
        if t not in _DEPLOY_SEEN and _DEPLOY_Q.qsize() < 500:
            _DEPLOY_SEEN.add(t)
            _DEPLOY_Q.put_nowait(t)
    global _DEPLOY_WORKER
    if _DEPLOY_WORKER is None or _DEPLOY_WORKER.done():
        _DEPLOY_WORKER = asyncio.create_task(_deploy_worker())


async def _deploy_worker() -> None:
    """One token at a time, with a breath in between, and never while the index is behind."""
    while True:
        try:
            token = await asyncio.wait_for(_DEPLOY_Q.get(), timeout=60)
        except asyncio.TimeoutError:
            return                                        # nothing left to do: let the task end
        try:
            row = await db.fetchone(text("SELECT deploy_ts FROM social_tokens WHERE token = :t").bindparams(t=token))
            if not (row and row["deploy_ts"]):
                await resolve_deploy_ts(token)
        except Exception:  # noqa - a birthday is never worth an exception in the API loop
            pass
        await asyncio.sleep(1.5)


async def api_token_meta(req: web.Request):
    """GET /api/token-meta?tokens=a,b,… (≤300) → {meta: {token: {symbol, name, logo, twitter, telegram, website, launchpad}}}
    Everything the pad lists / descriptions told us about a token — the site uses it to fill logos + socials on rows that
    came from bare pool discovery (Uniswap V3/V4 tabs)."""
    toks = [t.strip().lower() for t in (req.query.get("tokens") or "").split(",") if t.strip().startswith("0x") and len(t.strip()) == 42][:300]
    if not toks:
        return web.json_response({"meta": {}})
    # This endpoint shares an event loop with the swap indexer. A client-side remount loop once asked for the
    # same ten tokens 826 times in 17 seconds and the indexer fell 1529 blocks behind, freezing every market cap
    # on the site. Identical questions are now answered from memory for a minute, whatever the caller does.
    ck = ",".join(sorted(set(toks)))
    hit = _META_CACHE.get(ck)
    if hit and time.time() - hit[0] < 60:
        return web.json_response({"meta": hit[1]}, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=120"})
    rows = await db.fetchall(text("SELECT token, symbol, name, logo, x_handle, tg_handle, domain, launchpad, ds_enhanced, ds_url, deploy_ts FROM social_tokens WHERE token = ANY(:t)").bindparams(t=toks))
    meta = {r["token"]: {"symbol": r["symbol"], "name": r["name"], "logo": r["logo"], "twitter": r["x_handle"], "telegram": r["tg_handle"],
                                 "ds_enhanced": bool(r["ds_enhanced"]), "ds_url": r["ds_url"], "deploy_ts": r["deploy_ts"],
                         "website": r["domain"], "launchpad": r["launchpad"], "launchpad_label": _pad_label(r["launchpad"])} for r in rows}
    if len(_META_CACHE) > 800:
        _META_CACHE.clear()
    missing_birthdays = [t for t in toks if not (meta.get(t) or {}).get("deploy_ts")]
    if missing_birthdays:
        asyncio.create_task(fill_deploy_ts(missing_birthdays))
    _META_CACHE[ck] = (time.time(), meta)
    return web.json_response({"meta": meta}, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=120"})
