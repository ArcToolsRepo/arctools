"""Arc KOL graph — "smart followers" for token X accounts.

Two loops, one data source (twitterapi.io, env TWITTERAPI_KEY, pay-per-call):
  * kol_discover_loop (daily): who talks about Arc on X? advanced_search over Arc queries → authors with
    >= KOL_MIN_FOLLOWERS become KOL candidates (category 'auto'). Curated seeds (SEED_KOLS) are always in.
  * kol_follow_loop (every 6 h): for every active KOL, page through their followings (newest first) and store
    them in kol_following. First pass walks the whole list; later passes stop at the first already-known
    handle (followings are sorted by follow date), so a daily refresh is ~1 call per KOL.
Token X accounts (from token metadata) get profile snapshots (followers, created_at) once a day.

Public API:
  GET /api/kol-follows?handle=<x handle>  → {account:{…}, kols:[{handle,name,followers,avatar,category}], total_kols}
  GET /api/kols                            → active KOL list (for the Intel page)
  POST /api/kols {handle, action:add|remove, category} with X-Ref-Auth (admin)
Without TWITTERAPI_KEY the module is inert and the API answers {enabled:false}.
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

log = logging.getLogger("kols")
CORS = {"Access-Control-Allow-Origin": "*"}
API = "https://api.twitterapi.io"
KEY = os.getenv("TWITTERAPI_KEY", "")
KOL_MIN_FOLLOWERS = int(os.getenv("KOL_MIN_FOLLOWERS", "10000"))
ADMIN_AUTH = os.getenv("REF_AUTH", "")

# Curated: official / ecosystem / builders. Follower counts are fetched, not assumed. Lower-case handles.
SEED_KOLS: dict[str, str] = {
    "arc": "ecosystem", "circle": "ecosystem", "jerallaire": "ecosystem", "arcscan_org": "ecosystem",
    "radardex": "launchpad", "warpdotfun": "launchpad", "tollydotfun": "launchpad", "arcpad_fun": "launchpad",
    "arctoolsfun": "ecosystem",
}
ARC_QUERIES = [
    '"Arc mainnet" circle',
    '"on Arc" (usdc OR circle OR memecoin OR launchpad)',
    'arcpad OR radardex OR arcscan OR "tolly.fun" OR "warp.fun" OR arctools',
    '"Circle\'s Arc" OR "Arc L1" OR "Arc blockchain" OR "Arc network" circle',
    '"arc-scan.org" OR "arctools.fun" OR "arc.network"',
    '(memecoin OR meme OR launchpad OR degen) "arc" (circle OR usdc)',
]
QPS_SLEEP = float(os.getenv("TWITTERAPI_QPS_SLEEP", "5.2"))  # free tier: 1 request / 5 s


def enabled() -> bool:
    return bool(KEY)


async def init():
    await db.execute(text("CREATE TABLE IF NOT EXISTS kols (handle VARCHAR(64) PRIMARY KEY, user_id VARCHAR(32), name TEXT, followers BIGINT DEFAULT 0, avatar TEXT, category VARCHAR(16), active INTEGER DEFAULT 1, ts BIGINT, synced BIGINT DEFAULT 0, full_sync INTEGER DEFAULT 0)"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS kol_following (kol VARCHAR(64), handle VARCHAR(64), ts BIGINT, PRIMARY KEY (kol, handle))"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS kol_following_handle ON kol_following (handle)"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS x_accounts (handle VARCHAR(64) PRIMARY KEY, user_id VARCHAR(32), name TEXT, followers BIGINT, following BIGINT, created_at TEXT, avatar TEXT, description TEXT, verified INTEGER DEFAULT 0, ts BIGINT)"))
    now = int(time.time())
    for h, cat in SEED_KOLS.items():
        await db.execute(text("INSERT INTO kols (handle, category, active, ts) VALUES (:h, :c, 1, :ts) ON CONFLICT (handle) DO NOTHING").bindparams(h=h, c=cat, ts=now))
    if enabled():
        asyncio.create_task(kol_discover_loop(), name="kol-discover")
        asyncio.create_task(kol_follow_loop(), name="kol-follow")
        asyncio.create_task(x_accounts_loop(), name="x-accounts")
        log.info("kols: enabled (min followers %s)", KOL_MIN_FOLLOWERS)
    else:
        log.info("kols: TWITTERAPI_KEY missing — smart followers disabled")


# ---------------- twitterapi.io client ----------------
_sem = asyncio.Semaphore(1)
_spent = {"calls": 0}


async def _get(path: str, **params) -> dict | None:
    if not KEY:
        return None
    async with _sem:
        for attempt in range(3):
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25), headers={"X-API-Key": KEY}) as s:
                    async with s.get(f"{API}{path}", params={k: v for k, v in params.items() if v is not None}) as r:
                        _spent["calls"] += 1
                        if r.status == 429:
                            await asyncio.sleep(QPS_SLEEP * 2 * (attempt + 1))
                            continue
                        j = await r.json(content_type=None)
                        if r.status >= 400 or j.get("status") == "error":
                            log.debug("twitterapi %s %s: %s", path, r.status, str(j)[:160])
                            return None
                        await asyncio.sleep(QPS_SLEEP)
                        return j
            except Exception as e:  # noqa
                log.debug("twitterapi %s: %s", path, e)
                await asyncio.sleep(2)
    return None


async def user_info(handle: str) -> dict | None:
    j = await _get("/twitter/user/info", userName=handle)
    d = (j or {}).get("data") or {}
    return d if d.get("userName") else None


async def upsert_account(d: dict) -> None:
    await db.execute(text("""INSERT INTO x_accounts (handle, user_id, name, followers, following, created_at, avatar, description, verified, ts)
        VALUES (:h, :id, :n, :f, :fg, :c, :a, :d, :v, :ts) ON CONFLICT (handle) DO UPDATE SET user_id=EXCLUDED.user_id, name=EXCLUDED.name, followers=EXCLUDED.followers,
        following=EXCLUDED.following, created_at=EXCLUDED.created_at, avatar=EXCLUDED.avatar, description=EXCLUDED.description, verified=EXCLUDED.verified, ts=EXCLUDED.ts""")
                     .bindparams(h=d["userName"].lower(), id=str(d.get("id") or ""), n=d.get("name") or "", f=int(d.get("followers") or 0), fg=int(d.get("following") or 0),
                                 c=str(d.get("createdAt") or ""), a=d.get("profilePicture") or "", d=(d.get("description") or "")[:500], v=1 if d.get("isBlueVerified") else 0, ts=int(time.time())))


# ---------------- discovery ----------------
async def kol_discover():
    found: dict[str, dict] = {}
    for q in ARC_QUERIES:
        cursor = ""
        for _ in range(8):
            j = await _get("/twitter/tweet/advanced_search", query=q, queryType="Latest", cursor=cursor or None)
            if not j:
                break
            for t in j.get("tweets") or []:
                a = t.get("author") or {}
                if a.get("userName") and int(a.get("followers") or 0) >= KOL_MIN_FOLLOWERS:
                    found[a["userName"].lower()] = a
            if not j.get("has_next_page"):
                break
            cursor = j.get("next_cursor") or ""
    now = int(time.time())
    for h, a in found.items():
        await db.execute(text("""INSERT INTO kols (handle, user_id, name, followers, avatar, category, active, ts) VALUES (:h, :id, :n, :f, :a, 'auto', 1, :ts)
            ON CONFLICT (handle) DO UPDATE SET user_id=EXCLUDED.user_id, name=EXCLUDED.name, followers=EXCLUDED.followers, avatar=EXCLUDED.avatar""")
                         .bindparams(h=h, id=str(a.get("id") or ""), n=a.get("name") or "", f=int(a.get("followers") or 0), a=a.get("profilePicture") or "", ts=now))
    # refresh seed/manual profiles (followers, avatar) once a day
    rows = await db.fetchall(text("SELECT handle FROM kols WHERE category <> 'auto' AND (ts IS NULL OR ts < :old)").bindparams(old=now - 86400 + 60))
    for r in rows:
        d = await user_info(r["handle"])
        if d:
            await db.execute(text("UPDATE kols SET user_id=:id, name=:n, followers=:f, avatar=:a, ts=:ts WHERE handle=:h")
                             .bindparams(id=str(d.get("id") or ""), n=d.get("name") or "", f=int(d.get("followers") or 0), a=d.get("profilePicture") or "", ts=now, h=r["handle"]))
            await upsert_account(d)
    log.info("kol discover: %s authors ≥%s followers", len(found), KOL_MIN_FOLLOWERS)
    return len(found)


async def kol_discover_loop():
    await asyncio.sleep(120)
    while True:
        try:
            await kol_discover()
        except Exception as e:  # noqa
            log.warning("kol discover: %s", e)
        await asyncio.sleep(86400)


# ---------------- followings ----------------
async def sync_kol(handle: str, full: bool) -> int:
    known = {r["handle"] for r in await db.fetchall(text("SELECT handle FROM kol_following WHERE kol = :k").bindparams(k=handle))} if not full else set()
    cursor = ""
    added = 0
    now = int(time.time())
    for page in range(60 if full else 3):
        j = await _get("/twitter/user/followings", userName=handle, pageSize=200, cursor=cursor or None)
        if not j:
            break
        rows = j.get("followings") or []
        stop = False
        for u in rows:
            h = (u.get("userName") or "").lower()
            if not h:
                continue
            if h in known:
                stop = True
                break
            await db.execute(text("INSERT INTO kol_following (kol, handle, ts) VALUES (:k, :h, :ts) ON CONFLICT (kol, handle) DO NOTHING").bindparams(k=handle, h=h, ts=now))
            added += 1
        if stop or not j.get("has_next_page"):
            break
        cursor = j.get("next_cursor") or ""
    await db.execute(text("UPDATE kols SET synced=:ts, full_sync=1 WHERE handle=:h").bindparams(ts=now, h=handle))
    return added


async def kol_follow_loop():
    await asyncio.sleep(300)
    while True:
        try:
            rows = await db.fetchall(text("SELECT handle, full_sync, synced FROM kols WHERE active = 1 ORDER BY full_sync, synced NULLS FIRST LIMIT 60"))
            for r in rows:
                if int(r["synced"] or 0) > time.time() - 6 * 3600 and r["full_sync"]:
                    continue
                n = await sync_kol(r["handle"], full=not r["full_sync"])
                if n:
                    log.info("kol %s: +%s followings", r["handle"], n)
        except Exception as e:  # noqa
            log.warning("kol follow loop: %s", e)
        await asyncio.sleep(1800)


# ---------------- token X accounts ----------------
async def x_accounts_loop():
    """Profile snapshots for every X handle attached to an Arc token (wallet_x + site feed)."""
    await asyncio.sleep(240)
    from .risk_score import x_handle
    while True:
        try:
            handles: set[str] = set()
            for r in await db.fetchall(text("SELECT DISTINCT handle FROM wallet_x")):
                handles.add(r["handle"])
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as s:
                    async with s.get("https://arctools.fun/api/tokens") as r:
                        data = await r.json()
                for t in data if isinstance(data, list) else []:
                    h = x_handle(t.get("twitter")) if isinstance(t, dict) else None
                    if h:
                        handles.add(h)
            except Exception:  # noqa
                pass
            stale = {r["handle"] for r in await db.fetchall(text("SELECT handle FROM x_accounts WHERE ts > :t").bindparams(t=int(time.time()) - 86400))}
            todo = [h for h in handles if h not in stale][:150]
            for h in todo:
                d = await user_info(h)
                if d:
                    await upsert_account(d)
                else:
                    await db.execute(text("INSERT INTO x_accounts (handle, followers, ts) VALUES (:h, -1, :ts) ON CONFLICT (handle) DO UPDATE SET followers=-1, ts=EXCLUDED.ts").bindparams(h=h, ts=int(time.time())))
            if todo:
                log.info("x accounts: refreshed %s", len(todo))
        except Exception as e:  # noqa
            log.warning("x accounts: %s", e)
        await asyncio.sleep(3600)


# ---------------- API ----------------
async def smart_followers(handle: str) -> dict:
    h = handle.lower().lstrip("@")
    acc = await db.fetchone(text("SELECT * FROM x_accounts WHERE handle = :h").bindparams(h=h))
    kols = await db.fetchall(text("""SELECT k.handle, k.name, k.followers, k.avatar, k.category FROM kol_following f JOIN kols k ON k.handle = f.kol
                                     WHERE f.handle = :h AND k.active = 1 ORDER BY k.followers DESC""").bindparams(h=h))
    total = await db.fetchone(text("SELECT COUNT(*) AS n FROM kols WHERE active = 1 AND full_sync = 1"))
    account = None
    if acc and int(acc["followers"] or 0) >= 0:
        account = {"handle": acc["handle"], "name": acc["name"], "followers": acc["followers"], "following": acc["following"], "created_at": acc["created_at"], "avatar": acc["avatar"], "verified": bool(acc["verified"]), "ts": acc["ts"]}
    elif acc:
        account = {"handle": h, "missing": True}
    return {"enabled": enabled(), "handle": h, "account": account, "kols": [dict(k) for k in kols], "total_kols": int(total["n"] if total else 0)}


async def api_kol_follows(req: web.Request):
    h = (req.query.get("handle") or "").strip()
    if not h:
        return web.json_response({"error": "handle"}, status=400, headers=CORS)
    return web.json_response(await smart_followers(h), headers={**CORS, "Cache-Control": "public, max-age=120"})


async def api_kols(req: web.Request):
    rows = await db.fetchall(text("SELECT handle, name, followers, avatar, category, synced, full_sync FROM kols WHERE active = 1 ORDER BY followers DESC LIMIT 300"))
    return web.json_response({"enabled": enabled(), "min_followers": KOL_MIN_FOLLOWERS, "calls": _spent["calls"], "kols": [dict(r) for r in rows]}, headers={**CORS, "Cache-Control": "public, max-age=300"})


async def api_kols_admin(req: web.Request):
    if not ADMIN_AUTH or req.headers.get("X-Ref-Auth") != ADMIN_AUTH:
        return web.json_response({"error": "auth"}, status=401, headers=CORS)
    body = await req.json()
    h = str(body.get("handle") or "").lower().lstrip("@")
    if not h:
        return web.json_response({"error": "handle"}, status=400, headers=CORS)
    if body.get("action") == "remove":
        await db.execute(text("UPDATE kols SET active = 0 WHERE handle = :h").bindparams(h=h))
        return web.json_response({"ok": True, "removed": h}, headers=CORS)
    await db.execute(text("INSERT INTO kols (handle, category, active, ts) VALUES (:h, :c, 1, 0) ON CONFLICT (handle) DO UPDATE SET active = 1, category = EXCLUDED.category")
                     .bindparams(h=h, c=str(body.get("category") or "manual")[:16]))
    d = await user_info(h) if enabled() else None
    if d:
        await db.execute(text("UPDATE kols SET user_id=:id, name=:n, followers=:f, avatar=:a, ts=:ts WHERE handle=:h")
                         .bindparams(id=str(d.get("id") or ""), n=d.get("name") or "", f=int(d.get("followers") or 0), a=d.get("profilePicture") or "", ts=int(time.time()), h=h))
        asyncio.create_task(sync_kol(h, full=True))
    return web.json_response({"ok": True, "handle": h, "profile": bool(d)}, headers=CORS)


def register(app: web.Application):
    app.router.add_get("/api/kol-follows", api_kol_follows)
    app.router.add_get("/api/kols", api_kols)
    app.router.add_post("/api/kols", api_kols_admin)
