"""Insider alerts channel: real-time posts when a top-ranked Arc Insider wallet buys or sells.

Source: the chain-wide swap index (insider.py) + wallet_stats ranking (30d).
Posted to CFG.insider_channel_id (bot must be admin). One channel for now — gating comes later.

Anti-spam:
  * only wallets ranked TOP_N in the 30d board
  * min USD size per swap (MIN_BUY_USD / MIN_SELL_USD)
  * one alert per (wallet, token, side) per DEDUP_SEC
  * a CLUSTER alert when >= CLUSTER_N distinct insiders buy the same token within CLUSTER_SEC
  * on (re)start only swaps from the last LIVE_SEC are considered — no backlog flood
"""
from __future__ import annotations

import asyncio
import os
import logging
import time

import aiohttp
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import bindparam, text

from . import db
from .config import CFG
from .insider import RELAY_RPC, _symbol

log = logging.getLogger("insider-alerts")
bot = None  # set by main

TOP_N = int(__import__("os").getenv("INSIDER_ALERT_TOP", "20"))
MIN_BUY_USD = float(__import__("os").getenv("INSIDER_ALERT_MIN_BUY", "150"))
MIN_SELL_USD = float(__import__("os").getenv("INSIDER_ALERT_MIN_SELL", "150"))
DEDUP_SEC = 3600
CLUSTER_N = 3
CLUSTER_SEC = 1800
LIVE_SEC = 600
POLL_SEC = 3
RANK_TTL = 60

SNIPER = "https://t.me/ArcSniper_bot"
SITE = "https://arctools.fun"
SEL_TOTAL_SUPPLY = "0x18160ddd"

_rank: dict[str, dict] = {}
_rank_ts = 0.0
_supply_cache: dict[str, tuple[float, float]] = {}  # token -> (supply_tokens, ts)
_cluster: dict[str, dict[str, float]] = {}           # token -> {wallet: ts}
_cluster_sent: dict[str, float] = {}


# ---------------- persistence (survives redeploys) ----------------

async def _init():
    await db.execute(text(
        "CREATE TABLE IF NOT EXISTS insider_alerted (tx VARCHAR(80) NOT NULL, log_index INTEGER NOT NULL, "
        "wallet VARCHAR(64), token VARCHAR(64), side VARCHAR(4), ts BIGINT, PRIMARY KEY (tx, log_index))"))


async def _already_posted(tx: str, log_index: int) -> bool:
    r = await db.fetchone(text("SELECT 1 AS x FROM insider_alerted WHERE tx = :tx AND log_index = :li")
                          .bindparams(tx=tx, li=log_index))
    return bool(r)


async def _recent_dup(wallet: str, token: str, side: str, now: int) -> bool:
    r = await db.fetchone(text(
        "SELECT 1 AS x FROM insider_alerted WHERE wallet = :w AND token = :t AND side = :s AND ts > :c LIMIT 1"
    ).bindparams(w=wallet, t=token, s=side, c=now - DEDUP_SEC))
    return bool(r)


async def _mark(sw: dict, now: int):
    await db.execute(text(
        "INSERT INTO insider_alerted (tx, log_index, wallet, token, side, ts) VALUES (:tx, :li, :w, :t, :s, :ts) "
        "ON CONFLICT (tx, log_index) DO NOTHING"
    ).bindparams(tx=sw["tx"], li=sw["log_index"], w=sw["wallet"].lower(), t=sw["token"].lower(), s=sw["side"], ts=now))


# ---------------- helpers ----------------

def _fmt_usd(v: float) -> str:
    v = float(v or 0)
    if v >= 1_000_000:
        return f"${v / 1e6:.2f}M"
    if v >= 10_000:
        return f"${v / 1e3:.1f}K"
    if v >= 1_000:
        return f"${v:,.0f}"
    return f"${v:,.2f}"


