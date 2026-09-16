"""Bridge Watch: capital arriving on Arc through Circle CCTP v2, before it buys anything.

Reads MintAndWithdraw from TokenMessengerV2 (every USDC inflow to Arc), stores it, and posts to the
insiders channel when:
  * BRIDGE IN  — a single inflow >= BRIDGE_MIN_USD (who: fresh wallet / known trader / ranked insider, from which chain)
  * FRESH CAPITAL BUY — a wallet that bridged >= BRIDGE_MIN_USD in the last 24h makes its FIRST buy on Arc (>= FRESH_BUY_MIN_USD)
Also exposes /api/bridge (24h stats + latest inflows) for the site.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

import aiohttp
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiohttp import web
from sqlalchemy import text

from . import db
from .config import CFG
from .insider import RELAY_RPC, _symbol

log = logging.getLogger("bridge")
bot = None  # set by main

TOKEN_MESSENGER_V2 = "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d"
MESSAGE_TRANSMITTER_V2 = "0x81d40f21f12a8f0e3252bccb954d722d4c464b64"
TOPIC_MINT = "0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63"   # MintAndWithdraw(address,uint256,address,uint256)
TOPIC_BURN = "0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5"   # DepositForBurn v2 (outflows)

BRIDGE_MIN_USD = float(os.getenv("BRIDGE_MIN_USD", "5000"))
FRESH_BUY_MIN_USD = float(os.getenv("FRESH_BUY_MIN_USD", "300"))
WINDOW = 2000          # blocks per getLogs (arc-scan caps 10k; relay is fine with 2k)
POLL_SEC = 5
START_BACK = 20000     # ~3.5h on first start

# CCTP domain ids -> chain names (Circle docs)
DOMAINS = {0: "Ethereum", 1: "Avalanche", 2: "OP Mainnet", 3: "Arbitrum", 4: "Noble", 5: "Solana", 6: "Base",
           7: "Polygon", 8: "Sui", 9: "Aptos", 10: "Unichain", 11: "Linea", 12: "Codex", 13: "Sonic",
           14: "World Chain", 15: "Monad", 16: "Sei", 17: "HyperEVM", 18: "Ink", 19: "Plume", 20: "XDC",
           21: "BNB Chain", 22: "Starknet", 23: "Sei", 24: "Berachain", 25: "Stable", 26: "Arc"}

SITE = "https://arctools.fun"
SNIPER = "https://t.me/ArcSniper_bot"
API_CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type"}


async def _rpc(method: str, params: list):
    async with aiohttp.ClientSession() as s:
        async with s.post(RELAY_RPC, headers={"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "X-Priority": "high"}, json={"id": 1, "jsonrpc": "2.0", "method": method, "params": params},
                          timeout=aiohttp.ClientTimeout(total=25)) as r:
            j = await r.json()
    if "error" in j:
        raise RuntimeError(j["error"])
    return j["result"]


async def init_tables():
    try:
        await db.execute(text("ALTER TABLE bridge_mints ADD COLUMN IF NOT EXISTS swept INTEGER DEFAULT 0"))
    except Exception:  # noqa
        pass
    await db.execute(text("""CREATE TABLE IF NOT EXISTS bridge_mints (
        tx VARCHAR(80) NOT NULL, log_index INTEGER NOT NULL, block BIGINT, ts BIGINT,
        recipient VARCHAR(64), amount DOUBLE PRECISION, fee DOUBLE PRECISION, source_domain INTEGER,
        direction VARCHAR(4), alerted INTEGER DEFAULT 0, fresh_buy_alerted INTEGER DEFAULT 0, swept INTEGER DEFAULT 0,
        PRIMARY KEY (tx, log_index))"""))
    await db.execute(text("CREATE INDEX IF NOT EXISTS bridge_recipient_ts ON bridge_mints (recipient, ts)"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS bridge_ts ON bridge_mints (ts)"))


def _fmt_usd(v: float) -> str:
    v = float(v or 0)
    if v >= 1_000_000:
        return f"${v / 1e6:.2f}M"
    if v >= 10_000:
        return f"${v / 1e3:.1f}K"
    return f"${v:,.0f}" if v >= 1000 else f"${v:,.2f}"


def _short(a: str) -> str:
    return f"{a[:6]}…{a[-4:]}"


async def _source_domain(tx: str) -> int | None:
    """MessageReceived on the transmitter in the same tx: first data word = sourceDomain."""
    try:
        rcpt = await _rpc("eth_getTransactionReceipt", [tx])
        for lg in rcpt.get("logs", []):
            if lg["address"].lower() == MESSAGE_TRANSMITTER_V2 and len(lg.get("data", "0x")) >= 66:
                return int(lg["data"][2:66], 16)
    except Exception as e:  # noqa
        log.debug("source domain %s: %s", tx, e)
    return None


async def _block_ts(block: int) -> int:
    try:
        b = await _rpc("eth_getBlockByNumber", [hex(block), False])
        return int(b["timestamp"], 16)
    except Exception:  # noqa
        return int(time.time())


async def _wallet_profile(w: str) -> dict:
    """Who is this wallet on Arc: swaps in our index, ranked insider?"""
    r = await db.fetchone(text(
        "SELECT COUNT(*) AS n, MIN(ts) AS first_ts, SUM(usdc) AS vol FROM swaps WHERE wallet = :w").bindparams(w=w))
    st = await db.fetchone(text(
        "SELECT pnl_total, winrate, closed FROM wallet_stats WHERE range='30d' AND wallet = :w").bindparams(w=w))
    rank = None
    if st:
        rr = await db.fetchone(text(
            "SELECT COUNT(*) AS above FROM wallet_stats WHERE range='30d' AND pnl_total > :p").bindparams(p=st["pnl_total"]))
        rank = int(rr["above"] or 0) + 1
    nonce = None
    try:
        nonce = int(await _rpc("eth_getTransactionCount", [w, "latest"]), 16)
    except Exception:  # noqa
        pass
    return {"swaps": int(r["n"] or 0), "first_ts": int(r["first_ts"] or 0), "vol": float(r["vol"] or 0),
            "rank": rank, "stats": dict(st) if st else None, "nonce": nonce}


def _who_line(p: dict) -> str:
    if p["rank"] and p["rank"] <= 100 and p["stats"]:
        s = p["stats"]
        sign = "+" if (s["pnl_total"] or 0) >= 0 else "−"
        return (f"ranked insider #{p['rank']} · 30d PnL {sign}{_fmt_usd(abs(s['pnl_total'] or 0))} · "
                f"win-rate {float(s['winrate'] or 0):.0f}%")
    if p["swaps"] == 0:
        if p["nonce"] is not None and p["nonce"] <= 1:
            return "FRESH wallet — no trades on Arc yet, first transactions"
        return "no DEX trades on Arc yet"
    days = max(1, int((time.time() - p["first_ts"]) / 86400)) if p["first_ts"] else 0
    return f"known trader · {p['swaps']} swaps · {_fmt_usd(p['vol'])} volume · active {days}d"


async def _post_bridge_in(m: dict):
    p = await _wallet_profile(m["recipient"])
    src = DOMAINS.get(m["source_domain"], f"domain {m['source_domain']}") if m["source_domain"] is not None else "another chain"
    txt = "\n".join([
        f"<b>🌉 BRIDGE IN · {_fmt_usd(m['amount'])} USDC</b>",
        f"<code>{m['recipient']}</code>",
        f"from {src} via Circle CCTP" + (f" · fee {_fmt_usd(m['fee'])}" if m["fee"] else ""),
        f"Who: {_who_line(p)}",
        "",
        f"<a href='{CFG.explorer}/tx/{m['tx']}'>tx</a> · <a href='{CFG.explorer}/address/{m['recipient']}'>wallet</a>",
        "<i>Capital landing on Arc before it buys anything. Watch what this wallet does next — a FRESH CAPITAL BUY post follows if it trades.</i>",
    ])
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Copy wallet in sniper", url=f"{SNIPER}?start=copy_{m['recipient'][2:]}"),
        InlineKeyboardButton(text="Portfolio", url=f"{SITE}/portfolio?w={m['recipient']}"),
    ]])
    await bot.send_message(CFG.insider_channel_id, txt, parse_mode="HTML", reply_markup=kb, disable_web_page_preview=True)
    log.info("bridge in %s %s from %s", _fmt_usd(m["amount"]), m["recipient"], src)


async def _post_fresh_buy(m: dict, sw: dict):
    sym = (await _symbol(sw["token"])) or _short(sw["token"])
    mins = max(1, int((sw["ts"] - m["ts"]) / 60))
    src = DOMAINS.get(m["source_domain"], "another chain") if m["source_domain"] is not None else "another chain"
    txt = "\n".join([
        f"<b>💸 FRESH CAPITAL BUY · ${sym}</b>",
        f"<code>{_short(m['recipient'])}</code> bridged <b>{_fmt_usd(m['amount'])}</b> from {src} {mins} min ago — "
        f"first buy on Arc: <b>{_fmt_usd(sw['usdc'])}</b> of ${sym} ({sw['venue']})",
        "",
        f"<a href='{CFG.explorer}/tx/{sw['tx']}'>tx</a> · <a href='{SITE}/token/{sw['token']}'>chart</a> · "
        f"<a href='{CFG.explorer}/address/{m['recipient']}'>wallet</a>",
        "<i>New money picking its first token. Not advice.</i>",
    ])
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=f"Snipe ${sym}", url=f"{SNIPER}?start=ca_{sw['token'][2:]}"),
        InlineKeyboardButton(text="Copy wallet", url=f"{SNIPER}?start=copy_{m['recipient'][2:]}"),
    ], [InlineKeyboardButton(text="Chart", url=f"{SITE}/token/{sw['token']}")]])
    await bot.send_message(CFG.insider_channel_id, txt, parse_mode="HTML", reply_markup=kb, disable_web_page_preview=True)
    log.info("fresh capital buy %s -> %s %s", m["recipient"], sym, _fmt_usd(sw["usdc"]))


async def _scan(frm: int, to: int) -> list[dict]:
    logs = await _rpc("eth_getLogs", [{"fromBlock": hex(frm), "toBlock": hex(to), "address": TOKEN_MESSENGER_V2,
                                        "topics": [[TOPIC_MINT, TOPIC_BURN]]}])
    rows = []
    ts_cache: dict[int, int] = {}
    for lg in logs:
        blk = int(lg["blockNumber"], 16)
        if blk not in ts_cache:
            ts_cache[blk] = await _block_ts(blk)
        d = lg["data"][2:]
        if lg["topics"][0] == TOPIC_MINT:
            amount = int(d[0:64], 16) / 1e6
            fee = int(d[64:128], 16) / 1e6 if len(d) >= 128 else 0.0
            rows.append({"tx": lg["transactionHash"], "log_index": int(lg["logIndex"], 16), "block": blk, "ts": ts_cache[blk],
                         "recipient": "0x" + lg["topics"][1][-40:], "amount": amount, "fee": fee,
                         "source_domain": None, "direction": "in"})
        else:
            # DepositForBurn(burnToken idx, amount, depositor idx, mintRecipient, destinationDomain, ...)
            amount = int(d[0:64], 16) / 1e6
            dest = int(d[128:192], 16) if len(d) >= 192 else None
            rows.append({"tx": lg["transactionHash"], "log_index": int(lg["logIndex"], 16), "block": blk, "ts": ts_cache[blk],
                         "recipient": "0x" + lg["topics"][2][-40:] if len(lg["topics"]) > 2 else "0x" + "0" * 40,
                         "amount": amount, "fee": 0.0, "source_domain": dest, "direction": "out"})
    return rows


async def watch_loop():
    await asyncio.sleep(20)
    await init_tables()
    head = int(await _rpc("eth_blockNumber", []), 16)
    cur = await db.kv_get("bridge_cursor")
    cursor = int(cur) if cur else head - START_BACK
    log.info("bridge watch start @ %s (head %s)", cursor, head)
    ins = text(
        "INSERT INTO bridge_mints (tx, log_index, block, ts, recipient, amount, fee, source_domain, direction) "
        "VALUES (:tx, :log_index, :block, :ts, :recipient, :amount, :fee, :source_domain, :direction) "
        "ON CONFLICT (tx, log_index) DO NOTHING")
    while True:
        try:
            head = int(await _rpc("eth_blockNumber", []), 16)
            if cursor < head:
                frm, to = cursor + 1, min(head, cursor + WINDOW)
                rows = await _scan(frm, to)
                for r in rows:
                    if r["direction"] == "in" and r["amount"] >= BRIDGE_MIN_USD:
                        r["source_domain"] = await _source_domain(r["tx"])
                if rows:
                    await db.execute_many(ins, rows)
                cursor = to
                await db.kv_set("bridge_cursor", str(cursor))
                if rows:
                    log.info("bridge %s-%s: %s transfers (in: %s)", frm, to, len(rows),
                             _fmt_usd(sum(x["amount"] for x in rows if x["direction"] == "in")))
                if head - cursor > WINDOW:
                    await asyncio.sleep(0.2)
                    continue
            await _alerts()
        except Exception as e:  # noqa
            log.warning("bridge watch: %s", e)
            await asyncio.sleep(5)
        await asyncio.sleep(POLL_SEC)


async def _alerts():
    if not CFG.insider_channel_id or bot is None:
        return
    now = int(time.time())
    # 1) big inflows not yet announced (only recent ones — no backlog flood)
    big = await db.fetchall(text(
        "SELECT * FROM bridge_mints WHERE direction='in' AND amount >= :m AND alerted = 0 AND ts > :s "
        "ORDER BY ts LIMIT 5").bindparams(m=BRIDGE_MIN_USD, s=now - 1800))
    for m in big:
        m = dict(m)
        await db.execute(text("UPDATE bridge_mints SET alerted = 1 WHERE tx = :tx AND log_index = :li")
                         .bindparams(tx=m["tx"], li=m["log_index"]))
        await _post_bridge_in(m)
        await asyncio.sleep(0.5)
    await db.execute(text("UPDATE bridge_mints SET alerted = 1 WHERE alerted = 0 AND ts <= :s").bindparams(s=now - 1800))
    # 2) fresh capital: bridged >= min in last 24h, first buy after the mint, wallet had no swaps before the mint
    cands = await db.fetchall(text(
        "SELECT * FROM bridge_mints WHERE direction='in' AND amount >= :m AND fresh_buy_alerted = 0 AND ts > :s"
    ).bindparams(m=BRIDGE_MIN_USD, s=now - 86400))
    for m in cands:
        m = dict(m)
        before = await db.fetchone(text("SELECT COUNT(*) AS n FROM swaps WHERE wallet = :w AND ts < :t")
                                   .bindparams(w=m["recipient"], t=m["ts"]))
        if int(before["n"] or 0) > 0:
            await db.execute(text("UPDATE bridge_mints SET fresh_buy_alerted = 2 WHERE tx = :tx AND log_index = :li")
                             .bindparams(tx=m["tx"], li=m["log_index"]))   # not fresh — an existing trader topping up
            continue
        sw = await db.fetchone(text(
            "SELECT tx, ts, token, side, usdc, venue FROM swaps WHERE wallet = :w AND ts >= :t AND side='buy' "
            "AND usdc >= :u ORDER BY ts LIMIT 1").bindparams(w=m["recipient"], t=m["ts"], u=FRESH_BUY_MIN_USD))
        if sw:
            await db.execute(text("UPDATE bridge_mints SET fresh_buy_alerted = 1 WHERE tx = :tx AND log_index = :li")
                             .bindparams(tx=m["tx"], li=m["log_index"]))
            await _post_fresh_buy(m, dict(sw))
            await asyncio.sleep(0.5)


# ---------------- API ----------------

async def api_bridge(request: web.Request) -> web.Response:
    now = int(time.time())
    agg = await db.fetchone(text("""
        SELECT SUM(CASE WHEN direction='in' THEN amount ELSE 0 END) AS in24,
               SUM(CASE WHEN direction='out' THEN amount ELSE 0 END) AS out24,
               COUNT(CASE WHEN direction='in' THEN 1 END) AS n_in,
               COUNT(DISTINCT CASE WHEN direction='in' THEN recipient END) AS wallets_in
        FROM bridge_mints WHERE ts > :s""").bindparams(s=now - 86400))
    latest = await db.fetchall(text(
        "SELECT tx, ts, recipient, amount, source_domain, direction FROM bridge_mints "
        "WHERE amount >= 100 ORDER BY ts DESC LIMIT 50"))
    return web.json_response({
        "in24": float(agg["in24"] or 0), "out24": float(agg["out24"] or 0), "n_in24": int(agg["n_in"] or 0),
        "wallets_in24": int(agg["wallets_in"] or 0), "net24": float(agg["in24"] or 0) - float(agg["out24"] or 0),
        "min_alert_usd": BRIDGE_MIN_USD,
        "latest": [{**dict(r), "source": DOMAINS.get(r["source_domain"]) if r["source_domain"] is not None else None}
                   for r in latest],
    }, headers=API_CORS)


# ---- proxy sweeper -----------------------------------------------------------------------------------------------
# Old burns (before destinationCaller was pinned to the proxy) can still be minted by a public relayer straight into
# ArcBridgeFeeProxy, bypassing bridgeReceive → the USDC parks in the proxy. The owner key sweeps it: 2% fee to the
# treasury, the rest to the original source-chain sender decoded from the CCTP message in the mint transaction.
BRIDGE_PROXY = "0xa42c4beee84ced9f2ea15b3981b8a321943b7bec"
TREASURY = "0xb35c471b31d636b96f95b84e7a27d69b63235c0d"
SEND_URLS = [("https://rpc-production-ba7a.up.railway.app", {"X-Send-Auth": os.getenv("RPC_SEND_AUTH", "")}),
             ("https://rpc.arc-scan.org", {})]


def _decode_message_sender(tx_input: str) -> tuple[str, float] | None:
    """receiveMessage(bytes message, bytes attestation) → (messageSender, amount USDC) from BurnMessageV2 body."""
    try:
        inp = tx_input[10:]
        off = int(inp[0:64], 16) * 2
        ln = int(inp[off:off + 64], 16) * 2
        msg = inp[off + 64:off + 64 + ln]
        body = msg[148 * 2:]
        amount = int(body[136:200], 16) / 1e6
        sender = "0x" + body[200 + 24:200 + 64]
        return sender, amount
    except Exception:  # noqa
        return None


async def proxy_sweep_loop():
    key = os.getenv("BRIDGE_OWNER_KEY", "")
    if not key:
        log.info("bridge sweeper disabled (BRIDGE_OWNER_KEY empty)")
        return
    from eth_account import Account
    from web3 import Web3
    acct = Account.from_key(key)
    log.info("bridge sweeper on: owner %s", acct.address)
    sel = Web3.keccak(text="rescue(address,uint256)").hex().replace("0x", "")[:8]
    await asyncio.sleep(120)
    while True:
        try:
            bal = int(await _rpc("eth_getBalance", [BRIDGE_PROXY, "latest"]), 16)
            if bal < 10 ** 16:                      # < 0.01 USDC → nothing parked
                await asyncio.sleep(60); continue
            rows = await db.fetchall(text(
                "SELECT tx, amount FROM bridge_mints WHERE lower(recipient) = :p AND COALESCE(swept, 0) = 0 ORDER BY ts DESC LIMIT 5"
            ).bindparams(p=BRIDGE_PROXY))
            for r in rows:
                tx = await _rpc("eth_getTransactionByHash", [r["tx"]])
                if not tx:
                    continue
                if tx["input"][:10] != "0x57ecfd28":          # minted via bridgeReceive → nothing parked from this one
                    await db.execute(text("UPDATE bridge_mints SET swept = 1 WHERE tx = :t").bindparams(t=r["tx"])); continue
                dec = _decode_message_sender(tx["input"])
                if not dec:
                    continue
                user, amount = dec
                wei = int(round(amount * 1e18))
                if wei > bal:
                    continue
                fee = wei * 2 // 100
                nonce = int(await _rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
                gp = int(int(await _rpc("eth_gasPrice", []), 16) * 1.2)
                hashes = []
                for to, amt in ((TREASURY, fee), (user, wei - fee)):
                    data = "0x" + sel + to[2:].lower().rjust(64, "0") + hex(amt)[2:].rjust(64, "0")
                    s = acct.sign_transaction({"to": Web3.to_checksum_address(BRIDGE_PROXY), "data": data, "value": 0, "gas": 120_000,
                                               "gasPrice": gp, "nonce": nonce, "chainId": 5042})
                    raw = (s.raw_transaction if hasattr(s, "raw_transaction") else s.rawTransaction).hex()
                    raw = raw if raw.startswith("0x") else "0x" + raw
                    h = None
                    for _ in range(5):
                        for u, hdr in SEND_URLS:
                            try:
                                async with aiohttp.ClientSession() as sess:
                                    async with sess.post(u, json={"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": [raw]},
                                                         headers={"Content-Type": "application/json", **hdr}, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                                        j = await resp.json(content_type=None)
                                if "result" in j:
                                    h = j["result"]; break
                            except Exception:  # noqa
                                pass
                        if h:
                            break
                        await asyncio.sleep(2)
                    if not h:
                        raise RuntimeError("sweep broadcast failed")
                    hashes.append(h); nonce += 1
                await db.execute(text("UPDATE bridge_mints SET swept = 1 WHERE tx = :t").bindparams(t=r["tx"]))
                bal -= wei
                log.warning("bridge sweep: %.2f USDC parked in proxy → %.2f to %s, %.2f fee (%s)", amount, (wei - fee) / 1e18, user, fee / 1e18, hashes)
                try:
                    if bot and CFG.insider_channel_id:
                        pass  # admin notice goes through the watchdog summary; keep the channel clean
                except Exception:  # noqa
                    pass
        except Exception as e:  # noqa
            log.warning("bridge sweeper: %s", e)
        await asyncio.sleep(60)
