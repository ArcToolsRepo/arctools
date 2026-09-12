"""Group flow: add token, settings on buttons, boost payments (verified on-chain)."""
import json
import time
import logging
from aiogram import Router, F
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy import select, insert, update, delete
from eth_utils import is_address, to_checksum_address

from .config import CFG
from .chain import CHAIN
from .venues import discover_venues, token_symbol
from . import db

log = logging.getLogger("ui")
router = Router()

MIN_BUYS = [0, 1, 5, 25, 100]
EMOJIS = ["🟢", "💎", "🔥", "🚀", "🐋", "⚡"]


def kb(rows):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t, callback_data=d) for t, d in row] for row in rows])


async def is_admin(m_or_cb, chat_id: int, user_id: int) -> bool:
    try:
        bot = m_or_cb.bot
        member = await bot.get_chat_member(chat_id, user_id)
        return member.status in ("administrator", "creator")
    except Exception:  # noqa
        return False


@router.message(CommandStart())
async def start(m: Message):
    if m.chat.type != "private":
        return
    # deep-link: /start boost_n<abs_chat_id> -> private boost/payment flow
    parts = (m.text or "").split(maxsplit=1)
    payload = parts[1].strip() if len(parts) > 1 else ""
    if payload.startswith("boost_"):
        raw = payload[6:]
        chat_id = int("-" + raw[1:]) if raw.startswith("n") else int(raw)
        return await open_boost_dm(m, chat_id)
    if payload.startswith("watch_"):
        from .watchlist import add_watch
        return await add_watch(m, "0x" + payload[6:])
    if payload.startswith("rule_"):
        from .rules import add_rule
        return await add_rule(m, [x.replace("m", "-") if x.startswith("m") and x[1:].replace(".", "").isdigit() else x for x in payload[5:].split("_") if x])
    await m.answer(
        "📟 <b>ArcBuyBot</b> — buy alerts for Arc (chain 5042)\n\n"
        "1. Add me to your token's group and make me admin.\n"
        "2. In the group, send <code>/add 0xTOKEN</code> (admins only).\n"
        "3. I detect buys on Uniswap V3, V4, ArcToolsPad, DYORSwap and WarpDex and post them live.\n\n"
        "👁 <b>Wallet watch:</b> <code>/watch 0x…</code> — DM on every buy and sell of any wallet on Arc.\n"
        "🔔 <b>Alert rules:</b> <code>/alert</code> — price drops, whale swaps, bridge inflows, insider clusters, fresh wallets.",
        parse_mode="HTML",
        reply_markup=kb([
            [("➕ Add me to your group", "help_add")],
            [("🔥 Trending channel", "help_trend"), ("🚀 Boost", "help_boost")],
            [("🔫 ArcTools Sniper", "help_sniper")],
        ]))


@router.callback_query(F.data == "help_add")
async def help_add(cb: CallbackQuery):
    await cb.message.answer(
        "➕ <b>Setup</b>\n"
        f"1. Add @{CFG.bot_username} to your token's Telegram group.\n"
        "2. Promote it to admin (needed to post alerts).\n"
        "3. Send <code>/add 0xYOUR_TOKEN</code> in the group.\n"
        "4. Tune alerts with /settings (min buy, emoji).",
        parse_mode="HTML")
    await cb.answer()


@router.callback_query(F.data == "help_trend")
async def help_trend(cb: CallbackQuery):
    await cb.message.answer(
        "🔥 Live Arc trending (24h buy volume, boosted tokens pinned):\n"
        "https://t.me/ARCTrends")
    await cb.answer()


@router.callback_query(F.data == "help_boost")
async def help_boost(cb: CallbackQuery):
    await cb.message.answer(
        "🚀 <b>Trending boost</b>\n"
        f"• 24 hours — {CFG.boost_24h_usdc:g} USDC\n"
        f"• 3 days — {CFG.boost_3d_usdc:g} USDC\n"
        f"• 7 days — {CFG.boost_7d_usdc:g} USDC\n\n"
        "Run /boost inside your token's group to get the payment address.",
        parse_mode="HTML")
    await cb.answer()


@router.callback_query(F.data == "help_sniper")
async def help_sniper(cb: CallbackQuery):
    await cb.message.answer(
        "🔫 Snipe launches on Arc with buttons, live PnL panels and a CCTP bridge:\n"
        "https://t.me/ArcSniper_bot\n\nWeb tools: https://arctools.fun")
    await cb.answer()


