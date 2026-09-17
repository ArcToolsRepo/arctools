"""Finds the logo and socials of tokens nobody registered anywhere — and remembers the answer for good.

Most tokens in the Terminal never touch a launchpad with an API: someone deploys an ERC-20, opens a Uniswap V3 or
V4 pool and posts the contract on X. There is no list to read them from, so their rows used to stay blank while
launchpad tokens looked complete.

Sources, cheapest first, stopping at the first hit:
  1. the token contract itself (getters, metadata document, URL literals in the bytecode) — contract_socials
  2. the explorer's token page (devs upload a logo there when they verify)
  3. X: search for the exact contract address, then for "$SYMBOL" with Arc context; the account that posted it
     gives us the handle, the avatar (logo) and the website from its bio

Persistence matters as much as discovery. Once a logo or handle verifies, the row is LOCKED: the hunter never
re-queries it, so we never pay for the same lookup twice and a working logo can never be overwritten by a later
weaker guess. Tokens we genuinely cannot identify are re-checked on a slow schedule (7 days), not every 6 hours.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

import aiohttp
from sqlalchemy import text

from . import db
from .logos import _ipfs_to_http, _verify, verify_any

log = logging.getLogger("identity")

CA_RE = re.compile(r"0x[a-fA-F0-9]{40}")
TG_RE = re.compile(r"(?:https?://)?t\.me/([A-Za-z0-9_+]{3,40})", re.I)
WEB_RE = re.compile(r"https?://(?!t\.me|twitter\.com|x\.com)([A-Za-z0-9.\-]+\.[A-Za-z]{2,12}(?:/[^\s\"']{0,50})?)", re.I)
ARC_HINT = re.compile(r"\barc\b|arc chain|arctools|usdc", re.I)

stats = {"checked": 0, "found_logo": 0, "found_social": 0, "by": {}}


async def init() -> None:
    for stmt in ("ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS ident_locked SMALLINT DEFAULT 0",
                 "ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS ident_checked BIGINT",
                 "ALTER TABLE social_tokens ADD COLUMN IF NOT EXISTS ident_src VARCHAR(16)",
                 "CREATE INDEX IF NOT EXISTS social_tokens_ident ON social_tokens (ident_locked, ident_checked)"):
        try:
            await db.execute(text(stmt))
        except Exception:  # noqa
            pass


# ---------------------------------------------------------------- explorer page
async def from_explorer(s: aiohttp.ClientSession, token: str) -> dict:
    """arc-scan renders a token's uploaded icon into its page metadata."""
    for url in (f"https://arc-scan.org/token/{token}", f"https://arc-scan.org/address/{token}"):
        try:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=12),
                             headers={"User-Agent": "Mozilla/5.0 (compatible; ArcTools/1.0)"}) as r:
                if r.status != 200:
                    continue
                html = await r.text()
        except Exception:  # noqa
            continue
        m = re.search(r'"(?:image|icon|logo|iconUrl|logoURI)"\s*:\s*"(https?://[^"]+|ipfs://[^"]+)"', html)
        if not m:
            m = re.search(r'<meta[^>]+property="og:image"[^>]+content="(https?://[^"]+)"', html)
        if m:
            u = _ipfs_to_http(m.group(1))
            if "arc-scan" not in u.split("/")[2] and await _verify(s, u):
                return {"logo": u, "src": "explorer"}
    return {}


# ---------------------------------------------------------------- X / twitter
_x_blocked = {"until": 0.0, "reason": ""}


async def _tw(path: str, **params) -> dict | None:
    """X lookups share the twitterapi.io account with the KOL pipeline. When that account runs out of credits the
    API answers 402 for everything, so we note it and skip X for an hour instead of waiting on every token."""
    import time as _t
    if _t.time() < _x_blocked["until"]:
        return None
    from .kols import _get, KEY, API
    if not KEY:
        return None
    j = await _get(path, **params)
    if j is None:                       # could be 402 (no credits) — probe once and back off if so
        try:
            import aiohttp as _ah
            async with _ah.ClientSession(headers={"X-API-Key": KEY}) as s:
                async with s.get(f"{API}/twitter/user/info", params={"userName": "x"},
                                 timeout=_ah.ClientTimeout(total=12)) as r:
                    if r.status in (401, 402, 403):
                        body = (await r.text())[:120]
                        _x_blocked.update(until=_t.time() + 3600, reason=f"{r.status}: {body}")
                        log.warning("X lookups disabled for 1 h — %s", _x_blocked["reason"])
        except Exception:  # noqa
            pass
    return j


