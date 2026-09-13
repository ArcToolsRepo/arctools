"""Per-user alert rules, evaluated every 10 s against the chain-wide index. DM on trigger.

Rule types (args):
  price   <token> <pct> <minutes>   price of token moves by pct (negative = drop) within a rolling window
  whale   <min_usd>                 any swap >= min_usd anywhere on Arc
  token   <token> <min_usd>         any swap >= min_usd in a specific token
  bridge  <min_usd>                 CCTP inflow >= min_usd
  cluster <n> <minutes>             >= n distinct top-100 insiders buy the same token within minutes
  balance <min_usd>                 a known wallet's native USDC balance jumps by >= min_usd between snapshots
  fresh   <min_usd>                 a wallet's FIRST ever swap on Arc is a buy >= min_usd
Commands: /alert <type> <args…>, /alerts, /delalert <id>. Deep-link: /start rule_<type>_<arg1>_<arg2>…
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiohttp import web
from sqlalchemy import text

from . import db
from .config import CFG
from .insider import _symbol

log = logging.getLogger("rules")
router = Router()
bot = None

RULES_FREE = int(os.getenv("RULES_FREE", "5"))
COOLDOWN = {"price": 3600, "whale": 0, "token": 0, "bridge": 0, "cluster": 1800, "balance": 0, "fresh": 0}
SITE = "https://arctools.fun"
SNIPER = "https://t.me/ArcSniper_bot"
API_CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type"}
TYPES = {"price", "whale", "token", "bridge", "cluster", "balance", "fresh"}


async def init_tables():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS alert_rules (
        id SERIAL PRIMARY KEY, tg_id BIGINT NOT NULL, type VARCHAR(12) NOT NULL, token VARCHAR(64),
        num1 DOUBLE PRECISION, num2 DOUBLE PRECISION, created_at BIGINT, last_fired BIGINT DEFAULT 0, fires INTEGER DEFAULT 0)"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS rule_sent (
        rule_id INTEGER NOT NULL, key VARCHAR(120) NOT NULL, ts BIGINT, PRIMARY KEY (rule_id, key))"""))


def _is_addr(s: str) -> bool:
    s = (s or "").lower()
    return s.startswith("0x") and len(s) == 42 and all(c in "0123456789abcdef" for c in s[2:])


def _fmt(v: float) -> str:
    v = float(v or 0)
    return f"${v / 1e6:.2f}M" if v >= 1e6 else f"${v / 1e3:.1f}K" if v >= 1e4 else (f"${v:,.0f}" if v >= 1000 else f"${v:,.2f}")


def _short(a: str) -> str:
    return f"{a[:6]}…{a[-4:]}"


def parse_rule(parts: list[str]) -> tuple[dict | None, str]:
    """-> ({type, token, num1, num2}, error)"""
    if not parts or parts[0].lower() not in TYPES:
        return None, ("Usage:\n<code>/alert price 0xTOKEN -30 60</code> — token drops 30% within 60 min\n"
                      "<code>/alert token 0xTOKEN 500</code> — any swap ≥ $500 in that token\n"
                      "<code>/alert whale 5000</code> — any swap ≥ $5,000 on Arc\n"
                      "<code>/alert bridge 20000</code> — CCTP inflow ≥ $20,000\n"
                      "<code>/alert cluster 3 30</code> — 3+ insiders buy one token within 30 min\n"
                      "<code>/alert balance 25000</code> — a wallet balance jumps ≥ $25,000\n"
                      "<code>/alert fresh 1000</code> — a brand-new wallet's first buy ≥ $1,000")
    t = parts[0].lower()
    try:
        if t == "price":
            tok, pct, mins = parts[1].lower(), float(parts[2]), float(parts[3]) if len(parts) > 3 else 60
            if not _is_addr(tok) or pct == 0:
                raise ValueError
            return {"type": t, "token": tok, "num1": pct, "num2": max(5, min(1440, mins))}, ""
        if t == "token":
            tok, m = parts[1].lower(), float(parts[2]) if len(parts) > 2 else 100
            if not _is_addr(tok):
                raise ValueError
            return {"type": t, "token": tok, "num1": max(1, m), "num2": None}, ""
        if t == "cluster":
            n, mins = int(parts[1]) if len(parts) > 1 else 3, float(parts[2]) if len(parts) > 2 else 30
            return {"type": t, "token": None, "num1": max(2, min(20, n)), "num2": max(5, min(1440, mins))}, ""
        m = float(parts[1]) if len(parts) > 1 else 1000
        return {"type": t, "token": None, "num1": max(1, m), "num2": None}, ""
    except Exception:  # noqa
        return None, "Could not parse that rule. Send /alert for the format."


