"""Orders engine: take-profit / stop-loss / trailing stop / limit buy / deployer-dump guard.

* One row per order in `orders`. Position-bound orders (tp, sl, trail, guard) reference `position_id`;
  limit buys reference only the token.
* `orders_loop` (every 4 s): quotes each open position once (real exit value through the same router the
  sell will use), then evaluates all its orders. Sells go through sniper.execute_sell (turbo gas, fee, referral).
* Dump guard asks the ArcTools index (/api/dev-sells) whether the deployer or a launch-block wallet sold since
  the position was opened; above the user's threshold → sell 100 % immediately. Speed over confirmation.
* Per-user defaults (kv `prot:<tg_id>`, JSON): auto_tp (x, 0=off), auto_sl (% drop, 0=off), trail (% from peak,
  0=off), guard (0/1), guard_min_usd. `attach_defaults()` is called by execute_buy right after a fill.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import aiohttp
from sqlalchemy import (BigInteger, Column, Float, Integer, String, Table, Text, insert, select, update)

from . import db
from .pads import quote_token_usdc

log = logging.getLogger("orders")
notify = None  # set by main: async def notify(tg_id, text, markup=None)

INDEX_API = "https://bot-production-4200.up.railway.app"
POLL = 4

orders = Table("orders", db.meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("position_id", Integer, default=0),
    Column("token", String(64)),
    Column("symbol", String(32), default="?"),
    Column("kind", String(12)),            # tp | sl | trail | guard | limit_buy
    Column("trigger", Float, default=0),   # tp: multiple of cost; sl: % drop (e.g. 30); trail: % from peak; guard: min usd; limit_buy: max mcap usd (0 = price target in usdc/1e18 tokens)
    Column("sell_pct", Integer, default=100),
    Column("amount_usdc", Float, default=0),   # limit_buy size
    Column("hwm", Float, default=0),           # trailing: highest value seen (usdc)
    Column("status", String(12), default="active"),  # active | done | failed | cancelled
    Column("result", Text, default=""),
    Column("created_at", BigInteger),
)

DEFAULT_PROT = {"auto_tp": 0.0, "auto_sl": 0.0, "trail": 0.0, "guard": 1, "guard_min_usd": 50.0}


async def get_prot(tg_id: int) -> dict:
    raw = await db.kv_get(f"prot:{tg_id}", "")
    d = dict(DEFAULT_PROT)
    if raw:
        try:
            d.update(json.loads(raw))
        except Exception:  # noqa
            pass
    return d


async def set_prot(tg_id: int, **kw) -> dict:
    d = await get_prot(tg_id)
    d.update(kw)
    await db.kv_set(f"prot:{tg_id}", json.dumps(d))
    return d


async def add_order(tg_id: int, kind: str, token: str, symbol: str, trigger: float, position_id: int = 0,
                    sell_pct: int = 100, amount_usdc: float = 0.0) -> int:
    # one active order per (position, kind) — replacing keeps the panel simple
    if position_id:
        await db.execute(update(orders).where(
            (orders.c.position_id == position_id) & (orders.c.kind == kind) & (orders.c.status == "active")
        ).values(status="cancelled", result="replaced"))
    r = await db.execute(insert(orders).values(
        tg_id=tg_id, position_id=position_id, token=token, symbol=symbol or "?", kind=kind, trigger=float(trigger),
        sell_pct=int(sell_pct), amount_usdc=float(amount_usdc), hwm=0.0, status="active", created_at=int(time.time())))
    return int(r.inserted_primary_key[0]) if r.inserted_primary_key else 0


async def cancel_order(tg_id: int, order_id: int) -> None:
    await db.execute(update(orders).where((orders.c.id == order_id) & (orders.c.tg_id == tg_id) & (orders.c.status == "active"))
                     .values(status="cancelled", result="by user"))


async def position_orders(position_id: int) -> list[dict]:
    return await db.fetchall(select(orders).where((orders.c.position_id == position_id) & (orders.c.status == "active")))


async def user_limit_buys(tg_id: int) -> list[dict]:
    return await db.fetchall(select(orders).where((orders.c.tg_id == tg_id) & (orders.c.kind == "limit_buy") & (orders.c.status == "active")))


async def attach_defaults(tg_id: int, position: dict) -> list[str]:
    """Called right after a fill: create TP / SL / trailing / guard orders from the user's protection settings."""
    p = await get_prot(tg_id)
    made = []
    pid, tok, sym = position["id"], position["token"], position.get("symbol") or "?"
    if p.get("auto_tp"):
        await add_order(tg_id, "tp", tok, sym, float(p["auto_tp"]), pid); made.append(f"TP {p['auto_tp']:g}x")
    if p.get("auto_sl"):
        await add_order(tg_id, "sl", tok, sym, float(p["auto_sl"]), pid); made.append(f"SL −{p['auto_sl']:g}%")
    if p.get("trail"):
        await add_order(tg_id, "trail", tok, sym, float(p["trail"]), pid); made.append(f"trail {p['trail']:g}%")
    if int(p.get("guard", 1)):
        await add_order(tg_id, "guard", tok, sym, float(p.get("guard_min_usd") or 50), pid); made.append("dump guard")
    return made


