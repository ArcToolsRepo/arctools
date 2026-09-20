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
    # wallet ↔ X handle links. source: 'pad' (creator wrote it on-chain on ArcToolsPad/ArcPad → verified),
    # 'meta' (declared in RadarDex/Warp/other pad metadata → declared, spoofable). One row per (wallet, handle, token).
    await db.execute(text("CREATE TABLE IF NOT EXISTS wallet_x (wallet VARCHAR(64), handle VARCHAR(64), token VARCHAR(64), source VARCHAR(12), ts BIGINT, PRIMARY KEY (wallet, handle, token))"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS wallet_x_handle ON wallet_x (handle)"))
    asyncio.create_task(_backfill())
    asyncio.create_task(x_sync_loop())


async def _backfill():
    """First buyer of every indexed token → token_dev (source=first_buyer) where nothing better is known."""
    await asyncio.sleep(120)
    try:
        # ONLY tokens whose first retained buy really is their first trade ever. `swaps` keeps a retention
        # window, so for anything older the "first buyer" is just the earliest trader still stored — and the
        # sniper's dump guard sells a real position when that stranger takes profit, reporting it as the dev.
        # social_tokens.deploy_ts is the token's mint time from the explorer; within an hour of it, trust it.
        rows = await db.fetchall(text("""
            SELECT DISTINCT ON (s.token) s.token, s.wallet
              FROM swaps s
              JOIN social_tokens st ON st.token = s.token
             WHERE s.side = 'buy'
               AND st.deploy_ts IS NOT NULL
               AND s.ts - st.deploy_ts <= 3600
             ORDER BY s.token, s.ts ASC, s.log_index ASC
        """))
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
    try:
        res["x"] = (await wallet_x([dev])).get(dev, [])
    except Exception:  # noqa
        res["x"] = []
    _hist_cache[dev] = (time.time(), res)
    return res


# ---------------- wallet ↔ X ----------------
_X_BAD = {"i", "intent", "search", "home", "status", "share", "hashtag", "explore", "settings", "login", "signup", "compose", "messages", "notifications", "x", "twitter", "communities"}
VERIFIED_PADS = {"arctoolspad", "arcpad"}


def x_handle(url: str | None) -> str | None:
    """'https://x.com/Foo?s=21' → 'foo'. None for non-profile links."""
    if not url:
        return None
    u = url.strip()
    if u.startswith("@"):
        u = u[1:]
    u = u.replace("https://", "").replace("http://", "").replace("www.", "").replace("mobile.", "")
    for host in ("x.com/", "twitter.com/"):
        if u.lower().startswith(host):
            u = u[len(host):]
            break
    else:
        if "/" in u or "." in u:
            return None
    h = u.split("/")[0].split("?")[0].split("#")[0].strip().lower()
    if not h or h in _X_BAD or len(h) > 20 or not all(c.isalnum() or c == "_" for c in h):
        return None
    return h


async def x_sync():
    """Pull token socials from the site feed, join with token_dev, upsert wallet_x."""
    import aiohttp
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as sess:
        async with sess.get("https://arctools.fun/api/tokens") as r:
            data = await r.json()
    toks = data if isinstance(data, list) else (data.get("tokens") or data.get("rows") or [])
    pairs = [(t["token"].lower(), x_handle(t.get("twitter")), (t.get("pad") or "").lower()) for t in toks if isinstance(t, dict) and t.get("token") and x_handle(t.get("twitter"))]
    if not pairs:
        return 0
    from sqlalchemy import bindparam
    devs = await db.fetchall(text("SELECT token, dev, source FROM token_dev WHERE token IN :ts").bindparams(bindparam("ts", value=[p[0] for p in pairs], expanding=True)))
    dev_of = {r["token"].lower(): (r["dev"].lower(), r["source"]) for r in devs if r["dev"]}
    n = 0
    now = int(time.time())
    for tok, handle, pad in pairs:
        d = dev_of.get(tok)
        if not d or d[1] != "radar":  # only real deployers (radar = factory event), not first buyers
            continue
        src = "pad" if pad in VERIFIED_PADS else "meta"
        try:
            await db.execute(text("INSERT INTO wallet_x (wallet, handle, token, source, ts) VALUES (:w, :h, :t, :s, :ts) ON CONFLICT (wallet, handle, token) DO UPDATE SET source = EXCLUDED.source")
                             .bindparams(w=d[0], h=handle, t=tok, s=src, ts=now))
            n += 1
        except Exception as e:  # noqa
            log.debug("wallet_x upsert %s: %s", tok, e)
    _x_cache.clear()
    return n


async def x_sync_loop():
    await asyncio.sleep(90)
    while True:
        try:
            n = await x_sync()
            log.info("wallet_x sync: %s links", n)
        except Exception as e:  # noqa
            log.warning("wallet_x sync: %s", e)
        await asyncio.sleep(900)


_x_cache: dict[str, tuple[float, list[dict]]] = {}


async def wallet_x(wallets: list[str]) -> dict[str, list[dict]]:
    """{wallet: [{handle, verified, shared, tokens:[symbols]}]}. A handle used by ≥3 different deployer wallets is
    'shared' (celebrity / project spoof) and is not shown as that wallet's identity."""
    from sqlalchemy import bindparam
    ws = [w.lower() for w in wallets][:80]
    out: dict[str, list[dict]] = {w: [] for w in ws}
    miss = [w for w in ws if not (w in _x_cache and time.time() - _x_cache[w][0] < 600)]
    for w in ws:
        if w in _x_cache and w not in miss:
            out[w] = _x_cache[w][1]
    if miss:
        rows = await db.fetchall(text("""
            SELECT x.wallet, x.handle, x.source, s.symbol, x.token,
                   (SELECT COUNT(DISTINCT wallet) FROM wallet_x x2 WHERE x2.handle = x.handle) AS owners
            FROM wallet_x x LEFT JOIN token_symbols s ON s.token = x.token WHERE x.wallet IN :ws ORDER BY x.source, x.ts""").bindparams(bindparam("ws", value=miss, expanding=True)))
        by: dict[str, dict[str, dict]] = {w: {} for w in miss}
        for r in rows:
            d = by[r["wallet"].lower()].setdefault(r["handle"], {"handle": r["handle"], "verified": False, "shared": int(r["owners"] or 1) >= 3, "tokens": []})
            d["verified"] = d["verified"] or r["source"] == "pad"
            d["tokens"].append(r["symbol"] or r["token"][:6])
        for w in miss:
            lst = sorted(by[w].values(), key=lambda d: (not d["verified"], d["shared"], -len(d["tokens"])))
            _x_cache[w] = (time.time(), lst)
            out[w] = lst
    return out


async def api_x(req: web.Request):
    """GET /api/x/{handle} — every deployer wallet that declared this X account, their tokens and dump history."""
    h = x_handle(req.match_info["handle"])
    if not h:
        return web.json_response({"error": "handle"}, status=400, headers=CORS)
    rows = await db.fetchall(text("SELECT x.wallet, x.token, x.source, s.symbol FROM wallet_x x LEFT JOIN token_symbols s ON s.token = x.token WHERE x.handle = :h ORDER BY x.ts").bindparams(h=h))
    wallets: dict[str, dict] = {}
    for r in rows:
        w = wallets.setdefault(r["wallet"].lower(), {"wallet": r["wallet"].lower(), "verified": False, "tokens": []})
        w["verified"] = w["verified"] or r["source"] == "pad"
        w["tokens"].append({"token": r["token"], "symbol": r["symbol"]})
    for w in wallets.values():
        hist = await dev_history(w["wallet"])
        w["launches"], w["rugs"] = hist["launches"], hist["rugs"]
        dumped = {t["token"] for t in hist["tokens"] if t["dumped"]}
        for t in w["tokens"]:
            t["dumped"] = t["token"] in dumped
    return web.json_response({"handle": h, "url": f"https://x.com/{h}", "wallets": list(wallets.values()), "shared": len(wallets) >= 3,
                              "launches": sum(w["launches"] for w in wallets.values()), "rugs": sum(w["rugs"] for w in wallets.values())},
                             headers={**CORS, "Cache-Control": "public, max-age=120"})


async def api_wallet_x(req: web.Request):
    ws = [w.strip() for w in (req.query.get("wallets") or "").split(",") if w.strip().startswith("0x") and len(w.strip()) == 42]
    return web.json_response({"x": await wallet_x(ws)}, headers={**CORS, "Cache-Control": "public, max-age=120"})


OFFICIAL = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52"


def score(k: dict, official: bool = False) -> tuple[int, str, list[str]]:
    """k = holder-risk dict. Returns (score 0-100, grade, flags).

    The platform's own token is scored clean and carries no flags: every penalty here is a proxy for "a stranger
    may run off with your money", and for ARCT the treasury is ours, the deployer is ours, and its deployer
    history is ARCT itself. Applying the stranger heuristics to it measures nothing."""
    if official or (k.get("token") or "").lower() == OFFICIAL:
        return 100, "A", []
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
    ds = max(0.0, float(k.get("dev_net_usd", (k.get("dev_sold_usd") or 0) - (k.get("dev_bought_usd") or 0)) or 0))
    if ds > 200:
        s -= 25; flags.append(f"dev net −${ds:,.0f} (24h)")
    elif ds > 0:
        s -= 15; flags.append(f"dev net −${ds:,.0f} (24h)")
    bs = max(0.0, float(k.get("bundle_net_usd", (k.get("bundle_sold_usd") or 0) - (k.get("bundle_bought_usd") or 0)) or 0))
    if bs > 200:
        s -= 10; flags.append(f"bundle net −${bs:,.0f}")
    elif bs > 0:
        s -= 5; flags.append(f"bundle net −${bs:,.0f}")
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
        xs = await wallet_x(ws)
        for w, lst in xs.items():
            own = [d for d in lst if not d["shared"]]
            if own:
                d = own[0]
                # a wallet that pastes one famous handle under 3+ unrelated tokens, or several different handles, is claiming, not identifying
                related = any(t and (t.lower()[:4] in d["handle"] or d["handle"][:4] in t.lower()) for t in d["tokens"])
                claim = (not d["verified"]) and (len(own) > 1 or (len(d["tokens"]) >= 3 and not related))
                out[w].append({"kind": "x", "text": (f"claims @{d['handle']}" if claim else f"@{d['handle']}") + (" ✓" if d["verified"] else "") + (f" +{len(own) - 1}" if len(own) > 1 else ""),
                               "url": f"https://x.com/{d['handle']}", "verified": d["verified"], "conflict": len(own) > 1, "shared": claim})
            elif lst:
                out[w].append({"kind": "x", "text": f"claims @{lst[0]['handle']}", "url": f"https://x.com/{lst[0]['handle']}", "verified": False, "shared": True})
    except Exception as e:  # noqa
        log.debug("labels x: %s", e)
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
    out = await dev_history(dev)
    # "dumped before" means ANOTHER token: a page must not warn that this deployer once dumped the very token
    # you are looking at, and the official token is never reported against itself either
    skip = (req.query.get("exclude") or "").lower()
    if skip.startswith("0x") and isinstance(out, dict) and isinstance(out.get("tokens"), list):
        kept = [t for t in out["tokens"] if (t.get("token") or "").lower() not in (skip, OFFICIAL)]
        dropped = len(out["tokens"]) - len(kept)
        out = {**out, "tokens": kept}
        if dropped:
            for key, adj in (("rugs", "rugs"), ("dumped", "dumped")):
                if isinstance(out.get(key), int):
                    out[key] = max(0, out[key] - dropped)
    return web.json_response(out, headers={**CORS, "Cache-Control": "public, max-age=120"})


async def api_wallet_labels(req: web.Request):
    from .watchlist import _cached, _resp_body
    body = await _cached("wlabels:" + req.query_string, 120, lambda: _resp_body(_api_wallet_labels_impl(req)))
    return web.Response(body=body, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"})


async def _api_wallet_labels_impl(req: web.Request):
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



# Our own infrastructure. ARCT was deployed from the treasury, so every treasury movement read as "the
# deployer is dumping" and the sniper's guard sold real ARCT positions on it. Our own wallets are never a
# rug signal — a guard exists to warn about a stranger walking away with the liquidity.
OWN_WALLETS = {
    "0xb35c471b31d636b96f95b84e7a27d69b63235c0d",   # treasury / fee sink
    "0x43cdbf8edb8fe41dde4ba519f49499d1ed78e74a",   # ArcAggregator v3
    "0x9f3eefd8b4158c09bf134fa6c032745a7d781be6",   # ArcClaim
    "0x000000000000000000000000000000000000dead",   # burn
}


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
        if not dev:
            # NO first-buyer fallback here. `swaps` only holds a retention window, so the oldest row we still
            # have is not the token's first buyer — for any token older than the window it is just whoever
            # happened to trade inside it. Calling that wallet "the deployer" made the dump guard sell real
            # positions because an ordinary trader took profit. An unknown deployer means the guard stays put.
            dev = None
        try:
            early = await _bundle_wallets(t, dev)
        except Exception:  # noqa
            early = set()
        ws = ([dev] if dev else []) + sorted(early)
        row = {"dev": dev, "dev_sold_usd": 0.0, "dev_sells": 0, "dev_last_sell": None, "bundle_sold_usd": 0.0, "bundle_sells": 0, "bundle_last_sell": None, "dev_bought_usd": 0.0, "bundle_bought_usd": 0.0, "bundlers": len(early)}
        if ws:
            sells = await db.fetchall(text("SELECT wallet, usdc, ts, side FROM swaps WHERE token = :t AND ts > :s AND wallet IN :ws ORDER BY ts DESC LIMIT 400")
                                      .bindparams(bindparam("ws", value=ws, expanding=True)).bindparams(t=t, s=since))
            for sw in sells:
                if (sw["side"] or "") == "buy":
                    w = (sw["wallet"] or "").lower()
                    if w in OWN_WALLETS:
                        continue
                    if w == dev:
                        row["dev_bought_usd"] += float(sw["usdc"] or 0)
                    else:
                        row["bundle_bought_usd"] += float(sw["usdc"] or 0)
                    continue
                w = (sw["wallet"] or "").lower()
                if w in OWN_WALLETS:
                    continue
                if w == dev:
                    row["dev_sold_usd"] += float(sw["usdc"] or 0); row["dev_sells"] += 1
                    row["dev_last_sell"] = max(row["dev_last_sell"] or 0, int(sw["ts"]))
                else:
                    row["bundle_sold_usd"] += float(sw["usdc"] or 0); row["bundle_sells"] += 1
                    row["bundle_last_sell"] = max(row["bundle_last_sell"] or 0, int(sw["ts"]))
        # net is what the guard and the badge must read: money actually taken out of the token
        row["dev_net_usd"] = round(row["dev_sold_usd"] - row["dev_bought_usd"], 2)
        row["bundle_net_usd"] = round(row["bundle_sold_usd"] - row["bundle_bought_usd"], 2)
        for k in ("dev_sold_usd", "bundle_sold_usd", "dev_bought_usd", "bundle_bought_usd"):
            row[k] = round(row[k], 2)
        out[t] = row
    return web.json_response({"rows": out, "now": int(time.time())}, headers={**CORS, "Cache-Control": "no-store"})



async def api_dev_audit(req):
    """GET /api/dev-audit?key=… — who we think deployed what, and how we decided.

    Exists because a guessed deployer is not a harmless guess: the sniper's dump guard sells a real position
    on it. ?purge=first_buyer drops the guessed rows so they get resolved properly next time.
    """
    import os
    if req.query.get("key") != os.getenv("INGEST_KEY", ""):
        return web.json_response({"error": "forbidden"}, status=403)
    rows = await db.fetchall(text("SELECT source, COUNT(*) AS n, MAX(ts) AS last FROM token_dev GROUP BY source"))
    sym = (req.query.get("sym") or "").upper()
    if sym:
        fam = await db.fetchall(text("""
            SELECT st.token, st.launchpad, st.deploy_ts, st.updated, pt.pad AS pad_pad, pt.ts AS pad_ts,
                   (SELECT COUNT(*) FROM swaps s WHERE s.token = st.token) AS n_swaps
              FROM social_tokens st LEFT JOIN pad_tokens pt ON pt.token = st.token
             WHERE UPPER(st.symbol) = :s ORDER BY st.updated DESC LIMIT 200
        """).bindparams(s=sym))
        out_fam = [dict(r) for r in fam]
        return web.json_response({"symbol": sym, "n": len(out_fam), "rows": out_fam[:60],
                                  "pads": {k: sum(1 for r in out_fam if (r.get("launchpad") or r.get("pad_pad")) == k)
                                           for k in {(r.get("launchpad") or r.get("pad_pad")) for r in out_fam}},
                                  "traded": sum(1 for r in out_fam if (r.get("n_swaps") or 0) > 0)}, headers=CORS)
    out = {"by_source": {r["source"]: {"n": int(r["n"]), "last": int(r["last"] or 0)} for r in rows}}
    if req.query.get("purge") == "first_buyer":
        since = int(req.query.get("since") or 0)
        res = await db.execute(text("DELETE FROM token_dev WHERE source = 'first_buyer' AND ts >= :s").bindparams(s=since))
        out["purged"] = getattr(res, "rowcount", None)
    return web.json_response(out, headers=CORS)

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
    app.router.add_get("/api/dev-audit", api_dev_audit)
    app.router.add_get("/api/dev-sells", api_dev_sells)
    app.router.add_get("/api/dev-history", api_dev_history)
    app.router.add_get("/api/wallet-labels", api_wallet_labels)
    app.router.add_get("/api/rugs", api_rugs)
    app.router.add_get("/api/wallet-x", api_wallet_x)
    app.router.add_get("/api/x/{handle}", api_x)
