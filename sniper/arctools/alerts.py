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
                    # copy-trade: buy obserwowanego portfela (value > 0 = USDC in) / sell (value 0 → mirror sells)
                    if frm in copy_map and to in routers:
                        for c in copy_map[frm]:
                            if val_usdc > 0:
                                asyncio.create_task(_copy_buy(c, tx, val_usdc))
                            else:
                                asyncio.create_task(_copy_sell(c, tx))
            await asyncio.sleep(CFG.poll_interval)
        except Exception as e:  # noqa
            log.warning("watch_tx: %s", e)
            await asyncio.sleep(2)


async def _copy_buy(c: dict, src_tx, leader_usdc: float = 0.0):
    """Mirror buy: dekoduje token z receiptu (pierwszy Transfer do kupujacego). Honours the user's copy filters."""
    from . import wallets as W
    from .autosnipe import get_cpf
    try:
        f = await get_cpf(c["tg_id"])
        if float(f.get("min_usd") or 0) > 0 and leader_usdc < float(f["min_usd"]):
            return
        if int(f.get("max_open") or 0):
            from sqlalchemy import select as _sel
            n_open = len(await db.fetchall(_sel(db.positions.c.id).where((db.positions.c.tg_id == c["tg_id"]) & (db.positions.c.status == "open"))))
            if n_open >= int(f["max_open"]):
                return
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
        if f.get("mode") == "prop" and leader_usdc > 0:
            amount = max(1.0, round(leader_usdc * float(f.get("pct") or 10) / 100, 2))
        pad, key = await auto_pad(token)
        res = await sniper.execute_buy(c["tg_id"], token, pad, amount,
                                       u["slippage"], u["gas_mode"], [w["id"]], curve=key)
        if notify:
            ok = any(r.get("ok") for r in res)
            prot = next((r.get("protect") for r in res if r.get("ok")), None) or []
            await notify(c["tg_id"],
                         f"🤖 Copy-trade of <code>{c['wallet']}</code>: "
                         f"{'✅ bought' if ok else '❌ failed'} <code>{token}</code> ({amount:g} USDC, leader {leader_usdc:,.0f} USDC)"
                         + (f"\n🛡 {', '.join(prot)}" if prot else ""))
    except Exception as e:  # noqa
        log.warning("copy_buy: %s", e)


async def _copy_sell(c: dict, src_tx):
    """Mirror sell: the leader sent tokens to a router (Transfer FROM leader) and we hold that token → sell 100%."""
    from .autosnipe import get_cpf
    from sqlalchemy import select as _sel
    try:
        f = await get_cpf(c["tg_id"])
        if not int(f.get("mirror_sells", 1)):
            return
        rcpt = await CHAIN.w3.eth.get_transaction_receipt(src_tx["hash"])
        leader = (src_tx.get("from") or "").lower()
        token = None
        for lg in rcpt["logs"]:
            topics = [t.hex() if hasattr(t, "hex") else t for t in lg["topics"]]
            if topics and topics[0].lower() == TRANSFER_TOPIC and len(topics) >= 3:
                from_addr = "0x" + topics[1][-40:]
                if from_addr.lower() == leader:
                    token = lg["address"].lower()
                    break
        if not token:
            return
        poss = await db.fetchall(_sel(db.positions).where((db.positions.c.tg_id == c["tg_id"]) & (db.positions.c.status == "open")))
        for p in poss:
            if (p["token"] or "").lower() != token or (p["amount_tokens"] or 0) <= 0:
                continue
            res = await sniper.execute_sell(c["tg_id"], p, 100, "turbo")
            if notify:
                await notify(c["tg_id"], f"🪞 Mirror sell: <code>{c['wallet']}</code> sold <b>{p['symbol']}</b> → "
                             + (f"✅ sold 100% for {res.get('usdc', 0):.2f} USDC" if res.get("ok") else f"❌ sell failed: {res.get('err')}"))
    except Exception as e:  # noqa
        log.warning("copy_sell: %s", e)