@router.message(Command("add"))
async def add_token(m: Message):
    if m.chat.type == "private":
        return await m.answer("Use /add inside your token's group.")
    if not await is_admin(m, m.chat.id, m.from_user.id):
        return await m.reply("Admins only.")
    parts = (m.text or "").split()
    if len(parts) < 2 or not is_address(parts[1]):
        return await m.reply("Usage: /add 0xTOKEN")
    token = to_checksum_address(parts[1])
    status = await m.reply("🔎 Looking for pools on Uniswap V3, DYORSwap and WarpDex…")
    venues = await discover_venues(token)
    sym = await token_symbol(token)
    if not venues:
        return await status.edit_text(
            "❌ No USDC pool found for this token yet (still on a bonding curve?). "
            "Add it again after it has a pool.")
    old = await db.fetchone(select(db.tracks).where(
        (db.tracks.c.chat_id == m.chat.id) & (db.tracks.c.token == token)))
    if old:
        await db.execute(update(db.tracks).where(db.tracks.c.id == old["id"]).values(
            venues=json.dumps(venues), symbol=sym))
    else:
        await db.execute(insert(db.tracks).values(
            chat_id=m.chat.id, token=token, symbol=sym, venues=json.dumps(venues),
            min_buy=1.0, emoji="🟢", added_by=m.from_user.id, created_at=int(time.time())))
    vlist = ", ".join(f"{v['venue']}" for v in venues)
    await status.edit_text(
        f"✅ Tracking <b>{sym}</b>\n<code>{token}</code>\nPools: {vlist}\n\n"
        "Buy alerts are live and your token just claimed its spot on "
        "<a href='https://t.me/ARCTrends'>Arc Trending</a>. /settings to tune, /boost for the top slots.",
        parse_mode="HTML")
    # nowy sledzony token = natychmiastowe miejsce na tablicy: oglos na kanale
    if not old and CFG.trend_channel_id:
        try:
            await m.bot.send_message(
                CFG.trend_channel_id,
                f"📟 <b>{sym}</b> just joined Arc Trending — buy alerts armed.\n"
                f"<a href='https://arctools.fun/scan?ca={token}'>scan</a> · "
                f"<a href='https://t.me/ArcSniper_bot?start=ca_{token[2:]}'>snipe</a>",
                parse_mode="HTML", disable_web_page_preview=True)
        except Exception:  # noqa - brak praw na kanale: pomin
            pass


@router.message(Command("remove"))
async def remove_token(m: Message):
    if m.chat.type == "private" or not await is_admin(m, m.chat.id, m.from_user.id):
        return
    await db.execute(delete(db.tracks).where(db.tracks.c.chat_id == m.chat.id))
    await m.reply("🗑 Tracking stopped for this group.")


def settings_kb(t: dict):
    mt = t.get("media_type") or ""
    media_lbl = {"photo": "🖼 Photo set", "animation": "🎞 GIF set", "video": "🎬 MP4 set"}.get(mt, "🖼 Media: none")
    soc = sum(1 for k in ("website", "twitter", "telegram") if t.get(k))
    return kb([
        [(f"💵 Min buy: {t['min_buy']:g} USDC", f"s_minbuy:{t['id']}"),
         (f"{t['emoji']} Emoji", f"s_emoji:{t['id']}")],
        [(f"🪜 1 emoji / {t.get('emoji_step') or 10:g} USDC", f"s_step:{t['id']}")],
        [(media_lbl, f"s_media:{t['id']}"),
         ("🗑 Clear media", f"s_mediaclr:{t['id']}")],
        [(f"🌐 Socials ({soc}/3)", f"s_socials:{t['id']}")],
        [(f"📊 MC: {'on' if t.get('show_mc', 1) else 'off'}", f"s_togmc:{t['id']}"),
         (f"👤 Buyer: {'on' if t.get('show_buyer', 1) else 'off'}", f"s_togbuyer:{t['id']}")],
        [("🧪 Test alert", f"s_test:{t['id']}")],
    ])


@router.message(Command("settings"))
async def settings(m: Message):
    if m.chat.type == "private":
        return
    t = await db.fetchone(select(db.tracks).where(db.tracks.c.chat_id == m.chat.id))
    if not t:
        return await m.reply("No token tracked here. /add 0xTOKEN first.")
    await m.reply(f"⚙️ <b>{t['symbol']}</b> alert settings", parse_mode="HTML",
                  reply_markup=settings_kb(t))


async def _track(tid: int) -> dict | None:
    return await db.fetchone(select(db.tracks).where(db.tracks.c.id == tid))