def _score_author(author: dict, symbol: str, name: str) -> float:
    """How likely is this account the token's own project account?"""
    h = (author.get("userName") or "").lower()
    n = (author.get("name") or "").lower()
    desc = (author.get("description") or "").lower()
    sym = (symbol or "").lower().lstrip("$")
    nm = (name or "").lower()
    sc = 0.0
    if sym and (sym in h or sym in n):
        sc += 4
    if nm and len(nm) > 3 and (nm in n or nm in desc):
        sc += 2
    if ARC_HINT.search(desc):
        sc += 1.5
    followers = int(author.get("followers") or 0)
    sc += min(2.0, followers / 5000)
    if author.get("isBlueVerified"):
        sc += 0.5
    if int(author.get("statusesCount") or 0) < 3:
        sc -= 1
    return sc



def _norm_user(u: dict) -> dict:
    """twitterapi.io returns two different user shapes: tweet authors use userName/followers/profilePicture,
    while /user/search uses screen_name/followers_count/profile_image_url_https. Normalise to one."""
    return {
        "userName": u.get("userName") or u.get("screen_name") or u.get("username"),
        "name": u.get("name"),
        "description": u.get("description") or "",
        "url": u.get("url") or "",
        "followers": u.get("followers") or u.get("followers_count") or 0,
        "statusesCount": u.get("statusesCount") or u.get("statuses_count") or 0,
        "isBlueVerified": u.get("isBlueVerified") or u.get("verified") or False,
        "profilePicture": u.get("profilePicture") or u.get("profile_image_url_https") or "",
    }


def _owns_name(handle: str, display: str, sym: str) -> bool:
    """Does this account look like it IS the project, rather than someone talking about it?

    Substring matching is not enough — "BoAsoba" contains "boa". The ticker has to start the handle, be the whole
    handle, or stand as its own word in the display name."""
    if not sym or len(sym) < 3:
        return False
    s_ = sym.lower()
    h = (handle or "").lower()
    d = (display or "").lower()
    if h == s_ or h.startswith(s_) or h.startswith(s_ + "_") or h.endswith("_" + s_):
        return True
    return bool(re.search(rf"(^|[^a-z0-9]){re.escape(s_)}([^a-z0-9]|$)", d))


async def _posted_ca(handle: str, token: str) -> bool:
    """Has this specific account ever posted this contract address? That is the proof of ownership we want."""
    j = await _tw("/twitter/tweet/advanced_search", query=f"from:{handle} {token}", queryType="Latest")
    for t in ((j or {}).get("tweets") or []):
        if token.lower() in (t.get("text") or "").lower():
            return True
    return False


async def from_x(token: str, symbol: str | None, name: str | None) -> dict:
    """Search the other way round, then demand proof.

    Searching the contract address finds caller channels, not projects — ARCAT's address is posted by accounts with
    tens of thousands of followers that have nothing to do with it. So we start from accounts that *carry the
    ticker* (user search), and accept one only when that same account has itself posted the contract address, or
    put it in its bio. Ticker in the name plus the contract in their own timeline is the project announcing itself;
    anything less stays blank, because a wrong logo is worse than an empty circle.
    """
    sym = (symbol or "").strip().lstrip("$")
    if len(sym) < 3:
        return {}

    cands: list[dict] = []
    for q in (f"{sym} arc", sym):
        j = await _tw("/twitter/user/search", query=q)
        users = (j or {}).get("users") or (j or {}).get("data") or []
        for raw in users[:12]:
            u = _norm_user(raw)
            if _owns_name(u["userName"] or "", u["name"] or "", sym):
                cands.append(u)
        if cands:
            break
    # the tweet-search path can still contribute a candidate, as long as it is name-matched
    if not cands:
        j = await _tw("/twitter/tweet/advanced_search", query=token, queryType="Latest")
        for t in ((j or {}).get("tweets") or [])[:25]:
            a = _norm_user(t.get("author") or {})
            if token.lower() in (t.get("text") or "").lower() and _owns_name(a["userName"] or "", a["name"] or "", sym):
                cands.append(a)

    seen: set[str] = set()
    ranked = []
    for c in cands:
        h = (c.get("userName") or "").lower()
        if not h or h in seen:
            continue
        seen.add(h)
        ranked.append(c)
    ranked.sort(key=lambda c: -_score_author(c, sym, name or ""))

    for c in ranked[:4]:
        handle = c.get("userName")
        bio = (c.get("description") or "") + " " + (c.get("url") or "")
        proof = token.lower() in bio.lower() or await _posted_ca(handle, token)
        if not proof:
            continue
        out: dict = {"src": "x", "x_handle": handle}
        avatar = (c.get("profilePicture") or "").replace("_normal", "")
        if avatar:
            out["logo"] = avatar
        if m := TG_RE.search(c.get("description") or ""):
            out["tg_handle"] = m.group(1)
        web = c.get("url") or ""
        if not web:
            if m := WEB_RE.search(c.get("description") or ""):
                web = m.group(0)
        if web and "x.com/" not in web and "twitter.com/" not in web:
            out["domain"] = web[:160]
        return out
    return {}


