"""Per-user wallet watchlist: /watch 0x… (or deep-link /start watch_<hex>) -> DM alerts on every swap of that wallet.
Backed by the chain-wide swap index. Free tier: WATCH_FREE wallets per user.
Also serves the intel API: whale feed, top movers, insider activity."""
from __future__ import annotations

import asyncio
import logging
import os
import time

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiohttp import web
from sqlalchemy import bindparam, text

from . import db
from .config import CFG
from .insider import _symbol

log = logging.getLogger("watchlist")
router = Router()
bot = None

WATCH_FREE = int(os.getenv("WATCH_FREE", "3"))
WATCH_MIN_USD = float(os.getenv("WATCH_MIN_USD", "1"))
SITE = "https://arctools.fun"
SNIPER = "https://t.me/ArcSniper_bot"
API_CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type"}


async def init_tables():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS watchlist (
        tg_id BIGINT NOT NULL, wallet VARCHAR(64) NOT NULL, label VARCHAR(48), min_usd DOUBLE PRECISION DEFAULT 1,
        created_at BIGINT, PRIMARY KEY (tg_id, wallet))"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS watchlist_wallet ON watchlist (wallet)"))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS watch_sent (
        tg_id BIGINT NOT NULL, tx VARCHAR(80) NOT NULL, log_index INTEGER NOT NULL, ts BIGINT,
        PRIMARY KEY (tg_id, tx, log_index))"""))


def _is_addr(s: str) -> bool:
    s = (s or "").strip().lower()
    return s.startswith("0x") and len(s) == 42 and all(c in "0123456789abcdef" for c in s[2:])


def _fmt(v: float) -> str:
    v = float(v or 0)
    if v >= 1e6:
        return f"${v / 1e6:.2f}M"
    if v >= 1e4:
        return f"${v / 1e3:.1f}K"
    return f"${v:,.0f}" if v >= 1000 else f"${v:,.2f}"


def _short(a: str) -> str:
    return f"{a[:6]}…{a[-4:]}"


async def _profile(w: str) -> str:
    r = await db.fetchone(text(
        "SELECT COUNT(*) AS n, SUM(usdc) AS vol, MIN(ts) AS first FROM swaps WHERE wallet = :w").bindparams(w=w))
    st = await db.fetchone(text(
        "SELECT pnl_total, winrate, closed FROM wallet_stats WHERE range = '30d' AND wallet = :w").bindparams(w=w))
    parts = [f"{int(r['n'] or 0)} swaps", f"{_fmt(r['vol'] or 0)} volume"]
    if r["first"]:
        parts.append(f"active {max(1, int((time.time() - int(r['first'])) / 86400))}d")
    if st:
        sign = "+" if (st["pnl_total"] or 0) >= 0 else "−"
        parts.append(f"30d PnL {sign}{_fmt(abs(st['pnl_total'] or 0))} · win-rate {float(st['winrate'] or 0):.0f}%")
    return " · ".join(parts)


async def add_watch(m: Message, wallet: str):
    wallet = wallet.lower()
    if not _is_addr(wallet):
        return await m.answer("Send a wallet address: <code>/watch 0x…</code>", parse_mode="HTML")
    rows = await db.fetchall(text("SELECT wallet FROM watchlist WHERE tg_id = :t").bindparams(t=m.from_user.id))
    if len(rows) >= WATCH_FREE and wallet not in {r["wallet"] for r in rows}:
        return await m.answer(
            f"Free tier tracks {WATCH_FREE} wallets. Remove one with <code>/unwatch 0x…</code> — "
            f"more slots unlock with $ARCT staking soon.", parse_mode="HTML")
    await db.execute(text(
        "INSERT INTO watchlist (tg_id, wallet, min_usd, created_at) VALUES (:t, :w, :m, :c) ON CONFLICT (tg_id, wallet) DO NOTHING"
    ).bindparams(t=m.from_user.id, w=wallet, m=WATCH_MIN_USD, c=int(time.time())))
    prof = await _profile(wallet)
    await m.answer(
        f"👁 Watching <code>{wallet}</code>\n{prof}\n\nYou will get a DM on every buy and sell of this wallet "
        f"(min ${WATCH_MIN_USD:g}). <code>/watching</code> lists your wallets, <code>/unwatch 0x…</code> removes one.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="Copy in sniper", url=f"{SNIPER}?start=copy_{wallet[2:]}"),
            InlineKeyboardButton(text="Portfolio", url=f"{SITE}/portfolio?w={wallet}"),
        ]]))


@router.message(Command("watch"))
async def cmd_watch(m: Message):
    if m.chat.type != "private":
        return await m.answer("Use /watch in a private chat with me.")
    parts = (m.text or "").split()
    await add_watch(m, parts[1] if len(parts) > 1 else "")


@router.message(Command("unwatch"))
async def cmd_unwatch(m: Message):
    parts = (m.text or "").split()
    if len(parts) < 2 or not _is_addr(parts[1]):
        return await m.answer("Usage: <code>/unwatch 0x…</code>", parse_mode="HTML")
    await db.execute(text("DELETE FROM watchlist WHERE tg_id = :t AND wallet = :w").bindparams(t=m.from_user.id, w=parts[1].lower()))
    await m.answer("Removed.")


@router.message(Command("watching"))
async def cmd_watching(m: Message):
    rows = await db.fetchall(text("SELECT wallet, min_usd FROM watchlist WHERE tg_id = :t ORDER BY created_at").bindparams(t=m.from_user.id))
    if not rows:
        return await m.answer("You are not watching any wallet. <code>/watch 0x…</code>", parse_mode="HTML")
    lines = [f"👁 <b>Watching {len(rows)}/{WATCH_FREE}</b>"]
    for r in rows:
        lines.append(f"<code>{r['wallet']}</code> — {await _profile(r['wallet'])}")
    await m.answer("\n".join(lines), parse_mode="HTML")


# ---------------- alert loop ----------------

async def alerts_loop():
    await asyncio.sleep(25)
    await init_tables()
    last_ts = int(time.time()) - 300
    log.info("watchlist alerts start")
    while True:
        try:
            watched = await db.fetchall(text("SELECT tg_id, wallet, min_usd FROM watchlist"))
            if watched:
                wallets = sorted({w["wallet"] for w in watched})
                rows = await db.fetchall(text(
                    "SELECT tx, log_index, ts, wallet, token, side, usdc, tokens, price1m, venue FROM swaps "
                    "WHERE ts >= :s AND wallet IN :ws ORDER BY ts, log_index"
                ).bindparams(bindparam("ws", value=wallets, expanding=True)).bindparams(s=last_ts))
                now = int(time.time())
                by_wallet: dict[str, list] = {}
                for w in watched:
                    by_wallet.setdefault(w["wallet"], []).append(w)
                for r in rows:
                    sw = dict(r)
                    if sw["ts"] < now - 600:
                        continue
                    for w in by_wallet.get(sw["wallet"].lower(), []):
                        if float(sw["usdc"] or 0) < float(w["min_usd"] or 0):
                            continue
                        dup = await db.fetchone(text(
                            "SELECT 1 AS x FROM watch_sent WHERE tg_id = :t AND tx = :tx AND log_index = :li"
                        ).bindparams(t=w["tg_id"], tx=sw["tx"], li=sw["log_index"]))
                        if dup:
                            continue
                        await db.execute(text(
                            "INSERT INTO watch_sent (tg_id, tx, log_index, ts) VALUES (:t, :tx, :li, :ts) ON CONFLICT DO NOTHING"
                        ).bindparams(t=w["tg_id"], tx=sw["tx"], li=sw["log_index"], ts=now))
                        try:
                            await _send_alert(int(w["tg_id"]), sw)
                        except Exception as e:  # noqa
                            log.warning("watch dm %s: %s", w["tg_id"], e)
                        await asyncio.sleep(0.2)
                if rows:
                    last_ts = max(last_ts, int(rows[-1]["ts"]) - 60)
            await db.execute(text("DELETE FROM watch_sent WHERE ts < :c").bindparams(c=int(time.time()) - 86400))
        except Exception as e:  # noqa
            log.warning("watchlist loop: %s", e)
            await asyncio.sleep(5)
        await asyncio.sleep(4)


async def _send_alert(tg_id: int, sw: dict):
    sym = (await _symbol(sw["token"])) or _short(sw["token"])
    side = sw["side"]
    head = "🟢 BUY" if side == "buy" else "🔴 SELL"
    p = float(sw["price1m"] or 0) / 1e6
    price = f"${p:.8f}".rstrip("0") if p < 0.01 else f"${p:,.4f}"
    txt = "\n".join([
        f"<b>👁 {head} · ${sym}</b>  {_fmt(sw['usdc'])}",
        f"wallet <code>{_short(sw['wallet'])}</code> · {sw['tokens']:,.0f} tokens · {price} · {sw['venue']}",
        f"<a href='{CFG.explorer}/tx/{sw['tx']}'>tx</a> · <a href='{SITE}/token/{sw['token']}'>chart</a>",
    ])
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=f"Snipe ${sym}", url=f"{SNIPER}?start=ca_{sw['token'][2:]}"),
        InlineKeyboardButton(text="Copy wallet", url=f"{SNIPER}?start=copy_{sw['wallet'][2:]}"),
    ]])
    await bot.send_message(tg_id, txt, parse_mode="HTML", reply_markup=kb, disable_web_page_preview=True)


# ---------------- intel API ----------------

async def api_whales(request: web.Request) -> web.Response:
    """Largest swaps chain-wide in the last N minutes, with insider rank when the wallet is ranked."""
    mins = min(1440, int(request.query.get("minutes", "60")))
    min_usd = float(request.query.get("min_usd", "250"))
    limit = min(200, int(request.query.get("limit", "60")))
    rows = await db.fetchall(text("""
        SELECT s.tx, s.log_index, s.ts, s.wallet, s.token, s.side, s.usdc, s.tokens, s.price1m, s.venue, sym.symbol,
               (SELECT COUNT(*) + 1 FROM wallet_stats w2 WHERE w2.range = '30d' AND w2.pnl_total > ws.pnl_total) AS rank,
               ws.pnl_total, ws.winrate
        FROM swaps s LEFT JOIN token_symbols sym ON sym.token = s.token
        LEFT JOIN wallet_stats ws ON ws.wallet = s.wallet AND ws.range = '30d'
        WHERE s.ts > :since AND s.usdc >= :m ORDER BY s.usdc DESC LIMIT :l
    """).bindparams(since=int(time.time()) - mins * 60, m=min_usd, l=limit))
    out = []
    for r in rows:
        d = dict(r)
        d["rank"] = int(d["rank"]) if d.get("pnl_total") is not None and int(d["rank"] or 999) <= 100 else None
        out.append(d)
    await _fill_symbols(out)
    return web.json_response({"minutes": mins, "min_usd": min_usd, "rows": out}, headers=API_CORS)


async def api_movers(request: web.Request) -> web.Response:
    """Tokens with the biggest price change over the window (needs >= 3 trades and >= $50 volume in window)."""
    mins = min(1440, int(request.query.get("minutes", "60")))
    now = int(time.time())
    rows = await db.fetchall(text("""
        WITH w AS (
          SELECT token, ts, price1m, usdc,
                 ROW_NUMBER() OVER (PARTITION BY token ORDER BY ts ASC, log_index ASC) AS rn_first,
                 ROW_NUMBER() OVER (PARTITION BY token ORDER BY ts DESC, log_index DESC) AS rn_last
          FROM swaps WHERE ts > :since AND price1m > 0 AND usdc >= 0.5
        ), agg AS (
          SELECT token, COUNT(*) AS n, SUM(usdc) AS vol,
                 MAX(CASE WHEN rn_first = 1 THEN price1m END) AS p0,
                 MAX(CASE WHEN rn_last = 1 THEN price1m END) AS p1
          FROM w GROUP BY token HAVING COUNT(*) >= 3 AND SUM(usdc) >= 50
        )
        SELECT a.token, a.n, a.vol, a.p0, a.p1, (a.p1 - a.p0) / a.p0 * 100 AS chg, s.symbol
        FROM agg a LEFT JOIN token_symbols s ON s.token = a.token
        WHERE a.p0 > 0 ORDER BY ABS((a.p1 - a.p0) / a.p0) DESC LIMIT 40
    """).bindparams(since=now - mins * 60))
    out = [dict(r) for r in rows]
    await _fill_symbols(out)
    return web.json_response({"minutes": mins, "rows": out}, headers=API_CORS)


async def api_insider_activity(request: web.Request) -> web.Response:
    """Latest trades by top-100 (30d) wallets."""
    limit = min(100, int(request.query.get("limit", "40")))
    rows = await db.fetchall(text("""
        WITH top AS (SELECT wallet, pnl_total, winrate, ROW_NUMBER() OVER (ORDER BY pnl_total DESC) AS rank
                     FROM wallet_stats WHERE range = '30d' ORDER BY pnl_total DESC LIMIT 100)
        SELECT s.tx, s.ts, s.wallet, s.token, s.side, s.usdc, s.tokens, s.price1m, s.venue, sym.symbol, t.rank, t.pnl_total, t.winrate
        FROM swaps s JOIN top t ON t.wallet = s.wallet LEFT JOIN token_symbols sym ON sym.token = s.token
        WHERE s.usdc >= 20 ORDER BY s.ts DESC LIMIT :l
    """).bindparams(l=limit))
    out = [dict(r) for r in rows]
    await _fill_symbols(out)
    return web.json_response({"rows": out}, headers=API_CORS)


async def _fill_symbols(rows: list[dict]):
    miss = [r for r in rows if not r.get("symbol")]
    async def one(r):
        try:
            r["symbol"] = await _symbol(r["token"]) or None
        except Exception:  # noqa
            pass
    await asyncio.gather(*[one(r) for r in miss[:40]])


async def api_wallet_watch_count(request: web.Request) -> web.Response:
    w = (request.query.get("wallet") or "").lower()
    r = await db.fetchone(text("SELECT COUNT(*) AS n FROM watchlist WHERE wallet = :w").bindparams(w=w))
    return web.json_response({"wallet": w, "watchers": int(r["n"] or 0)}, headers=API_CORS)
