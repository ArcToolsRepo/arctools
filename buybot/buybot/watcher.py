"""Swap watcher: polls Swap events on every tracked pool and posts buy alerts."""
import asyncio
import json
import logging
import time
from sqlalchemy import select, insert
from eth_utils import to_checksum_address
from aiogram.exceptions import TelegramNetworkError, TelegramServerError, TelegramRetryAfter
from .config import CFG
from .chain import CHAIN
from .venues import (ARCPAD_TRADE_TOPIC, V3_SWAP_TOPIC, V2_SWAP_TOPIC, V4_SWAP_TOPIC, V4_POOL_MANAGER,
                     decode_swap, decode_v4_swap, price_1m,
                     token_socials, token_symbol, symbol_missing)
from . import db

log = logging.getLogger("watcher")


async def _with_retry(fn, label: str, attempts: int = 4):
    """Wysylka do Telegrama z retry na bledy sieci/5xx/flood (Railway -> api.telegram.org
    czasem zrywa polaczenie: 'Connection reset by peer'). Bledy logiczne (bot wyrzucony
    z grupy, zly chat) nie sa powtarzane."""
    delay = 1.0
    for i in range(attempts):
        try:
            return await fn()
        except TelegramRetryAfter as e:
            await asyncio.sleep(min(float(e.retry_after) + 0.5, 30))
        except (TelegramNetworkError, TelegramServerError) as e:
            if i == attempts - 1:
                raise
            log.warning("%s: %s — retry %d/%d in %.1fs", label, e, i + 1, attempts - 1, delay)
            await asyncio.sleep(delay)
            delay *= 2
bot = None  # set by main

def emoji_bar(emoji: str, usdc: float, step: float) -> str:
    n = max(1, int(usdc / max(step, 0.01)))
    return emoji * min(n, 30)


def fmt_amount(n: float) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 1000:
        return f"{n / 1000:.1f}K"
    return f"{n:,.2f}"


