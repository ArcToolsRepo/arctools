"""Public trader profiles: an identity a wallet's record attaches to.

The chain already tells us what every wallet did; `wallet_stats` already turns that into PnL, win rate and
volume. What was missing is a person. A profile is a handle, a picture, a bio, an X account and one or more
wallets — and every number on it is computed by us from the chain, never submitted by the user.

Rules that matter and why:

  * A wallet joins a profile only by SIGNING a message with that wallet. Without it, the first thing that would
    happen is somebody attaching the chain's biggest whale to their own handle and selling a copy-trade service
    on it.
  * Handles that belong to accounts in our KOL index are reserved: `@arc` cannot be taken by whoever registers
    first, only by the person who proves that X account.
  * X is confirmed by posting a one-time code, so "declared" and "verified" are visibly different states.
  * The leaderboard hides wallets flagged as bots and demands a few closed positions, because one lucky trade
    should not own the top of the board forever.
  * The public trade feed is delayed by default. A profile with followers has an obvious incentive to buy, wait
    for the copiers and sell into them; a delay makes that a much worse business.
"""
from __future__ import annotations

import logging
import re
import secrets
import time

from aiohttp import web
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import text

from . import db

log = logging.getLogger("profiles")
CORS = {"Access-Control-Allow-Origin": "*"}

HANDLE_RE = re.compile(r"^[a-z0-9_]{3,20}$")
MAX_WALLETS = 8
SIG_WINDOW = 600                      # a signature is good for ten minutes
DEFAULT_DELAY = 60                    # seconds the public feed lags behind the chain
RESERVED = {"arc", "arctools", "admin", "support", "team", "official", "circle", "usdc", "null", "system"}


