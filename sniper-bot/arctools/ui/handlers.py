"""aiogram 3 handlers: everything on inline buttons. Paste a CA anywhere and
the full Maestro-style buy panel opens (amount / slippage / gas / venue / mode
/ multi-wallet + live quote)."""
import time
import logging
from aiogram import Router, F
from aiogram.filters import CommandStart, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, CallbackQuery
from sqlalchemy import select, insert, update, delete
from eth_utils import is_address, to_checksum_address

from ..config import CFG
from ..chain import CHAIN
from ..pads import PADS, pad_by_name, default_pad, token_overview, quote_usdc_to_token
from .. import db, wallets, sniper, portfolio, feed, bridge
from .keyboards import (kb, main_menu, back, snipe_card, position_card,
                        AMOUNTS, SLIPPAGES, GAS_MODES, MODES)

log = logging.getLogger("ui")
router = Router()

DRAFTS: dict[int, dict] = {}


class St(StatesGroup):
    snipe_amt = State()
    import_pk = State()
    copy_addr = State()
    alert_grad = State()
    alert_deployer = State()
    bridge_amt = State()
    set_buy = State()


def short(a: str) -> str:
    return f"{a[:6]}…{a[-4:]}"


async def edit(cb: CallbackQuery, text: str, markup=None):
    try:
        await cb.message.edit_text(text, reply_markup=markup, parse_mode="HTML",
                                   disable_web_page_preview=True)
    except Exception:  # noqa - "message is not modified"
        pass
    await cb.answer()


@router.message(CommandStart())
async def start(m: Message, state: FSMContext, command: CommandObject = None):
    await state.clear()
    await db.get_user(m.from_user.id)
    # deep link: /start ca_<hex40> -> open the buy panel straight away
    payload = (command.args if command else None) or ""
    if payload.startswith("ca_") and is_address("0x" + payload[3:]):
        await open_ca_panel(m, "0x" + payload[3:])
        return
    # deep link: /start copy_<hex40> -> add an Insider wallet as a copy target
    if payload.startswith("copy_") and is_address("0x" + payload[5:]):
        wallet = to_checksum_address("0x" + payload[5:])
        dupe = await db.fetchone(select(db.copytargets).where(
            (db.copytargets.c.tg_id == m.from_user.id) & (db.copytargets.c.wallet == wallet)))
        if dupe:
            await db.execute(update(db.copytargets).where(db.copytargets.c.id == dupe["id"]).values(enabled=1))
        else:
            await db.execute(insert(db.copytargets).values(
                tg_id=m.from_user.id, wallet=wallet, amount_usdc=0, enabled=1))
        await m.answer(
            f"🤖 <b>Copy-trade armed</b> for Insider wallet:\n<code>{wallet}</code>\n\n"
            "Every buy this wallet makes will be mirrored from YOUR active wallet "
            "(default amount, turbo gas). Manage it in the 🤖 Copy-trade menu — "
            "set a fixed USDC amount per copied trade there.\n\n"
            "Make sure your wallet is funded: menu → 👛 Wallets.",
            reply_markup=main_menu(), parse_mode="HTML")
        return
    await m.answer(
        "🛠 <b>ArcTools</b> — the sniper terminal for Arc\n"
        f"Chain ID: <code>{CFG.chain_id}</code> | gas: native USDC | venues: "
        + (", ".join(p.name for p in PADS) or "none")
        + "\n\n💡 Paste any <b>contract address</b> to open the buy panel.",
        reply_markup=main_menu(), parse_mode="HTML")


@router.callback_query(F.data == "menu")
async def menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await edit(cb, "🛠 <b>ArcTools</b> — main menu\n\n💡 Paste any contract address to open the buy panel.",
               main_menu())


# ============ WALLETS ============

@router.callback_query(F.data == "wallets")
async def wallets_menu(cb: CallbackQuery):
    u = await db.get_user(cb.from_user.id)
    ws = await wallets.list_wallets(cb.from_user.id)
    lines = []
    rows = []
    for w in ws:
        bal = 0.0
        try:
            bal = await CHAIN.native_balance(w["address"])
        except Exception:  # noqa
            pass
        act = "⭐" if w["id"] == u["active_wallet"] else "▫️"
        lines.append(f"{act} <code>{w['address']}</code> — {bal:.2f} USDC")
        rows.append([(f"{act} {short(w['address'])} ({bal:.1f})", f"w_sel:{w['id']}"),
                     ("🗑", f"w_del:{w['id']}")])
    rows.append([("➕ New wallet", "w_new"), ("📥 Import", "w_imp")])
    rows.append(back())
    await edit(cb, "👛 <b>Wallets</b>\n" + ("\n".join(lines) or "No wallets yet. Create or import one."), kb(rows))


