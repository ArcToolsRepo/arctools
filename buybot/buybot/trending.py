"""Trending channel: ranked 24h buy volume across all tracked tokens,
boosted tokens pinned on top, remaining slots (up to 10) filled with the
biggest-mcap tokens on Arc. Edits one message in the channel."""
import asyncio
import json
import logging
import time

import aiohttp
from sqlalchemy import select, text
from .config import CFG
from .venues import discover_venues
from . import db

log = logging.getLogger("trending")
bot = None  # set by main

MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

# tokens currently on the board (top10 + boosted) — watcher mirrors their buys to the channel
_top10: set[str] = set()
_ranks: dict[str, int] = {}  # token(lower) -> 1-based trending position


def top10() -> set[str]:
    return _top10


def rank_of(token: str) -> int | None:
    """1-based trending rank of the token, or None if not on the board."""
    return _ranks.get(token.lower())


# ---- board fillers: biggest-mcap Arc tokens (not tracked by anyone yet) ----
_fillers: list[dict] = []   # {token, symbol, mcap, venues:[{address,kind}]}
_fillers_ts: float = 0.0


def fillers() -> list[dict]:
    return _fillers


MIN_FILLER_TXNS = 50  # tylko realne projekty: min. 50 transakcji all-time


async def _mcap_candidates() -> list[dict]:
    """Top Arc tokens by mcap from the RadarDex screener API (real stats:
    mcap, txns, volume, holders). Only projects with >= MIN_FILLER_TXNS txns."""
    out: list[dict] = []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
            async with s.get("https://api.radardex.pro/tokens") as r:
                d = await r.json()
        for t in d.get("tokens", []) or []:
            if not t.get("address") or not t.get("mcap"):
                continue
            if int(t.get("txnsAll") or 0) < MIN_FILLER_TXNS:
                continue
            out.append({
                "holders": int(t.get("holderCount") or 0),
                "mcap": float(t["mcap"]),
                "symbol": t.get("symbol") or "?",
                "token": t["address"],
                "txns": int(t.get("txnsAll") or 0),
                "vol24": float(t.get("volume24") or 0),
            })
    except Exception as e:  # noqa
        log.warning("mcap candidates: %s", e)
    out.sort(key=lambda c: -c["mcap"])
    return out


async def refresh_fillers():
    """Every 10 min: pick top-mcap untracked tokens + their venues (for buy watch)."""
    global _fillers_ts
    if time.time() - _fillers_ts < 600:
        return
    _fillers_ts = time.time()
    try:
        tracked_rows = await db.fetchall(select(db.tracks.c.token))
        tracked = {r["token"].lower() for r in tracked_rows}
        chosen: list[dict] = []
        for c in await _mcap_candidates():
            if c["token"].lower() in tracked:
                continue
            vens = await discover_venues(c["token"])
            if not vens:
                continue
            c["venues"] = vens
            chosen.append(c)
            if len(chosen) >= 10:
                break
        _fillers[:] = chosen
        log.info("fillers refreshed: %s", [(f["symbol"], round(f["mcap"])) for f in chosen[:10]])
    except Exception as e:  # noqa
        log.warning("refresh_fillers: %s", e)


async def build_text() -> str:
    now = int(time.time())
    day_ago = now - 86400
    tracks = await db.fetchall(select(db.tracks))
    tracked_syms = {t["token"].lower(): t["symbol"] for t in tracks}
    rows = await db.fetchall(text(
        "SELECT token, symbol, SUM(usdc) AS vol, COUNT(*) AS n "
        "FROM buys WHERE ts > :t GROUP BY token, symbol "
        "ORDER BY vol DESC LIMIT 40").bindparams(t=day_ago))
    vol_map = {r["token"].lower(): r for r in rows}
    boosted = await db.fetchall(select(db.boosts).where(db.boosts.c.until_ts > now))
    boosted = [b for b in boosted if b["token"].lower() in tracked_syms]
    boosted_set = {b["token"].lower() for b in boosted}

    def vol_of(tk: str) -> float:
        v = vol_map.get(tk)
        return float(v["vol"] or 0) if v else 0.0

    # board order:
    # 1) PAID boosts — guaranteed slots, always on top
    # 2) every TRACKED token (adding the bot = instant board spot), by 24h volume
    # 3) top-mcap fillers up to 10
    entries: list[dict] = []
    seen: set[str] = set()
    for b in sorted(boosted, key=lambda b: -vol_of(b["token"].lower())):
        tk = b["token"].lower()
        entries.append({"boost": True, "symbol": b["symbol"], "token": b["token"]})
        seen.add(tk)
    for t in sorted(tracks, key=lambda t: -vol_of(t["token"].lower())):
        tk = t["token"].lower()
        if tk in seen:
            continue
        entries.append({"boost": False, "symbol": t["symbol"], "token": t["token"]})
        seen.add(tk)
    entries = entries[:10]
    filler_shown = [f for f in _fillers if f["token"].lower() not in seen][: max(0, 10 - len(entries))]

    _top10.clear()
    _top10.update(e["token"].lower() for e in entries)
    _top10.update(f["token"].lower() for f in filler_shown)
    _ranks.clear()
    pos = 0
    for tk in [e["token"].lower() for e in entries] + [f["token"].lower() for f in filler_shown]:
        pos += 1
        _ranks[tk] = pos

    lines = ["🔥 <b>ARC TRENDING</b> (24h buy volume · top mcap)", ""]
    shown = 0
    for e in entries:
        medal = MEDALS[shown] if shown < len(MEDALS) else "•"
        tag = "🚀 " if e["boost"] else ""
        v = vol_map.get(e["token"].lower())
        volpart = f"${v['vol']:,.0f} ({v['n']} buys)" if v else "new on the board"
        lines.append(
            f"{medal} {tag}<b>{e['symbol']}</b> — {volpart}\n"
            f"      <a href='https://arctools.fun/scan?ca={e['token']}'>scan</a> · "
            f"<a href='https://t.me/ArcSniper_bot?start=ca_{e['token'][2:]}'>snipe</a>")
        shown += 1
    for f in filler_shown:
        medal = MEDALS[shown] if shown < len(MEDALS) else "•"
        v = vol_map.get(f["token"].lower())
        volpart = f" · ${v['vol']:,.0f} ({v['n']} buys)" if v else ""
        mc = f["mcap"]
        mcs = f"${mc/1000:.1f}K" if mc < 1_000_000 else f"${mc/1e6:.2f}M"
        holders = f" · {f['holders']} holders" if f.get("holders") else ""
        lines.append(
            f"{medal} <b>{f['symbol']}</b> — MC {mcs}{volpart}{holders}\n"
            f"      <a href='https://arctools.fun/scan?ca={f['token']}'>scan</a> · "
            f"<a href='https://t.me/ArcSniper_bot?start=ca_{f['token'][2:]}'>snipe</a>")
        shown += 1
    if shown == 0:
        lines.append("Quiet for now. Add your token: @" + (CFG.bot_username or "this bot"))
    lines.append("")
    lines.append(f"🤖 Add your token / boost to the top: @{CFG.bot_username}" if CFG.bot_username else "")
    return "\n".join(lines)