async def post_buy(track: dict, buy: dict, tx_hash: str, buyer: str):
    is_filler = track.get("chat_id") is None  # trending filler: channel-only
    mc = None
    if track.get("show_mc", 1):
        p = await price_1m(track["token"])
        if p is not None:
            mc = p * 1000  # fixed 1B supply on Arc launchpads
    bar = emoji_bar(track["emoji"] or "🟢", buy["usdc"], track.get("emoji_step") or 10.0)
    lines = [
        f"<b>{track['symbol']} BUY!</b>",
        bar,
        "",
        f"💵 <b>{buy['usdc']:,.2f} USDC</b>",
        f"🪙 {fmt_amount(buy['tokens'])} {track['symbol']}",
    ]
    if track.get("show_buyer", 1):
        lines.append(f"👤 <a href='{CFG.explorer}/address/{buyer}'>{buyer[:6]}…{buyer[-4:]}</a>")
    if mc is not None:
        lines.append(f"📊 MC ${fmt_amount(mc)}")
    from . import trending
    trank = trending.rank_of(track["token"]) if CFG.trend_channel_id else None
    if trank:
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(trank, "🔥")
        ch = str(CFG.trend_channel_id)
        url = f"https://t.me/{ch.lstrip('@')}" if ch.startswith("@") else "https://t.me/ARCTrends"
        lines.append(f"{medal} <a href='{url}'>Trending #{trank} on Arc</a>")

    # sociale + logo projektu: z ustawien tracka, a gdy brak - screener/on-chain (best effort)
    web = track.get("website")
    twt = track.get("twitter")
    tg = track.get("telegram")
    logo: str | None = None
    try:
        s = await token_socials(track["token"])
        logo = s.get("icon")
        if not (web or twt or tg):
            web, twt, tg = s.get("website"), s.get("twitter"), s.get("telegram")
    except Exception:  # noqa
        pass

    def _url(u: str) -> str:
        return u if u.startswith("http") else f"https://{u}"

    socials = []
    if web:
        socials.append(f"<a href='{_url(web)}'>Web</a>")
    if twt:
        socials.append(f"<a href='{_url(twt)}'>𝕏</a>")
    if tg:
        socials.append(f"<a href='{_url(tg)}'>TG</a>")
    links = (
        f"<a href='{CFG.explorer}/tx/{tx_hash}'>TX</a> | "
        f"<a href='https://arctools.fun/scan?ca={track['token']}'>Scan</a> | "
        f"<a href='https://t.me/ArcSniper_bot?start=ca_{track['token'][2:]}'>Snipe</a>")
    if socials:
        links = " | ".join(socials) + " | " + links
    lines.append("")
    lines.append(links)
    text = "\n".join(lines)

    async def _send_group():
        mt, mid = track.get("media_type") or "", track.get("media_id") or ""
        if mt == "photo" and mid:
            await bot.send_photo(track["chat_id"], mid, caption=text, parse_mode="HTML")
        elif mt == "animation" and mid:
            await bot.send_animation(track["chat_id"], mid, caption=text, parse_mode="HTML")
        elif mt == "video" and mid:
            await bot.send_video(track["chat_id"], mid, caption=text, parse_mode="HTML")
        elif logo:
            # brak wlasnego media: uzyj logo projektu (fallback na tekst gdy URL padnie)
            try:
                await bot.send_photo(track["chat_id"], logo, caption=text, parse_mode="HTML")
            except TelegramNetworkError:
                raise
            except Exception:  # noqa - zly URL loga
                await bot.send_message(track["chat_id"], text, parse_mode="HTML",
                                       disable_web_page_preview=True)
        else:
            await bot.send_message(track["chat_id"], text, parse_mode="HTML",
                                   disable_web_page_preview=True)

    if not is_filler:
        try:
            await _with_retry(_send_group, f"post_buy {track.get('chat_id')}")
        except Exception as e:  # noqa
            log.warning("post_buy %s: %s", track.get("chat_id"), e)

    # mirror buys of top-10 trending tokens to the trending channel (once per tx, >= $30)
    try:
        from . import trending
        if (CFG.trend_channel_id and buy["usdc"] >= MIN_TREND_BUY
                and track["token"].lower() in trending.top10()):
            key = f"{tx_hash}:{track['token'].lower()}"
            if key not in _trend_sent:
                _trend_sent.append(key)
                if len(_trend_sent) > 500:
                    del _trend_sent[:250]
                cap = "🔥 <b>TRENDING BUY</b>\n" + text

                async def _send_channel():
                    if logo:
                        try:
                            return await bot.send_photo(CFG.trend_channel_id, logo, caption=cap,
                                                        parse_mode="HTML")
                        except TelegramNetworkError:
                            raise
                        except Exception:  # noqa - zly URL loga: tekstowo
                            pass
                    await bot.send_message(CFG.trend_channel_id, cap, parse_mode="HTML",
                                           disable_web_page_preview=True)
                await _with_retry(_send_channel, "trend mirror")
    except Exception as e:  # noqa
        log.warning("trend mirror: %s", e)


_trend_sent: list[str] = []

MIN_TREND_BUY = 30.0  # na kanal trending trafiaja tylko zakupy >= $30


_sym_retry_ts: dict[str, float] = {}   # token -> last on-chain symbol retry


async def _heal_symbols(rows: list) -> list:
    """Tracki zapisane z symbolem '?' (padl RPC przy /add, bytes32 symbol itp.):
    sprobuj ponownie pobrac nazwe z lancucha (max raz na 5 min per token)
    i utrwal ja w bazie, zeby alerty nie pokazywaly '? BUY!'."""
    from sqlalchemy import update
    out = []
    for t in rows:
        t = dict(t)
        if symbol_missing(t.get("symbol")):
            key = t["token"].lower()
            now = time.time()
            if now - _sym_retry_ts.get(key, 0) > 300:
                _sym_retry_ts[key] = now
                try:
                    sym = await token_symbol(t["token"])
                    if not symbol_missing(sym):
                        await db.execute(update(db.tracks).where(
                            db.tracks.c.token == t["token"]).values(symbol=sym))
                        log.info("symbol healed %s -> %s", t["token"], sym)
                        t["symbol"] = sym
                except Exception as e:  # noqa
                    log.warning("symbol heal %s: %s", t["token"], e)
            if symbol_missing(t.get("symbol")):
                t["symbol"] = f"{t['token'][:6]}…{t['token'][-4:]}"
        out.append(t)
    return out


