"""Alpha screener — "potential alpha" ranking built from OUR data only (swap index, insider board, risk cache, KOLs).

Three modes:
  fresh    — tokens < 60 min old where smart capital is already entering
  accum    — older tokens where top-100 wallets keep buying for hours without the price having run yet
  revival  — a quiet token (no trades for hours) waking up on real volume

The scorer is a pure function of (swaps in a lookback window, insider set, kol mentions, risk row, now) so the
exact same maths runs live (every 45 s, cached) and in the backtest (replayed at historical cutoffs).
Every score comes with human-readable reasons — a number without a "why" is astrology.
"""
import asyncio
import json
import logging
import math
import time
from collections import defaultdict

from sqlalchemy import text

from . import db

log = logging.getLogger("alpha")

LOOKBACK = 6 * 3600           # swaps considered for scoring
CLUSTER_WIN = 15 * 60
INSIDER_TOP = 200

# hard risk cut-offs: the screener must never become a rug amplifier
MAX_DEV_PCT = 25.0
MAX_BUNDLE_PCT = 20.0
MAX_TOP10 = 75.0
MIN_LIQ_FRESH = 300.0         # USD


def _pct(v, p):
    if not v:
        return 0.0
    v = sorted(v); return v[min(len(v) - 1, int(round((len(v) - 1) * p)))]


