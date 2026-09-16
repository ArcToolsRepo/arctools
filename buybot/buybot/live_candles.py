"""In-memory 1-minute candles for hot tokens — the "event path" of the chart.

The ingest calls `ingest(rows)` for every swap batch BEFORE it is written to Postgres. /api/ohlc overlays these
buckets on top of the SQL candles, so the current and the last few minutes are always live even when the DB commit
lags. Only the last RING minutes per token are kept (≈ 3 h); older history stays in the database.
"""
from __future__ import annotations

import time
from collections import OrderedDict

RING = 180                       # minutes kept per token
MAX_TOKENS = 3000                # LRU over tokens
_c: "OrderedDict[str, dict[int, dict]]" = OrderedDict()
stats = {"swaps": 0, "tokens": 0}


def ingest(rows: list[dict]) -> None:
    for r in rows:
        tok = (r.get("token") or "").lower(); p = float(r.get("price1m") or 0); u = float(r.get("usdc") or 0); ts = int(r.get("ts") or 0)
        if not tok or p <= 0 or u <= 0 or ts <= 0:
            continue
        b = ts // 60 * 60
        buckets = _c.get(tok)
        if buckets is None:
            buckets = _c[tok] = {}
            if len(_c) > MAX_TOKENS:
                _c.popitem(last=False)
        else:
            _c.move_to_end(tok)
        k = buckets.get(b)
        if k is None:
            k = buckets[b] = {"t": b, "o": p, "h": p, "l": p, "c": p, "v": 0.0, "vb": 0.0, "n": 0, "_li": -1}
            if len(buckets) > RING:
                for old in sorted(buckets)[: len(buckets) - RING]:
                    buckets.pop(old, None)
        # order inside a bucket by (ts, log_index) → close = latest print
        li = int(r.get("log_index") or 0)
        if (ts, li) >= (k.get("_ts", 0), k["_li"]):
            k["c"] = p; k["_ts"] = ts; k["_li"] = li
        if p > k["h"]: k["h"] = p
        if p < k["l"]: k["l"] = p
        k["v"] += u; k["n"] += 1
        if r.get("side") == "buy": k["vb"] += u
        stats["swaps"] += 1
    stats["tokens"] = len(_c)


def candles(token: str, step: int, since: int) -> list[dict]:
    """Aggregate the 1m ring into `step`-second candles for buckets >= since."""
    buckets = _c.get(token.lower())
    if not buckets:
        return []
    out: dict[int, dict] = {}
    for b in sorted(buckets):
        if b < since:
            continue
        k = buckets[b]; B = b // step * step
        o = out.get(B)
        if o is None:
            out[B] = {"t": B, "o": k["o"], "h": k["h"], "l": k["l"], "c": k["c"], "v": k["v"], "vb": k["vb"], "n": k["n"]}
        else:
            o["h"] = max(o["h"], k["h"]); o["l"] = min(o["l"], k["l"]); o["c"] = k["c"]; o["v"] += k["v"]; o["vb"] += k["vb"]; o["n"] += k["n"]
    return [out[b] for b in sorted(out)]


def last_price(token: str) -> float | None:
    buckets = _c.get(token.lower())
    if not buckets:
        return None
    return buckets[max(buckets)]["c"]


def snapshot() -> dict:
    return {**stats, "ts": int(time.time())}
