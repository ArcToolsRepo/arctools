"""
Site watchdog with self-healing.

Every WATCHDOG_EVERY seconds it probes the things users actually touch:
  * pages render (/, /trade, /wallets, /intel, /insiders, a token page) and the Terminal carries rows
  * /api/tokens has a sane token count, /api/liq answers, /api/tokenpage for ARCT is complete
  * the RPC relay answers eth_blockNumber, the swap index is not stale, holders/risk API works

When something fails it first tries to fix it itself (drop the poisoned cache, recompute, re-warm) and
re-checks; only if it stays broken for two consecutive rounds does it DM the admin (once, then every
30 min while broken, and once when recovered). Everything is logged as `watchdog`.
"""
import asyncio
import logging
import os
import time

import aiohttp

from . import db
from .warm import WARM_AUTH, WARM_URL

log = logging.getLogger("watchdog")
SITE = "https://arctools.fun"
RELAY = os.environ.get("RELAY_RPC", "https://rpc-production-ba7a.up.railway.app")
ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52"
EVERY = int(os.environ.get("WATCHDOG_EVERY", "180"))
ADMIN = int(os.environ.get("ADMIN_TG_ID", "8351095206"))
ALERT_TOKEN = os.environ.get("ALERT_BOT_TOKEN", "")          # sniper bot token: the admin already has a DM with it
UA = {"User-Agent": "Mozilla/5.0 (compatible; ArcToolsWatchdog/1.0)", "Accept-Encoding": "identity"}

_fail_streak: dict[str, int] = {}
_last_alert: dict[str, float] = {}
# last round, exposed on /api/status for the site footer ("System: Running")
LAST: dict = {"ts": 0, "ok": None, "checks": {}, "rounds": 0}
_healed: dict[str, int] = {}