async def _announce_rank_changes(prev: dict[str, int], cur: dict[str, int]):
    """Powiadom grupy tokenow o wejsciu do trendingu / awansie na wyzsza pozycje."""
    if not prev:
        return  # pierwszy przebieg po starcie: bez spamu
    changed = {}
    for tok, pos in cur.items():
        old = prev.get(tok)
        if old is None:
            changed[tok] = ("enter", pos)
        elif pos < old:
            changed[tok] = ("climb", pos, old)
    if not changed:
        return
    ch = str(CFG.trend_channel_id or "@ARCTrends")
    url = f"https://t.me/{ch.lstrip('@')}" if ch.startswith("@") else "https://t.me/ARCTrends"
    tracks = await db.fetchall(select(db.tracks))
    for tr in tracks:
        info = changed.get(tr["token"].lower())
        if not info:
            continue
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(info[1], "🔥")
        if info[0] == "enter":
            txt = (f"{medal} <b>{tr['symbol']}</b> just entered "
                   f"<a href='{url}'>Arc Trending</a> at <b>#{info[1]}</b>!")
        else:
            txt = (f"{medal} <b>{tr['symbol']}</b> climbed "
                   f"<a href='{url}'>Arc Trending</a>: <b>#{info[2]} → #{info[1]}</b>!")
        try:
            await bot.send_message(tr["chat_id"], txt, parse_mode="HTML",
                                   disable_web_page_preview=True)
        except Exception as e:  # noqa - grupa mogla usunac bota
            log.warning("rank notify %s: %s", tr["chat_id"], e)


async def trending_loop():
    if not CFG.trend_channel_id:
        log.info("trending disabled (no TREND_CHANNEL_ID)")
        return
    # ranks przed restartem: azeby restart nie generowal falszywych "entered trending"
    prev_ranks: dict[str, int] = {}
    try:
        prev_ranks = json.loads(await db.kv_get("trend_ranks") or "{}")
    except Exception:  # noqa
        pass
    first_pass = True
    while True:
        try:
            await refresh_fillers()
            txt = await build_text()
            # powiadomienia o zmianach pozycji (nie na pierwszym przebiegu bez stanu)
            cur = dict(_ranks)
            if not (first_pass and not prev_ranks):
                await _announce_rank_changes(prev_ranks, cur)
            if cur != prev_ranks:
                await db.kv_set("trend_ranks", json.dumps(cur))
            prev_ranks = cur
            first_pass = False

            now = time.time()
            msg_id = await db.kv_get("trend_msg_id")
            last_pin = float(await db.kv_get("trend_pin_ts") or 0)
            if msg_id and now - last_pin < 3600:
                try:
                    await bot.edit_message_text(txt, chat_id=CFG.trend_channel_id,
                                                message_id=int(msg_id), parse_mode="HTML",
                                                disable_web_page_preview=True)
                except Exception:  # noqa - edit failed (same text / deleted) -> repost sometimes
                    pass
            else:
                # co godzine: swiezy post + pin (kanal dostaje powiadomienie, lista zawsze na dole)
                m = await bot.send_message(CFG.trend_channel_id, txt, parse_mode="HTML",
                                           disable_web_page_preview=True)
                if msg_id:
                    try:
                        await bot.delete_message(CFG.trend_channel_id, int(msg_id))
                    except Exception:  # noqa - starszy niz 48h / brak prawa: zostaje
                        pass
                await db.kv_set("trend_msg_id", str(m.message_id))
                await db.kv_set("trend_pin_ts", str(int(now)))
                try:
                    await bot.pin_chat_message(CFG.trend_channel_id, m.message_id,
                                               disable_notification=True)
                except Exception:  # noqa
                    pass
        except Exception as e:  # noqa
            log.warning("trending: %s", e)
        await asyncio.sleep(CFG.trend_interval)
