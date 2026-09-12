"""Alerty: graduacja curve, watch deployera, whale buys, TP na pozycjach."""
import asyncio
import logging
import time
from sqlalchemy import select, update
from eth_utils import to_checksum_address, function_signature_to_4byte_selector
from eth_abi import encode as abi_encode
from .config import CFG
from .chain import CHAIN
from .pads import PADS, quote_token_usdc, pad_by_name
from . import db, sniper

log = logging.getLogger("alerts")
notify = None  # async def notify(tg_id, text)

TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


async def _curve_progress(pad, token: str) -> float | None:
    sig = pad.cfg.get("curve_progress_signature")
    if not sig:
        return None
    try:
        data = function_signature_to_4byte_selector(sig) + abi_encode(["address"], [to_checksum_address(token)])
        res = await CHAIN.w3.eth.call({"to": to_checksum_address(pad.factory), "data": data})
        val = int.from_bytes(res[:32], "big")
        return val / 100 if val > 100 else float(val)  # bps albo %
    except Exception:  # noqa
        return None


async def alerts_loop():
    while True:
        try:
            rows = await db.fetchall(select(db.alerts))
            now = int(time.time())
            for a in rows:
                if now - a["last_fired"] < 60:
                    continue
                fired = None
                if a["kind"] == "grad":
                    for pad in PADS:
                        if pad.type != "curve":
                            continue
                        prog = await _curve_progress(pad, a["target"])
                        if prog is not None and prog >= a["param"]:
                            fired = f"📈 <b>{pad.name}</b>: token <code>{a['target']}</code> hit {prog:.0f}% of the curve (threshold {a['param']:.0f}%)"
                            break
                elif a["kind"] == "price":
                    cur = await quote_token_usdc(a["target"], int(1e18))
                    if cur is not None and cur >= a["param"]:
                        fired = f"💰 Price of <code>{a['target']}</code> ≥ {a['param']}"
                if fired and notify:
                    await notify(a["tg_id"], fired)
                    await db.execute(update(db.alerts).where(db.alerts.c.id == a["id"]).values(last_fired=now))
        except Exception as e:  # noqa
            log.warning("alerts: %s", e)
        await asyncio.sleep(10)


async def tp_loop():
    """Take-profit na otwartych pozycjach z tp_mult>0."""
    while True:
        try:
            poss = await db.fetchall(select(db.positions).where(
                (db.positions.c.status == "open") & (db.positions.c.tp_mult > 0)))
            for p in poss:
                if p["amount_tokens"] <= 0:
                    continue
                cur = await quote_token_usdc(p["token"], int(p["amount_tokens"]))
                if cur is None:
                    continue
                if cur >= p["cost_usdc"] * p["tp_mult"]:
                    res = await sniper.execute_sell(p["tg_id"], p, 100, "turbo")
                    if notify:
                        ok = res.get("ok")
                        await notify(p["tg_id"],
                                     f"🎯 TP {p['tp_mult']}x on <b>{p['symbol']}</b>: "
                                     f"{'sold for %.2f USDC' % res.get('usdc', 0) if ok else 'sell FAILED: ' + str(res.get('err'))}")
        except Exception as e:  # noqa
            log.warning("tp: %s", e)
        await asyncio.sleep(5)


async def watch_tx_loop():
    """Deployer-watch + whale-watch + copy-trade: skan transakcji w nowych blokach."""
    if not CHAIN:
        return
    last = await CHAIN.w3.eth.block_number
    routers = set()
    for pad in PADS:
        if pad.cfg.get("router"):
            routers.add(pad.cfg["router"].lower())
        if pad.factory:
            routers.add(pad.factory.lower())
    if CFG.univ3_router:
        routers.add(CFG.univ3_router.lower())
    while True:
        try:
            head = await CHAIN.w3.eth.block_number
            while last < head:
                last += 1
                blk = await CHAIN.w3.eth.get_block(last, full_transactions=True)
                deployer_watches = await db.fetchall(select(db.alerts).where(db.alerts.c.kind == "deployer"))
                copies = await db.fetchall(select(db.copytargets).where(db.copytargets.c.enabled == 1))
                copy_map = {}
                for c in copies:
                    copy_map.setdefault(c["wallet"].lower(), []).append(c)
                for tx in blk["transactions"]:
                    frm = (tx.get("from") or "").lower()
                    to = (tx.get("to") or "").lower() if tx.get("to") else ""
                    val_usdc = tx.get("value", 0) / 1e18
                    # deployer watch: creation tx od obserwowanego
                    if tx.get("to") is None:
                        for w in deployer_watches:
                            if w["target"].lower() == frm and notify:
                                await notify(w["tg_id"],
                                             f"👀 Deployer <code>{frm}</code> deployuje kontrakt (tx <code>{tx['hash'].hex()}</code>)")
                    # whale watch: duzy buy na router/pad
                    if to in routers and val_usdc >= CFG.whale_min_usdc:
                        whale_subs = await db.fetchall(select(db.alerts).where(db.alerts.c.kind == "whale"))
                        for w in whale_subs:
                            if notify:
                                await notify(w["tg_id"],
                                             f"🐋 Whale buy {val_usdc:,.0f} USDC → <code>{to}</code>\n"
                                             f"od <code>{frm}</code> tx <code>{tx['hash'].hex()}</code>")
                    # copy-trade: buy obserwowanego portfela
                    if frm in copy_map and to in routers and val_usdc > 0:
                        for c in copy_map[frm]:
                            asyncio.create_task(_copy_buy(c, tx))
            await asyncio.sleep(CFG.poll_interval)
        except Exception as e:  # noqa
            log.warning("watch_tx: %s", e)
            await asyncio.sleep(2)


async def _copy_buy(c: dict, src_tx):
    """Mirror buy: dekoduje token z receiptu (pierwszy Transfer do kupujacego)."""
    from . import wallets as W
    try:
        rcpt = await CHAIN.w3.eth.get_transaction_receipt(src_tx["hash"])
        token = None
        buyer = (src_tx.get("from") or "").lower()
        for lg in rcpt["logs"]:
            topics = [t.hex() if hasattr(t, "hex") else t for t in lg["topics"]]
            if topics and topics[0].lower() == TRANSFER_TOPIC and len(topics) >= 3:
                to_addr = "0x" + topics[2][-40:]
                if to_addr.lower() == buyer:
                    token = to_checksum_address(lg["address"])
                    break
        if not token:
            return
        u = await db.get_user(c["tg_id"])
        w = await W.active_wallet(c["tg_id"])
        if not w:
            return
        from .pads import auto_pad
        amount = c["amount_usdc"] or u["buy_usdc"]
        pad, key = await auto_pad(token)
        res = await sniper.execute_buy(c["tg_id"], token, pad, amount,
                                       u["slippage"], u["gas_mode"], [w["id"]], curve=key)
        if notify:
            ok = any(r.get("ok") for r in res)
            await notify(c["tg_id"],
                         f"🤖 Copy-trade za <code>{c['wallet']}</code>: "
                         f"{'✅ kupiono' if ok else '❌ fail'} <code>{token}</code> ({amount} USDC)")
    except Exception as e:  # noqa
        log.warning("copy_buy: %s", e)
