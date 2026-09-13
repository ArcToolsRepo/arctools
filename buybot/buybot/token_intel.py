"""Per-token intelligence for the token page: chart markers, top traders, one wallet's position.

GET /api/token-events?token=&limit=14   → notable trades to draw on the chart (dev / insider / pro-wallet), anti-spam capped
GET /api/token-traders?token=&limit=25  → wallets ranked by PnL on this token (realized + unrealized at last price)
GET /api/token-position?token=&wallet=  → the same numbers for one wallet (the viewer's) + its trades on the token
"""
from __future__ import annotations

import logging
import time

from aiohttp import web
from sqlalchemy import text

from . import db

log = logging.getLogger("token_intel")
CORS = {"Access-Control-Allow-Origin": "*"}
PRO_WINRATE = 75.0
PRO_MIN_CLOSED = 5
_cache: dict[str, tuple[float, object]] = {}


def _tok(req: web.Request) -> str | None:
    t = (req.query.get("token") or "").lower()
    return t if t.startswith("0x") and len(t) == 42 else None


async def _swaps(token: str) -> list[dict]:
    c = _cache.get("sw:" + token)
    if c and time.time() - c[0] < 45:
        return c[1]  # type: ignore[return-value]
    rows = await db.fetchall(text("SELECT tx, ts, wallet, side, usdc, tokens, price1m FROM swaps WHERE token = :t ORDER BY ts, log_index").bindparams(t=token))
    out = [dict(r) for r in rows]
    _cache["sw:" + token] = (time.time(), out)
    return out


async def _wallet_kinds(token: str) -> tuple[set[str], dict[str, int], dict[str, float]]:
    """dev wallets, insider rank per wallet (top-100 30d), winrate of 'pro' wallets (>=75% on >=5 closed, 30d)."""
    devs = {r["dev"].lower() for r in await db.fetchall(text("SELECT dev FROM token_dev WHERE token = :t").bindparams(t=token)) if r["dev"]}
    ins = {r["wallet"].lower(): int(r["rank"]) for r in await db.fetchall(text(
        "SELECT wallet, rank FROM (SELECT wallet, ROW_NUMBER() OVER (ORDER BY pnl_total DESC) AS rank FROM wallet_stats WHERE range='30d' AND bot_suspect = 0) x WHERE rank <= 100"))}
    pro = {r["wallet"].lower(): float(r["winrate"]) for r in await db.fetchall(text(
        "SELECT wallet, winrate FROM wallet_stats WHERE range='30d' AND winrate >= :w AND closed >= :c AND bot_suspect = 0").bindparams(w=PRO_WINRATE, c=PRO_MIN_CLOSED))}
    return devs, ins, pro


