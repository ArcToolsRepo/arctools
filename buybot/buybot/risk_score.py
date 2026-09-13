"""Token Score, rug database and wallet labels.

* token_dev  — deployer per token (RadarDex `deployer` when known, else the first buyer in our index). Filled
               lazily by holder-risk lookups and by a one-shot backfill at startup.
* dev history — every token a deployer launched, with how much they sold and how far the price fell from its
               peak → "dumped" flag → rug count per deployer ("dev previously dumped N tokens").
* score      — 0-100 (+ grade A-D + human flags) from dev share, bundle, top-10, dev/bundle sells, rug history,
               holder count. Same function feeds the site (Terminal / token page) and the sniper (auto-snipe rules).
* wallet labels — insider rank, dev of X, ruger ×N, fresh, whale, bundle-of-token, bot-suspect.
"""
from __future__ import annotations

import asyncio
import logging
import time

from aiohttp import web
from sqlalchemy import text

from . import db

log = logging.getLogger("risk_score")

DUMP_MIN_USD = 25.0          # deployer must have taken out at least this much…
DUMP_DRAWDOWN = 0.25         # …and the token trades at ≤25 % of its peak — or…
DUMP_SHARE_OF_BUYS = 0.40    # …deployer sells ≥40 % of all buy volume of that token (classic soft rug on thin curves)

_hist_cache: dict[str, tuple[float, dict]] = {}
_board_cache: tuple[float, dict[str, int]] = (0.0, {})