# ---------------------------------------------------------------- one token
async def from_deployer(token: str) -> dict:
    """Teams ship several tokens from one wallet and run them all from a single X account. If a deployer already
    has two or more identified tokens agreeing on the same handle, that handle is good enough for the next one.
    Applies to socials only — never to the logo, which is per-token artwork."""
    row = await db.fetchone(text("""
        SELECT s2.x_handle, count(*) AS n FROM social_tokens s1
        JOIN social_tokens s2 ON s2.deployer = s1.deployer AND s2.token <> s1.token
        WHERE s1.token = :t AND s1.deployer IS NOT NULL AND s2.x_handle IS NOT NULL
        GROUP BY s2.x_handle ORDER BY n DESC LIMIT 1""").bindparams(t=token))
    if row and int(row["n"] or 0) >= 2:
        return {"src": "deployer", "x_handle": row["x_handle"]}
    return {}


async def from_wallet_link(token: str) -> dict:
    """We already map some wallets to X handles (risk_score's wallet_x, 248 links). If the wallet that deployed
    this token is one of them, that handle is the project's own. Socials only — a dev's avatar is not the token's
    artwork, so the logo is left to the contract or to X's project account."""
    row = await db.fetchone(text("""
        SELECT w.handle FROM social_tokens s JOIN wallet_x w ON lower(w.wallet) = lower(s.deployer)
        WHERE s.token = :t LIMIT 1""").bindparams(t=token))
    return {"src": "walletlink", "x_handle": row["handle"]} if row and row["handle"] else {}


async def identify(s: aiohttp.ClientSession, row: dict) -> dict:
    token, symbol, name = row["token"], row.get("symbol"), row.get("name")
    found: dict = {}

    if not row.get("logo") or not (row.get("x_handle") or row.get("tg_handle") or row.get("domain")):
        try:
            from .contract_socials import read_contract
            got = await read_contract(s, token)
            ok = await verify_any(s, got["logo"]) if got.get("logo") else None
            if ok:
                found.update({"logo": ok, "src": "contract"})
            for k_src, k_dst in (("tw", "x_handle"), ("tg", "tg_handle"), ("web", "domain")):
                if got.get(k_src):
                    found.setdefault(k_dst, got[k_src])
                    found.setdefault("src", "contract")
        except Exception:  # noqa
            pass

    if not found.get("logo") and not row.get("logo"):
        found.update({k: v for k, v in (await from_explorer(s, token)).items() if k not in found})

    if not (row.get("x_handle") or found.get("x_handle")):
        for k, v in (await from_wallet_link(token)).items():
            found.setdefault(k, v)
    if not (row.get("x_handle") or found.get("x_handle")):
        for k, v in (await from_deployer(token)).items():
            found.setdefault(k, v)

    need_social = not (row.get("x_handle") or found.get("x_handle"))
    if (not found.get("logo") and not row.get("logo")) or need_social:
        try:
            got = await asyncio.wait_for(from_x(token, symbol, name), 40)
            for k, v in got.items():
                if k == "logo" and (found.get("logo") or row.get("logo")):
                    continue
                found.setdefault(k, v)
        except Exception:  # noqa
            pass
    return found


