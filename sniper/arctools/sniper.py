"""Silnik snipera: egzekucja buy/sell + watcher eventow fabryk padow.

Zasada: kupujemy za wszelka cene - minOut=0, brak checku taxow.
Szybkosc: gaz turbo, race-broadcast na wszystkie RPC.
UniV3: tokenIn = USDC facade (approve raz na portfel, potem swapy bez zwlok).
Curve (Warp): buy na kontrakt curve z eventu launchu, natywne value.
"""
import asyncio
import logging
import time
from sqlalchemy import select, insert, update
from eth_utils import to_checksum_address
from .config import CFG
from .chain import CHAIN
from .pads import PADS, Pad, pad_by_name, default_pad
from . import db, referral, wallets

log = logging.getLogger("sniper")

notify = None          # async def notify(tg_id, text)
feed_publish = None    # async def feed_publish(token, pad_name)

MAX_UINT = 2 ** 256 - 1


async def ensure_allowance(acct, token: str, spender: str, need: int, gas_mode: str = "fast"):
    ca = to_checksum_address(token)
    allowance = await CHAIN.call_any(
        lambda w3: CHAIN.erc20(ca, w3).functions.allowance(
            acct.address, to_checksum_address(spender)).call())
    if allowance >= need:
        return None
    erc = CHAIN.erc20(ca)
    tx = await CHAIN.build_tx(acct, token, erc.encode_abi("approve",
                              [to_checksum_address(spender), MAX_UINT]), gas_mode=gas_mode)
    h = await CHAIN.send(acct, tx)
    await CHAIN.wait_receipt(h)
    return h


async def token_balance(token: str, owner: str) -> int:
    """balanceOf z failoverem przez wszystkie RPC."""
    ca = to_checksum_address(token)
    return await CHAIN.call_any(
        lambda w3: CHAIN.erc20(ca, w3).functions.balanceOf(owner).call())


