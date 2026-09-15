"""Backtest the alpha scorer on our own swap history.

Replays score_token() at cutoffs every STEP seconds over the last DAYS days (only swaps before the cutoff are visible),
then measures the token's median price 1 h / 6 h / 24 h later vs. its median price in the 30 min before the cutoff.
Baseline = every token that had ≥ 5 swaps in the 6 h before the same cutoff (what a random pick would have done).

Known limitations (stated, not hidden): the insider set is today's top-200 (mild look-ahead); risk data is today's
snapshot; no slippage or fees. It answers one question honestly: do high scores precede up-moves more often than chance.
"""
import asyncio
import json
import sys
import time
from collections import defaultdict

from sqlalchemy import text

from . import db
from .alpha import score_token, LOOKBACK, INSIDER_TOP

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 5
STEP = 1800
HORIZONS = {"1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600}


def med(v):
    if not v:
        return None
    v = sorted(v); return v[len(v) // 2]


async def main():
    now = int(time.time())
    since = now - DAYS * 86400 - LOOKBACK
    rows = await db.fetchall(text("SELECT token, wallet, side, usdc, ts, price1m FROM swaps WHERE ts > :s AND usdc >= 0.5 ORDER BY ts").bindparams(s=since))
    print(f"swaps loaded: {len(rows):,} ({DAYS} days)", flush=True)
    by_tok = defaultdict(list)
    for r in rows:
        by_tok[r["token"]].append(dict(r))
    firsts = await db.fetchall(text("SELECT token, MIN(ts) f FROM swaps GROUP BY token"))
    first = {r["token"]: int(r["f"]) for r in firsts}
    ins = await db.fetchall(text("SELECT wallet FROM wallet_stats WHERE range='30d' ORDER BY pnl_total DESC LIMIT :n").bindparams(n=INSIDER_TOP))
    insiders = {r["wallet"]: 1.0 - i / (2 * INSIDER_TOP) for i, r in enumerate(ins)}
    kol_rows = await db.fetchall(text("SELECT m.token, m.kol, m.ts, k.followers FROM kol_mentions m LEFT JOIN kols k ON k.handle = m.kol"))
    kols_by = defaultdict(list)
    for r in kol_rows:
        kols_by[r["token"]].append(dict(r))
    risk_rows = await db.fetchall(text("SELECT token, data FROM risk_cache"))
    risk = {}
    for r in risk_rows:
        try:
            risk[r["token"]] = json.loads(r["data"]) if isinstance(r["data"], str) else r["data"]
        except Exception:  # noqa
            pass

    results = {m: {"picks": [], "base": []} for m in ("fresh", "accum", "revival")}
    cut = now - DAYS * 86400
    n_cuts = 0
    while cut <= now - HORIZONS["24h"]:
        n_cuts += 1
        for tok, sw in by_tok.items():
            vis = [s for s in sw if cut - LOOKBACK < s["ts"] <= cut]
            if len(vis) < 5:
                continue
            p0 = med([s["price1m"] for s in vis if s["ts"] > cut - 1800 and s["price1m"]]) or med([s["price1m"] for s in vis if s["price1m"]])
            if not p0:
                continue
            fut = {}
            for h, sec in HORIZONS.items():
                win = [s["price1m"] for s in sw if cut + sec - 1800 < s["ts"] <= cut + sec + 1800 and s["price1m"]]
                if not win:   # no trades around the horizon → last known price before it (or dead = -100%)
                    prev = [s["price1m"] for s in sw if cut < s["ts"] <= cut + sec and s["price1m"]]
                    fut[h] = (prev[-1] / p0 - 1) if prev else -1.0
                else:
                    fut[h] = med(win) / p0 - 1
            for mode in results:
                results[mode]["base"].append(fut)
                r = score_token(tok, vis, cut, insiders, [k for k in kols_by.get(tok, []) if k["ts"] <= cut], risk.get(tok), first.get(tok), None, mode)
                if r:
                    results[mode]["picks"].append({"score": r["score"], **fut, "tok": tok, "cut": cut})
        cut += STEP
    print(f"cutoffs: {n_cuts}\n", flush=True)

    def summ(lst, label):
        if not lst:
            print(f"  {label:<18} n=0"); return
        for h in HORIZONS:
            v = [x[h] for x in lst]
            up = sum(1 for x in v if x > 0.10) / len(v); dead = sum(1 for x in v if x <= -0.8) / len(v)
            print(f"  {label:<18} {h:>3}  n={len(v):<5} median {med(v):+.0%}  >+10%: {up:.0%}  ≥2x: {sum(1 for x in v if x >= 1)/len(v):.0%}  rug/dead: {dead:.0%}")
    for mode, r in results.items():
        print(f"== {mode.upper()} ==")
        summ(r["base"], "baseline (all)")
        summ([p for p in r["picks"] if p["score"] >= 40], "score ≥ 40")
        summ([p for p in r["picks"] if p["score"] >= 60], "score ≥ 60")
        summ([p for p in r["picks"] if p["score"] >= 75], "score ≥ 75")
        # distinct tokens picked at ≥60
        toks = {p["tok"] for p in r["picks"] if p["score"] >= 60}
        print(f"  distinct tokens ≥60: {len(toks)}\n")

asyncio.run(main())