def _fmt_num(v: float) -> str:
    v = float(v or 0)
    if v >= 1e9:
        return f"{v / 1e9:.2f}B"
    if v >= 1e6:
        return f"{v / 1e6:.2f}M"
    if v >= 1e3:
        return f"{v / 1e3:.1f}K"
    return f"{v:,.0f}"


def _fmt_price(p1m: float) -> str:
    """price1m = USDC per 1M tokens -> per-token price string."""
    p = float(p1m or 0) / 1e6
    if p <= 0:
        return "—"
    if p >= 1:
        return f"${p:,.4f}"
    import math
    digits = max(2, -int(math.floor(math.log10(p))) + 3)  # 4 significant digits, plain decimal
    return f"${p:.{digits}f}"


def _short(a: str) -> str:
    return f"{a[:6]}…{a[-4:]}"


async def _total_supply(token: str) -> float | None:
    now = time.time()
    c = _supply_cache.get(token)
    if c and now - c[1] < 6 * 3600:
        return c[0]
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(RELAY_RPC, headers={"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "X-Priority": "high"}, json={
                "id": 1, "jsonrpc": "2.0", "method": "eth_call",
                "params": [{"data": SEL_TOTAL_SUPPLY, "to": token}, "latest"],
            }, timeout=aiohttp.ClientTimeout(total=10)) as r:
                res = (await r.json()).get("result")
        if res and res != "0x":
            sup = int(res, 16) / 1e18
            _supply_cache[token] = (sup, now)
            return sup
    except Exception as e:  # noqa
        log.debug("totalSupply %s: %s", token, e)
    return None


RISING_N = int(__import__("os").getenv("INSIDER_ALERT_RISING", "10"))
RISING_MIN_CLOSED = 5
RISING_MIN_VOL = 500.0


async def _refresh_rank():
    """Alert pool = top-N by realized 30d PnL  +  'rising' wallets: best ROI% x win-rate that are not yet in top-N.
    Whales dominate absolute PnL; rising catches small, sharp wallets early — exactly what an inflow brings."""
    global _rank, _rank_ts
    if time.time() - _rank_ts < RANK_TTL:
        return
    rows = await db.fetchall(text(
        "SELECT wallet, pnl_total, pnl_pct, winrate, closed, trades, volume, best_symbol, best_pnl FROM wallet_stats "
        "WHERE range = '30d' ORDER BY pnl_total DESC LIMIT :n").bindparams(n=TOP_N))
    rank = {r["wallet"].lower(): {**dict(r), "rank": i + 1, "tier": "top"} for i, r in enumerate(rows)}
    rising = await db.fetchall(text(
        "SELECT wallet, pnl_total, pnl_pct, winrate, closed, trades, volume, best_symbol, best_pnl, "
        "       (COALESCE(pnl_pct,0) * COALESCE(winrate,0) / 100.0) AS score "
        "FROM wallet_stats WHERE range = '30d' AND closed >= :c AND volume >= :v AND pnl_total > 0 "
        "AND pnl_pct > 20 AND winrate >= 50 ORDER BY score DESC LIMIT :n"
    ).bindparams(c=RISING_MIN_CLOSED, v=RISING_MIN_VOL, n=RISING_N + TOP_N))
    k = 0
    for r in rising:
        w = r["wallet"].lower()
        if w in rank or k >= RISING_N:
            continue
        k += 1
        rank[w] = {**dict(r), "rank": k, "tier": "rising"}
    prev_top = set((await db.kv_get("insider_alert_top", "")).split(",")) - {""}
    _rank = rank
    _rank_ts = time.time()
    # NEW INSIDER: a wallet just entered the top-N — announce it (only once the first snapshot exists)
    cur_top = {w for w, v in rank.items() if v["tier"] == "top"}
    entrants = cur_top - prev_top
    if prev_top and len(entrants) <= 5:          # >5 at once = TOP_N reconfig / restart after outage, not real entrants
        for w in sorted(entrants, key=lambda x: rank[x]["rank"]):
            try:
                await _post_new_insider(w, rank[w])
            except Exception as e:  # noqa
                log.warning("new insider post: %s", e)
    if cur_top != prev_top:
        await db.kv_set("insider_alert_top", ",".join(sorted(cur_top)))