async def preapprove_wallet(acct):
    """Approve USDC facade -> SwapRouter02 z gory, zeby snipe byl 1 tx."""
    try:
        await ensure_allowance(acct, CFG.wrapped_usdc, CFG.univ3_router, MAX_UINT // 2)
        # Uniswap V4 facade pools via our ArcV4Router
        from .pads import ARC_V4_ROUTER
        await ensure_allowance(acct, CFG.wrapped_usdc, ARC_V4_ROUTER, MAX_UINT // 2)
    except Exception as e:  # noqa
        log.warning("preapprove: %s", e)


async def send_fee(acct, usdc_amount: float, label: str = "trade"):
    """Service fee: native USDC transfer to the fee wallet (never blocks a trade)."""
    try:
        if usdc_amount <= 0 or not CFG.fee_wallet:
            return
        tx = await CHAIN.build_tx(acct, CFG.fee_wallet, b"",
                                  value_wei=int(usdc_amount * 1e18),
                                  gas_mode="normal", gas_limit=30_000)
        h = await CHAIN.send(acct, tx)
        log.info("fee %s %.4f USDC tx %s", label, usdc_amount, h)
    except Exception as e:  # noqa
        log.warning("fee transfer failed (%s): %s", label, e)


async def execute_buy(tg_id: int, token: str, pad: Pad, amount_usdc: float,
                      slippage: int, gas_mode: str, wallet_ids: list[int],
                      curve: str | None = None) -> list[dict]:
    fee = amount_usdc * CFG.trade_fee_bps / 10_000
    net_amount = amount_usdc - fee

    import json as _json
    if pad.router_kind == "univ4":
        if isinstance(curve, str) and curve.startswith("{"):
            curve = _json.loads(curve)
        if not isinstance(curve, dict):
            from .pads import resolve_v4_key
            curve = await resolve_v4_key(token)
        if not curve:
            return [{"ok": False, "err": "no Uniswap V4 pool found for this token"}]

    async def _one(wid: int):
        w = await wallets.get_wallet(wid)
        if not w:
            return {"ok": False, "err": f"brak portfela {wid}"}
        acct = wallets.account_of(w)
        try:
            to, data, value, approve_spender = pad.buy_calldata(token, acct.address, net_amount,
                                                                min_out=0, curve=curve)
            if approve_spender:
                from .pads import usdc_units
                await ensure_allowance(acct, CFG.wrapped_usdc, approve_spender,
                                       usdc_units(net_amount), gas_mode)
            # snipe = szybkosc: staly gas limit, zero roundtripu na estymacje
            tx = await CHAIN.build_tx(acct, to, data, value_wei=value, gas_mode=gas_mode,
                                      gas_limit=800_000)
            h = await CHAIN.send(acct, tx)
            rcpt = await CHAIN.wait_receipt(h)
            ok = rcpt["status"] == 1
            got, sym = 0, "?"
            if ok:
                for attempt in range(4):  # balans moze dojsc z opoznieniem 1 bloku
                    try:
                        got = await token_balance(token, acct.address)
                        if got > 0:
                            break
                    except Exception:  # noqa
                        pass
                    await asyncio.sleep(1.5)
                try:
                    sym = await CHAIN.call_any(
                        lambda w3: CHAIN.erc20(to_checksum_address(token), w3).functions.symbol().call())
                except Exception:  # noqa
                    pass
                await db.execute(insert(db.positions).values(
                    tg_id=tg_id, wallet=acct.address, token=token, symbol=sym,
                    pad=pad.name, curve=(_json.dumps(curve) if isinstance(curve, dict) else (curve or "")),
                    amount_tokens=float(got),
                    cost_usdc=amount_usdc, created_at=int(time.time())))
                await db.execute(insert(db.trades).values(
                    tg_id=tg_id, token=token, side="buy", usdc=amount_usdc,
                    tokens=float(got), tx=h, ts=int(time.time())))
                asyncio.create_task(send_fee(acct, fee, "buy"))
                asyncio.create_task(referral.credit(tg_id, h, fee))
            return {"ok": ok, "tx": h, "tokens": got, "wallet": acct.address}
        except Exception as e:  # noqa
            log.exception("buy fail")
            return {"ok": False, "err": str(e)[:200], "wallet": acct.address}

    return list(await asyncio.gather(*[_one(w) for w in wallet_ids]))


async def execute_sell(tg_id: int, pos: dict, pct: int, gas_mode: str = "turbo") -> dict:
    pad = pad_by_name(pos["pad"]) or default_pad()
    ws = await wallets.list_wallets(tg_id)
    w = next((x for x in ws if x["address"].lower() == pos["wallet"].lower()), None)
    if not w:
        return {"ok": False, "err": "brak portfela pozycji"}
    acct = wallets.account_of(w)
    token = to_checksum_address(pos["token"])
    try:
        bal = await token_balance(token, acct.address)
        amount = bal * pct // 100
        if amount <= 0:
            return {"ok": False, "err": "balans 0"}
        curve = pos.get("curve") or None
        if pad.router_kind == "univ4":
            import json as _json
            from .pads import resolve_v4_key
            curve = _json.loads(curve) if (isinstance(curve, str) and curve.startswith("{")) else await resolve_v4_key(token)
            if not curve:
                return {"ok": False, "err": "no Uniswap V4 pool for this token"}
        to, data, approve_spender = pad.sell_calldata(token, acct.address, amount,
                                                      min_out=0, curve=curve)
        await ensure_allowance(acct, token, approve_spender, amount, gas_mode)
        pre = await token_balance(CFG.wrapped_usdc, acct.address)
        tx = await CHAIN.build_tx(acct, to, data, gas_mode=gas_mode)
        h = await CHAIN.send(acct, tx)
        rcpt = await CHAIN.wait_receipt(h)
        ok = rcpt["status"] == 1
        post = await token_balance(CFG.wrapped_usdc, acct.address)
        got_usdc = max(0.0, (post - pre) / 1e6)
        fee_amt = got_usdc * CFG.trade_fee_bps / 10_000
        got_usdc = got_usdc - fee_amt
        if ok:
            asyncio.create_task(send_fee(acct, fee_amt, "sell"))
            asyncio.create_task(referral.credit(tg_id, h, fee_amt))
            new_amount = pos["amount_tokens"] * (100 - pct) / 100
            await db.execute(update(db.positions).where(db.positions.c.id == pos["id"]).values(
                amount_tokens=new_amount,
                realized_usdc=pos["realized_usdc"] + got_usdc,
                status="open" if pct < 100 else "closed"))
            await db.execute(insert(db.trades).values(
                tg_id=tg_id, token=token, side="sell", usdc=got_usdc,
                tokens=float(amount), tx=h, ts=int(time.time())))
        return {"ok": ok, "tx": h, "usdc": got_usdc}
    except Exception as e:  # noqa
        log.exception("sell fail")
        return {"ok": False, "err": str(e)[:200]}


async def panic_sell(tg_id: int) -> list[dict]:
    poss = await db.fetchall(select(db.positions).where(
        (db.positions.c.tg_id == tg_id) & (db.positions.c.status == "open")))
    out = []
    for p in poss:
        out.append(await execute_sell(tg_id, p, 100, "turbo"))
    return out


# ---------------- WATCHER ----------------

async def _fire_armed_snipes(info: dict, pad: Pad, kind: str):
    token = info["token"]
    curve = info.get("curve")
    rows = await db.fetchall(select(db.snipes).where(db.snipes.c.status == "armed"))
    for s in rows:
        match_token = (not s["token"]) or s["token"].lower() == token.lower()
        match_pad = s["pad"] in ("auto", pad.name)
        want = "migration" if kind == "migrated" else "event"
        if not (match_token and match_pad and s["mode"] == want):
            continue
        wids = [int(x) for x in s["wallet_ids"].split(",") if x]
        res = await execute_buy(s["tg_id"], token, pad, s["amount_usdc"],
                                s["slippage"], s["gas_mode"], wids, curve=curve)
        ok = any(r.get("ok") for r in res)
        await db.execute(update(db.snipes).where(db.snipes.c.id == s["id"]).values(
            status="done" if ok else "failed",
            result="; ".join(str(r.get("tx", r.get("err", "?"))) for r in res)))
        if notify:
            lines = [f"{'✅' if r.get('ok') else '❌'} <code>{r.get('tx', r.get('err'))}</code>" for r in res]
            markup = None
            try:
                from .ui.keyboards import kb
                markup = kb([[("📊 Open positions", "portfolio")]])
            except Exception:  # noqa
                pass
            await notify(s["tg_id"],
                         f"🔫 SNIPE {'FILLED' if ok else 'FAILED'}\n"
                         f"Token: <code>{token}</code>\nVenue: {pad.name} ({kind})\n" + "\n".join(lines),
                         markup)


async def watcher_loop():
    if not CHAIN or not PADS:
        log.warning("watcher: brak RPC albo padow")
        return
    last = await CHAIN.w3.eth.block_number
    log.info("watcher start @ block %s, pady: %s", last, [p.name for p in PADS])
    seen: set[str] = set()
    while True:
        try:
            head = await CHAIN.w3.eth.block_number
            if head <= last:
                await asyncio.sleep(CFG.poll_interval)
                continue
            frm = last + 1
            to = min(head, frm + CFG.max_block_range - 1)
            for pad in PADS:
                if not (pad.factory and pad.event_topic):
                    continue
                topic_sets = [(pad.event_topic, "created")]
                if pad.migration_topic:
                    topic_sets.append((pad.migration_topic, "migrated"))
                for topic, kind in topic_sets:
                    try:
                        logs = await CHAIN.get_logs(
                            address=to_checksum_address(pad.factory),
                            topics=[topic], from_block=frm, to_block=to)
                    except Exception as e:  # noqa
                        log.warning("get_logs %s: %s", pad.name, e)
                        continue
                    for lg in logs:
                        info = pad.parse_log(lg)
                        if not info or not info.get("token"):
                            continue
                        key = f"{pad.name}:{kind}:{info['token']}"
                        if key in seen:
                            continue
                        seen.add(key)
                        if pad.router_kind == "univ4":
                            info["curve"] = await _v4_key_from_launch(lg, info["token"])
                        log.info("[%s] %s %s", pad.name, kind, info)
                        asyncio.create_task(_fire_armed_snipes(info, pad, kind))
                        if feed_publish and kind == "created" and pad.name != "UniswapV3":
                            asyncio.create_task(feed_publish(info["token"], pad.name))
                        elif feed_publish and kind == "created":
                            # generyczny V3: publikuj tylko jesli zaden pad nie zglosil
                            asyncio.create_task(_publish_if_unknown(info["token"]))
            last = to
        except Exception as e:  # noqa
            log.warning("watcher err: %s", e)
            await asyncio.sleep(2)
        await asyncio.sleep(CFG.poll_interval)


async def _v4_key_from_launch(lg, token: str):
    """Launch tx of a V4 pad contains PoolManager.Initialize — take the PoolKey straight from the receipt (zero extra
    latency at snipe time); fallback to the resolver."""
    import json as _json
    from .pads import poolkey_from_init_log, resolve_v4_key
    try:
        rcpt = await CHAIN.call_any(lambda w3: w3.eth.get_transaction_receipt(lg["transactionHash"]))
        for x in rcpt["logs"]:
            k = poolkey_from_init_log(x, token)
            if k:
                return _json.dumps(k)
    except Exception as e:  # noqa
        log.warning("v4 key from launch: %s", e)
    k = await resolve_v4_key(token)
    return _json.dumps(k) if k else None


async def _publish_if_unknown(token: str):
    await asyncio.sleep(2)  # daj szanse dedykowanym padom
    import json
    recent = json.loads(await db.kv_get("recent_tokens", "[]"))
    if not any(r["token"].lower() == token.lower() for r in recent):
        await feed_publish(token, "UniswapV3")