def describe(o: dict) -> str:
    k = o["kind"]
    if k == "tp":
        return f"🎯 TP {o['trigger']:g}x → sell {o['sell_pct']}%"
    if k == "sl":
        return f"🛑 SL −{o['trigger']:g}% → sell {o['sell_pct']}%"
    if k == "trail":
        return f"📉 trailing {o['trigger']:g}% from peak → sell {o['sell_pct']}%" + (f" (peak {o['hwm']:.2f} USDC)" if o["hwm"] else "")
    if k == "guard":
        return f"🛡 dump guard: dev/bundle sells ≥ ${o['trigger']:g} → sell 100%"
    if k == "limit_buy":
        return f"🧲 limit buy {o['amount_usdc']:g} USDC when MC ≤ ${o['trigger']:,.0f}"
    return k


# ------------------------------------------------------------------ engine
async def _dev_sells(tokens: list[str], since: int) -> dict:
    if not tokens:
        return {}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{INDEX_API}/api/dev-sells", params={"tokens": ",".join(tokens), "since": since},
                             timeout=aiohttp.ClientTimeout(total=6)) as r:
                if r.status == 200:
                    return (await r.json()).get("rows") or {}
    except Exception as e:  # noqa
        log.debug("dev-sells: %s", e)
    return {}


SITE_API = "https://arctools.fun"


async def _token_mcap(token: str) -> float | None:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{SITE_API}/api/tokenpage", params={"ca": token}, timeout=aiohttp.ClientTimeout(total=8)) as r:
                if r.status == 200:
                    j = await r.json()
                    m = j.get("mcapUsd")
                    return float(m) if m else None
    except Exception:  # noqa
        pass
    return None


async def _fire_sell(o: dict, pos: dict, why: str) -> None:
    from . import sniper
    await db.execute(update(orders).where(orders.c.id == o["id"]).values(status="done", result=why))
    res = await sniper.execute_sell(o["tg_id"], pos, int(o["sell_pct"]), "turbo")
    ok = res.get("ok")
    if not ok:
        await db.execute(update(orders).where(orders.c.id == o["id"]).values(status="failed", result=f"{why} | {res.get('err')}"))
    else:
        # position closed → drop the other orders on it
        if int(o["sell_pct"]) >= 100:
            await db.execute(update(orders).where((orders.c.position_id == pos["id"]) & (orders.c.status == "active"))
                             .values(status="cancelled", result="position closed"))
    if notify:
        head = {"tp": "🎯 TAKE-PROFIT", "sl": "🛑 STOP-LOSS", "trail": "📉 TRAILING STOP", "guard": "🛡 DUMP GUARD"}.get(o["kind"], o["kind"])
        markup = None
        try:
            from .ui.keyboards import kb
            markup = kb([[("📊 Positions", "portfolio")]])
        except Exception:  # noqa
            pass
        await notify(o["tg_id"],
                     f"{head} fired on <b>{pos.get('symbol') or '?'}</b>\n{why}\n"
                     + (f"✅ sold {o['sell_pct']}% for <b>{res.get('usdc', 0):.2f} USDC</b>\n<code>{res.get('tx')}</code>"
                        if ok else f"❌ sell failed: {res.get('err')}"), markup)


