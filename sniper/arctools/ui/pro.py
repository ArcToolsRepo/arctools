"""Pro panels: position orders (SL / trailing / dump guard), Protection defaults, Auto-snipe rules,
limit buys and copy-trade filters. Split from handlers.py to keep that file readable."""
from __future__ import annotations

import time

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message
from sqlalchemy import delete, insert, select, update

from .. import autosnipe, db, orders, portfolio
from .keyboards import back, kb

router = Router()


class PSt(StatesGroup):
    limit_buy = State()
    rule_amount = State()
    prot_tp = State()
    prot_sl = State()
    prot_trail = State()
    prot_guard = State()
    cpf_min = State()
    cpf_pct = State()


async def _edit(cb: CallbackQuery, text: str, markup=None):
    try:
        await cb.message.edit_text(text, parse_mode="HTML", reply_markup=markup, disable_web_page_preview=True)
    except Exception:  # noqa - identical content
        pass
    try:
        await cb.answer()
    except Exception:  # noqa
        pass


async def _pos_refresh(cb: CallbackQuery, pid: int):
    from .handlers import render_position
    p = await portfolio.position(pid)
    if not p:
        return await cb.answer("Position not found", show_alert=True)
    txt, markup = await render_position(p)
    await _edit(cb, txt, markup)


# ------------------------------------------------------------ position orders
@router.callback_query(F.data.startswith("sl:"))
async def sl_cb(cb: CallbackQuery):
    _, pid, pct = cb.data.split(":")
    p = await portfolio.position(int(pid))
    if not p or p["tg_id"] != cb.from_user.id:
        return await cb.answer("Position not found", show_alert=True)
    await orders.add_order(cb.from_user.id, "sl", p["token"], p["symbol"], float(pct), p["id"])
    await cb.answer(f"Stop-loss −{pct}% set")
    await _pos_refresh(cb, p["id"])


@router.callback_query(F.data.startswith("trail:"))
async def trail_cb(cb: CallbackQuery):
    _, pid, pct = cb.data.split(":")
    p = await portfolio.position(int(pid))
    if not p or p["tg_id"] != cb.from_user.id:
        return await cb.answer("Position not found", show_alert=True)
    await orders.add_order(cb.from_user.id, "trail", p["token"], p["symbol"], float(pct), p["id"])
    await cb.answer(f"Trailing stop {pct}% from peak set (arms once in profit)")
    await _pos_refresh(cb, p["id"])


@router.callback_query(F.data.startswith("guard:"))
async def guard_cb(cb: CallbackQuery):
    _, pid, on = cb.data.split(":")
    p = await portfolio.position(int(pid))
    if not p or p["tg_id"] != cb.from_user.id:
        return await cb.answer("Position not found", show_alert=True)
    if on == "1":
        prot = await orders.get_prot(cb.from_user.id)
        await orders.add_order(cb.from_user.id, "guard", p["token"], p["symbol"], float(prot.get("guard_min_usd") or 50), p["id"])
        await cb.answer("Dump guard ON — sells 100% the moment the deployer or launch-block wallets dump")
    else:
        await db.execute(update(orders.orders).where((orders.orders.c.position_id == p["id"]) & (orders.orders.c.kind == "guard")
                                                     & (orders.orders.c.status == "active")).values(status="cancelled", result="by user"))
        await cb.answer("Dump guard off")
    await _pos_refresh(cb, p["id"])


@router.callback_query(F.data.startswith("oclr:"))
async def oclr_cb(cb: CallbackQuery):
    pid = int(cb.data.split(":")[1])
    await db.execute(update(orders.orders).where((orders.orders.c.position_id == pid) & (orders.orders.c.tg_id == cb.from_user.id)
                                                 & (orders.orders.c.status == "active")).values(status="cancelled", result="by user"))
    await db.execute(update(db.positions).where(db.positions.c.id == pid).values(tp_mult=0.0))
    await cb.answer("All orders on this position cleared")
    await _pos_refresh(cb, pid)


# ------------------------------------------------------------ limit buy from the CA panel
@router.callback_query(F.data == "sn_limit")
async def sn_limit(cb: CallbackQuery, state: FSMContext):
    from .handlers import DRAFTS
    s = DRAFTS.get(cb.from_user.id)
    if not s:
        return await cb.answer("Panel expired, paste the CA again", show_alert=True)
    await state.set_state(PSt.limit_buy)
    await _edit(cb, f"🧲 <b>Limit buy</b> for <code>{s['token']}</code>\n\n"
                    f"Send: <code>amount_usdc max_mcap_usd</code>\nExample: <code>10 25000</code> → buy 10 USDC when market cap ≤ $25K.\n"
                    f"Checked every ~12 s; fills with turbo gas and your protection defaults.", kb([back("sniper")]))


