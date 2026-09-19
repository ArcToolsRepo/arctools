"""Arc chain / RPC status announcer for @ARCTrends and @ArcToolsInsiders.

While the chain (or every public RPC) is down: one post every 5 min ("still down · X min · last block N").
When it comes back: exactly 3 "LIVE again" posts (5 min apart), the first one pinned; then silence until the next outage.
State survives restarts (kv). "Down" = no new block for DOWN_AFTER seconds OR every RPC failing for that long.
"""
import asyncio
import json
import logging
import time

import aiohttp
from sqlalchemy import text

from . import db
from .config import CFG

log = logging.getLogger("chainstatus")
bot = None                      # set by main (aiogram Bot)

RPCS = ["https://rpc-production-ba7a.up.railway.app", "https://rpc.arc-scan.org", "https://5042.rpc.thirdweb.com"]
CHECK_S = 30
POST_EVERY = 300
DOWN_AFTER = 240
LIVE_POSTS = 3
KV = "chain_status_v1"


def _channels() -> list[str]:
    out = []
    for c in (CFG.trend_channel_id, CFG.insider_channel_id):
        if c and c not in out:
            out.append(c)
    return out


async def _head() -> tuple[int | None, str]:
    """(block number, source) from the first RPC that answers; None if all fail."""
    async with aiohttp.ClientSession() as s:
        for u in RPCS:
            try:
                async with s.post(u, json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []},
                                  headers={"X-Priority": "high", "X-Relay-Key": __import__("os").getenv("RELAY_KEY", "")},
                                  timeout=aiohttp.ClientTimeout(total=12)) as r:
                    j = await r.json(content_type=None)
                if isinstance(j.get("result"), str) and j["result"].startswith("0x"):
                    return int(j["result"], 16), u.split("//")[1].split("/")[0]
            except Exception:  # noqa
                continue
    return None, "none"


async def _scan_head() -> tuple[int | None, int | None]:
    """arc-scan's indexed head (block, ts) — independent of the RPCs, tells chain-halt from RPC-outage."""
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get("https://api.arc-scan.org/v1/txs?limit=1", headers={"User-Agent": "Mozilla/5.0"}, timeout=aiohttp.ClientTimeout(total=15)) as r:
                j = await r.json(content_type=None)
        x = (j.get("items") or [None])[0]
        return (int(x["block"]), int(x["timestamp"])) if x else (None, None)
    except Exception:  # noqa
        return None, None


def _mins(s: float) -> str:
    m = int(s // 60)
    return f"{m} min" if m < 120 else f"{m // 60} h {m % 60:02d} min"


async def _post(txt: str, pin: bool = False) -> None:
    if not bot:
        return
    for ch in _channels():
        try:
            m = await bot.send_message(ch, txt, parse_mode="HTML", disable_web_page_preview=True)
            if pin:
                try:
                    await bot.pin_chat_message(ch, m.message_id, disable_notification=True)
                except Exception as e:  # noqa
                    log.warning("pin %s: %s", ch, e)
        except Exception as e:  # noqa
            log.warning("post %s: %s", ch, e)


async def _load() -> dict:
    try:
        raw = await db.kv_get(KV)
        return json.loads(raw) if raw else {}
    except Exception:  # noqa
        return {}


async def _save(st: dict) -> None:
    try:
        await db.kv_set(KV, json.dumps(st))
    except Exception:  # noqa
        pass


async def loop():
    await asyncio.sleep(20)
    st = await _load()
    # st: {down: bool, since: ts, last_block: n, last_block_ts: ts, last_post: ts, live_left: n, live_since: ts}
    st.setdefault("down", False); st.setdefault("live_left", 0)
    if not st.get("last_block_ts"):
        b, ts = await _scan_head()
        if b:
            st["last_block"], st["last_block_ts"] = b, ts
    while True:
        try:
            now = time.time()
            head, src = await _head()
            if head and head > int(st.get("last_block") or 0):
                st["last_block"], st["last_block_ts"] = head, now
            chain_moving = None
            if not head:
                # RPCs all dead — ask the explorer whether the CHAIN moved, only to word the message (chain halt vs RPC outage)
                b, ts = await _scan_head()
                chain_moving = bool(b and ts and now - ts < DOWN_AFTER)
            stale = now - float(st.get("last_block_ts") or now)
            is_down = stale >= DOWN_AFTER
            if is_down and not st["down"]:
                st.update(down=True, since=now - stale, last_post=0, live_left=0)
            if not is_down and st["down"]:
                st.update(down=False, live_left=LIVE_POSTS, last_post=0, live_since=now)
                log.info("chain back: block %s via %s", head, src)

            if st["down"]:
                if now - float(st.get("last_post") or 0) >= POST_EVERY:
                    rpc_only = head is None and chain_moving
                    txt = (f"🔴 <b>Arc {'RPC endpoints are down (chain itself is producing blocks)' if rpc_only else 'chain is not producing blocks'}</b>\n"
                           f"Down for {_mins(now - float(st['since']))} · last block <code>{st.get('last_block')}</code>\n"
                           f"Trades, buys and alerts are paused until Arc is back. We check every 30 s and post here every 5 min.\n"
                           f"Status: https://arctools.fun · @ArcSniper_bot")
                    await _post(txt); st["last_post"] = now
            elif st.get("live_left", 0) > 0 and now - float(st.get("last_post") or 0) >= (0 if st["live_left"] == LIVE_POSTS else POST_EVERY):
                first = st["live_left"] == LIVE_POSTS
                downtime = float(st.get("live_since", now)) - float(st.get("since", now)) if st.get("since") else 0
                txt = (f"🟢 <b>Arc is LIVE again</b>\n"
                       f"Block <code>{st.get('last_block')}</code> · via {src}" + (f" · outage lasted {_mins(downtime)}" if downtime > 0 else "") + "\n"
                       f"Sniper, Terminal, alerts and limit orders are back to normal.\n"
                       f"https://arctools.fun · @ArcSniper_bot")
                await _post(txt, pin=first)
                st["live_left"] -= 1; st["last_post"] = now
            await _save(st)
        except Exception as e:  # noqa
            log.warning("chain status loop: %s", e)
        await asyncio.sleep(CHECK_S)


_mem: dict | None = None


async def api_status(request):
    """GET /api/chain-status — what the site banner reads (down flag, since, last block)."""
    from aiohttp import web
    # served from memory (the 30 s loop keeps _state fresh): the DB pool may be busy with ingest and this endpoint is
    # read by every page load (SSR banner) — it must never wait on Postgres
    global _mem
    try:
        if _mem and time.time() - _mem.get("_ts", 0) < 30:
            st = _mem
        else:
            st = dict(await asyncio.wait_for(_load(), 3)); st["_ts"] = time.time(); _mem = st
    except Exception:  # noqa
        st = _mem or {}
    now = time.time()
    out = {"down": bool(st.get("down")), "since": st.get("since"), "last_block": st.get("last_block"),
           "stale_s": int(now - float(st.get("last_block_ts") or now)), "live_since": st.get("live_since"), "ts": int(now)}
    return web.json_response(out, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=15"})