async def _refresh_panel(cb: CallbackQuery, tid: int):
    t = await _track(tid)
    if t:
        try:
            await cb.message.edit_reply_markup(reply_markup=settings_kb(t))
        except Exception:  # noqa
            pass


class SetSt(StatesGroup):
    minbuy = State()
    emoji = State()
    step = State()
    media = State()
    socials = State()


PENDING: dict[tuple[int, int], int] = {}  # (chat_id, user_id) -> track_id


async def _prompt(cb: CallbackQuery, state, st, text: str, tid: int):
    if not await is_admin(cb, cb.message.chat.id, cb.from_user.id):
        return await cb.answer("Admins only", show_alert=True)
    PENDING[(cb.message.chat.id, cb.from_user.id)] = tid
    await state.set_state(st)
    await cb.message.answer(text, parse_mode="HTML")
    await cb.answer()


@router.callback_query(F.data.startswith("s_minbuy:"))
async def s_minbuy(cb: CallbackQuery, state: FSMContext):
    await _prompt(cb, state, SetSt.minbuy,
                  "💵 Send the minimum buy to alert on, in USDC (e.g. <code>5</code> or <code>0</code> for all).",
                  int(cb.data.split(":")[1]))


@router.message(SetSt.minbuy)
async def s_minbuy_val(m: Message, state: FSMContext):
    tid = PENDING.get((m.chat.id, m.from_user.id))
    if tid is None:
        return
    try:
        v = float((m.text or "").replace(",", "."))
        assert v >= 0
    except Exception:  # noqa
        return await m.reply("Send a number, e.g. 5")
    await state.clear()
    await db.execute(update(db.tracks).where(db.tracks.c.id == tid).values(min_buy=v))
    await m.reply(f"✅ Min buy: {v:g} USDC")


@router.callback_query(F.data.startswith("s_emoji:"))
async def s_emoji(cb: CallbackQuery, state: FSMContext):
    await _prompt(cb, state, SetSt.emoji,
                  "😀 Send the emoji for the buy bar (any emoji works, animated premium emoji too, "
                  "or several like <code>🟢💚</code>).",
                  int(cb.data.split(":")[1]))


@router.message(SetSt.emoji)
async def s_emoji_val(m: Message, state: FSMContext):
    tid = PENDING.get((m.chat.id, m.from_user.id))
    if tid is None:
        return
    val = (m.text or "").strip()[:16]
    if not val:
        return await m.reply("Send an emoji.")
    await state.clear()
    await db.execute(update(db.tracks).where(db.tracks.c.id == tid).values(emoji=val))
    await m.reply(f"✅ Buy bar emoji: {val}")


@router.callback_query(F.data.startswith("s_step:"))
async def s_step(cb: CallbackQuery, state: FSMContext):
    await _prompt(cb, state, SetSt.step,
                  "🪜 Send how many USDC one emoji represents (e.g. <code>10</code> = one emoji per 10 USDC bought).",
                  int(cb.data.split(":")[1]))


@router.message(SetSt.step)
async def s_step_val(m: Message, state: FSMContext):
    tid = PENDING.get((m.chat.id, m.from_user.id))
    if tid is None:
        return
    try:
        v = float((m.text or "").replace(",", "."))
        assert v > 0
    except Exception:  # noqa
        return await m.reply("Send a number above zero, e.g. 10")
    await state.clear()
    await db.execute(update(db.tracks).where(db.tracks.c.id == tid).values(emoji_step=v))
    await m.reply(f"✅ 1 emoji per {v:g} USDC")


@router.callback_query(F.data.startswith("s_media:"))
async def s_media(cb: CallbackQuery, state: FSMContext):
    await _prompt(cb, state, SetSt.media,
                  "🖼 Send the media to attach to every buy alert: a <b>photo</b>, <b>GIF</b> or <b>MP4</b>.",
                  int(cb.data.split(":")[1]))


@router.message(SetSt.media, F.photo | F.animation | F.video)
async def s_media_val(m: Message, state: FSMContext):
    tid = PENDING.get((m.chat.id, m.from_user.id))
    if tid is None:
        return
    if m.animation:
        mt, mid = "animation", m.animation.file_id
    elif m.video:
        mt, mid = "video", m.video.file_id
    else:
        mt, mid = "photo", m.photo[-1].file_id
    await state.clear()
    await db.execute(update(db.tracks).where(db.tracks.c.id == tid).values(media_type=mt, media_id=mid))
    await m.reply({"photo": "✅ Photo saved.", "animation": "✅ GIF saved.", "video": "✅ MP4 saved."}[mt]
                  + " It will ride on every buy alert.")