@router.callback_query(F.data == "w_new")
async def w_new(cb: CallbackQuery):
    w = await wallets.create_wallet(cb.from_user.id)
    ws = await wallets.list_wallets(cb.from_user.id)
    await db.set_user(cb.from_user.id, active_wallet=ws[-1]["id"])
    await edit(cb, f"✅ New wallet:\n<code>{w['address']}</code>\n\n"
                   "Send USDC on Arc to it (USDC is the gas too).", kb([back("wallets")]))


@router.callback_query(F.data == "w_imp")
async def w_imp(cb: CallbackQuery, state: FSMContext):
    await state.set_state(St.import_pk)
    await edit(cb, "📥 Send your <b>private key</b> (the message gets deleted).", kb([back("wallets")]))


@router.message(St.import_pk)
async def w_imp_pk(m: Message, state: FSMContext):
    await state.clear()
    try:
        w = await wallets.import_wallet(m.from_user.id, m.text.strip())
        ws = await wallets.list_wallets(m.from_user.id)
        await db.set_user(m.from_user.id, active_wallet=ws[-1]["id"])
        txt = f"✅ Imported <code>{w['address']}</code>"
    except Exception as e:  # noqa
        txt = f"❌ Invalid key: {e}"
    try:
        await m.delete()
    except Exception:  # noqa
        pass
    await m.answer(txt, reply_markup=kb([back("wallets")]), parse_mode="HTML")


@router.callback_query(F.data.startswith("w_sel:"))
async def w_sel(cb: CallbackQuery):
    await db.set_user(cb.from_user.id, active_wallet=int(cb.data.split(":")[1]))
    await wallets_menu(cb)


@router.callback_query(F.data.startswith("w_del:"))
async def w_del(cb: CallbackQuery):
    await wallets.delete_wallet(int(cb.data.split(":")[1]), cb.from_user.id)
    await wallets_menu(cb)


# ============ CA PANEL (Maestro-style) ============

async def draft_text(s: dict) -> str:
    t = s["token"] or "❇️ first new token from the venue"
    head = "🔫 <b>Buy panel</b>\n"
    if s["token"]:
        info = s.get("info") or {}
        sym = info.get("symbol", "?")
        p1m = info.get("price_1m")
        price_s = f"{p1m:,.2f} USDC" if p1m is not None else "no V3 pool quote (curve token?)"
        est = None
        if p1m is not None:
            est = await quote_usdc_to_token(s["token"], s["amount_usdc"])
        est_s = ""
        if est is not None:
            dec = info.get("decimals", 18)
            est_s = f"\n📦 Est. for {s['amount_usdc']:g} USDC: <b>{est / 10 ** dec:,.0f} {sym}</b>"
        head += (f"Token: <b>{sym}</b>\n<code>{t}</code>\n"
                 f"💧 1M {sym} ≈ {price_s}{est_s}\n")
    else:
        head += f"Token: {t}\n"
    head += "<i>Sell tax ignored: we buy at any cost. 1% service fee per trade.</i>"
    return head


async def open_ca_panel(m: Message, token: str):
    u = await db.get_user(m.from_user.id)
    w = await wallets.active_wallet(m.from_user.id)
    if not w:
        await m.answer("❌ Add a wallet first.", reply_markup=kb([[("👛 Wallets", "wallets")]]))
        return
    # walidacja: adres musi byc kontraktem (EOA/portfel to nie token)
    try:
        from ..chain import CHAIN
        code = await CHAIN.call_any(lambda w3: w3.eth.get_code(to_checksum_address(token)))
        if not code or len(code) <= 2:
            await m.answer(
                "❌ That address is a wallet, not a token contract.\n"
                f"<code>{token}</code>\n\n"
                "Paste a token CA to open the buy panel.",
                parse_mode="HTML")
            return
    except Exception:  # noqa - RPC hiccup: nie blokuj panelu
        pass
    info = await token_overview(token)
    DRAFTS[m.from_user.id] = {
        "token": to_checksum_address(token), "pad": "auto",
        "amount_usdc": u["buy_usdc"], "slippage": u["slippage"],
        "gas_mode": u["gas_mode"], "mode": "instant",
        "wallet_ids": [w["id"]], "info": info,
    }
    s = DRAFTS[m.from_user.id]
    await m.answer(await draft_text(s), parse_mode="HTML",
                   reply_markup=snipe_card(s, [p.name for p in PADS]),
                   disable_web_page_preview=True)