def score_token(token: str, sw: list[dict], now: int, insiders: dict[str, float], kols: list[dict], risk: dict | None,
                first_ts: int | None, liq: float | None, mode: str) -> dict | None:
    """sw = swaps of this token in [now-LOOKBACK, now], sorted by ts. Returns {score, reasons, ...} or None (filtered)."""
    if not sw:
        return None
    age = (now - first_ts) if first_ts else None
    last = sw[-1]["ts"]
    buys = [s for s in sw if s["side"] == "buy"]; sells = [s for s in sw if s["side"] == "sell"]
    vol = sum(s["usdc"] for s in sw); vb = sum(s["usdc"] for s in buys); vs = sum(s["usdc"] for s in sells)
    if vol < (50 if mode == "fresh" else 150):
        return None

    # ---- hard risk gate
    r = risk or {}
    dev = r.get("dev_pct"); bun = r.get("bundle_pct"); t10 = r.get("top10")
    if (dev is not None and dev > MAX_DEV_PCT) or (bun is not None and bun > MAX_BUNDLE_PCT) or (t10 is not None and t10 > MAX_TOP10):
        return None
    if (r.get("dev_sells") or 0) >= 2 or (r.get("dev_rugs") or 0) > 0:
        return None
    if mode == "fresh" and liq is not None and liq < MIN_LIQ_FRESH:
        return None

    reasons: list[str] = []; pts = 0.0

    # ---- smart money (0-30): distinct top wallets buying, weighted by their rank and recency
    sm_buys = [s for s in buys if s["wallet"] in insiders]
    sm_wallets = {}
    for s in sm_buys:
        w = s["wallet"]; rec = math.exp(-(now - s["ts"]) / 5400)          # 90 min half-ish life
        sm_wallets[w] = max(sm_wallets.get(w, 0), insiders[w] * rec)
    sm_n = len(sm_wallets); sm_usd = sum(s["usdc"] for s in sm_buys)
    if sm_n:
        p = min(30.0, 9.0 * sm_n + min(9.0, sm_usd / 250))
        pts += p
        newest = now - max(s["ts"] for s in sm_buys)
        reasons.append(f"{sm_n} top-100 wallet{'s' if sm_n > 1 else ''} bought ${sm_usd:,.0f} · last {int(newest // 60)}m ago")
    # ---- cluster (0-20): ≥2 insiders inside 15 min
    best_cluster = 0
    ts_sm = sorted(set(s["ts"] for s in sm_buys)); wl = sorted((s["ts"], s["wallet"]) for s in sm_buys)
    for i in range(len(wl)):
        ws = {w for (t, w) in wl if wl[i][0] <= t <= wl[i][0] + CLUSTER_WIN}
        best_cluster = max(best_cluster, len(ws))
    if best_cluster >= 2:
        p = min(20.0, 8.0 * (best_cluster - 1)); pts += p
        reasons.append(f"cluster: {best_cluster} insiders within 15 min")

    # ---- buyer acceleration (0-20): unique buyers last 30 min vs the 30 min before
    b_now = {s["wallet"] for s in buys if s["ts"] > now - 1800}
    b_prev = {s["wallet"] for s in buys if now - 3600 < s["ts"] <= now - 1800}
    if len(b_now) >= 4:
        ratio = len(b_now) / max(1, len(b_prev))
        if ratio >= 1.5:
            p = min(20.0, 6.0 * math.log2(ratio) + min(8.0, len(b_now) / 3)); pts += p
            reasons.append(f"unique buyers ×{ratio:.1f} in 30 min ({len(b_now)} wallets)")

    # ---- flow (0-12): buy share of volume, only with enough participants
    if vol > 0 and len(buys) >= 5:
        share = vb / vol
        if share >= 0.6:
            p = min(12.0, (share - 0.5) * 60); pts += p
            reasons.append(f"buy flow {int(share * 100)}% of ${vol:,.0f}")

    # ---- KOL ignition (0-15): mentions in the last 6 h weighted by followers and recency
    kp = 0.0; best_k = None
    for m in kols:
        rec = math.exp(-(now - m["ts"]) / 7200); f = m.get("followers") or 0
        w = rec * min(1.0, math.log10(max(10, f)) / 5.5)
        if w > kp:
            kp, best_k = w, m
    if best_k:
        p = min(15.0, kp * 15); pts += p
        reasons.append(f"KOL @{best_k['kol']} ({(best_k.get('followers') or 0) / 1000:.0f}K) {int((now - best_k['ts']) // 60)}m ago")

    # ---- clean risk bonus (0-8)
    if risk:
        clean = []
        if dev is not None and dev <= 5: clean.append(f"dev {dev:.0f}%")
        if bun is not None and bun <= 1: clean.append("no bundle")
        if (r.get("dev_sells") or 0) == 0: clean.append("dev never sold")
        if (r.get("holders") or 0) >= 100: clean.append(f"{int(r['holders'])} holders")
        if len(clean) >= 2:
            pts += min(8.0, 2.0 * len(clean)); reasons.append("clean: " + ", ".join(clean))

    # ---- mode-specific shaping
    if mode == "fresh":
        if age is None or age > 3600:
            return None
        pts *= 1.0 + max(0.0, (3600 - age) / 3600) * 0.25          # earlier = better
        if sm_n == 0 and best_cluster == 0 and kp == 0:
            return None                                            # fresh needs at least one smart/social signal
    elif mode == "accum":
        if age is None or age < 3600:
            return None
        # accumulation = sustained smart-money buying while price has NOT run: compare median price now vs 3 h ago
        p_now = _pct([s["price1m"] for s in sw if s["ts"] > now - 1800 and s["price1m"]], 0.5)
        p_old = _pct([s["price1m"] for s in sw if now - 4 * 3600 < s["ts"] <= now - 3 * 3600 and s["price1m"]], 0.5)
        if sm_n < 2:
            return None
        if p_now and p_old:
            chg = p_now / p_old - 1
            if chg > 1.0:
                return None                                        # already ran ×2 — not accumulation any more
            if -0.35 < chg < 0.35:
                pts += 8; reasons.append(f"price flat ({chg:+.0%} / 3 h) while insiders buy")
    elif mode == "revival":
        # quiet gap ≥ 6 h before the recent burst, then real volume from several wallets
        recent = [s for s in sw if s["ts"] > now - 3600]
        if len({s["wallet"] for s in recent if s["side"] == "buy"}) < 5 or sum(s["usdc"] for s in recent) < 300:
            return None
        older = [s for s in sw if s["ts"] <= now - 3600]
        gap_ok = (not older) or (min(s["ts"] for s in recent) - max(s["ts"] for s in older) >= 3 * 3600)
        if not gap_ok:
            return None
        if age is None or age < 24 * 3600:
            return None
        pts += 10; reasons.append(f"woke up: {len({s['wallet'] for s in recent})} wallets · ${sum(s['usdc'] for s in recent):,.0f} in 1 h after a quiet spell")

    score = max(0, min(100, round(pts)))
    if score < 25:
        return None
    return {"token": token, "score": score, "reasons": reasons[:5], "mode": mode, "age_s": age, "vol_6h": round(vol, 2),
            "buyers_30m": len(b_now), "sm_wallets": sm_n, "sm_usd": round(sm_usd, 2), "cluster": best_cluster,
            "last_ts": last, "price1m": sw[-1].get("price1m")}


# ---------------- live ranking ----------------

_cache: dict[str, tuple[float, list[dict]]] = {}
CACHE_S = 45


async def _insiders() -> dict[str, float]:
    rows = await db.fetchall(text("SELECT wallet, pnl_total FROM wallet_stats WHERE range='30d' ORDER BY pnl_total DESC LIMIT :n").bindparams(n=INSIDER_TOP))
    out = {}
    for i, r in enumerate(rows):
        out[r["wallet"]] = 1.0 - i / (2 * INSIDER_TOP)      # rank weight 1.0 → 0.5
    return out