async def _tick_positions() -> None:
    rows = await db.fetchall(select(orders).where((orders.c.status == "active") & (orders.c.position_id > 0)))
    if not rows:
        return
    by_pos: dict[int, list[dict]] = {}
    for o in rows:
        by_pos.setdefault(int(o["position_id"]), []).append(o)
    poss = {}
    for pid in by_pos:
        p = await db.fetchone(select(db.positions).where(db.positions.c.id == pid))
        if not p or p["status"] != "open" or (p["amount_tokens"] or 0) <= 0:
            await db.execute(update(orders).where((orders.c.position_id == pid) & (orders.c.status == "active"))
                             .values(status="cancelled", result="position closed"))
            continue
        poss[pid] = p
    # dump guard: one index call for all guarded tokens
    guard_orders = [o for o in rows if o["kind"] == "guard" and int(o["position_id"]) in poss]
    sells = {}
    if guard_orders:
        since = min(int(poss[int(o["position_id"])]["created_at"] or 0) for o in guard_orders)
        sells = await _dev_sells(sorted({o["token"].lower() for o in guard_orders}), since)
    for pid, p in poss.items():
        cur = None
        needs_quote = any(o["kind"] in ("tp", "sl", "trail") for o in by_pos[pid])
        if needs_quote:
            try:
                cur = await quote_token_usdc(p["token"], int(p["amount_tokens"]))
            except Exception:  # noqa
                cur = None
        cost = float(p["cost_usdc"] or 0)
        for o in by_pos[pid]:
            k = o["kind"]
            if k == "guard":
                d = sells.get(o["token"].lower())
                if not d:
                    continue
                # only sells AFTER we bought count (since is the min over guards; filter per position here)
                opened = int(p["created_at"] or 0)
                dev_after = d["dev_sold_usd"] if (d.get("dev_last_sell") or 0) >= opened else 0.0
                bun_after = d["bundle_sold_usd"] if (d.get("bundle_last_sell") or 0) >= opened else 0.0
                total = dev_after + bun_after
                if total >= float(o["trigger"] or 50):
                    who = []
                    if dev_after:
                        who.append(f"deployer sold ${dev_after:,.0f}")
                    if bun_after:
                        who.append(f"launch-block wallets sold ${bun_after:,.0f}")
                    await _fire_sell(o, p, " · ".join(who))
                    return  # position state changed; next tick re-reads
                continue
            if cur is None or cost <= 0:
                continue
            if k == "tp" and cur >= cost * float(o["trigger"]):
                await _fire_sell(o, p, f"value {cur:.2f} USDC ≥ {o['trigger']:g}× entry ({cost:.2f})")
                return
            if k == "sl" and cur <= cost * (1 - float(o["trigger"]) / 100):
                await _fire_sell(o, p, f"value {cur:.2f} USDC ≤ entry −{o['trigger']:g}% ({cost:.2f})")
                return
            if k == "trail":
                hwm = max(float(o["hwm"] or 0), cur)
                if hwm > float(o["hwm"] or 0):
                    await db.execute(update(orders).where(orders.c.id == o["id"]).values(hwm=hwm))
                # arm only once in profit (peak above entry) so a fresh buy isn't stopped out by the fee spread
                if hwm > cost and cur <= hwm * (1 - float(o["trigger"]) / 100):
                    await _fire_sell(o, p, f"value {cur:.2f} USDC fell {o['trigger']:g}% from peak {hwm:.2f}")
                    return


async def _tick_limit_buys() -> None:
    rows = await db.fetchall(select(orders).where((orders.c.status == "active") & (orders.c.kind == "limit_buy")))
    for o in rows:
        mc = await _token_mcap(o["token"])
        if mc is None or mc <= 0 or mc > float(o["trigger"]):
            continue
        from . import sniper, wallets as W
        from .pads import auto_pad
        u = await db.get_user(o["tg_id"])
        w = await W.active_wallet(o["tg_id"])
        if not w:
            await db.execute(update(orders).where(orders.c.id == o["id"]).values(status="failed", result="no wallet"))
            continue
        await db.execute(update(orders).where(orders.c.id == o["id"]).values(status="done", result=f"mc {mc:,.0f}"))
        try:
            pad, key = await auto_pad(o["token"])
            res = await sniper.execute_buy(o["tg_id"], o["token"], pad, float(o["amount_usdc"]), u["slippage"], "turbo", [w["id"]], curve=key)
            ok = any(r.get("ok") for r in res)
            if not ok:
                await db.execute(update(orders).where(orders.c.id == o["id"]).values(status="failed", result=str(res[0].get("err") if res else "?")[:200]))
            if notify:
                await notify(o["tg_id"], f"🧲 LIMIT BUY {'FILLED' if ok else 'FAILED'} on <b>{o['symbol']}</b>\nMC ${mc:,.0f} ≤ ${o['trigger']:,.0f} · {o['amount_usdc']:g} USDC\n"
                             + "\n".join(f"{'✅' if r.get('ok') else '❌'} <code>{r.get('tx', r.get('err'))}</code>" for r in res))
        except Exception as e:  # noqa
            await db.execute(update(orders).where(orders.c.id == o["id"]).values(status="failed", result=str(e)[:200]))


async def orders_loop():
    await asyncio.sleep(15)
    n = 0
    while True:
        try:
            await _tick_positions()
            n += 1
            if n % 3 == 0:          # limit buys every ~12 s (mcap is a cached index value anyway)
                await _tick_limit_buys()
        except Exception as e:  # noqa
            log.warning("orders loop: %s", e)
        await asyncio.sleep(POLL)
