"""RPC availability + latency monitor.

Probes every RPC endpoint we depend on (own reth node first, public backups after) every 20 s:
eth_blockNumber latency, head lag vs the freshest endpoint, eth_call sanity (USDC facade totalSupply).
Keeps a 24 h ring per endpoint (uptime %, p50 / p95 latency, last error) and alerts the admin on Telegram:

  🔴 PRIMARY NODE DOWN  — 3 consecutive failed probes of the own node (or head stuck > 120 s behind the others)
  🟢 PRIMARY NODE BACK  — first successful probe after an outage, with outage duration
  🟠 backup down        — a public backup failing for 5 min (one line, then silence until it recovers)
  ⚠️ latency            — primary p95 > 1500 ms over the last 5 min (at most once / h)

Exposed at GET /api/rpc-health for the site (self-heal reads it) and the watchdog (chk_rpc).
"""
from __future__ import annotations

import asyncio
import logging
import os
import statistics
import time
from collections import deque

import aiohttp
from aiohttp import web

from .config import CFG

log = logging.getLogger("rpc_monitor")

PRIMARY = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")     # US box, next door to Railway
BACKUP = os.getenv("BACKUP_RPC", "http://178.156.197.90:8545")        # original Warsaw box, now the fallback
ENDPOINTS: list[tuple[str, str]] = [("node", PRIMARY), ("node-backup", BACKUP)] + [
    (u.split("//")[1].split("/")[0].replace("rpc.", "").replace(".up.railway.app", " (relay)"), u)
    for u in (CFG.rpc_urls if hasattr(CFG, "rpc_urls") else [])
    if u.rstrip("/") not in (PRIMARY.rstrip("/"), BACKUP.rstrip("/"))
]
for extra in ("https://rpc.arc-scan.org", "https://rpc-production-ba7a.up.railway.app"):
    if all(u.rstrip("/") != extra for _, u in ENDPOINTS):
        ENDPOINTS.append((extra.split("//")[1].split("/")[0].replace("rpc.", "").replace(".up.railway.app", " (relay)"), extra))

INTERVAL = 20
RING = 24 * 3600 // INTERVAL          # 24 h of samples
API_CORS = {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}
USDC = "0x3600000000000000000000000000000000000000"

_hist: dict[str, deque] = {u: deque(maxlen=RING) for _, u in ENDPOINTS}   # (ts, ok, ms, head)
_state: dict[str, dict] = {u: {"fails": 0, "down_since": None, "last_err": "", "alerted": False} for _, u in ENDPOINTS}
_last_lat_alert = 0.0
bot = None