@router.callback_query(F.data.startswith("s_mediaclr:"))
async def s_mediaclr(cb: CallbackQuery):
    if not await is_admin(cb, cb.message.chat.id, cb.from_user.id):
        return await cb.answer("Admins only", show_alert=True)
    tid = int(cb.data.split(":")[1])
    await db.execute(update(db.tracks).where(db.tracks.c.id == tid).values(media_type="", media_id=""))
    await cb.answer("Media removed")
    await _refresh_panel(cb, tid)


@router.callback_query(F.data.startswith("s_socials:"))
async def s_socials(cb: CallbackQuery, state: FSMContext):
    await _prompt(cb, state, SetSt.socials,
                  "🌐 Send the project links in ONE message (any order, space-separated):\n"
                  "<code>https://yoursite.com https://x.com/yourtoken https://t.me/yourgroup</code>\n"
                  "Send <code>-</code> to clear all.",
                  int(cb.data.split(":")[1]))


@router.message(SetSt.socials)
async def s_socials_val(m: Message, state: FSMContext):
    tid = PENDING.get((m.chat.id, m.from_user.id))
    if tid is None:
        return
    txt = (m.text or "").strip()
    await state.clear()
    if txt == "-":
        await db.execute(update(db.tracks).where(db.tracks.c.id == tid).values(
            website="", twitter="", telegram=""))
        return await m.reply("✅ Socials cleared.")
    web = tw = tg = ""
    for w in txt.split():
        wl = w.lower()
        if not wl.startswith("http"):
            if wl.startswith("t.me/") or wl.startswith("x.com/") or wl.startswith("twitter.com/"):
                w = "https://" + w
                wl = w.lower()
            else:
                continue
        if "t.me/" in wl or "telegram." in wl:
            tg = w
        elif "x.com/" in wl or "twitter.com/" in wl:
            tw = w
        else:
            web = w
    vals = {}
    if web:
        vals["website"] = web
    if tw:
        vals["twitter"] = tw
    if tg:
        vals["telegram"] = tg
    if not vals:
        return await m.reply("No links recognized. Send full URLs (https://…).")
    await db.execute(update(db.tracks).where(db.tracks.c.id == tid).values(**vals))
    await m.reply("✅ Socials saved: " + ", ".join(vals.keys()))


@router.callback_query(F.data.startswith("s_togmc:"))
async def s_togmc(cb: CallbackQuery):
    if not await is_admin(cb, cb.message.chat.id, cb.from_user.id):
        return await cb.answer("Admins only", show_alert=True)
    tid = int(cb.data.split(":")[1])
    t = await _track(tid)
    if t:
        await db.execute(update(db.tracks).where(db.tracks.c.id == tid)
                         .values(show_mc=0 if t.get("show_mc", 1) else 1))
    await cb.answer()
    await _refresh_panel(cb, tid)


@router.callback_query(F.data.startswith("s_togbuyer:"))
async def s_togbuyer(cb: CallbackQuery):
    if not await is_admin(cb, cb.message.chat.id, cb.from_user.id):
        return await cb.answer("Admins only", show_alert=True)
    tid = int(cb.data.split(":")[1])
    t = await _track(tid)
    if t:
        await db.execute(update(db.tracks).where(db.tracks.c.id == tid)
                         .values(show_buyer=0 if t.get("show_buyer", 1) else 1))
    await cb.answer()
    await _refresh_panel(cb, tid)


@router.callback_query(F.data.startswith("s_test:"))
async def s_test(cb: CallbackQuery):
    tid = int(cb.data.split(":")[1])
    t = await _track(tid)
    if not t:
        return await cb.answer()
    from .watcher import post_buy
    await cb.answer("Sending a test alert")
    await post_buy(t, {"usdc": 123.45, "tokens": 1_234_567.0},
                   "0x" + "00" * 32, "0x0000000000000000000000000000000000000000")


# ---------- boosts / payments (in DM: keep the group chat clean) ----------

def _boost_link(chat_id: int) -> str:
    tag = f"n{abs(chat_id)}" if chat_id < 0 else str(chat_id)
    return f"https://t.me/{CFG.bot_username}?start=boost_{tag}"