async def refresh_draft(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        await cb.answer("Panel expired, paste the CA again", show_alert=True)
        return
    try:
        await cb.message.edit_text(await draft_text(s), parse_mode="HTML",
                                   reply_markup=snipe_card(s, [p.name for p in PADS]),
                                   disable_web_page_preview=True)
    except Exception:  # noqa
        pass
    await cb.answer()


# ============ SNIPER MENU ============

@router.callback_query(F.data == "sniper")
async def sniper_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    armed = await db.fetchall(select(db.snipes).where(
        (db.snipes.c.tg_id == cb.from_user.id) & (db.snipes.c.status == "armed")))
    rows = [[("📡 Snipe from feed", "sn_feed"), ("❇️ Any new token", "sn_any")]]
    lines = ["💡 Paste a contract address to open the buy panel."]
    for s in armed:
        t = short(s["token"]) if s["token"] else "any new token"
        lines.append(f"🔫 #{s['id']} {t} | {s['amount_usdc']:g} USDC | {s['pad']} | {s['mode']}")
        rows.append([(f"❌ Disarm #{s['id']}", f"sn_dis:{s['id']}")])
    rows.append(back())
    await edit(cb, "🔫 <b>Sniper</b>\n" + "\n".join(lines), kb(rows))


@router.callback_query(F.data == "sn_any")
async def sn_any(cb: CallbackQuery):
    u = await db.get_user(cb.from_user.id)
    w = await wallets.active_wallet(cb.from_user.id)
    if not w:
        return await cb.answer("Add a wallet first", show_alert=True)
    DRAFTS[cb.from_user.id] = {
        "token": "", "pad": "auto", "amount_usdc": u["buy_usdc"],
        "slippage": u["slippage"], "gas_mode": u["gas_mode"], "mode": "event",
        "wallet_ids": [w["id"]], "info": {},
    }
    s = DRAFTS[cb.from_user.id]
    await edit(cb, await draft_text(s), snipe_card(s, [p.name for p in PADS]))


# ---- panel toggles ----

@router.callback_query(F.data == "sn_amt")
async def sn_amt(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    cur = s["amount_usdc"]
    s["amount_usdc"] = AMOUNTS[(AMOUNTS.index(cur) + 1) % len(AMOUNTS)] if cur in AMOUNTS else AMOUNTS[0]
    await refresh_draft(cb)


@router.callback_query(F.data == "sn_amt_custom")
async def sn_amt_custom(cb: CallbackQuery, state: FSMContext):
    if cb.from_user.id not in DRAFTS:
        return await cb.answer("Panel expired", show_alert=True)
    await state.set_state(St.snipe_amt)
    await cb.answer()
    await cb.message.answer("✏️ Send the amount in USDC (e.g. <code>73.5</code>).", parse_mode="HTML")


@router.message(St.snipe_amt)
async def sn_amt_msg(m: Message, state: FSMContext):
    s = DRAFTS.get(m.from_user.id)
    try:
        amt = float(m.text.replace(",", "."))
        assert amt > 0
    except Exception:  # noqa
        return await m.answer("❌ Send a number above zero.")
    await state.clear()
    if not s:
        return await m.answer("Panel expired, paste the CA again.")
    s["amount_usdc"] = amt
    await m.answer(await draft_text(s), parse_mode="HTML",
                   reply_markup=snipe_card(s, [p.name for p in PADS]),
                   disable_web_page_preview=True)


@router.callback_query(F.data == "sn_gas")
async def sn_gas(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    s["gas_mode"] = GAS_MODES[(GAS_MODES.index(s["gas_mode"]) + 1) % len(GAS_MODES)]
    await refresh_draft(cb)


@router.callback_query(F.data == "sn_slip")
async def sn_slip(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    cur = s["slippage"]
    s["slippage"] = SLIPPAGES[(SLIPPAGES.index(cur) + 1) % len(SLIPPAGES)] if cur in SLIPPAGES else SLIPPAGES[0]
    await refresh_draft(cb)


@router.callback_query(F.data == "sn_pad")
async def sn_pad(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    names = ["auto"] + [p.name for p in PADS]
    s["pad"] = names[(names.index(s["pad"]) + 1) % len(names)]
    await refresh_draft(cb)


@router.callback_query(F.data == "sn_mode")
async def sn_mode(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    s["mode"] = MODES[(MODES.index(s["mode"]) + 1) % len(MODES)]
    await refresh_draft(cb)


@router.callback_query(F.data == "sn_wal")
async def sn_wal(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    ws = await wallets.list_wallets(cb.from_user.id)
    ids = [w["id"] for w in ws]
    n = len(s["wallet_ids"])
    n = n + 1 if n < len(ids) else 1
    s["wallet_ids"] = ids[:n]
    await cb.answer(f"Multi-wallet: {n} wallets (amount × {n})")
    await refresh_draft(cb)


@router.callback_query(F.data == "sn_quote")
async def sn_quote(cb: CallbackQuery):
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    if s["token"]:
        s["info"] = await token_overview(s["token"])
    await refresh_draft(cb)


@router.callback_query(F.data == "sn_arm")
async def sn_arm(cb: CallbackQuery):
    s = DRAFTS.pop(cb.from_user.id, None)
    if not s:
        return await cb.answer("Panel expired", show_alert=True)
    if s["mode"] == "instant" and s["token"]:
        pad = pad_by_name(s["pad"]) if s["pad"] != "auto" else default_pad()
        await edit(cb, "⚡ Buying…")
        res = await sniper.execute_buy(cb.from_user.id, s["token"], pad, s["amount_usdc"],
                                       s["slippage"], s["gas_mode"], s["wallet_ids"])
        lines = []
        for r in res:
            if r.get("ok"):
                lines.append(f"✅ <a href='{CFG.explorer}/tx/{r['tx']}'>tx</a> ({short(r['wallet'])})")
            else:
                if r.get("tx"):
                    lines.append(f"❌ <a href='{CFG.explorer}/tx/{r['tx']}'>tx reverted on-chain</a> "
                                 f"({short(r.get('wallet', ''))})")
                else:
                    lines.append(f"❌ {r.get('err', 'unknown error')} ({short(r.get('wallet', ''))})")
        await cb.message.answer("🔫 Result:\n" + "\n".join(lines), parse_mode="HTML",
                                disable_web_page_preview=True)
        # Maestro-style: open the live position panel right away
        if any(r.get("ok") for r in res):
            poss = await db.fetchall(select(db.positions).where(
                (db.positions.c.tg_id == cb.from_user.id) &
                (db.positions.c.token == s["token"]) &
                (db.positions.c.status == "open")).order_by(db.positions.c.id.desc()))
            for p in poss[:len([r for r in res if r.get("ok")])]:
                txt, markup = await render_position(p)
                await cb.message.answer(txt, parse_mode="HTML", reply_markup=markup,
                                        disable_web_page_preview=True)
        else:
            await cb.message.answer("Menu:", reply_markup=main_menu())
        return
    await db.execute(insert(db.snipes).values(
        tg_id=cb.from_user.id, token=s["token"], pad=s["pad"],
        amount_usdc=s["amount_usdc"], slippage=s["slippage"], gas_mode=s["gas_mode"],
        wallet_ids=",".join(map(str, s["wallet_ids"])), mode=s["mode"],
        status="armed", created_at=int(time.time())))
    await edit(cb, "✅ <b>ARMED.</b> I fire the moment the event lands.", kb([back("sniper")]))


@router.callback_query(F.data.startswith("sn_dis:"))
async def sn_disarm(cb: CallbackQuery, state: FSMContext):
    await db.execute(update(db.snipes).where(
        (db.snipes.c.id == int(cb.data.split(":")[1])) &
        (db.snipes.c.tg_id == cb.from_user.id)).values(status="cancelled"))
    await sniper_menu(cb, state)


# ============ FEED ============

@router.callback_query(F.data.in_({"feed", "sn_feed"}))
async def feed_menu(cb: CallbackQuery):
    items = await feed.recent_tokens()
    rows = []
    lines = []
    for it in items[:10]:
        lines.append(f"🆕 <b>{it['symbol']}</b> [{it['pad']}] <code>{it['token']}</code>")
        rows.append([(f"🔫 SNIPE {it['symbol']} ({it['pad']})", f"feedsn:{it['token']}")])
    rows.append(back())
    await edit(cb, "📡 <b>New pairs</b> (last 10)\n" +
               ("\n".join(lines) or "Quiet for now. Waiting for launch events."), kb(rows))


@router.callback_query(F.data.startswith("feedsn:"))
async def feed_snipe(cb: CallbackQuery):
    token = cb.data.split(":")[1]
    await cb.answer()
    await open_ca_panel(cb.message, token)


# ============ PORTFOLIO ============

async def render_position(p: dict) -> tuple[str, object]:
    from ..pads import quote_token_usdc
    from ..sniper import token_balance
    # samonaprawa: pozycja zapisana przy padnietym RPC ma 0 tokenow / symbol "?"
    if not p["amount_tokens"] or p["symbol"] == "?":
        try:
            live = await token_balance(p["token"], p["wallet"])
            if live > 0:
                p["amount_tokens"] = float(live)
            if p["symbol"] == "?":
                from ..pads import token_overview
                p["symbol"] = (await token_overview(p["token"]))["symbol"]
            from sqlalchemy import update as _upd
            from .. import db as _db
            await _db.execute(_upd(_db.positions).where(_db.positions.c.id == p["id"]).values(
                amount_tokens=p["amount_tokens"], symbol=p["symbol"]))
        except Exception:  # noqa
            pass
    cur = await quote_token_usdc(p["token"], int(p["amount_tokens"])) if p["amount_tokens"] else 0
    cur_v = cur or 0.0
    pnl = (p["realized_usdc"] + cur_v) - p["cost_usdc"]
    pct_pnl = (pnl / p["cost_usdc"] * 100) if p["cost_usdc"] else 0
    emoji = "🟢" if pnl >= 0 else "🔴"
    tp = f"{p['tp_mult']:g}x" if p["tp_mult"] else "off"
    cur_s = f"{cur_v:.2f} USDC" if cur is not None else "?"
    txt = (f"{emoji} <b>{p['symbol']}</b> [{p['pad']}]\n"
           f"CA: <code>{p['token']}</code>\n"
           f"Wallet: <code>{p['wallet']}</code>\n\n"
           f"💵 Entry: {p['cost_usdc']:.2f} USDC\n"
           f"💰 Value now: {cur_s}\n"
           f"♻️ Realized: {p['realized_usdc']:.2f} USDC\n"
           f"📈 PnL: <b>{pnl:+.2f} USDC ({pct_pnl:+.1f}%)</b>\n"
           f"🎯 TP: {tp}")
    return txt, position_card(p["id"])


@router.callback_query(F.data == "portfolio")
async def portfolio_menu(cb: CallbackQuery):
    txt = await portfolio.pnl_report(cb.from_user.id)
    poss = await portfolio.open_positions(cb.from_user.id)
    rows = [[(f"{p['symbol']} ({p['cost_usdc']:g} USDC)", f"pos:{p['id']}")] for p in poss]
    if poss:
        rows.append([("🚨 PANIC SELL ALL", "panic")])
    rows.append(back())
    await edit(cb, "📊 <b>Portfolio</b>\n" + txt, kb(rows))


@router.callback_query(F.data.startswith("pos:"))
async def pos_card(cb: CallbackQuery):
    p = await portfolio.position(int(cb.data.split(":")[1]))
    if not p:
        return await cb.answer("Position not found", show_alert=True)
    txt, markup = await render_position(p)
    await edit(cb, txt, markup)


@router.callback_query(F.data.startswith("buymore:"))
async def buy_more(cb: CallbackQuery):
    p = await portfolio.position(int(cb.data.split(":")[1]))
    if not p:
        return await cb.answer("Position not found", show_alert=True)
    await cb.answer()
    await open_ca_panel(cb.message, p["token"])


@router.callback_query(F.data.startswith("sell:"))
async def sell_cb(cb: CallbackQuery):
    _, pid, pct = cb.data.split(":")
    p = await portfolio.position(int(pid))
    if not p or p["tg_id"] != cb.from_user.id:
        return await cb.answer("Position not found", show_alert=True)
    await cb.answer("Selling…")
    res = await sniper.execute_sell(cb.from_user.id, p, int(pct))
    if res.get("ok"):
        await cb.message.answer(
            f"✅ Sold {pct}% of <b>{p['symbol']}</b> for {res['usdc']:.2f} USDC\n"
            f"<a href='{CFG.explorer}/tx/{res['tx']}'>tx</a>",
            parse_mode="HTML", disable_web_page_preview=True)
        p2 = await portfolio.position(int(pid))
        if p2 and p2["status"] == "open":
            txt, markup = await render_position(p2)
            await cb.message.answer(txt, parse_mode="HTML", reply_markup=markup,
                                    disable_web_page_preview=True)
    else:
        await cb.message.answer(f"❌ Sell failed: {res.get('err')}")


@router.callback_query(F.data.startswith("tp:"))
async def tp_cb(cb: CallbackQuery):
    _, pid, mult = cb.data.split(":")
    await db.execute(update(db.positions).where(
        (db.positions.c.id == int(pid)) & (db.positions.c.tg_id == cb.from_user.id)
    ).values(tp_mult=float(mult)))
    await cb.answer(f"TP = {mult}x" if mult != "0" else "TP off")
    cb2 = cb.model_copy(update={"data": f"pos:{pid}"})
    await pos_card(cb2)


@router.callback_query(F.data == "panic")
async def panic_cb(cb: CallbackQuery):
    await cb.answer("PANIC: selling everything!")
    res = await sniper.panic_sell(cb.from_user.id)
    ok = sum(1 for r in res if r.get("ok"))
    await cb.message.answer(f"🚨 Panic sell: {ok}/{len(res)} positions closed.")


# ============ ALERTS ============

@router.callback_query(F.data == "alerts")
async def alerts_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    rows_db = await db.fetchall(select(db.alerts).where(db.alerts.c.tg_id == cb.from_user.id))
    lines = []
    rows = []
    for a in rows_db:
        desc = {"grad": f"📈 graduation {short(a['target'])} @ {a['param']:g}%",
                "deployer": f"👀 deployer {short(a['target'])}",
                "whale": f"🐋 whale ≥ {CFG.whale_min_usdc:g} USDC"}.get(a["kind"], a["kind"])
        lines.append(desc)
        rows.append([(f"🗑 {desc}", f"al_del:{a['id']}")])
    rows.append([("➕ Graduation", "al_grad"), ("➕ Deployer", "al_dep"), ("➕ Whale", "al_whale")])
    rows.append(back())
    await edit(cb, "🔔 <b>Alerts</b>\n" + ("\n".join(lines) or "No alerts yet."), kb(rows))


@router.callback_query(F.data == "al_grad")
async def al_grad(cb: CallbackQuery, state: FSMContext):
    await state.set_state(St.alert_grad)
    await edit(cb, "📈 Send: <code>CA threshold%</code> e.g. <code>0xabc… 90</code>", kb([back("alerts")]))


@router.message(St.alert_grad)
async def al_grad_msg(m: Message, state: FSMContext):
    try:
        ca, pct = m.text.split()
        assert is_address(ca)
        await db.execute(insert(db.alerts).values(
            tg_id=m.from_user.id, kind="grad", target=to_checksum_address(ca), param=float(pct)))
        await state.clear()
        await m.answer("✅ Graduation alert added.", reply_markup=kb([back("alerts")]))
    except Exception:  # noqa
        await m.answer("❌ Format: CA threshold%")


@router.callback_query(F.data == "al_dep")
async def al_dep(cb: CallbackQuery, state: FSMContext):
    await state.set_state(St.alert_deployer)
    await edit(cb, "👀 Send the deployer address to watch.", kb([back("alerts")]))


@router.message(St.alert_deployer)
async def al_dep_msg(m: Message, state: FSMContext):
    ca = m.text.strip()
    if not is_address(ca):
        return await m.answer("❌ Not an address.")
    await db.execute(insert(db.alerts).values(
        tg_id=m.from_user.id, kind="deployer", target=to_checksum_address(ca), param=0))
    await state.clear()
    await m.answer("✅ Deployer watch added.", reply_markup=kb([back("alerts")]))


@router.callback_query(F.data == "al_whale")
async def al_whale(cb: CallbackQuery, state: FSMContext):
    await db.execute(insert(db.alerts).values(
        tg_id=cb.from_user.id, kind="whale", target="", param=0))
    await alerts_menu(cb, state)


@router.callback_query(F.data.startswith("al_del:"))
async def al_del(cb: CallbackQuery, state: FSMContext):
    await db.execute(delete(db.alerts).where(
        (db.alerts.c.id == int(cb.data.split(":")[1])) & (db.alerts.c.tg_id == cb.from_user.id)))
    await alerts_menu(cb, state)


# ============ COPY-TRADE ============

@router.callback_query(F.data == "copy")
async def copy_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    rows_db = await db.fetchall(select(db.copytargets).where(db.copytargets.c.tg_id == cb.from_user.id))
    rows = []
    lines = []
    for c in rows_db:
        st = "🟢" if c["enabled"] else "⚪"
        amt = f"{c['amount_usdc']:g} USDC" if c["amount_usdc"] else "default amount"
        lines.append(f"{st} <code>{c['wallet']}</code> ({amt})")
        rows.append([(f"{st} {short(c['wallet'])}", f"cp_tog:{c['id']}"), ("🗑", f"cp_del:{c['id']}")])
    rows.append([("➕ Add wallet", "cp_add")])
    rows.append(back())
    await edit(cb, "🤖 <b>Copy-trade</b>\nMirrors the buys of tracked wallets (your active wallet, turbo gas).\n"
               + ("\n".join(lines) or ""), kb(rows))


@router.callback_query(F.data == "cp_add")
async def cp_add(cb: CallbackQuery, state: FSMContext):
    await state.set_state(St.copy_addr)
    await edit(cb, "🤖 Send: <code>address [amount USDC]</code>", kb([back("copy")]))


@router.message(St.copy_addr)
async def cp_add_msg(m: Message, state: FSMContext):
    parts = m.text.split()
    if not parts or not is_address(parts[0]):
        return await m.answer("❌ Format: address [amount]")
    amt = float(parts[1]) if len(parts) > 1 else 0
    await db.execute(insert(db.copytargets).values(
        tg_id=m.from_user.id, wallet=to_checksum_address(parts[0]), amount_usdc=amt, enabled=1))
    await state.clear()
    await m.answer("✅ Copy target added.", reply_markup=kb([back("copy")]))


@router.callback_query(F.data.startswith("cp_tog:"))
async def cp_tog(cb: CallbackQuery, state: FSMContext):
    cid = int(cb.data.split(":")[1])
    c = await db.fetchone(select(db.copytargets).where(db.copytargets.c.id == cid))
    if c:
        await db.execute(update(db.copytargets).where(db.copytargets.c.id == cid)
                         .values(enabled=0 if c["enabled"] else 1))
    await copy_menu(cb, state)


@router.callback_query(F.data.startswith("cp_del:"))
async def cp_del(cb: CallbackQuery, state: FSMContext):
    await db.execute(delete(db.copytargets).where(
        (db.copytargets.c.id == int(cb.data.split(":")[1])) &
        (db.copytargets.c.tg_id == cb.from_user.id)))
    await copy_menu(cb, state)


# ============ BRIDGE ============

@router.callback_query(F.data == "bridge")
async def bridge_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    rows = [
        [("Ethereum", "br:eth"), ("Base", "br:base"), ("Arbitrum", "br:arb")],
        back(),
    ]
    await edit(cb, "🌉 <b>CCTP v2 bridge</b> → Arc\n\n"
                   "⚠️ <b>CIRCLE HAS PAUSED CCTP TO ARC UNTIL SEPT 16.</b>\n"
                   "Bridged funds may only arrive on Sept 16 (possibly earlier, no guarantee). "
                   "Burns go through, so your USDC waits in transit until Circle resumes. "
                   "<b>We recommend NOT bridging before Sept 16.</b>\n\n"
                   "USDC arrives on the SAME address as your active wallet (native mint, domain 26).\n"
                   "Service fee: 2% of the bridged amount.\n"
                   "Pick the source chain:", kb(rows))


@router.callback_query(F.data.startswith("br:"))
async def br_src(cb: CallbackQuery, state: FSMContext):
    src = cb.data.split(":")[1]
    await state.set_state(St.bridge_amt)
    await state.update_data(src=src)
    await edit(cb, f"🌉 {bridge.SOURCES[src]['label']} → Arc\nSend the USDC amount (e.g. <code>100</code>).",
               kb([back("bridge")]))


@router.message(St.bridge_amt)
async def br_amt(m: Message, state: FSMContext):
    data = await state.get_data()
    await state.clear()
    try:
        amount = float(m.text.replace(",", "."))
    except ValueError:
        return await m.answer("❌ Send a number.")
    w = await wallets.active_wallet(m.from_user.id)
    if not w:
        return await m.answer("❌ No active wallet.")
    acct = wallets.account_of(w)
    status = await m.answer("🌉 Starting the bridge…")

    async def cb_status(t):
        try:
            await status.edit_text(f"🌉 {t}")
        except Exception:  # noqa
            pass

    res = await bridge.bridge_to_arc(acct, data["src"], amount, cb_status)
    if res.get("ok"):
        await status.edit_text(
            f"✅ Bridged!\nBurn: <code>{res['burn_tx']}</code>\nMint (Arc): <code>{res['mint_tx']}</code>",
            parse_mode="HTML")
    else:
        await status.edit_text(f"❌ Bridge failed: {res.get('err')}")


# ============ SETTINGS ============

@router.callback_query(F.data == "settings")
async def settings_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    u = await db.get_user(cb.from_user.id)
    rows = [
        [(f"💵 Default buy: {u['buy_usdc']:g} USDC", "set_buy")],
        [(f"📉 Slippage: {u['slippage']}%", "set_slip"),
         (f"⛽ Gas: {u['gas_mode']}", "set_gas")],
        back(),
    ]
    await edit(cb, "⚙️ <b>Default settings</b>", kb(rows))


@router.callback_query(F.data == "set_buy")
async def set_buy(cb: CallbackQuery, state: FSMContext):
    await state.set_state(St.set_buy)
    await edit(cb, "💵 Send the default buy amount in USDC.", kb([back("settings")]))


@router.message(St.set_buy)
async def set_buy_msg(m: Message, state: FSMContext):
    try:
        amt = float(m.text.replace(",", "."))
        await db.set_user(m.from_user.id, buy_usdc=amt)
        await state.clear()
        await m.answer(f"✅ Default buy: {amt:g} USDC", reply_markup=kb([back("settings")]))
    except ValueError:
        await m.answer("❌ Send a number.")


@router.callback_query(F.data == "set_slip")
async def set_slip(cb: CallbackQuery, state: FSMContext):
    u = await db.get_user(cb.from_user.id)
    cur = u["slippage"]
    nxt = SLIPPAGES[(SLIPPAGES.index(cur) + 1) % len(SLIPPAGES)] if cur in SLIPPAGES else SLIPPAGES[0]
    await db.set_user(cb.from_user.id, slippage=nxt)
    await settings_menu(cb, state)


@router.callback_query(F.data == "set_gas")
async def set_gas(cb: CallbackQuery, state: FSMContext):
    u = await db.get_user(cb.from_user.id)
    nxt = GAS_MODES[(GAS_MODES.index(u["gas_mode"]) + 1) % len(GAS_MODES)]
    await db.set_user(cb.from_user.id, gas_mode=nxt)
    await settings_menu(cb, state)


# ============ GLOBAL CA CATCH-ALL (must stay LAST) ============

@router.message(F.text)
async def any_text(m: Message, state: FSMContext):
    """Paste a CA anywhere -> the buy panel opens (Maestro-style)."""
    if await state.get_state():
        return  # an FSM flow owns this message
    txt = (m.text or "").strip()
    ca = next((w for w in txt.split() if is_address(w)), None)
    if ca:
        await open_ca_panel(m, ca)
    else:
        await m.answer("💡 Paste a contract address to open the buy panel, or use the menu.",
                       reply_markup=main_menu())