async def _tg(text: str):
    token = os.getenv("BOT_TOKEN", "")
    admin = os.getenv("ADMIN_TG_ID", "8351095206")
    if not token:
        return
    try:
        async with aiohttp.ClientSession() as s:
            await s.post(f"https://api.telegram.org/bot{token}/sendMessage",
                         json={"chat_id": int(admin), "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
                         timeout=aiohttp.ClientTimeout(total=10))
    except Exception as e:  # noqa
        log.warning("tg: %s", e)


async def _probe(s: aiohttp.ClientSession, url: str) -> tuple[bool, float, int | None, str]:
    """Batch: blockNumber + eth_call totalSupply(USDC). Returns (ok, ms, head, err)."""
    body = [{"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []},
            {"jsonrpc": "2.0", "id": 2, "method": "eth_call", "params": [{"to": USDC, "data": "0x18160ddd"}, "latest"]}]
    hdr = {"Content-Type": "application/json", "User-Agent": "arcbuybot-rpcmon/1.0", "X-Priority": "high", "X-Relay-Key": os.getenv("RELAY_KEY", "")}
    t = time.time()
    try:
        async with s.post(url, json=body, headers=hdr, timeout=aiohttp.ClientTimeout(total=8)) as r:
            txt = await r.text()
            ms = (time.time() - t) * 1000
            if r.status != 200:
                return False, ms, None, f"HTTP {r.status}: {txt[:60]}"
            import json
            j = json.loads(txt)
            if not isinstance(j, list):
                j = [j]
            res = {x.get("id"): x for x in j if isinstance(x, dict)}
            bn = res.get(1, {})
            if "result" not in bn:
                return False, ms, None, f"blockNumber: {str(bn.get('error'))[:60]}"
            head = int(bn["result"], 16)
            call = res.get(2, {})
            if "result" not in call or call["result"] in ("0x", None):
                return False, ms, head, f"eth_call: {str(call.get('error'))[:60]}"
            return True, ms, head, ""
    except Exception as e:  # noqa
        return False, (time.time() - t) * 1000, None, f"{type(e).__name__}: {str(e)[:60]}"


def _stats(url: str, window_s: int) -> dict:
    now = time.time()
    rows = [x for x in _hist[url] if now - x[0] <= window_s]
    if not rows:
        return {"n": 0}
    oks = [x for x in rows if x[1]]
    lat = sorted(x[2] for x in oks)
    p = lambda q: (lat[min(len(lat) - 1, int(q * len(lat)))] if lat else None)  # noqa
    return {"n": len(rows), "uptime": round(100 * len(oks) / len(rows), 2), "p50_ms": round(p(0.5)) if lat else None,
            "p95_ms": round(p(0.95)) if lat else None, "max_ms": round(lat[-1]) if lat else None}


def _decide(heads: dict[str, int | None]) -> None:
    """Primary wins unless it is stale: more than 120 blocks behind the best head we can see, or unreachable.
    A syncing node answers requests happily while serving blocks from an hour ago, which would quietly starve
    the index — this is why the choice is made on head distance, not on whether the port is open."""
    from . import insider
    best = max([h for h in heads.values() if h], default=0)
    ph = heads.get(PRIMARY)
    lag = (best - ph) if (ph and best) else 10 ** 6
    insider.set_node_state(bool(ph) and lag <= 120, int(lag))


async def monitor_loop():
    global _last_lat_alert
    await asyncio.sleep(15)
    log.info("rpc monitor: %s", [(n, u) for n, u in ENDPOINTS])
    async with aiohttp.ClientSession() as s:
        while True:
            try:
                res = await asyncio.gather(*[_probe(s, u) for _, u in ENDPOINTS])
                now = time.time()
                heads = [h for (_, _, h, _) in res if h]
                best = max(heads) if heads else None
                _decide({u: h for (_, u), (_, _, h, _) in zip(ENDPOINTS, res)})
                for (name, url), (ok, ms, head, err) in zip(ENDPOINTS, res):
                    st = _state[url]
                    # a node that answers but sits > 120 blocks (~1-2 min) behind the freshest endpoint is effectively down
                    stale = ok and best is not None and head is not None and best - head > 120
                    if stale:
                        ok, err = False, f"head {head} is {best - head} blocks behind"
                    _hist[url].append((now, ok, ms, head))
                    if ok:
                        if st["down_since"] is not None:
                            dur = int(now - st["down_since"])
                            if url == PRIMARY:
                                await _tg(f"🟢 <b>PRIMARY NODE BACK</b> {PRIMARY}\nwas down {dur // 60} min {dur % 60} s · head {head} · {ms:.0f} ms")
                            elif st["alerted"]:
                                await _tg(f"🟢 backup RPC back: {name} (down {dur // 60} min)")
                        st.update(fails=0, down_since=None, last_err="", alerted=False)
                    else:
                        st["fails"] += 1; st["last_err"] = err
                        if st["down_since"] is None and st["fails"] >= 3:
                            st["down_since"] = now - st["fails"] * INTERVAL
                            if url == PRIMARY:
                                st["alerted"] = True
                                others = [f"{n}: {'ok' if o else 'down'}" for (n, u_), (o, *_r) in zip(ENDPOINTS, res) if u_ != PRIMARY]
                                await _tg(f"🔴 <b>PRIMARY NODE DOWN</b> {PRIMARY}\n{err}\nbackups → {' · '.join(others)}\n"
                                          f"traffic is failing over to the public RPCs (rate-limited): expect slower index and quotes")
                        # backup: alert after 5 min continuous failure, once
                        if url != PRIMARY and st["down_since"] is not None and not st["alerted"] and now - st["down_since"] >= 300:
                            st["alerted"] = True
                            await _tg(f"🟠 backup RPC down 5 min: {name} — {err}")
                # primary latency
                p = _stats(PRIMARY, 300)
                if p.get("p95_ms") and p["p95_ms"] > 1500 and now - _last_lat_alert > 3600 and _state[PRIMARY]["down_since"] is None:
                    _last_lat_alert = now
                    await _tg(f"⚠️ primary node slow: p95 {p['p95_ms']} ms over 5 min (p50 {p['p50_ms']} ms)")
            except Exception as e:  # noqa
                log.warning("rpc monitor: %s", e)
            await asyncio.sleep(INTERVAL)


def snapshot() -> dict:
    now = time.time()
    out = []
    for name, url in ENDPOINTS:
        st = _state[url]
        last = _hist[url][-1] if _hist[url] else None
        out.append({"name": name, "url": url, "primary": url == PRIMARY,
                    "up": bool(last and last[1]), "down_since": st["down_since"], "last_err": st["last_err"],
                    "last_ms": round(last[2]) if last else None, "head": last[3] if last else None,
                    "m5": _stats(url, 300), "h1": _stats(url, 3600), "h24": _stats(url, 86400)})
    prim = next((x for x in out if x["primary"]), None)
    return {"ts": int(now), "primary_up": bool(prim and prim["up"]), "endpoints": out}


async def api_rpc_health(_req):
    return web.json_response(snapshot(), headers=API_CORS)


def check_line() -> tuple[bool, str]:
    """For the watchdog: FAIL while the primary is down; detail = one-line summary."""
    s = snapshot()
    parts = []
    for e in s["endpoints"]:
        h = e["h1"]
        parts.append(f"{e['name']} {'UP' if e['up'] else 'DOWN'} {e['last_ms'] or '-'}ms up1h {h.get('uptime', '-')}%")
    return s["primary_up"], " | ".join(parts)