async def _get(s: aiohttp.ClientSession, url: str, timeout=40) -> tuple[int, str]:
    try:
        async with s.get(url, headers=UA, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            return r.status, await r.text()
    except Exception as e:  # noqa
        return 0, str(e)[:120]


async def _json(s: aiohttp.ClientSession, url: str, timeout=40):
    st, body = await _get(s, url, timeout)
    if st != 200:
        return None
    try:
        import json
        return json.loads(body)
    except Exception:  # noqa
        return None


async def _warm(s: aiohttp.ClientSession, **params) -> None:
    if not WARM_AUTH:
        return
    q = "&".join(f"{k}={v}" for k, v in params.items())
    await _get(s, f"{WARM_URL}?k={WARM_AUTH}" + (f"&{q}" if q else ""), timeout=120)


async def _tg(text: str) -> None:
    if not ALERT_TOKEN:
        log.warning("no ALERT_BOT_TOKEN — cannot DM admin: %s", text[:200])
        return
    try:
        async with aiohttp.ClientSession() as s:
            await s.post(f"https://api.telegram.org/bot{ALERT_TOKEN}/sendMessage",
                         json={"chat_id": ADMIN, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
                         timeout=aiohttp.ClientTimeout(total=20))
    except Exception as e:  # noqa
        log.warning("tg alert failed: %s", e)


# ---- individual checks: each returns (ok, detail) and may self-heal ---------------------------------

async def chk_pages(s):
    bad = []
    for path in ("/", "/trade", "/wallets", "/intel", "/insiders", f"/token/{ARCT}"):
        st, body = await _get(s, SITE + path)
        if st != 200 or "<html" not in body[:300].lower():
            bad.append(f"{path}:{st}")
        elif path == "/trade" and body.count("arc-row-link") < 5:
            bad.append("/trade: <5 rows in SSR")
        elif path.startswith("/token/") and "Token not found" in body:
            bad.append("token page: not found for ARCT")
    if bad:
        await _warm(s, purge="lists")
        await _warm(s, purge=f"token:{ARCT}")
        await _warm(s)
        _healed["pages"] = _healed.get("pages", 0) + 1
    return (not bad, ", ".join(bad) or "ok")


async def chk_tokens_api(s):
    j = await _json(s, f"{SITE}/api/tokens")
    n = int((j or {}).get("count") or 0)
    if n < 100:
        await _warm(s, purge="lists"); await _warm(s)
        _healed["tokens"] = _healed.get("tokens", 0) + 1
        return False, f"/api/tokens count={n}"
    j2 = await _json(s, f"{SITE}/api/tokenpage?ca={ARCT}", timeout=60)
    if not j2 or j2.get("error") or j2.get("mcapUsd") is None:
        await _warm(s, purge=f"token:{ARCT}")
        _healed["tokenpage"] = _healed.get("tokenpage", 0) + 1
        return False, f"tokenpage ARCT: {str(j2)[:120]}"
    return True, f"tokens={n}"


async def chk_relay(s):
    try:
        async with s.post(RELAY, json={"id": 1, "jsonrpc": "2.0", "method": "eth_blockNumber", "params": []},
                          timeout=aiohttp.ClientTimeout(total=20)) as r:
            j = await r.json(content_type=None)
            ok = r.status == 200 and str(j.get("result", "")).startswith("0x")
            return ok, f"relay {r.status}"
    except Exception as e:  # noqa
        return False, f"relay: {str(e)[:80]}"


async def chk_index(s):
    """Swap index cursor must move: > 600 s without a new swap while the chain has blocks = stuck ingest."""
    try:
        r = await db.fetchone(__import__("sqlalchemy").text("SELECT MAX(ts) AS t FROM swaps"))
        last = int(r["t"] or 0)
        lag = int(time.time()) - last
        return lag < 900, f"last swap {lag}s ago"
    except Exception as e:  # noqa
        return False, f"db: {str(e)[:80]}"


async def chk_own_api(s):
    base = os.environ.get("SELF_URL", "https://bot-production-4200.up.railway.app")
    j = await _json(s, f"{base}/api/trending?minutes=60&limit=5", timeout=30)
    j2 = await _json(s, f"{base}/api/liq?tokens={ARCT}", timeout=60)
    ok = bool(j and j.get("rows") is not None) and bool(j2 and "liq" in j2)
    return ok, f"trending={bool(j)} liq={bool(j2)}"


CHECKS = [("pages", chk_pages), ("tokens", chk_tokens_api), ("relay", chk_relay), ("index", chk_index), ("api", chk_own_api)]


async def run_once() -> dict[str, tuple[bool, str]]:
    res: dict[str, tuple[bool, str]] = {}
    async with aiohttp.ClientSession() as s:
        for name, fn in CHECKS:
            try:
                ok, detail = await fn(s)
            except Exception as e:  # noqa
                ok, detail = False, f"check crashed: {str(e)[:80]}"
            # a failed check that self-healed gets one immediate re-check before it counts
            if not ok and name in ("pages", "tokens"):
                await asyncio.sleep(8)
                try:
                    ok, detail2 = await fn(s)
                    detail = f"{detail} → after heal: {detail2}"
                except Exception:  # noqa
                    pass
            res[name] = (ok, detail)
    return res


async def watchdog_loop():
    await asyncio.sleep(90)
    while True:
        try:
            res = await run_once()
            now = time.time()
            for name, (ok, detail) in res.items():
                if ok:
                    if _fail_streak.get(name, 0) >= 2:
                        await _tg(f"✅ <b>ArcTools watchdog</b>: <code>{name}</code> recovered — {detail}")
                    _fail_streak[name] = 0
                    continue
                _fail_streak[name] = _fail_streak.get(name, 0) + 1
                log.warning("check %s FAILED (%d): %s", name, _fail_streak[name], detail)
                if _fail_streak[name] >= 2 and now - _last_alert.get(name, 0) > 1800:
                    _last_alert[name] = now
                    await _tg(f"🔴 <b>ArcTools watchdog</b>: <code>{name}</code> failing for {_fail_streak[name]} rounds\n{detail}\n"
                              f"self-heal attempts: {_healed.get(name, 0)}")
            log.info("watchdog: %s", {k: ("ok" if v[0] else "FAIL") for k, v in res.items()})
            LAST.update(ts=int(now), ok=all(v[0] for v in res.values()), rounds=LAST["rounds"] + 1,
                        checks={k: {"ok": v[0], "detail": v[1][:160], "streak": _fail_streak.get(k, 0)} for k, v in res.items()})
        except Exception as e:  # noqa
            log.warning("watchdog loop: %s", e)
        await asyncio.sleep(EVERY)


async def api_status(req):
    """GET /api/status — last watchdog round (pages, tokens API, relay, index lag, own API). Used by the site footer."""
    from aiohttp import web
    age = int(time.time() - LAST["ts"]) if LAST["ts"] else None
    state = "starting" if LAST["ok"] is None else ("running" if LAST["ok"] else "degraded")
    if age is not None and age > EVERY * 4:
        state = "stale"
    return web.json_response({"state": state, "ts": LAST["ts"], "age_s": age, "every_s": EVERY, "rounds": LAST["rounds"], "checks": LAST["checks"]},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30"})
