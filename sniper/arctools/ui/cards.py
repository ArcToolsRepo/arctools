"""Maestro-style cards: token header, buy panel, position panel, main menu.

Layout rules: one glance = token · venue · price · MC · liq · momentum; then YOUR numbers; then a dense button
grid (buy amounts / sell percents / protection). Monospace tree lines for scanability. Never blocks on RPC —
renderers take already-fetched dicts; '—' where data is missing.
"""
from ..config import CFG
from .keyboards import kb, back, MODE_LABEL

SITE = "https://arctools.fun"


def usd(v, dec=2) -> str:
    if v is None:
        return "—"
    v = float(v)
    a = abs(v)
    if a >= 1e9:
        return f"${v / 1e9:.2f}B"
    if a >= 1e6:
        return f"${v / 1e6:.2f}M"
    if a >= 1e3:
        return f"${v / 1e3:.1f}K"
    return f"${v:,.{dec}f}"


def price_s(p) -> str:
    if p is None:
        return "—"
    p = float(p)
    if p == 0:
        return "$0"
    if p >= 1:
        return f"${p:,.4f}".rstrip("0").rstrip(".")
    if p >= 0.0001:
        return f"${p:.6f}".rstrip("0")
    # $0.0₅123 notation for micro prices
    s = f"{p:.20f}".split(".")[1]
    zeros = len(s) - len(s.lstrip("0"))
    sub = "₀₁₂₃₄₅₆₇₈₉"
    return f"$0.0{''.join(sub[int(c)] for c in str(zeros))}{s.lstrip('0')[:4]}"


def pct(v) -> str:
    if v is None:
        return "—"
    v = float(v)
    return f"{'🟢' if v >= 0 else '🔴'} {v:+.1f}%"


def qty(n: float, dec: int = 18) -> str:
    v = n / 10 ** dec if n > 1e12 else n
    if v >= 1e9:
        return f"{v / 1e9:.2f}B"
    if v >= 1e6:
        return f"{v / 1e6:.2f}M"
    if v >= 1e3:
        return f"{v / 1e3:.1f}K"
    return f"{v:,.2f}"


def age(s) -> str:
    if not s:
        return "—"
    s = int(s)
    if s < 3600:
        return f"{s // 60}m"
    if s < 86400:
        return f"{s // 3600}h"
    return f"{s // 86400}d"


def short(a: str) -> str:
    return f"{a[:6]}…{a[-4:]}" if a and len(a) > 12 else (a or "")


def header(token: str, m: dict, venue: str | None = None, loading: bool = False) -> str:
    sym = m.get("symbol") or ("…" if loading else short(token))
    ch = m.get("change") or {}
    venue_s = f" · {venue}" if venue and venue != "auto" else ""
    b, s = m.get("buys24"), m.get("sells24")
    flow = f"{b}/{s}" if b is not None and s is not None else "—"
    lines = [
        f"<b>{sym}</b>{venue_s}  <a href='{SITE}/token/{token}'>chart</a> · <a href='{SITE}/scan?ca={token}'>scan</a> · <a href='{CFG.explorer}/token/{token}'>explorer</a>",
        f"<code>{token}</code>",
        "",
        f"├ 💲 Price  <b>{price_s(m.get('price'))}</b>" + ("  ⏳" if loading and m.get("price") is None else ""),
        f"├ 🏦 MC     {usd(m.get('mcap'))}   💧 Liq {usd(m.get('liq'))}",
        f"├ 📊 Vol24  {usd(m.get('vol24'))}   🔁 B/S {flow}   ⏱ {age(m.get('age_s'))}",
        f"└ 📈 5m {pct(ch.get('5m'))} · 1h {pct(ch.get('1h'))} · 24h {pct(ch.get('24h'))}",
    ]
    return "\n".join(lines)


# ---------- BUY PANEL ----------

def buy_text(s: dict, m: dict, est: int | None, wallet_balance: float | None) -> str:
    token = s["token"]
    sym = m.get("symbol") or "tokens"
    amt = s["amount_usdc"]
    fee = amt * CFG.trade_fee_bps / 10_000
    est_s = "…" if est is None and m.get("price") is not None else ("—" if est is None else f"{qty(est, m.get('decimals', 18))} {sym}")
    bal = f"{wallet_balance:.2f} USDC" if wallet_balance is not None else "—"
    lines = [
        header(token, m, s.get("pad"), loading=bool(m.get("loading"))),
        "",
        f"<b>🛒 Buy</b>  {amt:g} USDC  →  <b>{est_s}</b>",
        f"├ 👛 Wallet {bal}  ·  {len(s['wallet_ids'])} wallet{'s' if len(s['wallet_ids']) > 1 else ''}",
        f"├ ⛽ {s['gas_mode']}  ·  📉 slippage {s['slippage']}%  ·  fee {fee:.2f} USDC",
        f"└ {MODE_LABEL[s['mode']]}",
    ]
    return "\n".join(lines)