async def _post_new_insider(wallet: str, ins: dict):
    if int(ins.get("rank") or 99) > TOP_N:
        return
    best = f" · best trade ${ins['best_symbol']} {_pnl_str(float(ins['best_pnl'] or 0))}" if ins.get("best_symbol") else ""
    txt = "\n".join([
        f"<b>⭐ NEW INSIDER · #{ins['rank']}</b>",
        f"<code>{wallet}</code> just entered the top-{TOP_N} on Arc.",
        f"30d PnL {_pnl_str(float(ins['pnl_total'] or 0))} · ROI {float(ins['pnl_pct'] or 0):+.0f}% · "
        f"win-rate {float(ins['winrate'] or 0):.0f}% · {int(ins['closed'] or 0)} closed · vol {_fmt_usd(float(ins['volume'] or 0))}{best}",
        "",
        f"<a href='{CFG.explorer}/address/{wallet}'>wallet</a> · <a href='{SITE}/insiders'>leaderboard</a>",
        "<i>Its buys and sells will now be posted here. Ranking is recomputed every 2 minutes from the chain-wide index.</i>",
    ])
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Copy insider", url=f"{SNIPER}?start=copy_{wallet[2:]}"),
        InlineKeyboardButton(text="Leaderboard", url=f"{SITE}/insiders"),
    ]])
    await bot.send_message(CFG.insider_channel_id, txt, parse_mode="HTML", reply_markup=kb, disable_web_page_preview=True)
    log.info("new insider #%s %s", ins["rank"], wallet)


async def _position(wallet: str, token: str) -> dict:
    """Net position of the wallet in the token from the swap index (all time)."""
    r = await db.fetchone(text("""
        SELECT SUM(CASE WHEN side='buy' THEN tokens ELSE 0 END) AS bought,
               SUM(CASE WHEN side='sell' THEN tokens ELSE 0 END) AS sold,
               SUM(CASE WHEN side='buy' THEN usdc ELSE 0 END) AS cost,
               SUM(CASE WHEN side='sell' THEN usdc ELSE 0 END) AS proceeds,
               SUM(CASE WHEN side='buy' THEN 1 ELSE 0 END) AS buys,
               MIN(ts) AS first_ts
        FROM swaps WHERE wallet = :w AND token = :t""").bindparams(w=wallet, t=token))
    bought = float(r["bought"] or 0)
    sold = float(r["sold"] or 0)
    cost = float(r["cost"] or 0)
    avg = (cost / bought) if bought > 0 else 0.0  # USD per token
    return {
        "net": max(0.0, bought - sold), "bought": bought, "sold": sold, "cost": cost,
        "proceeds": float(r["proceeds"] or 0), "buys": int(r["buys"] or 0),
        "avg": avg, "first_ts": int(r["first_ts"] or 0),
    }


def _keyboard(token: str, wallet: str, symbol: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text=f"Snipe ${symbol}", url=f"{SNIPER}?start=ca_{token[2:]}"),
            InlineKeyboardButton(text="Copy insider", url=f"{SNIPER}?start=copy_{wallet[2:]}"),
        ],
        [
            InlineKeyboardButton(text="Chart", url=f"{SITE}/token/{token}#chart"),
            InlineKeyboardButton(text="Insider profile", url=f"{SITE}/insiders"),
        ],
    ])


def _pnl_str(v: float) -> str:
    sign = "+" if v >= 0 else "−"
    return f"{sign}{_fmt_usd(abs(v))}"


# ---------------- message builders ----------------