async def init():
    await db.execute(text("CREATE TABLE IF NOT EXISTS token_dev (token VARCHAR(64) PRIMARY KEY, dev VARCHAR(64), source VARCHAR(12), ts BIGINT)"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS token_dev_dev ON token_dev (dev)"))
    asyncio.create_task(_backfill())


async def _backfill():
    """First buyer of every indexed token → token_dev (source=first_buyer) where nothing better is known."""
    await asyncio.sleep(120)
    try:
        rows = await db.fetchall(text(
            "SELECT DISTINCT ON (token) token, wallet FROM swaps WHERE side = 'buy' ORDER BY token, ts ASC, log_index ASC"))
        n = 0
        for r in rows:
            if not r["wallet"]:
                continue
            await db.execute(text(
                "INSERT INTO token_dev (token, dev, source, ts) VALUES (:t, :d, 'first_buyer', :ts) ON CONFLICT (token) DO NOTHING"
            ).bindparams(t=r["token"].lower(), d=r["wallet"].lower(), ts=int(time.time())))
            n += 1
        log.info("token_dev backfill: %d tokens", n)
    except Exception as e:  # noqa
        log.warning("token_dev backfill: %s", e)


async def remember_dev(token: str, dev: str | None, source: str) -> None:
    if not dev:
        return
    try:
        if source == "radar":
            await db.execute(text(
                "INSERT INTO token_dev (token, dev, source, ts) VALUES (:t, :d, 'radar', :ts) "
                "ON CONFLICT (token) DO UPDATE SET dev = EXCLUDED.dev, source = 'radar', ts = EXCLUDED.ts WHERE token_dev.source <> 'radar'"
            ).bindparams(t=token.lower(), d=dev.lower(), ts=int(time.time())))
        else:
            await db.execute(text(
                "INSERT INTO token_dev (token, dev, source, ts) VALUES (:t, :d, :s, :ts) ON CONFLICT (token) DO NOTHING"
            ).bindparams(t=token.lower(), d=dev.lower(), s=source, ts=int(time.time())))
    except Exception as e:  # noqa
        log.debug("remember_dev %s: %s", token, e)


async def dev_history(dev: str) -> dict:
    """Every token this wallet deployed (or launch-bought) with dump analysis. Cached 10 min."""
    dev = dev.lower()
    c = _hist_cache.get(dev)
    if c and time.time() - c[0] < 600:
        return c[1]
    toks = await db.fetchall(text("SELECT token, source FROM token_dev WHERE dev = :d").bindparams(d=dev))
    out = []
    for r in toks[:60]:
        t = r["token"]
        try:
            agg = await db.fetchone(text(
                "SELECT COALESCE(SUM(CASE WHEN wallet = :d AND side = 'sell' THEN usdc END),0) AS dev_sold, "
                "COALESCE(SUM(CASE WHEN side = 'buy' THEN usdc END),0) AS buys, MAX(price1m) AS peak, MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*) AS n "
                "FROM swaps WHERE token = :t").bindparams(d=dev, t=t))
            last = await db.fetchone(text("SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 ORDER BY ts DESC, log_index DESC LIMIT 1").bindparams(t=t))
            sym = await db.fetchone(text("SELECT symbol FROM token_symbols WHERE token = :t").bindparams(t=t))
            dev_sold = float(agg["dev_sold"] or 0); buys = float(agg["buys"] or 0)
            peak = float(agg["peak"] or 0); now_p = float(last["price1m"]) if last and last["price1m"] else 0.0
            drawdown = (now_p / peak) if peak > 0 and now_p > 0 else None
            # confirmed deployer (RadarDex): took money out AND the chart collapsed, or sold a big share of all buys.
            # first-buyer fallback (often just a fast sniper, not the dev): only the hard "sold ≥40 % of all buy volume" signal counts.
            heavy = buys > 0 and dev_sold / buys >= DUMP_SHARE_OF_BUYS
            if r["source"] == "radar":
                dumped = dev_sold >= DUMP_MIN_USD and ((drawdown is not None and drawdown <= DUMP_DRAWDOWN) or heavy)
            else:
                dumped = dev_sold >= DUMP_MIN_USD and heavy
            out.append({"token": t, "symbol": (sym["symbol"] if sym else None), "source": r["source"], "dev_sold_usd": round(dev_sold, 2),
                        "buy_volume_usd": round(buys, 2), "drawdown": round(drawdown, 3) if drawdown is not None else None,
                        "dumped": bool(dumped), "first_ts": int(agg["first_ts"] or 0), "last_ts": int(agg["last_ts"] or 0), "swaps": int(agg["n"] or 0)})
        except Exception as e:  # noqa
            log.debug("dev_history %s/%s: %s", dev, t, e)
    out.sort(key=lambda d: -d["first_ts"])
    res = {"dev": dev, "launches": len(out), "rugs": sum(1 for d in out if d["dumped"]), "tokens": out}
    _hist_cache[dev] = (time.time(), res)
    return res


def score(k: dict, official: bool = False) -> tuple[int, str, list[str]]:
    """k = holder-risk dict. Returns (score 0-100, grade, flags)."""
    s = 100
    flags: list[str] = []
    dv = k.get("dev_pct"); bd = k.get("bundle_pct"); t10 = k.get("top10"); hold = k.get("holders") or 0
    if dv is None:
        s -= 5
    elif dv > 15:
        s -= 25; flags.append(f"dev holds {dv:.0f}%")
    elif dv > 5:
        s -= 10; flags.append(f"dev holds {dv:.0f}%")
    if bd is not None:
        if bd > 25:
            s -= 20; flags.append(f"bundle {bd:.0f}%")
        elif bd > 10:
            s -= 8; flags.append(f"bundle {bd:.0f}%")
    if t10 is not None and not official:
        if t10 > 60:
            s -= 20; flags.append(f"top-10 hold {t10:.0f}%")
        elif t10 > 35:
            s -= 8; flags.append(f"top-10 hold {t10:.0f}%")
    ds = k.get("dev_sold_usd") or 0
    if ds > 200:
        s -= 25; flags.append(f"dev sold ${ds:,.0f} (24h)")
    elif ds > 0:
        s -= 15; flags.append(f"dev sold ${ds:,.0f} (24h)")
    bs = k.get("bundle_sold_usd") or 0
    if bs > 200:
        s -= 10; flags.append(f"bundle sold ${bs:,.0f}")
    elif bs > 0:
        s -= 5; flags.append(f"bundle sold ${bs:,.0f}")
    rugs = k.get("dev_rugs") or 0
    if rugs >= 2:
        s -= 45; flags.append(f"dev dumped {rugs} tokens before")
    elif rugs == 1:
        s -= 30; flags.append("dev dumped a token before")
    if 0 < hold < 10:
        s -= 10; flags.append(f"only {hold} holders")
    if k.get("lookalike"):
        s -= 15; flags.append("lookalike name")
    s = max(0, min(100, s))
    grade = "A" if s >= 80 else "B" if s >= 60 else "C" if s >= 40 else "D"
    return s, grade, flags


async def _board() -> dict[str, int]:
    global _board_cache
    if time.time() - _board_cache[0] < 300:
        return _board_cache[1]
    try:
        rows = await db.fetchall(text(
            "SELECT wallet FROM wallet_stats WHERE range = '30d' AND closed >= 3 AND volume >= 200 AND bot_suspect = 0 ORDER BY pnl_total DESC LIMIT 100"))
        m = {r["wallet"].lower(): i + 1 for i, r in enumerate(rows)}
    except Exception:  # noqa
        m = {}
    _board_cache = (time.time(), m)
    return m


async def wallet_labels(wallets: list[str], token: str | None = None) -> dict[str, list[dict]]:
    """Labels per wallet: {kind, text}. kinds: insider, dev, ruger, fresh, whale, bundle, bot."""
    from sqlalchemy import bindparam
    ws = [w.lower() for w in wallets if w.startswith("0x") and len(w) == 42][:80]
    out: dict[str, list[dict]] = {w: [] for w in ws}
    if not ws:
        return out
    board = await _board()
    for w in ws:
        if w in board:
            out[w].append({"kind": "insider", "text": f"insider #{board[w]}"})
    try:
        devs = await db.fetchall(text("SELECT d.dev, d.token, d.source, s.symbol FROM token_dev d LEFT JOIN token_symbols s ON s.token = d.token WHERE d.dev IN :ws")
                                 .bindparams(bindparam("ws", value=ws, expanding=True)))
        by: dict[str, list] = {}
        src: dict[str, str] = {}
        for r in devs:
            by.setdefault(r["dev"].lower(), []).append(r["symbol"] or r["token"][:6])
            if r["source"] == "radar":
                src[r["dev"].lower()] = "radar"
        for w, syms in by.items():
            word = "dev of" if src.get(w) == "radar" else "first buyer of"
            if token and any(True for r in devs if r["dev"].lower() == w and r["token"].lower() == token.lower()):
                this_src = next((r["source"] for r in devs if r["dev"].lower() == w and r["token"].lower() == token.lower()), "")
                out[w].append({"kind": "dev", "text": "dev of this token" if this_src == "radar" else "first buyer"})
            else:
                out[w].append({"kind": "dev", "text": f"{word} " + ", ".join(syms[:2]) + (f" +{len(syms) - 2}" if len(syms) > 2 else "")})
            h = await dev_history(w)
            if h["rugs"]:
                out[w].append({"kind": "ruger", "text": f"dumped {h['rugs']} token{'s' if h['rugs'] > 1 else ''}"})
    except Exception as e:  # noqa
        log.debug("labels dev: %s", e)
    try:
        since = int(time.time()) - 86400
        fr = await db.fetchall(text("SELECT wallet, MIN(ts) AS t0, COUNT(*) AS n FROM swaps WHERE wallet IN :ws GROUP BY wallet")
                               .bindparams(bindparam("ws", value=ws, expanding=True)))
        for r in fr:
            if int(r["t0"] or 0) > since:
                out[r["wallet"].lower()].append({"kind": "fresh", "text": "fresh wallet"})
    except Exception as e:  # noqa
        log.debug("labels fresh: %s", e)
    try:
        bal = await db.fetchall(text("SELECT wallet, balance FROM wallet_balance WHERE wallet IN :ws AND balance >= 10000")
                                .bindparams(bindparam("ws", value=ws, expanding=True)))
        for r in bal:
            out[r["wallet"].lower()].append({"kind": "whale", "text": f"whale ${float(r['balance']) / 1000:.0f}K"})
    except Exception as e:  # noqa
        log.debug("labels whale: %s", e)
    try:
        bots = await db.fetchall(text("SELECT wallet FROM wallet_stats WHERE range = '30d' AND bot_suspect = 1 AND wallet IN :ws")
                                 .bindparams(bindparam("ws", value=ws, expanding=True)))
        for r in bots:
            out[r["wallet"].lower()].append({"kind": "bot", "text": "bot-like"})
    except Exception:  # noqa
        pass
    if token:
        try:
            from .liquidity import _bundle_wallets
            devrow = await db.fetchone(text("SELECT dev FROM token_dev WHERE token = :t").bindparams(t=token.lower()))
            early = await _bundle_wallets(token.lower(), devrow["dev"] if devrow else None)
            for w in ws:
                if w in early:
                    out[w].append({"kind": "bundle", "text": "launch-block buyer"})
        except Exception as e:  # noqa
            log.debug("labels bundle: %s", e)
    return out


# ---------------------------------------------------------------- HTTP
CORS = {"Access-Control-Allow-Origin": "*"}


async def api_dev_history(req: web.Request):
    dev = (req.query.get("dev") or "").lower()
    if not (dev.startswith("0x") and len(dev) == 42):
        return web.json_response({"error": "dev"}, status=400, headers=CORS)
    return web.json_response(await dev_history(dev), headers={**CORS, "Cache-Control": "public, max-age=120"})


async def api_wallet_labels(req: web.Request):
    ws = [w.strip() for w in (req.query.get("wallets") or "").split(",") if w.strip()]
    token = req.query.get("token")
    return web.json_response({"labels": await wallet_labels(ws, token)}, headers={**CORS, "Cache-Control": "public, max-age=60"})


async def api_rugs(req: web.Request):
    """GET /api/rugs — deployers with ≥1 dumped token (for the site's rug database page / sniper deny-list)."""
    rows = await db.fetchall(text("SELECT dev, COUNT(*) AS n FROM token_dev GROUP BY dev HAVING COUNT(*) >= 1 ORDER BY n DESC LIMIT 300"))
    out = []
    for r in rows:
        h = await dev_history(r["dev"])
        if h["rugs"]:
            out.append({"dev": r["dev"], "launches": h["launches"], "rugs": h["rugs"],
                        "last": max((t["first_ts"] for t in h["tokens"]), default=0),
                        "symbols": [t["symbol"] or t["token"][:8] for t in h["tokens"] if t["dumped"]][:5]})
    out.sort(key=lambda d: (-d["rugs"], -d["last"]))
    return web.json_response({"rugs": out[:100]}, headers={**CORS, "Cache-Control": "public, max-age=300"})


async def api_dev_sells(req: web.Request):
    """GET /api/dev-sells?tokens=a,b&since=<unix> — dev + launch-block sells per token since `since`.
    Pure indexed DB query (no arc-scan), meant for the sniper's dump-guard loop every few seconds."""
    from sqlalchemy import bindparam
    toks = [t.strip().lower() for t in (req.query.get("tokens") or "").split(",") if t.strip().startswith("0x") and len(t.strip()) == 42][:60]
    since = int(req.query.get("since") or 0)
    if not toks:
        return web.json_response({"rows": {}}, headers=CORS)
    out: dict[str, dict] = {}
    devs = await db.fetchall(text("SELECT token, dev FROM token_dev WHERE token IN :ts").bindparams(bindparam("ts", value=toks, expanding=True)))
    devmap = {r["token"].lower(): (r["dev"] or "").lower() for r in devs}
    from .liquidity import _bundle_wallets
    for t in toks:
        dev = devmap.get(t)
        if not dev:   # first buyer fallback, remembered for next time
            r = await db.fetchone(text("SELECT wallet FROM swaps WHERE token = :t ORDER BY ts ASC, log_index ASC LIMIT 1").bindparams(t=t))
            dev = (r["wallet"] or "").lower() if r else None
            if dev:
                await remember_dev(t, dev, "first_buyer")
        try:
            early = await _bundle_wallets(t, dev)
        except Exception:  # noqa
            early = set()
        ws = ([dev] if dev else []) + sorted(early)
        row = {"dev": dev, "dev_sold_usd": 0.0, "dev_sells": 0, "dev_last_sell": None, "bundle_sold_usd": 0.0, "bundle_sells": 0, "bundle_last_sell": None, "bundlers": len(early)}
        if ws:
            sells = await db.fetchall(text("SELECT wallet, usdc, ts FROM swaps WHERE token = :t AND side = 'sell' AND ts > :s AND wallet IN :ws ORDER BY ts DESC LIMIT 200")
                                      .bindparams(bindparam("ws", value=ws, expanding=True)).bindparams(t=t, s=since))
            for sw in sells:
                w = (sw["wallet"] or "").lower()
                if w == dev:
                    row["dev_sold_usd"] += float(sw["usdc"] or 0); row["dev_sells"] += 1
                    row["dev_last_sell"] = max(row["dev_last_sell"] or 0, int(sw["ts"]))
                else:
                    row["bundle_sold_usd"] += float(sw["usdc"] or 0); row["bundle_sells"] += 1
                    row["bundle_last_sell"] = max(row["bundle_last_sell"] or 0, int(sw["ts"]))
        row["dev_sold_usd"] = round(row["dev_sold_usd"], 2); row["bundle_sold_usd"] = round(row["bundle_sold_usd"], 2)
        out[t] = row
    return web.json_response({"rows": out, "now": int(time.time())}, headers={**CORS, "Cache-Control": "no-store"})


async def api_dev_sells_feed(req: web.Request):
    """GET /api/dev-sells-feed?hours=24&limit=40 — chain-wide: recent sells by deployers of their own tokens (token_dev join)."""
    hours = min(168, max(1, int(req.query.get("hours") or 24)))
    limit = min(100, int(req.query.get("limit") or 40))
    since = int(time.time()) - hours * 3600
    rows = await db.fetchall(text(
        "SELECT s.tx, s.ts, s.wallet, s.token, s.usdc, s.tokens, s.price1m, sym.symbol, d.source "
        "FROM swaps s JOIN token_dev d ON d.token = s.token AND d.dev = s.wallet LEFT JOIN token_symbols sym ON sym.token = s.token "
        "WHERE s.side = 'sell' AND s.ts > :s AND s.usdc >= 5 ORDER BY s.ts DESC LIMIT :l").bindparams(s=since, l=limit))
    return web.json_response({"rows": [dict(r) for r in rows], "now": int(time.time())}, headers={**CORS, "Cache-Control": "public, max-age=15"})


def register(app: web.Application):
    app.router.add_get("/api/dev-sells-feed", api_dev_sells_feed)
    app.router.add_get("/api/dev-sells", api_dev_sells)
    app.router.add_get("/api/dev-history", api_dev_history)
    app.router.add_get("/api/wallet-labels", api_wallet_labels)
    app.router.add_get("/api/rugs", api_rugs)