def buy_kb(s: dict, amounts: list[float]) -> object:
    a = s["amount_usdc"]
    row_amt = [(("• " if x == a else "") + f"{x:g}", f"sn_amt_set:{x:g}") for x in amounts[:4]]
    row_amt.append(("✏️ X", "sn_amt_custom"))
    return kb([
        row_amt,
        [(f"⛽ {s['gas_mode'].capitalize()}", "sn_gas"), (f"📉 {s['slippage']}%", "sn_slip"), (f"👛 ×{len(s['wallet_ids'])}", "sn_wal")],
        [(f"🎯 {s['pad']}", "sn_pad"), (MODE_LABEL[s["mode"]], "sn_mode"), ("🔄", "sn_quote")],
        [("🧲 Limit @ MC", "sn_limit"), ("👁 Watch", f"watch:{s['token']}")] if s.get("token") else [("🧲 Limit @ MC", "sn_limit")],
        [(f"⚡ BUY {a:g} USDC", "sn_arm")],
        [("⬅️ Menu", "menu"), ("❌ Close", "sn_close")],
    ])


# ---------- POSITION PANEL ----------

def position_text(p: dict, m: dict, orders_txt: str) -> str:
    dec = m.get("decimals", 18)
    amount = float(p["amount_tokens"] or 0)
    tokens = amount / 10 ** dec
    cur = (m["price"] * tokens) if m.get("price") is not None else None
    realized = float(p.get("realized_usdc") or 0)
    cost = float(p["cost_usdc"] or 0)
    pnl = (realized + (cur or 0)) - cost if cur is not None else None
    pnl_pct = (pnl / cost * 100) if (pnl is not None and cost) else None
    entry_px = (cost / tokens) if tokens else None
    x = (cur / cost) if (cur is not None and cost) else None
    mood = "🟢" if (pnl or 0) >= 0 else "🔴"
    lines = [
        header(p["token"], dict(m, symbol=m.get("symbol") or p.get("symbol")), p.get("pad")),
        "",
        f"<b>💼 Position</b>  <code>{short(p['wallet'])}</code>",
        f"├ Bought   {cost:.2f} USDC  →  {qty(amount, dec)} {m.get('symbol') or p['symbol']}",
        f"├ Entry    {price_s(entry_px)}   ·   now {price_s(m.get('price'))}",
        f"├ Worth    <b>{'—' if cur is None else f'{cur:.2f} USDC'}</b>" + (f"   ({x:.2f}x)" if x is not None else ""),
        (f"├ Realized {realized:.2f} USDC" if realized else "│"),
        f"└ PnL      <b>{'—' if pnl is None else f'{pnl:+.2f} USDC ({pnl_pct:+.1f}%)'}</b> {mood if pnl is not None else ''}",
        "",
        f"<b>🛡 Orders</b>  {orders_txt}",
    ]
    return "\n".join(lines)


def position_kb(pos_id: int, guard_on: bool, buy_amounts: list[float], default_amt: float) -> object:
    p = str(pos_id)
    return kb([
        [(f"🛒 Buy {x:g}", f"posbuy:{p}:{x:g}") for x in buy_amounts[:3]] + [("🛒 X", f"posbuy:{p}:x")],
        [("💰 Sell 25%", f"sell:{p}:25"), ("💰 50%", f"sell:{p}:50"), ("💰 100%", f"sell:{p}:100")],
        [("🎯 TP 2x", f"tp:{p}:2"), ("3x", f"tp:{p}:3"), ("5x", f"tp:{p}:5"), ("10x", f"tp:{p}:10")],
        [("🛑 SL −30%", f"sl:{p}:30"), ("−50%", f"sl:{p}:50"), ("📉 Trail 20%", f"trail:{p}:20"), ("35%", f"trail:{p}:35")],
        [(("🛡 Guard ON" if guard_on else "🛡 Guard off"), f"guard:{p}:{0 if guard_on else 1}"), ("🧹 Clear", f"oclr:{p}"), ("🔄 Refresh", f"pos:{p}")],
        [("⬅️ Portfolio", "portfolio"), ("🏠 Menu", "menu")],
    ])


# ---------- MENU ----------

def menu_kb():
    return kb([
        [("🛒 Buy", "sniper"), ("💼 Positions", "portfolio")],
        [("📡 New pairs", "feed"), ("👛 Wallets", "wallets")],
        [("🤖 Copy-trade", "copy"), ("🔔 Alerts", "alerts")],
        [("🛡 Protection", "prot"), ("⚡ Auto-snipe", "auto")],
        [("🌉 Bridge", "bridge"), ("⚙️ Settings", "settings")],
        [("🤝 Referrals · 25% of fees", "ref"), ("❓ Help", "help")],
    ])


def menu_text(wallet: str | None, balance: float | None, open_positions: int, pnl_open: float | None) -> str:
    bal = f"{balance:.2f} USDC" if balance is not None else "—"
    w = f"<code>{wallet}</code>" if wallet else "no wallet yet → 👛 Wallets"
    pnl = "—" if pnl_open is None else f"{pnl_open:+.2f} USDC"
    return (
        "🔫 <b>ArcTools Sniper</b>  <i>Arc · chain 5042 · gas in USDC</i>\n\n"
        f"├ 👛 {w}\n"
        f"├ 💵 Balance  <b>{bal}</b>\n"
        f"└ 💼 Open positions  {open_positions}  ·  PnL {pnl}\n\n"
        "💡 Paste a <b>contract address</b> to open the buy panel.\n"
        "<i>1% fee per trade · sell tax ignored, we buy at any cost · every launchpad + Uniswap V3/V4.</i>"
    )