async def _build_alert(sw: dict, ins: dict) -> tuple[str, InlineKeyboardMarkup]:
    token, wallet, side = sw["token"], sw["wallet"], sw["side"]
    sym = (await _symbol(token)) or _short(token)
    supply = await _total_supply(token)
    price = float(sw["price1m"] or 0) / 1e6
    mcap = (supply * price) if (supply and price > 0) else None
    pos = await _position(wallet, token)

    tag = f"#{ins['rank']}" if ins.get("tier", "top") == "top" else f"RISING #{ins['rank']} · ROI {float(ins['pnl_pct'] or 0):+.0f}%"
    head = ("🟢 INSIDER BUY" if side == "buy" else "🔴 INSIDER SELL") + f" · {tag}"
    lines = [
        f"<b>{head}</b>",
        f"<b>${sym}</b>  {'+' if side == 'buy' else '−'}{_fmt_usd(sw['usdc'])}  ({_fmt_num(sw['tokens'])} tokens)",
        f"Price {_fmt_price(sw['price1m'])}" + (f" · MCAP {_fmt_usd(mcap)}" if mcap else "") + f" · {sw['venue']}",
        "",
        f"Insider <code>{_short(wallet)}</code> · 30d PnL {_pnl_str(float(ins['pnl_total'] or 0))}"
        f" · win-rate {float(ins['winrate'] or 0):.0f}% · {int(ins['closed'] or 0)} closed",
    ]
    if side == "buy":
        if pos["buys"] <= 1:
            lines.append(f"New position in ${sym} — first entry")
        else:
            lines.append(
                f"Adding: now holds {_fmt_num(pos['net'])} ${sym} (~{_fmt_usd(pos['net'] * price)}), "
                f"{pos['buys']} buys, avg {_fmt_price(pos['avg'] * 1e6)}")
    else:
        realized = ""
        if pos["avg"] > 0 and price > 0:
            realized = f" · {((price - pos['avg']) / pos['avg'] * 100):+.0f}% vs avg entry"
        left = "fully out" if pos["net"] * price < 5 else f"still holds {_fmt_num(pos['net'])} ${sym} (~{_fmt_usd(pos['net'] * price)})"
        lines.append(f"{left}{realized}")
    lines += [
        "",
        f"<a href='{CFG.explorer}/tx/{sw['tx']}'>tx</a> · "
        f"<a href='{SITE}/token/{token}#chart'>chart</a> · "
        f"<a href='{CFG.explorer}/address/{wallet}'>wallet</a>",
        f"<i>Not financial advice. Insiders are ranked by realized PnL on Arc — they can be wrong.</i>",
    ]
    return "\n".join(lines), _keyboard(token, wallet, sym)


async def _build_cluster(token: str, wallets: dict[str, float]) -> tuple[str, InlineKeyboardMarkup]:
    sym = (await _symbol(token)) or _short(token)
    ranks = sorted((_rank[w]["rank"] for w in wallets if w in _rank and _rank[w].get("tier") == "top"))
    r = await db.fetchone(text(
        "SELECT SUM(usdc) AS usd FROM swaps WHERE token = :t AND side='buy' AND ts > :s AND wallet IN :ws"
    ).bindparams(bindparam("ws", value=list(wallets), expanding=True)).bindparams(t=token, s=int(time.time()) - CLUSTER_SEC))
    usd = float(r["usd"] or 0) if r else 0.0
    txt = "\n".join([
        f"<b>🟢🟢🟢 INSIDER CLUSTER · ${sym}</b>",
        f"{len(wallets)} insiders bought ${sym} in the last {CLUSTER_SEC // 60} min"
        + (f" (ranks {', '.join('#' + str(x) for x in ranks)})" if ranks else "") + f" · total {_fmt_usd(usd)}",
        "",
        f"<a href='{SITE}/token/{token}#chart'>chart</a> · <a href='{SITE}/insiders'>leaderboard</a>",
        "<i>Several ranked wallets entering together is the strongest signal this channel emits. Still not advice.</i>",
    ])
    best = min(wallets, key=lambda w: _rank.get(w, {}).get("rank", 999))
    return txt, _keyboard(token, best, sym)


# ---------------- loop ----------------