@router.message(PSt.limit_buy)
async def sn_limit_msg(m: Message, state: FSMContext):
    from .handlers import DRAFTS
    s = DRAFTS.get(m.from_user.id)
    if not s:
        await state.clear()
        return await m.answer("Panel expired, paste the CA again.")
    try:
        a, mc = m.text.replace(",", "").split()
        amount, mcap = float(a), float(mc.lower().replace("k", "000").replace("m", "000000"))
    except Exception:  # noqa
        return await m.answer("❌ Format: <code>amount max_mcap</code>, e.g. <code>10 25000</code>", parse_mode="HTML")
    sym = (s.get("info") or {}).get("symbol") or "?"
    await orders.add_order(m.from_user.id, "limit_buy", s["token"].lower(), sym, mcap, 0, 100, amount)
    await state.clear()
    await m.answer(f"🧲 Limit buy armed: {amount:g} USDC on <b>{sym}</b> when MC ≤ ${mcap:,.0f}.", parse_mode="HTML",
                   reply_markup=kb([[("🧲 My limit buys", "limits")], back()]))


@router.callback_query(F.data == "limits")
async def limits_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    rows_db = await orders.user_limit_buys(cb.from_user.id)
    lines = [f"#{o['id']} {orders.describe(o)} <code>{o['token'][:8]}…</code>" for o in rows_db]
    rows = [[(f"❌ cancel #{o['id']}", f"ocancel:{o['id']}")] for o in rows_db]
    rows.append(back("sniper"))
    await _edit(cb, "🧲 <b>Limit buys</b>\n" + ("\n".join(lines) or "none — open a CA panel and tap 🧲 Limit buy"), kb(rows))


@router.callback_query(F.data.startswith("ocancel:"))
async def ocancel(cb: CallbackQuery, state: FSMContext):
    await orders.cancel_order(cb.from_user.id, int(cb.data.split(":")[1]))
    await limits_menu(cb, state)


# ------------------------------------------------------------ protection defaults
def _prot_text(p: dict) -> str:
    return ("🛡 <b>Protection defaults</b>\nApplied automatically to every fill (manual buys, snipes, auto-snipe, copy-trade).\n\n"
            f"🎯 Auto take-profit: <b>{('%gx' % p['auto_tp']) if p['auto_tp'] else 'off'}</b>\n"
            f"🛑 Auto stop-loss: <b>{('−%g%%' % p['auto_sl']) if p['auto_sl'] else 'off'}</b>\n"
            f"📉 Trailing stop: <b>{('%g%% from peak' % p['trail']) if p['trail'] else 'off'}</b> (arms once in profit)\n"
            f"🛡 Deployer-dump guard: <b>{'ON' if int(p['guard']) else 'off'}</b> · threshold ${p['guard_min_usd']:g} sold by dev / launch-block wallets\n\n"
            "Guard reads the ArcTools swap index (~2 s behind chain) and sells 100% with turbo gas, minOut 0. "
            "It cannot undo a dump that already landed in the same block — it turns −80% into −20%.")


def _prot_kb(p: dict):
    return kb([
        [("🎯 TP off", "prot_tp:0"), ("2x", "prot_tp:2"), ("3x", "prot_tp:3"), ("5x", "prot_tp:5"), ("✏️", "prot_tp:x")],
        [("🛑 SL off", "prot_sl:0"), ("−30%", "prot_sl:30"), ("−50%", "prot_sl:50"), ("−70%", "prot_sl:70"), ("✏️", "prot_sl:x")],
        [("📉 Trail off", "prot_trail:0"), ("15%", "prot_trail:15"), ("25%", "prot_trail:25"), ("40%", "prot_trail:40"), ("✏️", "prot_trail:x")],
        [(("🛡 Guard: ON" if int(p["guard"]) else "🛡 Guard: off"), f"prot_guard:{0 if int(p['guard']) else 1}"),
         (f"threshold ${p['guard_min_usd']:g}", "prot_guard:x")],
        back(),
    ])


@router.callback_query(F.data == "prot")
async def prot_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    p = await orders.get_prot(cb.from_user.id)
    await _edit(cb, _prot_text(p), _prot_kb(p))