def describe(r: dict) -> str:
    t = r["type"]
    if t == "price":
        return f"${r.get('symbol') or _short(r['token'])} {'drops' if r['num1'] < 0 else 'pumps'} {abs(r['num1']):.0f}% within {int(r['num2'])} min"
    if t == "token":
        return f"any swap ≥ {_fmt(r['num1'])} in ${r.get('symbol') or _short(r['token'])}"
    if t == "whale":
        return f"any swap ≥ {_fmt(r['num1'])} on Arc"
    if t == "bridge":
        return f"CCTP inflow ≥ {_fmt(r['num1'])}"
    if t == "cluster":
        return f"{int(r['num1'])}+ insiders buy one token within {int(r['num2'])} min"
    if t == "balance":
        return f"a wallet balance jumps ≥ {_fmt(r['num1'])}"
    return f"a fresh wallet's first buy ≥ {_fmt(r['num1'])}"


async def add_rule(m: Message, parts: list[str]):
    rule, err = parse_rule(parts)
    if not rule:
        return await m.answer(err, parse_mode="HTML")
    cnt = await db.fetchone(text("SELECT COUNT(*) AS n FROM alert_rules WHERE tg_id = :t").bindparams(t=m.from_user.id))
    if int(cnt["n"] or 0) >= RULES_FREE:
        return await m.answer(f"Free tier: {RULES_FREE} rules. Remove one with <code>/delalert ID</code> (see /alerts). More with $ARCT staking soon.", parse_mode="HTML")
    await db.execute(text(
        "INSERT INTO alert_rules (tg_id, type, token, num1, num2, created_at) VALUES (:t, :ty, :tok, :n1, :n2, :c)"
    ).bindparams(t=m.from_user.id, ty=rule["type"], tok=rule["token"], n1=rule["num1"], n2=rule["num2"], c=int(time.time())))
    if rule["token"]:
        rule["symbol"] = await _symbol(rule["token"])
    await m.answer(f"🔔 Rule armed: <b>{describe(rule)}</b>\nYou will get a DM when it triggers. /alerts lists your rules.", parse_mode="HTML")


@router.message(Command("alert"))
async def cmd_alert(m: Message):
    if m.chat.type != "private":
        return await m.answer("Use /alert in a private chat with me.")
    await add_rule(m, (m.text or "").split()[1:])


@router.message(Command("alerts"))
async def cmd_alerts(m: Message):
    rows = await db.fetchall(text("SELECT * FROM alert_rules WHERE tg_id = :t ORDER BY id").bindparams(t=m.from_user.id))
    if not rows:
        return await m.answer("No rules yet. Send /alert for the format, or build one at arctools.fun/intel.")
    lines = [f"🔔 <b>Your rules ({len(rows)}/{RULES_FREE})</b>"]
    for r in rows:
        d = dict(r)
        if d["token"]:
            d["symbol"] = await _symbol(d["token"])
        lines.append(f"#{d['id']} · {describe(d)} · fired {d['fires'] or 0}x")
    lines.append("\nRemove: <code>/delalert ID</code>")
    await m.answer("\n".join(lines), parse_mode="HTML")


