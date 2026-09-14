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
BOT = "http://127.0.0.1:" + __import__("os").environ.get("PORT", "8080")
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
        await _warm(s)   # no purge: a recompute during an RPC outage would replace a good list with nothing
        await _warm(s, purge=f"token:{ARCT}")
        await _warm(s)
        _healed["pages"] = _healed.get("pages", 0) + 1
    return (not bad, ", ".join(bad) or "ok")


async def chk_tokens_api(s):
    j = await _json(s, f"{SITE}/api/tokens")
    n = int((j or {}).get("count") or 0)
    if n < 100:
        await _warm(s)   # never purge: during an RPC outage the cached list is the only good copy
        _healed["tokens"] = _healed.get("tokens", 0) + 1
        return False, f"/api/tokens count={n}"
    # data quality: garbled rows ("?" symbols, empty names) or a logo-coverage drop mean an upstream chunk was lost
    # and got cached → purge the lists so the next compute (with the metadata memory) heals it
    toks = (j or {}).get("tokens") or []
    if toks:
        garbled = sum(1 for t in toks if not t.get("name") or t.get("symbol") in ("?", ""))
        logos = sum(1 for t in toks if t.get("logo"))
        cov = logos / len(toks)
        prev = _healed.get("_logo_cov", cov)
        _healed["_logo_cov"] = max(prev, cov) if garbled == 0 else prev
        if garbled > 0 or cov < prev - 0.15:
            await _warm(s)   # never purge: during an RPC outage the cached list is the only good copy
            _healed["quality"] = _healed.get("quality", 0) + 1
            return False, f"list quality: {garbled} garbled rows, logo coverage {cov:.0%} (was {prev:.0%})"
    j2 = await _json(s, f"{SITE}/api/tokenpage?ca={ARCT}", timeout=60)
    if not j2 or j2.get("error") or j2.get("mcapUsd") is None:
        await _warm(s, purge=f"token:{ARCT}")
        _healed["tokenpage"] = _healed.get("tokenpage", 0) + 1
        return False, f"tokenpage ARCT: {str(j2)[:120]}"
    return True, f"tokens={n} · logos {(_healed.get('_logo_cov', 0)):.0%}"


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


async def chk_display(s):
    """What a user actually sees: launchpad list complete with logos, stock pairs listed, a pad token's page + route
    answer, Terminal rows carry stats. Self-heals by purging the relevant caches."""
    problems = []
    pl = await _json(s, f"{SITE}/api/padlist", timeout=60) or {}
    rows = pl.get("rows") or []
    n = len(rows)
    prev = _healed.get("_pad_n", 0)
    if n < prev:
        problems.append(f"pad list shrank {prev}->{n}")
        await _warm(s)   # no purge: a recompute during an RPC outage would replace a good list with nothing
    else:
        _healed["_pad_n"] = n
    garbled = [r["symbol"] for r in rows if r.get("symbol") in ("?", "") or not r.get("name")]
    if garbled:
        problems.append(f"pad rows garbled: {garbled}")
        await _warm(s)   # no purge: a recompute during an RPC outage would replace a good list with nothing
    nologo = [r["symbol"] for r in rows if not r.get("image")]
    prev_nl = _healed.get("_pad_nologo")
    if prev_nl is not None and len(nologo) > prev_nl:
        problems.append(f"pad logos disappeared: {nologo}")
        await _warm(s)   # no purge: a recompute during an RPC outage would replace a good list with nothing
    _healed["_pad_nologo"] = min(len(nologo), prev_nl if prev_nl is not None else len(nologo))
    st = await _json(s, f"{SITE}/api/stocks", timeout=60) or {}
    stocks = st.get("stocks") or []
    if len(stocks) < 10 or not any(x.get("usdcPool") for x in stocks):
        problems.append(f"stocks list {len(stocks)} / pools {sum(1 for x in stocks if x.get('usdcPool'))}")
    if rows:
        t = rows[-1]["token"]
        pg = await _json(s, f"{SITE}/api/tokenpage?ca={t}", timeout=60) or {}
        if pg.get("error") or pg.get("mcapUsd") is None:
            problems.append(f"pad token page {rows[-1]['symbol']}: {str(pg)[:80]}")
            await _warm(s, purge=f"token:{t}")
        rt = {}
        for attempt in range(3):   # quotes go through the relay: one dropped call must not raise an alarm
            rt = await _json(s, f"{SITE}/api/swaproute?token={t}&side=buy&amount=1000000000000000000", timeout=60) or {}
            if rt.get("legs") and not rt.get("error"):
                break
            await asyncio.sleep(4)
        if rt.get("error") or not rt.get("legs"):
            problems.append(f"route {rows[-1]['symbol']}: {rt.get('error') or 'no legs'}")
    if problems:
        _healed["display"] = _healed.get("display", 0) + 1
        return False, " · ".join(problems)[:300]
    return True, f"pad {n} tokens, {n - len(nologo)} logos · stocks {len(stocks)} · page+route ok"