@router.callback_query(F.data.startswith("prot_"))
async def prot_set(cb: CallbackQuery, state: FSMContext):
    key, val = cb.data.split(":")
    field = key[len("prot_"):]
    if val == "x":
        st = {"tp": PSt.prot_tp, "sl": PSt.prot_sl, "trail": PSt.prot_trail, "guard": PSt.prot_guard}[field]
        await state.set_state(st)
        hint = {"tp": "take-profit multiple (e.g. 2.5)", "sl": "stop-loss % drop (e.g. 35)", "trail": "trailing % from peak (e.g. 20)",
                "guard": "dump-guard threshold in USD (e.g. 100)"}[field]
        return await _edit(cb, f"✏️ Send the {hint}. 0 = off.", kb([back("prot")]))
    v = float(val)
    p = await orders.set_prot(cb.from_user.id, **({"guard": int(v)} if field == "guard" else {{"tp": "auto_tp", "sl": "auto_sl", "trail": "trail"}[field]: v}))
    await _edit(cb, _prot_text(p), _prot_kb(p))


async def _prot_msg(m: Message, state: FSMContext, field: str):
    try:
        v = float(m.text.replace(",", ".").replace("%", "").replace("x", ""))
    except ValueError:
        return await m.answer("❌ Send a number.")
    kw = {"tp": {"auto_tp": v}, "sl": {"auto_sl": v}, "trail": {"trail": v}, "guard": {"guard_min_usd": v}}[field]
    p = await orders.set_prot(m.from_user.id, **kw)
    await state.clear()
    await m.answer(_prot_text(p), parse_mode="HTML", reply_markup=_prot_kb(p))


@router.message(PSt.prot_tp)
async def prot_tp_msg(m: Message, state: FSMContext): await _prot_msg(m, state, "tp")


@router.message(PSt.prot_sl)
async def prot_sl_msg(m: Message, state: FSMContext): await _prot_msg(m, state, "sl")


@router.message(PSt.prot_trail)
async def prot_trail_msg(m: Message, state: FSMContext): await _prot_msg(m, state, "trail")


@router.message(PSt.prot_guard)
async def prot_guard_msg(m: Message, state: FSMContext): await _prot_msg(m, state, "guard")


# ------------------------------------------------------------ auto-snipe rules
PRESETS = {
    "safe": dict(name="Conservative", amount_usdc=5, min_score=75, max_dev_pct=5, max_bundle_pct=10, min_liq_usd=1500, max_mcap_usd=0, min_holders=15, no_rugger=1, max_per_day=5, max_open=3),
    "bal": dict(name="Balanced", amount_usdc=5, min_score=60, max_dev_pct=10, max_bundle_pct=20, min_liq_usd=500, max_mcap_usd=0, min_holders=0, no_rugger=1, max_per_day=10, max_open=5),
    "degen": dict(name="Degen", amount_usdc=5, min_score=40, max_dev_pct=20, max_bundle_pct=35, min_liq_usd=100, max_mcap_usd=0, min_holders=0, no_rugger=1, max_per_day=25, max_open=10),
}


async def _auto_view(cb: CallbackQuery):
    rules = await db.fetchall(select(autosnipe.autorules).where(autosnipe.autorules.c.tg_id == cb.from_user.id))
    lines = [autosnipe.describe_rule(r) for r in rules]
    rows = []
    for r in rules:
        rows.append([(f"{'🟢' if r['enabled'] else '⚪'} {r['name']}", f"au_tog:{r['id']}"), (f"💵 {r['amount_usdc']:g}", f"au_amt:{r['id']}"),
                     ("🎯 venues", f"au_pads:{r['id']}"), ("🗑", f"au_del:{r['id']}")])
    rows.append([("➕ Conservative", "au_add:safe"), ("➕ Balanced", "au_add:bal"), ("➕ Degen", "au_add:degen")])
    rows.append([("🛡 Protection defaults", "prot")])
    rows.append(back())
    await _edit(cb, "⚡ <b>Auto-snipe</b>\nBuys every new launch that passes the rule — hands-free, turbo gas, "
                    "your Protection defaults (TP / SL / trailing / dump guard) attached to each fill.\n"
                    "Filters read the ArcTools risk engine: Token Score, dev share, bundle share, rug history, liquidity.\n\n"
                    + ("\n\n".join(lines) or "No rules yet — add a preset, then tune amount and venues."), kb(rows))