@router.message(Command("delalert"))
async def cmd_delalert(m: Message):
    parts = (m.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        return await m.answer("Usage: <code>/delalert ID</code>", parse_mode="HTML")
    await db.execute(text("DELETE FROM alert_rules WHERE tg_id = :t AND id = :i").bindparams(t=m.from_user.id, i=int(parts[1])))
    await m.answer("Removed.")


# ---------------- evaluator ----------------

async def _fire(rule: dict, key: str, txt: str, token: str | None = None, wallet: str | None = None):
    now = int(time.time())
    dup = await db.fetchone(text("SELECT 1 AS x FROM rule_sent WHERE rule_id = :r AND key = :k").bindparams(r=rule["id"], k=key))
    if dup:
        return
    if COOLDOWN.get(rule["type"], 0) and now - int(rule.get("last_fired") or 0) < COOLDOWN[rule["type"]]:
        return
    await db.execute(text("INSERT INTO rule_sent (rule_id, key, ts) VALUES (:r, :k, :ts) ON CONFLICT DO NOTHING").bindparams(r=rule["id"], k=key, ts=now))
    await db.execute(text("UPDATE alert_rules SET last_fired = :ts, fires = COALESCE(fires, 0) + 1 WHERE id = :r").bindparams(ts=now, r=rule["id"]))
    btns = []
    if token:
        sym = await _symbol(token)
        btns.append(InlineKeyboardButton(text=f"Snipe ${sym or _short(token)}", url=f"{SNIPER}?start=ca_{token[2:]}"))
        btns.append(InlineKeyboardButton(text="Chart", url=f"{SITE}/token/{token}"))
    if wallet:
        btns.append(InlineKeyboardButton(text="Watch wallet", url=f"https://t.me/{CFG.bot_username}?start=watch_{wallet[2:]}"))
    kb = InlineKeyboardMarkup(inline_keyboard=[btns]) if btns else None
    try:
        await bot.send_message(int(rule["tg_id"]), txt, parse_mode="HTML", reply_markup=kb, disable_web_page_preview=True)
    except Exception as e:  # noqa
        log.warning("rule dm %s: %s", rule["tg_id"], e)


async def evaluate_once(since: int):
    rules = [dict(r) for r in await db.fetchall(text("SELECT * FROM alert_rules"))]
    if not rules:
        return
    now = int(time.time())
    by = {}
    for r in rules:
        by.setdefault(r["type"], []).append(r)

    # swaps since cursor (shared by whale/token/fresh)
    swaps = [dict(x) for x in await db.fetchall(text(
        "SELECT tx, log_index, ts, wallet, token, side, usdc, price1m, venue FROM swaps WHERE ts >= :s AND usdc >= 1 ORDER BY ts"
    ).bindparams(s=since))]
    if swaps:
        syms: dict[str, str] = {}

        async def sym(t):
            if t not in syms:
                syms[t] = (await _symbol(t)) or _short(t)
            return syms[t]

        for sw in swaps:
            for r in by.get("whale", []):
                if sw["usdc"] >= r["num1"]:
                    await _fire(r, f"{sw['tx']}:{sw['log_index']}",
                                f"🐋 <b>WHALE {sw['side'].upper()}</b> {_fmt(sw['usdc'])} of ${await sym(sw['token'])} · <code>{_short(sw['wallet'])}</code> · {sw['venue']}\n"
                                f"<a href='{CFG.explorer}/tx/{sw['tx']}'>tx</a>", token=sw["token"], wallet=sw["wallet"])
            for r in by.get("token", []):
                if sw["token"].lower() == (r["token"] or "").lower() and sw["usdc"] >= r["num1"]:
                    await _fire(r, f"{sw['tx']}:{sw['log_index']}",
                                f"🔔 <b>{sw['side'].upper()} {_fmt(sw['usdc'])}</b> in ${await sym(sw['token'])} · <code>{_short(sw['wallet'])}</code> · {sw['venue']}\n"
                                f"<a href='{CFG.explorer}/tx/{sw['tx']}'>tx</a>", token=sw["token"], wallet=sw["wallet"])
            if by.get("fresh") and sw["side"] == "buy":
                if sw["usdc"] >= min(r["num1"] for r in by["fresh"]):
                    prev = await db.fetchone(text("SELECT COUNT(*) AS n FROM swaps WHERE wallet = :w AND ts < :t").bindparams(w=sw["wallet"], t=sw["ts"]))
                    if int(prev["n"] or 0) == 0:
                        for r in by["fresh"]:
                            if sw["usdc"] >= r["num1"]:
                                await _fire(r, f"{sw['tx']}:{sw['log_index']}",
                                            f"🆕 <b>FRESH WALLET</b> first ever swap: buys {_fmt(sw['usdc'])} of ${await sym(sw['token'])} · <code>{sw['wallet']}</code>\n"
                                            f"<a href='{CFG.explorer}/tx/{sw['tx']}'>tx</a>", token=sw["token"], wallet=sw["wallet"])

    # price rules: compare latest price vs price at (now - window)
    for r in by.get("price", []):
        t = r["token"]
        last = await db.fetchone(text("SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 AND usdc >= 0.5 ORDER BY ts DESC LIMIT 1").bindparams(t=t))
        ref = await db.fetchone(text("SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 AND usdc >= 0.5 AND ts <= :c ORDER BY ts DESC LIMIT 1").bindparams(t=t, c=now - int(r["num2"]) * 60))
        if last and ref and float(ref["price1m"]) > 0:
            chg = (float(last["price1m"]) - float(ref["price1m"])) / float(ref["price1m"]) * 100
            if (r["num1"] < 0 and chg <= r["num1"]) or (r["num1"] > 0 and chg >= r["num1"]):
                await _fire(r, f"price:{now // 3600}",
                            f"📉 <b>${await _symbol(t) or _short(t)} {chg:+.1f}%</b> in {int(r['num2'])} min (rule: {r['num1']:+.0f}%)", token=t)

    # bridge inflows
    for r in by.get("bridge", []):
        rows = await db.fetchall(text("SELECT tx, log_index, ts, recipient, amount, source_domain FROM bridge_mints WHERE direction='in' AND ts >= :s AND amount >= :m").bindparams(s=since, m=r["num1"]))
        for b in rows:
            await _fire(r, f"{b['tx']}:{b['log_index']}",
                        f"🌉 <b>BRIDGE IN {_fmt(b['amount'])}</b> → <code>{b['recipient']}</code>\n<a href='{CFG.explorer}/tx/{b['tx']}'>tx</a>", wallet=b["recipient"])

    # cluster: distinct top-100 insiders buying same token within window
    for r in by.get("cluster", []):
        rows = await db.fetchall(text("""
            WITH top AS (SELECT wallet FROM wallet_stats WHERE range='30d' ORDER BY pnl_total DESC LIMIT 100)
            SELECT s.token, COUNT(DISTINCT s.wallet) AS n, SUM(s.usdc) AS usd FROM swaps s JOIN top t ON t.wallet = s.wallet
            WHERE s.side='buy' AND s.ts >= :s GROUP BY s.token HAVING COUNT(DISTINCT s.wallet) >= :n""").bindparams(s=now - int(r["num2"]) * 60, n=int(r["num1"])))
        for c in rows:
            await _fire(r, f"cluster:{c['token']}:{now // (int(r['num2']) * 60)}",
                        f"🟢🟢🟢 <b>{int(c['n'])} insiders</b> bought ${await _symbol(c['token']) or _short(c['token'])} in the last {int(r['num2'])} min · total {_fmt(c['usd'])}", token=c["token"])

    # balance jumps
    for r in by.get("balance", []):
        rows = await db.fetchall(text("SELECT wallet, ts, balance, delta FROM balance_hist WHERE ts >= :s AND ABS(delta) >= :m").bindparams(s=since, m=r["num1"]))
        for b in rows:
            await _fire(r, f"bal:{b['wallet']}:{b['ts']}",
                        f"💰 <b>BALANCE {'+' if b['delta'] >= 0 else '−'}{_fmt(abs(b['delta']))}</b> → now {_fmt(b['balance'])} USDC · <code>{b['wallet']}</code>", wallet=b["wallet"])


async def rules_loop():
    await asyncio.sleep(35)
    await init_tables()
    since = int(time.time()) - 120
    log.info("rules engine start")
    while True:
        try:
            t0 = int(time.time())
            await evaluate_once(since)
            since = t0 - 90   # overlap; rule_sent dedups
            await db.execute(text("DELETE FROM rule_sent WHERE ts < :c").bindparams(c=int(time.time()) - 3 * 86400))
        except Exception as e:  # noqa
            log.warning("rules loop: %s", e)
            await asyncio.sleep(5)
        await asyncio.sleep(10)


async def api_rule_types(_):
    return web.json_response({"types": sorted(TYPES), "free": RULES_FREE}, headers=API_CORS)


async def api_fresh(request: web.Request) -> web.Response:
    """Wallets whose first ever swap on Arc happened in the window, with that first buy."""
    hours = min(168, int(request.query.get("hours", "24")))
    min_usd = float(request.query.get("min_usd", "50"))
    rows = await db.fetchall(text("""
        WITH f AS (SELECT wallet, MIN(ts) AS first_ts FROM swaps GROUP BY wallet HAVING MIN(ts) > :s)
        SELECT s.wallet, s.ts, s.token, s.side, s.usdc, s.tx, sym.symbol,
               (SELECT COUNT(*) FROM swaps s2 WHERE s2.wallet = s.wallet) AS swaps,
               (SELECT SUM(usdc) FROM swaps s3 WHERE s3.wallet = s.wallet AND s3.side='buy') AS bought
        FROM f JOIN swaps s ON s.wallet = f.wallet AND s.ts = f.first_ts LEFT JOIN token_symbols sym ON sym.token = s.token
        WHERE s.usdc >= :m ORDER BY s.usdc DESC LIMIT 60""").bindparams(s=int(time.time()) - hours * 3600, m=min_usd))
    return web.json_response({"hours": hours, "rows": [dict(r) for r in rows]}, headers=API_CORS)


async def api_smart_flow(request: web.Request) -> web.Response:
    """GET /api/smart-flow?minutes=60 — per token: net USD flow of the top-100 insiders (buys − sells), how many bought
    and sold, latest action. Sorted by net inflow. minutes=0 → all-time. The Terminal's SMART column."""
    mins = int(request.query.get("minutes", "60")); mins = 0 if mins <= 0 else min(1440, mins)
    limit = min(300, int(request.query.get("limit", "150")))
    rows = await db.fetchall(text("""
        WITH top AS (SELECT wallet, ROW_NUMBER() OVER (ORDER BY pnl_total DESC) AS rank FROM wallet_stats WHERE range='30d' AND bot_suspect = 0 ORDER BY pnl_total DESC LIMIT 100)
        SELECT s.token, sym.symbol,
               SUM(CASE WHEN s.side='buy' THEN s.usdc ELSE -s.usdc END) AS net,
               SUM(CASE WHEN s.side='buy' THEN s.usdc ELSE 0 END) AS bought, SUM(CASE WHEN s.side='sell' THEN s.usdc ELSE 0 END) AS sold,
               COUNT(DISTINCT CASE WHEN s.side='buy' THEN s.wallet END) AS buyers, COUNT(DISTINCT CASE WHEN s.side='sell' THEN s.wallet END) AS sellers,
               MIN(t.rank) AS best_rank, MAX(s.ts) AS last_ts
        FROM swaps s JOIN top t ON t.wallet = s.wallet LEFT JOIN token_symbols sym ON sym.token = s.token
        WHERE s.ts >= :s GROUP BY s.token, sym.symbol ORDER BY 3 DESC LIMIT :l""").bindparams(s=(int(time.time()) - mins * 60) if mins else 0, l=limit))
    return web.json_response({"minutes": mins, "rows": [dict(r) for r in rows]}, headers={**API_CORS, "Cache-Control": "public, max-age=15"})


async def api_clusters(request: web.Request) -> web.Response:
    """Tokens bought by >= n distinct top-100 insiders within the window."""
    mins = min(1440, int(request.query.get("minutes", "120")))
    n = max(2, int(request.query.get("n", "2")))
    rows = await db.fetchall(text("""
        WITH top AS (SELECT wallet, ROW_NUMBER() OVER (ORDER BY pnl_total DESC) AS rank FROM wallet_stats WHERE range='30d' ORDER BY pnl_total DESC LIMIT 100)
        SELECT s.token, sym.symbol, COUNT(DISTINCT s.wallet) AS insiders, SUM(s.usdc) AS usd, MIN(t.rank) AS best_rank, MAX(s.ts) AS last_ts,
               STRING_AGG(DISTINCT CAST(t.rank AS TEXT), ',') AS ranks
        FROM swaps s JOIN top t ON t.wallet = s.wallet LEFT JOIN token_symbols sym ON sym.token = s.token
        WHERE s.side='buy' AND s.ts >= :s GROUP BY s.token, sym.symbol HAVING COUNT(DISTINCT s.wallet) >= :n
        ORDER BY COUNT(DISTINCT s.wallet) DESC, SUM(s.usdc) DESC LIMIT 30""").bindparams(s=int(time.time()) - mins * 60, n=n))
    return web.json_response({"minutes": mins, "rows": [dict(r) for r in rows]}, headers=API_CORS)