async def rank(mode: str, limit: int = 30) -> list[dict]:
    hit = _cache.get(mode)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1][:limit]
    now = int(time.time())
    swaps = await db.fetchall(text(
        "SELECT token, wallet, side, usdc, ts, price1m FROM swaps WHERE ts > :s AND usdc >= 0.5 ORDER BY ts").bindparams(s=now - LOOKBACK))
    by_tok: dict[str, list[dict]] = defaultdict(list)
    for s in swaps:
        by_tok[s["token"]].append(dict(s))
    if not by_tok:
        return []
    toks = list(by_tok.keys())
    firsts = await db.fetchall(text("SELECT token, MIN(ts) f FROM swaps WHERE token = ANY(:t) GROUP BY token").bindparams(t=toks))
    first = {r["token"]: int(r["f"]) for r in firsts}
    insiders = await _insiders()
    kol_rows = await db.fetchall(text(
        "SELECT m.token, m.kol, m.ts, k.followers FROM kol_mentions m LEFT JOIN kols k ON k.handle = m.kol WHERE m.ts > :s").bindparams(s=now - 6 * 3600))
    kols_by: dict[str, list[dict]] = defaultdict(list)
    for r in kol_rows:
        kols_by[r["token"]].append(dict(r))
    risk_rows = await db.fetchall(text("SELECT token, data FROM risk_cache WHERE token = ANY(:t)").bindparams(t=toks))
    risk = {}
    for r in risk_rows:
        try:
            risk[r["token"]] = json.loads(r["data"]) if isinstance(r["data"], str) else r["data"]
        except Exception:  # noqa
            pass
    try:
        from .liquidity import liquidity_for
        liq = await asyncio.wait_for(liquidity_for(toks[:300]), timeout=8)
    except Exception:  # noqa
        liq = {}
    out = []
    for t, sw in by_tok.items():
        try:
            r = score_token(t, sw, now, insiders, kols_by.get(t, []), risk.get(t), first.get(t), liq.get(t), mode)
        except Exception as e:  # noqa
            log.debug("score %s: %s", t, e); r = None
        if r:
            r["liq"] = liq.get(t); out.append(r)
    out.sort(key=lambda x: (-x["score"], -x["vol_6h"]))
    # market cap now (last price × cached total supply) + "first call": the moment this token first entered the list
    from .insider import total_supply_nowait
    for o in out:
        sup = total_supply_nowait(o["token"]); p = o.get("price1m")
        o["mcap"] = round(p * sup / 1e6, 2) if (p and sup) else None      # price1m = USDC per 1M tokens
    await _record_calls(mode, out[:60], now)
    # symbols
    syms = await db.fetchall(text("SELECT token, symbol FROM token_symbols WHERE token = ANY(:t)").bindparams(t=[o["token"] for o in out[:60]]))
    sm = {r["token"]: r["symbol"] for r in syms}
    for o in out:
        o["symbol"] = sm.get(o["token"])
    _cache[mode] = (time.time(), out)
    return out[:limit]


_calls_ready = False


async def _record_calls(mode: str, rows: list[dict], now: int) -> None:
    """Persist the first appearance of (token, mode) with its score and market cap, and attach it to every row.
    That is the "first call" users measure us against — kept forever, never rewritten."""
    global _calls_ready
    if not rows:
        return
    try:
        if not _calls_ready:
            await db.execute(text("CREATE TABLE IF NOT EXISTS alpha_calls (token VARCHAR(64) NOT NULL, mode VARCHAR(12) NOT NULL, "
                                  "ts BIGINT, score INTEGER, mcap DOUBLE PRECISION, price DOUBLE PRECISION, PRIMARY KEY (token, mode))"))
            _calls_ready = True
        toks = [r["token"] for r in rows]
        have = {r["token"]: dict(r) for r in await db.fetchall(text(
            "SELECT token, ts, score, mcap, price FROM alpha_calls WHERE mode = :m AND token = ANY(:t)").bindparams(m=mode, t=toks))}
        for r in rows:
            c = have.get(r["token"])
            if c is None:
                await db.execute(text("INSERT INTO alpha_calls (token, mode, ts, score, mcap, price) VALUES (:t, :m, :ts, :s, :mc, :p) "
                                      "ON CONFLICT DO NOTHING").bindparams(t=r["token"], m=mode, ts=now, s=r["score"], mc=r.get("mcap"), p=r.get("price1m")))
                c = {"ts": now, "score": r["score"], "mcap": r.get("mcap"), "price": r.get("price1m")}
            r["first_ts"] = int(c["ts"]) if c.get("ts") else None
            r["first_score"] = c.get("score"); r["first_mcap"] = c.get("mcap"); r["first_price"] = c.get("price")
            fm, nm = c.get("mcap"), r.get("mcap")
            r["since_call"] = round(nm / fm - 1, 4) if (fm and nm) else None
    except Exception as e:  # noqa
        log.warning("alpha_calls: %s", e)


async def api_alpha(request):
    from aiohttp import web
    mode = request.query.get("mode", "fresh")
    if mode not in ("fresh", "accum", "revival"):
        mode = "fresh"
    limit = min(60, max(3, int(request.query.get("limit", "30") or 30)))
    try:
        rows = await asyncio.wait_for(rank(mode, limit), timeout=20)
    except Exception as e:  # noqa
        log.warning("alpha %s: %s", mode, e); rows = []
    return web.json_response({"mode": mode, "ts": int(time.time()), "rows": rows, "cache_s": CACHE_S},
                             headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=20"})