@router.callback_query(F.data == "auto")
async def auto_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    await _auto_view(cb)


@router.callback_query(F.data.startswith("au_add:"))
async def au_add(cb: CallbackQuery, state: FSMContext):
    preset = dict(PRESETS[cb.data.split(":")[1]])
    u = await db.get_user(cb.from_user.id)
    preset["amount_usdc"] = float(u["buy_usdc"] or preset["amount_usdc"])
    await db.execute(insert(autosnipe.autorules).values(tg_id=cb.from_user.id, pads="*", enabled=1, fired_today=0, day="", last_result="",
                                                        created_at=int(time.time()), **preset))
    await _auto_view(cb)


@router.callback_query(F.data.startswith("au_tog:"))
async def au_tog(cb: CallbackQuery):
    rid = int(cb.data.split(":")[1])
    r = await db.fetchone(select(autosnipe.autorules).where((autosnipe.autorules.c.id == rid) & (autosnipe.autorules.c.tg_id == cb.from_user.id)))
    if r:
        await db.execute(update(autosnipe.autorules).where(autosnipe.autorules.c.id == rid).values(enabled=0 if r["enabled"] else 1))
    await _auto_view(cb)


@router.callback_query(F.data.startswith("au_del:"))
async def au_del(cb: CallbackQuery):
    rid = int(cb.data.split(":")[1])
    await db.execute(delete(autosnipe.autorules).where((autosnipe.autorules.c.id == rid) & (autosnipe.autorules.c.tg_id == cb.from_user.id)))
    await _auto_view(cb)


@router.callback_query(F.data.startswith("au_amt:"))
async def au_amt(cb: CallbackQuery, state: FSMContext):
    rid = int(cb.data.split(":")[1])
    await state.set_state(PSt.rule_amount)
    await state.update_data(rid=rid)
    await _edit(cb, "💵 Send the buy size in USDC for this rule (optionally add <code>max/day max_open</code>, e.g. <code>10 8 4</code>).",
                kb([back("auto")]))


@router.message(PSt.rule_amount)
async def au_amt_msg(m: Message, state: FSMContext):
    d = await state.get_data()
    try:
        parts = m.text.replace(",", ".").split()
        vals = {"amount_usdc": float(parts[0])}
        if len(parts) > 1:
            vals["max_per_day"] = int(parts[1])
        if len(parts) > 2:
            vals["max_open"] = int(parts[2])
    except Exception:  # noqa
        return await m.answer("❌ Send a number (e.g. <code>10</code> or <code>10 8 4</code>).", parse_mode="HTML")
    await db.execute(update(autosnipe.autorules).where((autosnipe.autorules.c.id == int(d["rid"])) & (autosnipe.autorules.c.tg_id == m.from_user.id)).values(**vals))
    await state.clear()
    await m.answer("✅ Rule updated.", reply_markup=kb([[("⚡ Auto-snipe", "auto")]]))


@router.callback_query(F.data.startswith("au_pads:"))
async def au_pads(cb: CallbackQuery):
    from ..pads import PADS
    rid = int(cb.data.split(":")[1])
    r = await db.fetchone(select(autosnipe.autorules).where((autosnipe.autorules.c.id == rid) & (autosnipe.autorules.c.tg_id == cb.from_user.id)))
    if not r:
        return await cb.answer("Rule not found", show_alert=True)
    cur = set() if (r["pads"] or "*") == "*" else {p.strip() for p in r["pads"].split(",") if p.strip()}
    rows = [[(("✅ " if not cur else "☐ ") + "All venues", f"au_pad:{rid}:*")]]
    row = []
    for p in PADS:
        row.append((("✅ " if p.name in cur else "☐ ") + p.name, f"au_pad:{rid}:{p.name}"))
        if len(row) == 2:
            rows.append(row); row = []
    if row:
        rows.append(row)
    rows.append(back("auto"))
    await _edit(cb, f"🎯 Venues for <b>{r['name']}</b> — tap to toggle.", kb(rows))


@router.callback_query(F.data.startswith("au_pad:"))
async def au_pad_toggle(cb: CallbackQuery):
    _, rid, name = cb.data.split(":", 2)
    rid = int(rid)
    r = await db.fetchone(select(autosnipe.autorules).where((autosnipe.autorules.c.id == rid) & (autosnipe.autorules.c.tg_id == cb.from_user.id)))
    if not r:
        return await cb.answer("Rule not found", show_alert=True)
    if name == "*":
        new = "*"
    else:
        cur = set() if (r["pads"] or "*") == "*" else {p.strip() for p in r["pads"].split(",") if p.strip()}
        cur.symmetric_difference_update({name})
        new = ",".join(sorted(cur)) or "*"
    await db.execute(update(autosnipe.autorules).where(autosnipe.autorules.c.id == rid).values(pads=new))
    cb2 = cb.model_copy(update={"data": f"au_pads:{rid}"})
    await au_pads(cb2)


