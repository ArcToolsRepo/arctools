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


async def from_x(token: str, symbol: str | None, name: str | None) -> dict:
    """The contract address is the strongest query: whoever posts it is almost always the project or a caller."""
    out: dict = {}
    queries = [token]
    if symbol and len(symbol) >= 3:
        queries.append(f'"${symbol}" (arc OR arcchain OR usdc)')
    for q in queries:
        j = await _tw("/twitter/tweet/advanced_search", query=q, queryType="Latest")
        tweets = (j or {}).get("tweets") or []
        best, best_sc = None, 0.0
        for t in tweets[:25]:
            a = t.get("author") or {}
            txt = t.get("text") or ""
            if q == token and token.lower() not in txt.lower():
                continue
            sc = _score_author(a, symbol or "", name or "")
            if q == token and CA_RE.search(txt):
                sc += 1.5                               # posted the contract itself
            if sc > best_sc:
                best, best_sc = a, sc
        if best and best_sc >= 4:
            handle = best.get("userName")
            avatar = (best.get("profilePicture") or "").replace("_normal", "")
            desc = best.get("description") or ""
            out["x_handle"] = handle
            if avatar:
                out["logo"] = avatar
            if m := TG_RE.search(desc):
                out["tg_handle"] = m.group(1)
            web = best.get("url") or ""
            if not web:
                if m := WEB_RE.search(desc):
                    web = m.group(0)
            if web:
                out["domain"] = web[:160]
            out["src"] = "x"
            return out
    return out


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


async def sweep_once(limit: int = 40) -> tuple[int, int]:
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
            await asyncio.sleep(0.4)                     # X search is pay-per-call: stay deliberate
    return len(rows), hits


async def identity_loop() -> None:
    await init()
    await asyncio.sleep(150)
    while True:
        try:
            from .insider import _lag
            if (_lag.get("blocks") or 0) > 40:
                await asyncio.sleep(30)
                continue
            n, h = await sweep_once()
            if n:
                log.info("identity: %s checked, %s identified (%s)", n, h, stats["by"])
        except Exception as e:  # noqa
            log.warning("identity loop: %s", str(e)[:120])
        await asyncio.sleep(90)


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