async def token_events(token: str, limit: int, since: int = 0) -> dict:
    swaps = [s for s in await _swaps(token) if int(s["ts"]) >= since] if since else await _swaps(token)
    devs, ins, pro = await _wallet_kinds(token)
    ev: list[dict] = []
    for s in swaps:
        w = s["wallet"].lower()
        if w in devs:
            kind, meta = "dev", None
        elif w in ins:
            kind, meta = "insider", ins[w]
        elif w in pro:
            kind, meta = "pro", round(pro[w])
        else:
            continue
        ev.append({"ts": int(s["ts"]), "side": s["side"], "usdc": float(s["usdc"] or 0), "wallet": w, "kind": kind, "meta": meta, "tx": s["tx"]})
    # merge the same wallet+side within 90 s (bots split fills) so one decision = one badge
    merged: list[dict] = []
    for e in ev:
        m = merged[-1] if merged else None
        if m and m["wallet"] == e["wallet"] and m["side"] == e["side"] and e["ts"] - m["ts"] <= 90:
            m["usdc"] += e["usdc"]; m["n"] = m.get("n", 1) + 1
        else:
            merged.append({**e, "n": 1})
    # anti-spam: every dev event (they are the signal), then the biggest insider/pro trades until `limit`
    dev_all = [e for e in merged if e["kind"] == "dev"]
    dev_cap = max(4, limit // 2)
    if len(dev_all) > dev_cap:
        # a chatty deployer would flood the chart: keep the biggest fills (sells first) plus the two most recent
        recent = dev_all[-2:]
        big = sorted((e for e in dev_all[:-2]), key=lambda e: (e["side"] != "sell", -e["usdc"]))[: dev_cap - 2]
        dev_all = sorted({id(e): e for e in big + recent}.values(), key=lambda e: e["ts"])
    rest = sorted((e for e in merged if e["kind"] != "dev" and e["usdc"] >= 20), key=lambda e: -e["usdc"])
    keep = dev_all + rest[: max(4, limit - len(dev_all))]
    # KOL mentions are rare and high-signal → always on the chart (own kind, not counted against the trade cap)
    try:
        from .kols import token_mentions
        for m in await token_mentions(token, since, 40):
            keep.append({"ts": int(m["ts"]), "side": "buy", "usdc": float(m.get("likes") or 0), "wallet": m["kol"], "kind": "kol", "meta": int(m.get("followers") or 0), "tx": m["url"], "n": 1, "text": (m.get("text") or "")[:140], "avatar": m.get("avatar") or "", "name": m.get("name") or ""})
    except Exception as e:  # noqa
        log.debug("kol mentions for chart: %s", e)
    keep.sort(key=lambda e: e["ts"])
    return {"token": token, "events": keep, "total": len(merged), "devs": sorted(devs), "insiders_seen": len({e["wallet"] for e in merged if e["kind"] == "insider"}),
            "pros_seen": len({e["wallet"] for e in merged if e["kind"] == "pro"})}


def _positions(swaps: list[dict], last_price1m: float) -> dict[str, dict]:
    """avg-cost PnL per wallet on one token. price1m = USDC per 1M tokens."""
    pos: dict[str, dict] = {}
    for s in swaps:
        w = s["wallet"].lower()
        p = pos.setdefault(w, {"wallet": w, "bought": 0.0, "sold": 0.0, "tok": 0.0, "cost": 0.0, "realized": 0.0, "buys": 0, "sells": 0, "first_ts": int(s["ts"]), "last_ts": int(s["ts"])})
        usdc = float(s["usdc"] or 0); tk = float(s["tokens"] or 0)
        p["last_ts"] = int(s["ts"])
        if s["side"] == "buy":
            p["bought"] += usdc; p["tok"] += tk; p["cost"] += usdc; p["buys"] += 1
        else:
            p["sold"] += usdc; p["sells"] += 1
            if p["tok"] > 0:
                avg = p["cost"] / p["tok"] if p["tok"] else 0
                sell_tk = min(tk, p["tok"])
                p["realized"] += usdc - avg * sell_tk
                p["cost"] -= avg * sell_tk
                p["tok"] -= sell_tk
            else:
                p["realized"] += usdc   # tokens acquired outside indexed swaps (transfers/airdrop) → pure proceeds
    for p in pos.values():
        p["tok"] = max(0.0, p["tok"])
        p["value"] = p["tok"] * last_price1m / 1e6
        p["unrealized"] = p["value"] - p["cost"] if p["tok"] > 0 else 0.0
        p["pnl"] = p["realized"] + p["unrealized"]
        p["avg"] = (p["cost"] / p["tok"] * 1e6) if p["tok"] > 0 else None   # USDC per 1M tokens, comparable to price1m
        for k in ("bought", "sold", "tok", "cost", "realized", "value", "unrealized", "pnl"):
            p[k] = round(p[k], 4)
    return pos


async def token_traders(token: str, limit: int) -> dict:
    swaps = await _swaps(token)
    if not swaps:
        return {"token": token, "traders": [], "price1m": 0}
    last = float(swaps[-1]["price1m"] or 0)
    pos = _positions(swaps, last)
    devs, ins, pro = await _wallet_kinds(token)
    rows = sorted(pos.values(), key=lambda p: -p["pnl"])
    out = []
    for p in rows[:limit]:
        w = p["wallet"]
        out.append({**p, "dev": w in devs, "insider_rank": ins.get(w), "winrate": round(pro[w]) if w in pro else None})
    return {"token": token, "price1m": last, "traders": out, "wallets": len(pos)}


async def api_token_events(req: web.Request):
    t = _tok(req)
    if not t:
        return web.json_response({"error": "token"}, status=400, headers=CORS)
    lim = min(40, max(4, int(req.query.get("limit", "14"))))
    since = int(req.query.get("since", "0") or 0)
    since = since - since % 900 if since else 0   # 15-min buckets keep the cache useful
    key = f"ev:{t}:{lim}:{since}"
    c = _cache.get(key)
    if not c or time.time() - c[0] > 30:
        c = (time.time(), await token_events(t, lim, since)); _cache[key] = c
    return web.json_response(c[1], headers={**CORS, "Cache-Control": "public, max-age=20"})


async def api_token_traders(req: web.Request):
    t = _tok(req)
    if not t:
        return web.json_response({"error": "token"}, status=400, headers=CORS)
    lim = min(100, max(5, int(req.query.get("limit", "25"))))
    key = f"tr:{t}:{lim}"
    c = _cache.get(key)
    if not c or time.time() - c[0] > 45:
        c = (time.time(), await token_traders(t, lim)); _cache[key] = c
    return web.json_response(c[1], headers={**CORS, "Cache-Control": "public, max-age=30"})


async def api_token_position(req: web.Request):
    t = _tok(req)
    w = (req.query.get("wallet") or "").lower()
    if not t or not (w.startswith("0x") and len(w) == 42):
        return web.json_response({"error": "token/wallet"}, status=400, headers=CORS)
    swaps = await _swaps(t)
    last = float(swaps[-1]["price1m"] or 0) if swaps else 0.0
    mine = [s for s in swaps if s["wallet"].lower() == w]
    p = _positions(mine, last).get(w)
    trades = [{"tx": s["tx"], "ts": int(s["ts"]), "side": s["side"], "usdc": float(s["usdc"] or 0), "tokens": float(s["tokens"] or 0), "price1m": float(s["price1m"] or 0)} for s in mine[-40:]][::-1]
    return web.json_response({"token": t, "wallet": w, "price1m": last, "position": p, "trades": trades}, headers={**CORS, "Cache-Control": "no-store"})


def register(app: web.Application):
    app.router.add_get("/api/token-events", api_token_events)
    app.router.add_get("/api/token-traders", api_token_traders)
    app.router.add_get("/api/token-position", api_token_position)