async def sweep_once(limit: int = 150) -> tuple[int, int]:
    """Highest-volume unidentified tokens first, so the Terminal's visible rows fill in before the long tail."""
    now = int(time.time())
    rows = await db.fetchall(text("""
        WITH act AS (SELECT token, SUM(usdc) v FROM swaps WHERE ts > :since GROUP BY token)
        SELECT a.token, s.symbol, s.name, s.logo, s.x_handle, s.tg_handle, s.domain, a.v
        FROM act a LEFT JOIN social_tokens s ON s.token = a.token
        WHERE COALESCE(s.ident_locked, 0) = 0
          AND COALESCE(s.ident_checked, 0) < :stale
          AND (s.logo IS NULL OR s.logo = '' OR (s.x_handle IS NULL AND s.tg_handle IS NULL AND s.domain IS NULL))
          AND a.token <> '0x3600000000000000000000000000000000000000'
        ORDER BY a.v DESC LIMIT :n
    """).bindparams(since=now - 7 * 86400, stale=now - 7 * 86400, n=limit))
    if not rows:
        return 0, 0
    hits = 0
    async with aiohttp.ClientSession() as s:
        for r in rows:
            row = dict(r)
            stats["checked"] += 1
            try:
                got = await identify(s, row)
            except Exception as e:  # noqa
                log.debug("identify %s: %s", row["token"][:10], e)
                got = {}
            src = got.pop("src", None)
            if got:
                hits += 1
                if got.get("logo"):
                    stats["found_logo"] += 1
                if got.get("x_handle") or got.get("tg_handle") or got.get("domain"):
                    stats["found_social"] += 1
                if src:
                    stats["by"][src] = stats["by"].get(src, 0) + 1
            # a verified logo locks the row: no more lookups for it, ever, and nothing can overwrite it later
            lock = 1 if (got.get("logo") or row.get("logo")) and (got.get("x_handle") or row.get("x_handle")) else 0
            await db.execute(text("""
                INSERT INTO social_tokens (token, symbol, name, logo, x_handle, tg_handle, domain, ident_locked, ident_checked, ident_src, updated)
                VALUES (:t, '', '', :l, :tw, :tg, :w, :lock, :now, :src, :now)
                ON CONFLICT (token) DO UPDATE SET
                    logo = COALESCE(social_tokens.logo, EXCLUDED.logo),
                    x_handle = COALESCE(social_tokens.x_handle, EXCLUDED.x_handle),
                    tg_handle = COALESCE(social_tokens.tg_handle, EXCLUDED.tg_handle),
                    domain = COALESCE(social_tokens.domain, EXCLUDED.domain),
                    ident_locked = GREATEST(COALESCE(social_tokens.ident_locked, 0), EXCLUDED.ident_locked),
                    ident_checked = EXCLUDED.ident_checked,
                    ident_src = COALESCE(social_tokens.ident_src, EXCLUDED.ident_src),
                    updated = EXCLUDED.updated
            """).bindparams(t=row["token"], l=got.get("logo"), tw=got.get("x_handle"), tg=got.get("tg_handle"),
                            w=got.get("domain"), lock=lock, now=now, src=src))
            # a found logo also stops the old logo hunter from spending another lookup on this token
            if got.get("logo"):
                await db.execute(text("UPDATE social_tokens SET logo_checked = :far, logo_src = COALESCE(logo_src, :src) WHERE token = :t")
                                 .bindparams(t=row["token"], far=now + 10 * 365 * 86400, src=src or "ident"))
            await asyncio.sleep(0.12)                    # X search is pay-per-call, but credits are topped up
    return len(rows), hits


async def identity_loop() -> None:
    await init()
    await asyncio.sleep(150)
    while True:
        try:
            from .insider import _lag
            if (_lag.get("blocks") or 0) > 25:
                await asyncio.sleep(30)
                continue
            n, h = await sweep_once()
            if n:
                log.info("identity: %s checked, %s identified (%s)", n, h, stats["by"])
        except Exception as e:  # noqa
            log.warning("identity loop: %s", str(e)[:120])
        await asyncio.sleep(30)


async def api_identity_stats(request):
    from aiohttp import web
    row = await db.fetchone(text("""
        SELECT count(*) AS rows,
               count(*) FILTER (WHERE logo IS NOT NULL AND logo <> '') AS with_logo,
               count(*) FILTER (WHERE x_handle IS NOT NULL) AS with_x,
               count(*) FILTER (WHERE ident_locked = 1) AS locked
        FROM social_tokens"""))
    return web.json_response({"session": stats, "totals": dict(row) if row else {}},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})