async def init():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS profiles (
        handle VARCHAR(20) PRIMARY KEY,
        display VARCHAR(40), bio VARCHAR(280), avatar VARCHAR(300), banner VARCHAR(300),
        x_handle VARCHAR(64), x_verified SMALLINT DEFAULT 0, x_code VARCHAR(16),
        public_positions SMALLINT DEFAULT 0, feed_delay INTEGER DEFAULT 60,
        created BIGINT, updated BIGINT)"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS profile_wallets (
        wallet VARCHAR(64) PRIMARY KEY, handle VARCHAR(20), proved_ts BIGINT)"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS profile_follows (
        follower VARCHAR(64), handle VARCHAR(20), ts BIGINT, PRIMARY KEY (follower, handle))"""))
    await db.execute(text("""CREATE TABLE IF NOT EXISTS profile_images (
        id VARCHAR(40) PRIMARY KEY, handle VARCHAR(20), kind VARCHAR(8), mime VARCHAR(32), bytes BYTEA, ts BIGINT)"""))
    for stmt in ("CREATE INDEX IF NOT EXISTS profile_wallets_handle ON profile_wallets (handle)",
                 "CREATE INDEX IF NOT EXISTS profile_follows_handle ON profile_follows (handle)"):
        try:
            await db.execute(text(stmt))
        except Exception:  # noqa
            pass


# ---------------------------------------------------------------- auth

def _msg(action: str, handle: str, wallet: str, ts: int) -> str:
    return f"ArcTools profile\naction: {action}\nhandle: {handle}\nwallet: {wallet.lower()}\nts: {ts}"


def _recover(action: str, handle: str, wallet: str, ts: int, sig: str) -> bool:
    """True when `sig` really is this wallet signing this exact action, recently."""
    try:
        if abs(int(time.time()) - int(ts)) > SIG_WINDOW:
            return False
        got = Account.recover_message(encode_defunct(text=_msg(action, handle, wallet, int(ts))), signature=sig)
        return got.lower() == wallet.lower()
    except Exception:  # noqa
        return False


async def _owner(handle: str, wallet: str) -> bool:
    r = await db.fetchone(text("SELECT 1 x FROM profile_wallets WHERE handle = :h AND wallet = :w")
                          .bindparams(h=handle, w=wallet.lower()))
    return bool(r)


async def _auth(req: web.Request, action: str) -> tuple[dict | None, web.Response | None]:
    try:
        body = await req.json()
    except Exception:  # noqa
        return None, web.json_response({"error": "bad json"}, status=400, headers=CORS)
    handle = str(body.get("handle") or "").lower().strip()
    wallet = str(body.get("wallet") or "").lower().strip()
    ts, sig = body.get("ts"), str(body.get("sig") or "")
    if not HANDLE_RE.match(handle) or not (wallet.startswith("0x") and len(wallet) == 42):
        return None, web.json_response({"error": "handle or wallet invalid"}, status=400, headers=CORS)
    if not _recover(action, handle, wallet, ts or 0, sig):
        return None, web.json_response({"error": "signature does not match this wallet"}, status=401, headers=CORS)
    return {**body, "handle": handle, "wallet": wallet}, None


async def _handle_free(handle: str, x_handle: str | None) -> tuple[bool, str]:
    if handle in RESERVED:
        return False, "this handle is reserved"
    row = await db.fetchone(text("SELECT handle FROM kols WHERE handle = :h").bindparams(h=handle))
    if row and (x_handle or "").lower() != handle:
        return False, "this handle belongs to a known X account and is held for its owner"
    return True, ""


# ---------------------------------------------------------------- stats

async def profile_stats(handle: str, rng: str = "all", wallets: list[str] | None = None) -> dict:
    """Everything the profile shows, summed over its wallets and computed from the chain.

    `wallets` can be passed directly, which is how the create form previews the real record of a wallet that
    has not been attached to any profile yet — the person sees their own numbers before they commit to a
    public handle, instead of filling a form blind."""
    if wallets is None:
        ws = await db.fetchall(text("SELECT wallet FROM profile_wallets WHERE handle = :h").bindparams(h=handle))
        wallets = [w["wallet"] for w in ws]
    if not wallets:
        return {"wallets": [], "trades": 0}
    rng = rng if rng in ("7d", "30d", "all") else "all"
    rows = await db.fetchall(text("""
        SELECT wallet, pnl_realized, pnl_unrealized, pnl_total, pnl_pct, winrate, trades, closed, volume,
               best_symbol, best_pnl, last_trade, bot_suspect
        FROM wallet_stats WHERE range = :r AND wallet = ANY(:w)""").bindparams(r=rng, w=wallets))
    agg = {"pnl_realized": 0.0, "pnl_unrealized": 0.0, "pnl_total": 0.0, "volume": 0.0,
           "trades": 0, "closed": 0, "last_trade": 0, "bot_suspect": 0}
    wr_num = wr_den = 0.0
    best = ("", 0.0)
    for r in rows:
        agg["pnl_realized"] += r["pnl_realized"] or 0
        agg["pnl_unrealized"] += r["pnl_unrealized"] or 0
        agg["pnl_total"] += r["pnl_total"] or 0
        agg["volume"] += r["volume"] or 0
        agg["trades"] += r["trades"] or 0
        agg["closed"] += r["closed"] or 0
        agg["last_trade"] = max(agg["last_trade"], r["last_trade"] or 0)
        agg["bot_suspect"] = max(agg["bot_suspect"], r["bot_suspect"] or 0)
        if (r["closed"] or 0) and r["winrate"] is not None:
            wr_num += (r["winrate"] or 0) * (r["closed"] or 0); wr_den += r["closed"] or 0
        if (r["best_pnl"] or 0) > best[1]:
            best = (r["best_symbol"] or "", r["best_pnl"] or 0.0)
    # wallet_stats only covers wallets the indexer has already summarised. A wallet nobody has looked at yet
    # would otherwise preview as all zeros next to positions worth thousands, so compute it from the swaps.
    if not rows or (agg["trades"] == 0 and agg["volume"] == 0):
        raw = await db.fetchall(text("""
            SELECT s.token,
                   SUM(CASE WHEN s.side = 'buy' THEN s.tokens ELSE 0 END) bought,
                   SUM(CASE WHEN s.side = 'sell' THEN s.tokens ELSE 0 END) sold,
                   SUM(CASE WHEN s.side = 'buy' THEN s.usdc ELSE 0 END) cost,
                   SUM(CASE WHEN s.side = 'sell' THEN s.usdc ELSE 0 END) proceeds,
                   COUNT(*) n,
                   (SELECT price1m FROM swaps p WHERE p.token = s.token AND p.price1m > 0 AND p.usdc >= 0.5
                    ORDER BY p.ts DESC LIMIT 1) price1m
            FROM swaps s WHERE s.wallet = ANY(:w) GROUP BY s.token LIMIT 500""").bindparams(w=wallets))
        realized = unreal = vol = 0.0
        trades = closed = wins = 0
        for r in raw:
            bought, sold = r["bought"] or 0, r["sold"] or 0
            cost, proceeds = r["cost"] or 0, r["proceeds"] or 0
            trades += r["n"] or 0
            vol += cost
            avg = cost / bought if bought > 0 else 0
            realized += proceeds - sold * avg
            held = max(0.0, bought - sold)
            if held > bought * 0.01:
                unreal += held * ((r["price1m"] or 0) / 1e6) - held * avg
            elif cost > 0:
                closed += 1
                if proceeds > cost:
                    wins += 1
        agg.update({"pnl_realized": round(realized, 2), "pnl_unrealized": round(unreal, 2),
                    "pnl_total": round(realized + unreal, 2), "volume": round(vol, 2),
                    "trades": trades, "closed": closed})
        wr_num, wr_den = (wins, closed) if closed else (0, 0)

    agg["winrate"] = round(wr_num / wr_den, 4) if wr_den else None
    # ROI against money actually put to work, not against the largest single position
    agg["roi"] = round(100 * agg["pnl_total"] / agg["volume"], 2) if agg["volume"] > 0 else None
    agg["best_symbol"], agg["best_pnl"] = best
    agg["wallets"] = wallets
    first = await db.fetchone(text("SELECT MIN(ts) t FROM swaps WHERE wallet = ANY(:w)").bindparams(w=wallets))
    agg["first_trade"] = (first or {}).get("t") or 0
    agg["days_active"] = round(max(0, (time.time() - agg["first_trade"]) / 86400), 1) if agg["first_trade"] else 0
    agg["range"] = rng
    return agg


async def badges(handle: str, st: dict) -> list[dict]:
    """Earned, never bought — except the verified mark, which is earned by proving the X account."""
    out: list[dict] = []
    p = await db.fetchone(text("SELECT x_verified, created FROM profiles WHERE handle = :h").bindparams(h=handle))
    if p and p["x_verified"]:
        out.append({"id": "verified", "label": "X verified", "tone": "cobalt"})
    if (st.get("first_trade") or 0) and st["first_trade"] < 1789200000:
        out.append({"id": "early", "label": "Arc early", "tone": "gold"})
    if (st.get("trades") or 0) >= 100:
        out.append({"id": "t100", "label": "100+ trades", "tone": "ink"})
    if (st.get("closed") or 0) >= 10 and (st.get("winrate") or 0) >= 0.6:
        out.append({"id": "sharp", "label": "60%+ win rate", "tone": "up"})
    wallets = st.get("wallets") or []
    if wallets:
        pad = await db.fetchone(text(
            "SELECT COUNT(*) n FROM token_dev WHERE dev = ANY(:w)")
            .bindparams(w=[w.lower() for w in wallets]))
        if (pad or {}).get("n"):
            out.append({"id": "creator", "label": f"deployed {pad['n']} token(s)", "tone": "pink"})
    return out


# ---------------------------------------------------------------- endpoints

async def api_get(req: web.Request):
    handle = (req.query.get("handle") or "").lower().strip()
    wallet = (req.query.get("wallet") or "").lower().strip()
    rng = req.query.get("range") or "all"
    if wallet and not handle:
        r = await db.fetchone(text("SELECT handle FROM profile_wallets WHERE wallet = :w").bindparams(w=wallet))
        if not r:
            if req.query.get("preview"):
                st = await profile_stats("", rng, wallets=[wallet])
                return web.json_response({"profile": None, "stats": st, "badges": [], "followers": 0, "preview": True},
                                         headers={**CORS, "Cache-Control": "no-store"})
            return web.json_response({"profile": None}, headers={**CORS, "Cache-Control": "public, max-age=30"})
        handle = r["handle"]
    if not HANDLE_RE.match(handle or ""):
        return web.json_response({"error": "handle"}, status=400, headers=CORS)
    p = await db.fetchone(text("""SELECT handle, display, bio, avatar, banner, x_handle, x_verified,
                                         public_positions, feed_delay, created
                                  FROM profiles WHERE handle = :h""").bindparams(h=handle))
    if not p:
        return web.json_response({"profile": None}, headers={**CORS, "Cache-Control": "public, max-age=30"})
    st = await profile_stats(handle, rng)
    bg = await badges(handle, st)
    fol = await db.fetchone(text("SELECT COUNT(*) n FROM profile_follows WHERE handle = :h").bindparams(h=handle))
    return web.json_response({"profile": dict(p), "stats": st, "badges": bg, "followers": (fol or {}).get("n") or 0},
                             headers={**CORS, "Cache-Control": "public, max-age=20"})


async def api_save(req: web.Request):
    body, err = await _auth(req, "save")
    if err:
        return err
    handle, wallet = body["handle"], body["wallet"]
    now = int(time.time())
    exists = await db.fetchone(text("SELECT handle, x_handle FROM profiles WHERE handle = :h").bindparams(h=handle))
    if exists:
        if not await _owner(handle, wallet):
            return web.json_response({"error": "this wallet does not belong to that profile"}, status=403, headers=CORS)
    else:
        taken = await db.fetchone(text("SELECT handle FROM profile_wallets WHERE wallet = :w").bindparams(w=wallet))
        if taken:
            return web.json_response({"error": f"this wallet already belongs to @{taken['handle']}"}, status=409, headers=CORS)
        ok, why = await _handle_free(handle, str(body.get("x_handle") or "").lower().lstrip("@"))
        if not ok:
            return web.json_response({"error": why}, status=409, headers=CORS)
    fields = {
        "display": str(body.get("display") or "")[:40],
        "bio": str(body.get("bio") or "")[:280],
        "avatar": str(body.get("avatar") or "")[:300],
        "banner": str(body.get("banner") or "")[:300],
        "x_handle": (str(body.get("x_handle") or "").lstrip("@") or None),
        "public_positions": 1 if body.get("public_positions") else 0,
        "feed_delay": max(0, min(3600, int(body.get("feed_delay") or DEFAULT_DELAY))),
    }
    await db.execute(text("""
        INSERT INTO profiles (handle, display, bio, avatar, banner, x_handle, public_positions, feed_delay, created, updated)
        VALUES (:h, :d, :b, :a, :bn, :x, :pp, :fd, :n, :n)
        ON CONFLICT (handle) DO UPDATE SET display = EXCLUDED.display, bio = EXCLUDED.bio, avatar = EXCLUDED.avatar,
            banner = EXCLUDED.banner, public_positions = EXCLUDED.public_positions, feed_delay = EXCLUDED.feed_delay,
            x_handle = CASE WHEN profiles.x_verified = 1 THEN profiles.x_handle ELSE EXCLUDED.x_handle END,
            x_verified = CASE WHEN profiles.x_handle IS DISTINCT FROM EXCLUDED.x_handle AND profiles.x_verified = 0
                              THEN 0 ELSE profiles.x_verified END,
            updated = EXCLUDED.updated
    """).bindparams(h=handle, d=fields["display"], b=fields["bio"], a=fields["avatar"], bn=fields["banner"],
                    x=fields["x_handle"], pp=fields["public_positions"], fd=fields["feed_delay"], n=now))
    if not exists:
        await db.execute(text("INSERT INTO profile_wallets (wallet, handle, proved_ts) VALUES (:w, :h, :n) "
                              "ON CONFLICT (wallet) DO NOTHING").bindparams(w=wallet, h=handle, n=now))
    return web.json_response({"ok": True, "handle": handle}, headers=CORS)


async def api_wallet(req: web.Request):
    """Attach or detach a wallet. Attaching must be signed BY THE WALLET being attached."""
    body, err = await _auth(req, "wallet")
    if err:
        return err
    handle, wallet = body["handle"], body["wallet"]
    now = int(time.time())
    if body.get("remove"):
        if not await _owner(handle, wallet):
            return web.json_response({"error": "not your wallet"}, status=403, headers=CORS)
        left = await db.fetchone(text("SELECT COUNT(*) n FROM profile_wallets WHERE handle = :h").bindparams(h=handle))
        if ((left or {}).get("n") or 0) <= 1:
            return web.json_response({"error": "a profile needs at least one wallet"}, status=400, headers=CORS)
        await db.execute(text("DELETE FROM profile_wallets WHERE handle = :h AND wallet = :w")
                         .bindparams(h=handle, w=wallet))
        return web.json_response({"ok": True, "removed": wallet}, headers=CORS)
    p = await db.fetchone(text("SELECT handle FROM profiles WHERE handle = :h").bindparams(h=handle))
    if not p:
        return web.json_response({"error": "no such profile"}, status=404, headers=CORS)
    taken = await db.fetchone(text("SELECT handle FROM profile_wallets WHERE wallet = :w").bindparams(w=wallet))
    if taken:
        return web.json_response({"error": f"wallet already on @{taken['handle']}"}, status=409, headers=CORS)
    n = await db.fetchone(text("SELECT COUNT(*) n FROM profile_wallets WHERE handle = :h").bindparams(h=handle))
    if ((n or {}).get("n") or 0) >= MAX_WALLETS:
        return web.json_response({"error": f"at most {MAX_WALLETS} wallets"}, status=400, headers=CORS)
    await db.execute(text("INSERT INTO profile_wallets (wallet, handle, proved_ts) VALUES (:w, :h, :n)")
                     .bindparams(w=wallet, h=handle, n=now))
    return web.json_response({"ok": True, "added": wallet}, headers=CORS)


async def api_x_start(req: web.Request):
    body, err = await _auth(req, "xstart")
    if err:
        return err
    handle = body["handle"]
    if not await _owner(handle, body["wallet"]):
        return web.json_response({"error": "not your profile"}, status=403, headers=CORS)
    code = "arc-" + secrets.token_hex(3)
    await db.execute(text("UPDATE profiles SET x_code = :c WHERE handle = :h").bindparams(c=code, h=handle))
    return web.json_response({"code": code, "post": f"Verifying my ArcTools profile: {code}"}, headers=CORS)


async def api_x_verify(req: web.Request):
    body, err = await _auth(req, "xverify")
    if err:
        return err
    handle = body["handle"]
    if not await _owner(handle, body["wallet"]):
        return web.json_response({"error": "not your profile"}, status=403, headers=CORS)
    p = await db.fetchone(text("SELECT x_handle, x_code FROM profiles WHERE handle = :h").bindparams(h=handle))
    xh = (p or {}).get("x_handle")
    code = (p or {}).get("x_code")
    if not xh or not code:
        return web.json_response({"error": "set your X handle and request a code first"}, status=400, headers=CORS)
    from . import kols
    j = await kols._get("/twitter/user/last_tweets", userName=xh)
    data = (j or {}).get("data") or {}
    tweets = (data.get("tweets") if isinstance(data, dict) else None) or (j or {}).get("tweets") or []
    hit = next((t for t in tweets if code in (t.get("text") or "")), None)
    if not hit:
        return web.json_response({"ok": False, "error": f"no post containing {code} found on @{xh}"}, headers=CORS)
    await db.execute(text("UPDATE profiles SET x_verified = 1, x_code = NULL WHERE handle = :h").bindparams(h=handle))
    return web.json_response({"ok": True, "verified": xh, "tweet": hit.get("url")}, headers=CORS)


async def api_follow(req: web.Request):
    body, err = await _auth(req, "follow")
    if err:
        return err
    target = str(body.get("target") or "").lower()
    if not HANDLE_RE.match(target):
        return web.json_response({"error": "target"}, status=400, headers=CORS)
    if body.get("off"):
        await db.execute(text("DELETE FROM profile_follows WHERE follower = :f AND handle = :h")
                         .bindparams(f=body["wallet"], h=target))
        return web.json_response({"ok": True, "following": False}, headers=CORS)
    await db.execute(text("INSERT INTO profile_follows (follower, handle, ts) VALUES (:f, :h, :n) "
                          "ON CONFLICT (follower, handle) DO NOTHING")
                     .bindparams(f=body["wallet"], h=target, n=int(time.time())))
    return web.json_response({"ok": True, "following": True}, headers=CORS)


async def api_following(req: web.Request):
    w = (req.query.get("wallet") or "").lower()
    rows = await db.fetchall(text("SELECT handle, ts FROM profile_follows WHERE follower = :w ORDER BY ts DESC")
                             .bindparams(w=w))
    return web.json_response({"following": [dict(r) for r in rows]}, headers={**CORS, "Cache-Control": "no-store"})


async def api_trades(req: web.Request):
    """A profile's recent trades. Delayed for everyone but the owner: a public track record must not become a
    free front-running signal for whoever is watching the profile."""
    handle = (req.query.get("handle") or "").lower()
    limit = max(1, min(100, int(req.query.get("limit") or 30)))
    p = await db.fetchone(text("SELECT feed_delay FROM profiles WHERE handle = :h").bindparams(h=handle))
    if not p:
        return web.json_response({"trades": []}, headers=CORS)
    cutoff = int(time.time()) - int(p["feed_delay"] or 0)
    rows = await db.fetchall(text("""
        SELECT s.ts, s.token, s.side, s.usdc, s.tokens, s.price1m, s.wallet, st.symbol, st.logo
        FROM swaps s
        LEFT JOIN social_tokens st ON st.token = s.token
        WHERE s.wallet IN (SELECT wallet FROM profile_wallets WHERE handle = :h) AND s.ts <= :c
        ORDER BY s.ts DESC LIMIT :l""").bindparams(h=handle, c=cutoff, l=limit))
    return web.json_response({"trades": [dict(r) for r in rows], "delay": p["feed_delay"]},
                             headers={**CORS, "Cache-Control": "public, max-age=15"})


async def api_leaderboard(req: web.Request):
    season = req.query.get("season") or "7d"
    rng = season if season in ("7d", "30d", "all") else "7d"
    sort = req.query.get("sort") or "pnl"
    limit = max(1, min(100, int(req.query.get("limit") or 50)))
    order = {"pnl": "pnl_total DESC", "roi": "roi DESC", "winrate": "winrate DESC, closed DESC",
             "volume": "volume DESC"}.get(sort, "pnl_total DESC")
    # the official board demands a track record; the side rail on a profile page is navigation, so it may list
    # everyone (still never a wallet flagged as a bot)
    relaxed = req.query.get("relaxed") == "1"
    min_closed, min_vol = (0, 0) if relaxed else (3, 100)
    rows = await db.fetchall(text(f"""
        WITH agg AS (
            SELECT pw.handle,
                   SUM(ws.pnl_total) pnl_total, SUM(ws.volume) volume, SUM(ws.trades) trades,
                   SUM(ws.closed) closed, MAX(ws.bot_suspect) bots,
                   CASE WHEN SUM(ws.closed) > 0
                        THEN SUM(ws.winrate * ws.closed) / SUM(ws.closed) END winrate
            FROM profile_wallets pw
            -- LEFT: a wallet the summariser has not reached yet still belongs on the rail, with zeros
            LEFT JOIN wallet_stats ws ON ws.wallet = pw.wallet AND ws.range = :r
            GROUP BY pw.handle)
        SELECT a.*, CASE WHEN a.volume > 0 THEN 100 * a.pnl_total / a.volume END roi,
               p.display, p.avatar, p.x_handle, p.x_verified
        FROM agg a JOIN profiles p ON p.handle = a.handle
        WHERE COALESCE(a.bots, 0) = 0 AND COALESCE(a.closed, 0) >= :min_closed AND COALESCE(a.volume, 0) >= :min_vol
        ORDER BY {order} NULLS LAST LIMIT :l""").bindparams(r=rng, l=limit, min_closed=min_closed, min_vol=min_vol))
    out = [dict(r) for r in rows]
    # a profile whose wallets the summariser has not reached yet comes back with NULLs; rather than printing a
    # dash next to somebody's name, compute those few rows from the swaps the same way the profile page does
    missing = [r for r in out if r.get("pnl_total") is None][:20]
    for r in missing:
        try:
            st = await profile_stats(r["handle"], rng)
            r.update({"pnl_total": st.get("pnl_total"), "volume": st.get("volume"), "trades": st.get("trades"),
                      "closed": st.get("closed"), "winrate": st.get("winrate"), "roi": st.get("roi")})
        except Exception:  # noqa
            continue
    if sort == "pnl":
        out.sort(key=lambda r: r.get("pnl_total") or 0, reverse=True)
    elif sort == "volume":
        out.sort(key=lambda r: r.get("volume") or 0, reverse=True)
    return web.json_response({"season": rng, "sort": sort, "rows": out},
                             headers={**CORS, "Cache-Control": "public, max-age=60"})


async def api_chart_profiles(req: web.Request):
    """Trades by profiled wallets on one token — the avatars drawn on the chart."""
    token = (req.query.get("token") or "").lower()
    if not (token.startswith("0x") and len(token) == 42):
        return web.json_response({"marks": []}, status=400, headers=CORS)
    since = int(req.query.get("from") or (time.time() - 14 * 86400))
    rows = await db.fetchall(text("""
        SELECT s.ts, s.side, s.usdc, pw.handle, p.display, p.avatar, p.x_verified
        FROM swaps s
        JOIN profile_wallets pw ON pw.wallet = s.wallet
        JOIN profiles p ON p.handle = pw.handle
        WHERE s.token = :t AND s.ts >= :f AND s.usdc > 0
        ORDER BY s.ts DESC LIMIT 200""").bindparams(t=token, f=since))
    return web.json_response({"marks": [dict(r) for r in rows]},
                             headers={**CORS, "Cache-Control": "public, max-age=30"})


async def api_by_wallets(req: web.Request):
    """Bulk wallet → profile, so a page can badge many rows in one call."""
    ws = [w.strip().lower() for w in (req.query.get("wallets") or "").split(",") if w.strip().startswith("0x")][:100]
    if not ws:
        return web.json_response({"profiles": {}}, headers=CORS)
    rows = await db.fetchall(text("""
        SELECT pw.wallet, pw.handle, p.display, p.avatar, p.x_verified
        FROM profile_wallets pw JOIN profiles p ON p.handle = pw.handle
        WHERE pw.wallet = ANY(:w)""").bindparams(w=ws))
    return web.json_response({"profiles": {r["wallet"]: dict(r) for r in rows}},
                             headers={**CORS, "Cache-Control": "public, max-age=60"})


async def api_image(req: web.Request):
    """Avatar / banner upload, straight from a phone or a desktop.

    The bytes are re-encoded here before anything is stored: it strips EXIF (a phone photo carries GPS), caps
    the dimensions so one upload cannot push a 40 MB banner at every visitor, and guarantees the stored file
    really is an image rather than something renamed to .png. Authorised by the same wallet signature as every
    other write."""
    from io import BytesIO
    body, err = await _auth(req, "image")
    if err:
        return err
    handle, wallet = body["handle"], body["wallet"]
    if not await _owner(handle, wallet):
        return web.json_response({"error": "not your profile"}, status=403, headers=CORS)
    kind = "banner" if str(body.get("kind")) == "banner" else "avatar"
    raw_b64 = str(body.get("data") or "")
    if "," in raw_b64[:64]:                      # data:image/png;base64,....
        raw_b64 = raw_b64.split(",", 1)[1]
    import base64
    try:
        raw = base64.b64decode(raw_b64, validate=True)
    except Exception:  # noqa
        return web.json_response({"error": "not base64"}, status=400, headers=CORS)
    if len(raw) > 8 * 1024 * 1024:
        return web.json_response({"error": "file too large (8 MB max)"}, status=413, headers=CORS)
    try:
        from PIL import Image
        im = Image.open(BytesIO(raw))
        im.load()
    except Exception:  # noqa
        return web.json_response({"error": "not a readable image"}, status=400, headers=CORS)
    box = (1500, 500) if kind == "banner" else (512, 512)
    im = im.convert("RGB")
    im.thumbnail(box, Image.LANCZOS)
    out = BytesIO()
    im.save(out, "JPEG", quality=86, optimize=True)
    data = out.getvalue()
    key = f"{handle}-{kind}"
    await db.execute(text("""
        INSERT INTO profile_images (id, handle, kind, mime, bytes, ts) VALUES (:i, :h, :k, 'image/jpeg', :b, :t)
        ON CONFLICT (id) DO UPDATE SET bytes = EXCLUDED.bytes, mime = EXCLUDED.mime, ts = EXCLUDED.ts
    """).bindparams(i=key, h=handle, k=kind, b=data, t=int(time.time())))
    url = f"/bot/api/profile/image/{key}?v={int(time.time())}"
    col = "banner" if kind == "banner" else "avatar"
    await db.execute(text(f"UPDATE profiles SET {col} = :u, updated = :t WHERE handle = :h")
                     .bindparams(u=url, t=int(time.time()), h=handle))
    _CARD.pop(handle, None)
    return web.json_response({"ok": True, "url": url, "bytes": len(data), "size": list(im.size)}, headers=CORS)


async def api_image_get(req: web.Request):
    key = req.match_info.get("key", "")
    row = await db.fetchone(text("SELECT mime, bytes FROM profile_images WHERE id = :i").bindparams(i=key))
    if not row:
        return web.Response(status=404, text="no image")
    return web.Response(body=bytes(row["bytes"]), content_type=row["mime"] or "image/jpeg",
                        headers={**CORS, "Cache-Control": "public, max-age=86400"})


async def api_positions(req: web.Request):
    """Open and closed positions across every wallet on the profile, from the swap index."""
    handle = (req.query.get("handle") or "").lower()
    one = (req.query.get("wallet") or "").lower()
    if one.startswith("0x") and len(one) == 42:
        wallets = [one]
    else:
        ws = await db.fetchall(text("SELECT wallet FROM profile_wallets WHERE handle = :h").bindparams(h=handle))
        wallets = [w["wallet"] for w in ws]
    if not wallets:
        return web.json_response({"open": [], "closed": []}, headers=CORS)
    rows = await db.fetchall(text("""
        SELECT s.token, MAX(st.symbol) symbol, MAX(st.logo) logo,
               SUM(CASE WHEN s.side = 'buy' THEN s.tokens ELSE 0 END) bought,
               SUM(CASE WHEN s.side = 'sell' THEN s.tokens ELSE 0 END) sold,
               SUM(CASE WHEN s.side = 'buy' THEN s.usdc ELSE 0 END) cost,
               SUM(CASE WHEN s.side = 'sell' THEN s.usdc ELSE 0 END) proceeds,
               COUNT(*) n, MAX(s.ts) last_ts,
               (SELECT price1m FROM swaps p WHERE p.token = s.token AND p.price1m > 0 AND p.usdc >= 0.5
                ORDER BY p.ts DESC LIMIT 1) price1m
        FROM swaps s LEFT JOIN social_tokens st ON st.token = s.token
        WHERE s.wallet = ANY(:w)
        GROUP BY s.token ORDER BY MAX(s.ts) DESC LIMIT 300""").bindparams(w=wallets))
    op, cl = [], []
    for r in rows:
        bought, sold = r["bought"] or 0, r["sold"] or 0
        cost, proceeds = r["cost"] or 0, r["proceeds"] or 0
        held = bought - sold
        avg = cost / bought if bought > 0 else 0
        price = (r["price1m"] or 0) / 1e6
        item = {"token": r["token"], "symbol": r["symbol"], "logo": r["logo"], "n": r["n"], "last_ts": r["last_ts"],
                "cost": round(cost, 2), "proceeds": round(proceeds, 2)}
        if held > bought * 0.01:                 # still holding a meaningful part of what was bought
            value = held * price
            item.update({"held": held, "value": round(value, 2), "avg": avg,
                         "pnl": round(value - held * avg, 2),
                         "pnl_pct": round(100 * (value - held * avg) / max(held * avg, 1e-9), 1)})
            op.append(item)
        else:
            item.update({"pnl": round(proceeds - cost, 2),
                         "pnl_pct": round(100 * (proceeds - cost) / cost, 1) if cost > 0 else None})
            cl.append(item)
    op.sort(key=lambda x: x.get("value") or 0, reverse=True)
    cl.sort(key=lambda x: x.get("last_ts") or 0, reverse=True)
    return web.json_response({"open": op[:60], "closed": cl[:60]},
                             headers={**CORS, "Cache-Control": "public, max-age=30"})


async def api_search(req: web.Request):
    """Find a trader by handle, display name or X account — what the Terminal search box calls."""
    q = (req.query.get("q") or "").strip().lower().lstrip("@")
    if len(q) < 2:
        return web.json_response({"rows": []}, headers=CORS)
    rows = await db.fetchall(text("""
        WITH agg AS (
            SELECT pw.handle, SUM(ws.pnl_total) pnl, SUM(ws.volume) volume, SUM(ws.trades) trades
            FROM profile_wallets pw
            LEFT JOIN wallet_stats ws ON ws.wallet = pw.wallet AND ws.range = 'all'
            GROUP BY pw.handle)
        SELECT p.handle, p.display, p.avatar, p.x_handle, p.x_verified,
               a.pnl, a.volume, a.trades
        FROM profiles p LEFT JOIN agg a ON a.handle = p.handle
        WHERE p.handle LIKE :like OR lower(COALESCE(p.display, '')) LIKE :like
           OR lower(COALESCE(p.x_handle, '')) LIKE :like
        ORDER BY COALESCE(a.pnl, 0) DESC LIMIT 12""").bindparams(like=f"%{q}%"))
    return web.json_response({"rows": [dict(r) for r in rows]},
                             headers={**CORS, "Cache-Control": "public, max-age=30"})


async def api_top_trades(req: web.Request):
    """The profile's best positions, ranked by profit — open ones priced at the last trade, closed ones settled.

    Entry and exit are expressed as market cap, the way traders actually talk about a call ("bought at 50k,
    it did 700k"), using the token's supply where we know it."""
    handle = (req.query.get("handle") or "").lower()
    ws = await db.fetchall(text("SELECT wallet FROM profile_wallets WHERE handle = :h").bindparams(h=handle))
    wallets = [w["wallet"] for w in ws]
    if not wallets:
        return web.json_response({"rows": []}, headers=CORS)
    rows = await db.fetchall(text("""
        SELECT s.token, MAX(st.symbol) symbol, MAX(st.name) name, MAX(st.logo) logo, MAX(st.mcap) mcap,
               SUM(CASE WHEN s.side = 'buy' THEN s.tokens ELSE 0 END) bought,
               SUM(CASE WHEN s.side = 'sell' THEN s.tokens ELSE 0 END) sold,
               SUM(CASE WHEN s.side = 'buy' THEN s.usdc ELSE 0 END) cost,
               SUM(CASE WHEN s.side = 'sell' THEN s.usdc ELSE 0 END) proceeds,
               MIN(CASE WHEN s.side = 'buy' AND s.price1m > 0 THEN s.price1m END) entry1m,
               MAX(s.ts) last_ts, COUNT(*) n,
               (SELECT price1m FROM swaps p WHERE p.token = s.token AND p.price1m > 0 AND p.usdc >= 0.5
                ORDER BY p.ts DESC LIMIT 1) price1m
        FROM swaps s LEFT JOIN social_tokens st ON st.token = s.token
        WHERE s.wallet = ANY(:w) GROUP BY s.token LIMIT 400""").bindparams(w=wallets))
    out = []
    for r in rows:
        bought, sold = r["bought"] or 0, r["sold"] or 0
        cost, proceeds = r["cost"] or 0, r["proceeds"] or 0
        price = (r["price1m"] or 0) / 1e6
        held = max(0.0, bought - sold)
        avg = cost / bought if bought > 0 else 0
        closed = held <= bought * 0.01
        value = held * price
        pnl = (proceeds - cost) if closed else (proceeds + value - cost)
        # we do not store supply, so market cap comes from the indexed mcap and the price ratio: the entry cap
        # is today's cap scaled by how much cheaper the entry price was
        now_mc = float(r["mcap"] or 0) or (price * 1e9 if price else 0)
        entry_price = (r["entry1m"] or 0) / 1e6
        entry_mc = (now_mc * entry_price / price) if (price > 0 and entry_price > 0 and now_mc > 0) else None
        out.append({
            "token": r["token"], "symbol": r["symbol"], "name": r["name"], "logo": r["logo"],
            "closed": closed, "last_ts": r["last_ts"], "n": r["n"],
            "spent": round(cost, 2), "value": round(value, 2), "pnl": round(pnl, 2),
            "pnl_pct": round(100 * pnl / cost, 1) if cost > 0 else None,
            "entry_mc": round(entry_mc, 2) if entry_mc else None,
            "now_mc": round(now_mc, 2) if now_mc else None,
        })
    out.sort(key=lambda x: x["pnl"], reverse=True)
    return web.json_response({"rows": out[:12]}, headers={**CORS, "Cache-Control": "public, max-age=30"})


async def api_following_feed(req: web.Request):
    """Trades of every profile this wallet follows — the alert surface that works without a linked Telegram
    account. Each profile's own delay still applies, so following someone never grants an earlier view."""
    w = (req.query.get("wallet") or "").lower()
    limit = max(1, min(60, int(req.query.get("limit") or 30)))
    if not (w.startswith("0x") and len(w) == 42):
        return web.json_response({"trades": []}, status=400, headers=CORS)
    rows = await db.fetchall(text("""
        SELECT s.ts, s.token, s.side, s.usdc, pw.handle, p.display, p.avatar, st.symbol, st.logo
        FROM profile_follows f
        JOIN profiles p ON p.handle = f.handle
        JOIN profile_wallets pw ON pw.handle = f.handle
        JOIN swaps s ON s.wallet = pw.wallet
        LEFT JOIN social_tokens st ON st.token = s.token
        WHERE f.follower = :w AND s.ts <= (:now - COALESCE(p.feed_delay, 0)) AND s.usdc > 0
        ORDER BY s.ts DESC LIMIT :l""").bindparams(w=w, now=int(time.time()), l=limit))
    return web.json_response({"trades": [dict(r) for r in rows]},
                             headers={**CORS, "Cache-Control": "no-store"})


_CARD: dict[str, tuple[float, bytes]] = {}


async def api_card(req: web.Request):
    """The share card: a PNG of the profile's record, so posting a link to X shows the numbers, not a blank box.

    Drawn here rather than in the browser because social crawlers never run JavaScript."""
    from io import BytesIO
    handle = (req.query.get("handle") or "").lower()
    if not HANDLE_RE.match(handle):
        return web.Response(status=400, text="handle")
    hit = _CARD.get(handle)
    if hit and time.time() - hit[0] < 300:
        return web.Response(body=hit[1], content_type="image/png", headers={**CORS, "Cache-Control": "public, max-age=300"})
    p = await db.fetchone(text("SELECT handle, display, bio, x_handle, x_verified FROM profiles WHERE handle = :h")
                          .bindparams(h=handle))
    if not p:
        return web.Response(status=404, text="no profile")
    st = await profile_stats(handle, "all")
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception:  # noqa
        return web.Response(status=503, text="image support unavailable")
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), (10, 13, 20))
    d = ImageDraw.Draw(img)

    def font(sz: int, bold: bool = True):
        for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
                     "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                     "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
            try:
                return ImageFont.truetype(path, sz)
            except Exception:  # noqa
                continue
        return ImageFont.load_default()

    cob, ink, mut = (46, 124, 255), (240, 244, 250), (150, 162, 182)
    up, down = (34, 197, 128), (240, 83, 79)
    d.rectangle((0, 0, W, 6), fill=cob)
    d.text((56, 52), "ARCTOOLS · TRADER", font=font(22), fill=cob)
    d.text((56, 92), (p["display"] or f"@{handle}")[:26], font=font(64), fill=ink)
    sub = f"@{handle}" + (f"  ·  X @{p['x_handle']}{' verified' if p['x_verified'] else ''}" if p["x_handle"] else "")
    d.text((56, 176), sub[:60], font=font(26, False), fill=mut)

    pnl = st.get("pnl_total") or 0
    tiles = [
        ("PNL TOTAL", f"{'-' if pnl < 0 else ''}${abs(pnl):,.0f}", up if pnl >= 0 else down),
        ("ROI", "—" if st.get("roi") is None else f"{st['roi']:.1f}%", ink),
        ("WIN RATE", "—" if st.get("winrate") is None else f"{st['winrate'] * 100:.0f}%", ink),
        ("TRADES", f"{st.get('trades') or 0:,}", ink),
    ]
    x, y, tw, th = 56, 260, 262, 132
    for i, (k, v, col) in enumerate(tiles):
        cx = x + i * (tw + 16)
        d.rounded_rectangle((cx, y, cx + tw, y + th), radius=16, fill=(18, 24, 36), outline=(40, 48, 64))
        d.text((cx + 20, y + 22), k, font=font(18), fill=mut)
        d.text((cx + 20, y + 56), v[:12], font=font(44), fill=col)

    if p["bio"]:
        d.text((56, 430), p["bio"][:78], font=font(24, False), fill=mut)
    d.text((56, 520), f"volume ${st.get('volume') or 0:,.0f}  ·  {st.get('closed') or 0} closed  ·  {st.get('days_active') or 0}d active",
           font=font(24, False), fill=mut)
    d.rounded_rectangle((56, 556, 372, 604), radius=12, fill=up)
    d.text((76, 568), f"arctools.fun/u/{handle}"[:26], font=font(24), fill=(4, 20, 10))

    buf = BytesIO(); img.save(buf, "PNG", optimize=True)
    data = buf.getvalue()
    _CARD[handle] = (time.time(), data)
    return web.Response(body=data, content_type="image/png", headers={**CORS, "Cache-Control": "public, max-age=300"})


def register(app: web.Application):
    app.router.add_get("/api/profile", api_get)
    app.router.add_post("/api/profile/save", api_save)
    app.router.add_post("/api/profile/wallet", api_wallet)
    app.router.add_post("/api/profile/x/start", api_x_start)
    app.router.add_post("/api/profile/x/verify", api_x_verify)
    app.router.add_post("/api/profile/follow", api_follow)
    app.router.add_get("/api/profile/following", api_following)
    app.router.add_get("/api/profile/trades", api_trades)
    app.router.add_get("/api/profiles/leaderboard", api_leaderboard)
    app.router.add_get("/api/profiles/chart", api_chart_profiles)
    app.router.add_get("/api/profiles/by-wallets", api_by_wallets)
    app.router.add_get("/api/profile/following-feed", api_following_feed)
    app.router.add_get("/api/profile/card", api_card)
    app.router.add_post("/api/profile/image", api_image)
    app.router.add_get("/api/profile/image/{key}", api_image_get)
    app.router.add_get("/api/profile/positions", api_positions)
    app.router.add_get("/api/profiles/search", api_search)
    app.router.add_get("/api/profiles/top-trades", api_top_trades)