async def open_boost_dm(m: Message, chat_id: int):
    """Private-chat boost offer for the group's tracked token."""
    t = await db.fetchone(select(db.tracks).where(db.tracks.c.chat_id == chat_id))
    if not t:
        return await m.answer("That group does not track a token yet. In the group: /add 0xTOKEN")
    if not await is_admin(m, chat_id, m.from_user.id):
        return await m.answer("❌ Only an admin of that token's group can buy a boost.")
    await db.kv_set(f"boostctx:{m.from_user.id}", str(chat_id))
    await m.answer(
        f"🚀 <b>Trending boost for {t['symbol']}</b>\n"
        "Your token gets pinned with 🚀 at the top of the Arc trending channel.\n\n"
        f"• 24 hours — <b>{CFG.boost_24h_usdc:g} USDC</b>\n"
        f"• 3 days — <b>{CFG.boost_3d_usdc:g} USDC</b>\n"
        f"• 7 days — <b>{CFG.boost_7d_usdc:g} USDC</b>\n\n"
        f"Send the exact amount in native USDC on Arc to:\n<code>{CFG.fee_wallet}</code>\n\n"
        "Then send me here:\n<code>/paid 0xTRANSACTION_HASH</code>",
        parse_mode="HTML")


@router.message(Command("boost"))
async def boost(m: Message):
    if m.chat.type == "private":
        ctx = await db.kv_get(f"boostctx:{m.from_user.id}")
        if ctx:
            return await open_boost_dm(m, int(ctx))
        return await m.answer("Open your token's group and send /boost there once — "
                              "I will hand you back here to pay privately.")
    t = await db.fetchone(select(db.tracks).where(db.tracks.c.chat_id == m.chat.id))
    if not t:
        return await m.reply("Track a token first: /add 0xTOKEN")
    await m.reply(
        f"🚀 <b>Trending boost for {t['symbol']}</b>\n"
        "Payment happens in DM — the group stays clean.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="🚀 Boost in DM", url=_boost_link(m.chat.id))]]))


@router.message(Command("paid"))
async def paid(m: Message):
    if m.chat.type != "private":
        # payments never in the group: hand over to DM (and hide the tx hash)
        try:
            await m.delete()
        except Exception:  # noqa - no delete rights: leave it
            pass
        return await m.answer(
            "🔒 Payments are handled in DM.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="💬 Continue in DM", url=_boost_link(m.chat.id))]]))
    ctx = await db.kv_get(f"boostctx:{m.from_user.id}")
    if not ctx:
        return await m.answer("Start with /boost in your token's group — then pay here.")
    chat_id = int(ctx)
    t = await db.fetchone(select(db.tracks).where(db.tracks.c.chat_id == chat_id))
    if not t:
        return await m.answer("That group no longer tracks a token.")
    if not await is_admin(m, chat_id, m.from_user.id):
        return await m.answer("❌ Only an admin of that token's group can activate a boost.")
    parts = (m.text or "").split()
    if len(parts) < 2 or not parts[1].startswith("0x") or len(parts[1]) != 66:
        return await m.answer("Usage: /paid 0xTRANSACTION_HASH")
    txh = parts[1]
    if await db.fetchone(select(db.payments).where(db.payments.c.tx == txh)):
        return await m.answer("❌ This transaction was already used.")
    try:
        tx = await CHAIN.get_tx(txh)
    except Exception:  # noqa
        return await m.answer("❌ Transaction not found on Arc.")
    if not tx or (tx.get("to") or "").lower() != CFG.fee_wallet.lower():
        return await m.answer("❌ That payment did not go to the boost wallet.")
    amount = tx.get("value", 0) / 1e18
    tiers = [(CFG.boost_7d_usdc, 7 * 86400), (CFG.boost_3d_usdc, 3 * 86400),
             (CFG.boost_24h_usdc, 86400)]
    dur = next((d for need, d in tiers if amount >= need * 0.99), None)
    if dur is None:
        return await m.answer(f"❌ Amount too low ({amount:.2f} USDC). Minimum {CFG.boost_24h_usdc:g} USDC.")
    now = int(time.time())
    await db.execute(insert(db.payments).values(tx=txh, chat_id=chat_id, amount=amount, ts=now))
    await db.execute(insert(db.boosts).values(
        token=t["token"], symbol=t["symbol"], until_ts=now + dur, paid_usdc=amount))
    days = dur // 86400
    await m.answer(f"✅ Boost active for <b>{t['symbol']}</b>: {days} day(s) on top of trending. 🚀",
                   parse_mode="HTML")
    try:  # short, payment-free confirmation for the group
        await m.bot.send_message(
            chat_id, f"🚀 <b>{t['symbol']}</b> boost activated: {days} day(s) pinned on "
                     "<a href='https://t.me/ARCTrends'>Arc Trending</a>!",
            parse_mode="HTML", disable_web_page_preview=True)
    except Exception:  # noqa
        pass