async def alerts_loop():
    if not CFG.insider_channel_id:
        log.info("insider alerts disabled (INSIDER_CHANNEL_ID empty)")
        return
    await asyncio.sleep(15)  # let ingest/stats settle
    await _init()
    last_ts = int(time.time()) - LIVE_SEC
    log.info("insider alerts -> %s (top %s, min buy $%s)", CFG.insider_channel_id, TOP_N, MIN_BUY_USD)
    # one-off sample so the format can be reviewed without waiting for a live swap
    try:
        await _refresh_rank()
        if _rank and not await db.kv_get("insider_alert_sample_v1"):
            r = await db.fetchone(text(
                "SELECT tx, log_index, ts, wallet, token, side, usdc, tokens, price1m, venue FROM swaps "
                "WHERE side='buy' AND usdc >= :m AND wallet IN :ws ORDER BY ts DESC LIMIT 1"
            ).bindparams(bindparam("ws", value=list(_rank), expanding=True)).bindparams(m=MIN_BUY_USD))
            if r:
                sw = dict(r)
                txt, kb = await _build_alert(sw, _rank[sw["wallet"].lower()])
                age = int((time.time() - sw["ts"]) / 60)
                await bot.send_message(CFG.insider_channel_id, f"<b>SAMPLE ({age} min old swap)</b>\n\n" + txt,
                                       parse_mode="HTML", reply_markup=kb, disable_web_page_preview=True)
                await db.kv_set("insider_alert_sample_v1", "1")
    except Exception as e:  # noqa
        log.warning("insider alerts sample: %s", e)
    while True:
        try:
            await _refresh_rank()
            if not _rank:
                await asyncio.sleep(POLL_SEC)
                continue
            rows = await db.fetchall(text(
                "SELECT tx, log_index, ts, wallet, token, side, usdc, tokens, price1m, venue FROM swaps "
                "WHERE ts >= :s AND wallet IN :ws ORDER BY ts, log_index"
            ).bindparams(bindparam("ws", value=list(_rank), expanding=True)).bindparams(s=last_ts))
            now = int(time.time())
            for r in rows:
                sw = dict(r)
                if sw["ts"] < now - LIVE_SEC:
                    continue
                w, t, side = sw["wallet"].lower(), sw["token"].lower(), sw["side"]
                usd = float(sw["usdc"] or 0)
                if (side == "buy" and usd < MIN_BUY_USD) or (side == "sell" and usd < MIN_SELL_USD):
                    continue
                if await _already_posted(sw["tx"], sw["log_index"]):
                    continue
                if await _recent_dup(w, t, side, now):
                    await _mark(sw, now)          # swallowed by dedup — remember so it never resurfaces
                    continue
                await _mark(sw, now)              # mark BEFORE sending: a crash mid-send must not double post
                txt, kb = await _build_alert(sw, _rank[w])
                await bot.send_message(CFG.insider_channel_id, txt, parse_mode="HTML",
                                       reply_markup=kb, disable_web_page_preview=True)
                log.info("alert %s %s %s $%.0f (#%s)", side, t, w, usd, _rank[w]["rank"])
                # cluster tracking
                if side == "buy":
                    c = _cluster.setdefault(t, {})
                    c[w] = now
                    for k in [k for k, ts in c.items() if now - ts > CLUSTER_SEC]:
                        del c[k]
                    if len(c) >= CLUSTER_N and now - _cluster_sent.get(t, 0) > CLUSTER_SEC:
                        _cluster_sent[t] = now
                        ctxt, ckb = await _build_cluster(t, dict(c))
                        await bot.send_message(CFG.insider_channel_id, ctxt, parse_mode="HTML",
                                               reply_markup=ckb, disable_web_page_preview=True)
                await asyncio.sleep(0.5)
            if rows:
                last_ts = max(last_ts, int(rows[-1]["ts"]) - 60)  # small overlap; the DB table dedups
        except Exception as e:  # noqa
            log.warning("insider alerts: %s", e)
            await asyncio.sleep(5)
        await asyncio.sleep(POLL_SEC)