# ------------------------------------------------------------ copy-trade filters
def _cpf_text(c: dict) -> str:
    return ("🎛 <b>Copy-trade filters</b> (apply to every tracked wallet)\n\n"
            f"• Copy only buys ≥ <b>${c['min_usd']:g}</b> by the leader (0 = all)\n"
            f"• Max open copied positions: <b>{c['max_open'] or 'unlimited'}</b>\n"
            f"• Size: <b>{'flat (per-wallet / default amount)' if c['mode'] == 'flat' else '%g%% of the leader’s buy' % c['pct']}</b>\n"
            f"• Mirror sells: <b>{'ON — sell when the leader sells' if int(c['mirror_sells']) else 'off'}</b>\n\n"
            "Protection defaults (TP / SL / trailing / dump guard) are attached to every copied fill.")


def _cpf_kb(c: dict):
    return kb([
        [(f"min buy ${c['min_usd']:g} ✏️", "cpf_min"), (f"max open {c['max_open'] or '∞'}", "cpf_open")],
        [(("📐 proportional %g%%" % c["pct"]) if c["mode"] != "flat" else "📏 flat size", "cpf_mode"), ("✏️ set %", "cpf_pct")],
        [(("🪞 Mirror sells: ON" if int(c["mirror_sells"]) else "🪞 Mirror sells: off"), "cpf_mirror")],
        back("copy"),
    ])


@router.callback_query(F.data == "cpf")
async def cpf_menu(cb: CallbackQuery, state: FSMContext):
    await state.clear()
    c = await autosnipe.get_cpf(cb.from_user.id)
    await _edit(cb, _cpf_text(c), _cpf_kb(c))


@router.callback_query(F.data.in_({"cpf_open", "cpf_mode", "cpf_mirror"}))
async def cpf_toggle(cb: CallbackQuery, state: FSMContext):
    c = await autosnipe.get_cpf(cb.from_user.id)
    if cb.data == "cpf_open":
        seq = [0, 1, 2, 3, 5, 10]
        c = await autosnipe.set_cpf(cb.from_user.id, max_open=seq[(seq.index(int(c["max_open"])) + 1) % len(seq)] if int(c["max_open"]) in seq else 0)
    elif cb.data == "cpf_mode":
        c = await autosnipe.set_cpf(cb.from_user.id, mode="prop" if c["mode"] == "flat" else "flat")
    else:
        c = await autosnipe.set_cpf(cb.from_user.id, mirror_sells=0 if int(c["mirror_sells"]) else 1)
    await _edit(cb, _cpf_text(c), _cpf_kb(c))


@router.callback_query(F.data.in_({"cpf_min", "cpf_pct"}))
async def cpf_ask(cb: CallbackQuery, state: FSMContext):
    await state.set_state(PSt.cpf_min if cb.data == "cpf_min" else PSt.cpf_pct)
    await _edit(cb, "✏️ Send the minimum leader buy in USD (0 = copy everything)." if cb.data == "cpf_min"
                else "✏️ Send the % of the leader’s buy to mirror (e.g. 10 → their 500 USDC buy = your 50 USDC).", kb([back("cpf")]))


@router.message(PSt.cpf_min)
async def cpf_min_msg(m: Message, state: FSMContext):
    try:
        v = float(m.text.replace(",", "."))
    except ValueError:
        return await m.answer("❌ Send a number.")
    c = await autosnipe.set_cpf(m.from_user.id, min_usd=v)
    await state.clear()
    await m.answer(_cpf_text(c), parse_mode="HTML", reply_markup=_cpf_kb(c))


@router.message(PSt.cpf_pct)
async def cpf_pct_msg(m: Message, state: FSMContext):
    try:
        v = float(m.text.replace(",", ".").replace("%", ""))
    except ValueError:
        return await m.answer("❌ Send a number.")
    c = await autosnipe.set_cpf(m.from_user.id, pct=v, mode="prop")
    await state.clear()
    await m.answer(_cpf_text(c), parse_mode="HTML", reply_markup=_cpf_kb(c))