async def chk_cells(s):
    """Terminal cell coverage: for the first 150 Terminal rows (default order) + 50 random others, how many have a Score
    and a liquidity figure in the index right now. A gap schedules background compute (holder-risk does that itself)
    and, if it persists on the second look, fails the check so it is visible in the status pill and the hourly DM."""
    import random
    j = await _json(s, f"{SITE}/api/tokens?full=1")
    toks = [t["token"].lower() for t in ((j or {}).get("tokens") or []) if (t.get("mcapUsd") or 0) > 0]
    if len(toks) < 50:
        return True, "cells: list too small to judge"
    # what the Terminal actually opens on: the Trending tab (all-time volume order) — brand-new tokens without an indexed
    # pool legitimately have no LIQ yet, so they are not part of the liquidity threshold
    tr = await _json(s, f"{BOT}/api/trending?minutes=0&limit=150")
    top = [r["token"].lower() for r in ((tr or {}).get("rows") or [])] or toks[:150]
    sample = list(dict.fromkeys(top + random.sample(toks, min(50, len(toks)))))
    async def coverage():
        risk_ok = 0
        for i in range(0, len(sample), 50):
            r = await _json(s, f"{BOT}/api/holder-risk?tokens={','.join(sample[i:i + 50])}")
            risk_ok += sum(1 for t in sample[i:i + 50] if (r or {}).get("risk", {}).get(t))
        liq = await _json(s, f"{BOT}/api/liq?tokens={','.join(top[:120])}")
        liq_ok = sum(1 for t in top[:120] if t in ((liq or {}).get("liq") or {}))
        return risk_ok / len(sample), liq_ok / max(1, len(top[:120]))
    rc, lc = await coverage()
    if rc < 0.9 or lc < 0.6:
        await asyncio.sleep(20)          # background compute kicked in — look again
        rc, lc = await coverage()
    detail = f"score {rc:.0%} · liq {lc:.0%} of {len(sample)} rows"
    return (rc >= 0.9 and lc >= 0.6), "cells: " + detail


async def chk_bots(s):
    """Speed & stability of the Telegram bots: sniper heartbeat freshness, handler latency p95, buy fill rate,
    Telegram API ping, RPC quarantine; buybot's own handler latency."""
    from .botmetrics import all_bots
    bots = all_bots()
    problems, notes = [], []
    sn = bots.get("sniper")
    if not sn:
        problems.append("sniper: no heartbeat yet")
    else:
        age = sn.get("heartbeat_age_s", 9999)
        if age > 150:
            problems.append(f"sniper heartbeat {age}s old (bot down?)")
        p95 = sn.get("p95_ms")
        if p95 is not None and p95 > 12000:      # buy handlers legitimately wait for a block (~5 s); 12 s = something is stuck
            problems.append(f"sniper p95 {p95:.0f}ms")
        if (sn.get("buy_median_s") or 0) > 15:
            problems.append(f"sniper fills take {sn['buy_median_s']:.0f}s (target <6s)")
        if (sn.get("errors_15m") or 0) >= 3:
            problems.append(f"sniper {sn['errors_15m']} handler errors/15m")
        if sn.get("tg_ping_ms") is None:
            problems.append("sniper: Telegram API unreachable")
        elif sn["tg_ping_ms"] > 2500:
            problems.append(f"sniper tg ping {sn['tg_ping_ms']:.0f}ms")
        b, ok = sn.get("buys_1h") or 0, sn.get("buys_ok_1h") or 0
        if b >= 3 and ok == 0:
            problems.append(f"sniper: 0/{b} buys filled in 1h")
        if len(sn.get("rpc_quarantined") or []) >= 3:
            problems.append("sniper: all RPCs quarantined")
        notes.append(f"sniper p50 {sn.get('p50_ms') or 0:.0f}ms · p95 {p95 or 0:.0f}ms · buys {ok}/{b} · fill {sn.get('buy_median_s') or 0:.1f}s · tg {sn.get('tg_ping_ms') or 0:.0f}ms · up {(sn.get('uptime_s') or 0)//60}m")
    bb = bots["buybot"]
    if bb.get("p95_ms") is not None and bb["p95_ms"] > 12000:   # /add probes pools under a 12 s budget
        problems.append(f"buybot p95 {bb['p95_ms']:.0f}ms")
    if (bb.get("errors_15m") or 0) >= 5:
        problems.append(f"buybot {bb['errors_15m']} handler errors/15m")
    notes.append(f"buybot p95 {bb.get('p95_ms') or 0:.0f}ms · {bb.get('updates_15m')} upd/15m · up {bb['uptime_s']//60}m")
    return (not problems), ("; ".join(problems) + " | " if problems else "") + " · ".join(notes)


CHECKS = [("bots", chk_bots), ("pages", chk_pages), ("cells", chk_cells), ("tokens", chk_tokens_api), ("relay", chk_relay), ("index", chk_index), ("api", chk_own_api), ("display", chk_display)]
REPORT_EVERY = int(os.getenv("WATCHDOG_REPORT_EVERY", "3600"))   # hourly "all good" summary to the admin
_last_report = 0.0


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
            # periodic review summary (what the user asked for: "check every 30-60 min that everything displays fine")
            global _last_report
            if REPORT_EVERY and now - _last_report >= REPORT_EVERY:
                _last_report = now
                ok_all = all(v[0] for v in res.values())
                lines = [f"{'🟢' if v[0] else '🔴'} <code>{k}</code> — {v[1][:120]}" for k, v in res.items()]
                await _tg(f"{'🟢' if ok_all else '🔴'} <b>ArcTools review</b> ({time.strftime('%H:%M UTC', time.gmtime(now))})\n" + "\n".join(lines)
                          + (f"\nself-heals since start: {sum(v for k, v in _healed.items() if not k.startswith('_'))}" ))
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
    from .botmetrics import all_bots
    return web.json_response({"state": state, "ts": LAST["ts"], "age_s": age, "every_s": EVERY, "rounds": LAST["rounds"], "checks": LAST["checks"], "bots": all_bots()},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30"})