async def watcher_loop():
    last = await CHAIN._bn()
    log.info("watcher start @ %s", last)
    while True:
        try:
            head = await CHAIN._bn()
            if head <= last:
                await asyncio.sleep(CFG.poll_interval)
                continue
            frm, to = last + 1, min(head, last + CFG.max_block_range)

            rows = await db.fetchall(select(db.tracks))
            rows = await _heal_symbols(rows)
            # (no early exit: trending fillers are watched even with 0 tracked tokens)

            # pool -> [(track, kind)]
            pool_map: dict[str, list[tuple[dict, str]]] = {}
            v4_map: dict[str, list[tuple[dict, bool]]] = {}   # pool id -> [(track, token_is_0)]

            def _add(track, v):
                if v.get("kind") == "v4" and v.get("pool_id"):
                    v4_map.setdefault(v["pool_id"].lower(), []).append((track, (bool(v.get("is0")), int(v.get("usdc_dec") or 18))))
                else:
                    pool_map.setdefault(v["address"].lower(), []).append((track, v["kind"]))

            for t in rows:
                for v in json.loads(t["venues"] or "[]"):
                    _add(t, v)
            # trending fillers: big-mcap untracked tokens, watched channel-only
            from . import trending
            for f in trending.fillers():
                pseudo = {
                    "chat_id": None, "emoji": "🟢", "emoji_step": 25.0, "media_id": "",
                    "media_type": "", "min_buy": MIN_TREND_BUY, "show_buyer": 1, "show_mc": 1,
                    "symbol": f["symbol"], "telegram": None, "token": f["token"],
                    "twitter": None, "website": None,
                }
                for v in f.get("venues", []):
                    _add(pseudo, v)
            if not pool_map and not v4_map:
                last = to
                await asyncio.sleep(CFG.poll_interval)
                continue

            addresses = [to_checksum_address(a) for a in pool_map]
            plan = [(t, addresses) for t in (V3_SWAP_TOPIC, V2_SWAP_TOPIC, ARCPAD_TRADE_TOPIC) if addresses]
            if v4_map:
                plan.append((V4_SWAP_TOPIC, [to_checksum_address(V4_POOL_MANAGER)]))
            for topic, addrs in plan:
                try:
                    logs = await CHAIN.get_logs({
                        "address": addrs, "topics": [topic],
                        "fromBlock": frm, "toBlock": to})
                except Exception as e:  # noqa
                    log.warning("get_logs: %s", e)
                    continue
                for lg in logs:
                    pool = lg["address"].lower()
                    if topic == V4_SWAP_TOPIC:
                        pid = lg["topics"][1]
                        pid = (pid.hex() if hasattr(pid, "hex") else str(pid)).lower()
                        pid = pid if pid.startswith("0x") else "0x" + pid
                        targets = [(track, ("v4",) + meta) for track, meta in v4_map.get(pid, [])]
                    else:
                        targets = pool_map.get(pool, [])
                    for track, kind in targets:
                        if topic == V4_SWAP_TOPIC:
                            buy = decode_v4_swap(kind[1], lg, kind[2])
                        else:
                            want = ("v3" if topic == V3_SWAP_TOPIC
                                    else "v2" if topic == V2_SWAP_TOPIC else "arcpad")
                            if kind != want:
                                continue
                            buy = decode_swap(kind, track["token"], lg)
                        if not buy:
                            continue
                        if buy["usdc"] < (track["min_buy"] or 0):
                            log.info("buy %.2f USDC below min_buy %.2f (chat %s)",
                                     buy["usdc"], track["min_buy"] or 0, track["chat_id"])
                            continue
                        txh = lg["transactionHash"].hex()
                        txh = txh if txh.startswith("0x") else "0x" + txh
                        buyer = "0x???"
                        try:
                            tx = await CHAIN.get_tx(lg["transactionHash"])
                            buyer = tx["from"]
                        except Exception:  # noqa
                            pass
                        await db.execute(insert(db.buys).values(
                            token=track["token"], symbol=track["symbol"],
                            usdc=buy["usdc"], tx=txh, ts=int(time.time())))
                        asyncio.create_task(post_buy(track, buy, txh, buyer))
            last = to
        except Exception as e:  # noqa
            log.warning("watcher: %s", e)
            await asyncio.sleep(3)
        await asyncio.sleep(CFG.poll_interval)
