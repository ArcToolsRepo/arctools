from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton


def kb(rows: list[list[tuple[str, str]]]) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    for row in rows:
        b.row(*[InlineKeyboardButton(text=t, callback_data=d) for t, d in row])
    return b.as_markup()


def main_menu() -> InlineKeyboardMarkup:
    return kb([
        [("🔫 Sniper", "sniper"), ("👛 Wallets", "wallets")],
        [("📡 New pairs", "feed"), ("📊 Portfolio", "portfolio")],
        [("🤖 Copy-trade", "copy"), ("🔔 Alerts", "alerts")],
        [("🌉 Bridge", "bridge"), ("⚙️ Settings", "settings")],
    ])


def back(to: str = "menu") -> list[tuple[str, str]]:
    return [("⬅️ Back", to)]


AMOUNTS = [10, 25, 50, 100, 250, 500]
SLIPPAGES = [10, 25, 50, 100]
GAS_MODES = ["normal", "fast", "turbo"]
MODES = ["instant", "event", "migration"]
MODE_LABEL = {"instant": "⚡ Instant", "event": "📡 On launch", "migration": "🔄 On migration"}


def snipe_card(s: dict, pads: list[str]) -> InlineKeyboardMarkup:
    rows = [
        [(f"💵 {s['amount_usdc']:g} USDC", "sn_amt"), ("✏️ Custom", "sn_amt_custom")],
        [(f"⛽ Gas: {s['gas_mode'].capitalize()}", "sn_gas"),
         (f"📉 Slippage: {s['slippage']}%", "sn_slip")],
        [(f"🎯 Venue: {s['pad']}", "sn_pad"),
         (MODE_LABEL[s['mode']], "sn_mode")],
        [(f"🔁 Wallets: {len(s['wallet_ids'])}", "sn_wal"), ("🔄 Refresh quote", "sn_quote")],
        [("✅ BUY / ARM", "sn_arm"), ("❌ Cancel", "sniper")],
    ]
    return kb(rows)


def position_card(pos_id: int) -> InlineKeyboardMarkup:
    p = str(pos_id)
    return kb([
        [("💰 Sell 25%", f"sell:{p}:25"), ("💰 50%", f"sell:{p}:50"), ("💰 100%", f"sell:{p}:100")],
        [("🎯 TP 2x", f"tp:{p}:2"), ("🎯 5x", f"tp:{p}:5"), ("🎯 10x", f"tp:{p}:10"), ("🎯 off", f"tp:{p}:0")],
        [("🔄 Refresh", f"pos:{p}"), ("🔫 Buy more", f"buymore:{p}")],
        back("portfolio"),
    ])
