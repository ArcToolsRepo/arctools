"""Portfolio / PnL - wszystko w USDC."""
from sqlalchemy import select
from . import db
from .pads import quote_token_usdc


async def open_positions(tg_id: int) -> list[dict]:
    return await db.fetchall(select(db.positions).where(
        (db.positions.c.tg_id == tg_id) & (db.positions.c.status == "open")))


async def position(pos_id: int) -> dict | None:
    return await db.fetchone(select(db.positions).where(db.positions.c.id == pos_id))


async def pnl_report(tg_id: int) -> str:
    poss = await db.fetchall(select(db.positions).where(db.positions.c.tg_id == tg_id))
    if not poss:
        return "No positions yet."
    lines = []
    tot_cost = tot_real = tot_cur = 0.0
    for p in poss:
        cur = None
        if p["status"] == "open" and p["amount_tokens"] > 0:
            cur = await quote_token_usdc(p["token"], int(p["amount_tokens"]))
        cur_v = cur or 0.0
        pnl = p["realized_usdc"] + cur_v - p["cost_usdc"]
        tot_cost += p["cost_usdc"]
        tot_real += p["realized_usdc"]
        tot_cur += cur_v
        emoji = "🟢" if pnl >= 0 else "🔴"
        state = "open" if p["status"] == "open" else "closed"
        cur_s = f"{cur_v:.2f}" if cur is not None else "?"
        lines.append(f"{emoji} <b>{p['symbol']}</b> [{state}] cost {p['cost_usdc']:.2f} | "
                     f"realized {p['realized_usdc']:.2f} | now {cur_s} | PnL {pnl:+.2f} USDC")
    tot = tot_real + tot_cur - tot_cost
    trades = await db.fetchall(select(db.trades).where(db.trades.c.tg_id == tg_id))
    buys = [t for t in trades if t["side"] == "buy"]
    lines.append(f"\n<b>Σ PnL: {tot:+.2f} USDC</b> | snipes: {len(buys)}")
    return "\n".join(lines)
