"""Arc Insider — smart-money tracker.

Chain-wide swap ingest (every USDC pool on Arc, all venues), resumable
backfill, average-cost PnL stats per wallet, and a small HTTP API that the
arctools.fun /insiders page reads.
"""
import os
import asyncio
import json
import logging
import time

import aiohttp
import aiohttp as _aiohttp
from aiohttp import web
from web3 import Web3
from sqlalchemy import text

from .chain import CHAIN
from .config import CFG
from .venues import ARCPAD, ARCPAD_TRADE_TOPIC, V2_SWAP_TOPIC, V3_SWAP_TOPIC
from . import db

log = logging.getLogger("insider")

USDC = "0x3600000000000000000000000000000000000000"
BACKFILL_BLOCKS = 5_200_000          # ~30 dni przy 0.5 s/blok
LIVE_WINDOW = 2_000
BACKFILL_WINDOW = 5_000
PARALLEL_WINDOWS = 1                  # okna backfillu skanowane jednocześnie
_lag = {"blocks": 0, "phase": "init", "since": 0.0, "window": ""}                  # live ingest lag + phase (debug via /api/tasks); background scans yield while it is large (RPC budget goes to live data first)


async def _yield_to_live(tag: str):
    """Background scanners call this before each RPC-heavy window: sleep while the live ingest is far behind."""
    waited = 0
    while _lag["blocks"] > 5_000 and waited < 3600:
        await asyncio.sleep(15); waited += 15
    if waited:
        log.info("%s resumed after %ss (ingest lag %s)", tag, waited, _lag["blocks"])
MIN_CLOSED = 3                        # min. zamknietych pozycji do rankingu
MIN_VOLUME = 200.0                    # min. wolumen $ do rankingu
BOT_TRADES_PER_DAY = 500
PRICE_MIN_USD = 5.0                   # swapy ponizej sa pylkiem — nie wyceniaja tokena
UNREAL_CAP = 5.0                      # pozycja otwarta max 5x kosztu (anty-manipulacja)
RELAY_RPC = "https://rpc-production-ba7a.up.railway.app"

# adresy infrastruktury wykluczone z rankingu
EXCLUDED = {a.lower() for a in [
    ARCPAD,
    "0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd",  # ArcRewardsVault
    "0xA42c4BEee84CEd9f2ea15b3981B8A321943b7Bec",  # bridge proxy
    "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77",  # SwapRouter02
    "0x000000000000000000000000000000000000dead",
    "0x0000000000000000000000000000000000000000",
]}

SEL_TOKEN0 = "0x0dfe1681"
SEL_TOKEN1 = "0xd21220a7"
SEL_SYMBOL = "0x95d89b41"

_sym_cache: dict[str, str] = {}


_sym_neg: dict[str, float] = {}


async def _symbol(token: str) -> str:
    """Symbol tokena: dynamic string albo bytes32, z cache w pamieci i w bazie."""
    key = token.lower()
    if key in _sym_cache:
        return _sym_cache[key]
    neg = _sym_neg.get(key)
    if neg and time.time() - neg < 600:              # unreadable symbol: do not hammer the relay 3× per swap for 10 min
        return key[2:8].upper()
    row = await db.fetchone(text("SELECT symbol FROM token_symbols WHERE token = :t").bindparams(t=key))
    if row and row["symbol"]:
        _sym_cache[key] = row["symbol"]
        return row["symbol"]
    sym = ""
    for attempt in range(3):
        try:
            # wlasny relay (stabilny) — arc-scan w trakcie backfillu zwraca 429
            async with _aiohttp.ClientSession() as s:
                async with s.post(RELAY_RPC, headers={"Content-Type": "application/json", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "X-Priority": "high"}, json={
                    "id": 1, "jsonrpc": "2.0", "method": "eth_call",
                    "params": [{"data": SEL_SYMBOL, "to": token}, "latest"],
                }, timeout=_aiohttp.ClientTimeout(total=12)) as r:
                    res = (await r.json()).get("result") or ""
            if res and res != "0x":
                raw = bytes.fromhex(res[2:])
                if len(raw) >= 96:                  # ABI string: offset + len + data
                    ln = int.from_bytes(raw[32:64], "big")
                    sym = raw[64:64 + ln].decode("utf-8", "ignore").strip()
                if not sym:                         # bytes32
                    sym = raw[:32].decode("utf-8", "ignore").replace("\x00", "").strip()
            if sym:
                break
        except Exception:  # noqa
            await asyncio.sleep(0.5 * (attempt + 1))
    sym = "".join(ch for ch in sym if ch.isprintable())[:24] or "?"
    if sym == "?":
        _sym_neg[key] = time.time()
        return key[2:8].upper()
    if sym != "?":                                  # nieudanych nie utrwalamy — sprobujemy pozniej
        _sym_cache[key] = sym
        await db.execute(text(
            "INSERT INTO token_symbols (token, symbol) VALUES (:t, :s) ON CONFLICT (token) DO UPDATE SET symbol = :s"
        ).bindparams(s=sym, t=key))
    return sym

_pool_cache: dict[str, dict | None] = {}   # pool -> {token, is0} | None (non-USDC)


async def init_tables():
    stmts = [
        """CREATE TABLE IF NOT EXISTS swaps (
            tx VARCHAR(80) NOT NULL,
            log_index INTEGER NOT NULL,
            block BIGINT,
            ts BIGINT,
            wallet VARCHAR(64),
            token VARCHAR(64),
            side VARCHAR(4),
            usdc DOUBLE PRECISION,
            tokens DOUBLE PRECISION,
            price1m DOUBLE PRECISION,
            venue VARCHAR(16),
            PRIMARY KEY (tx, log_index)
        )""",
        "CREATE INDEX IF NOT EXISTS swaps_wallet_ts ON swaps (wallet, ts)",
        "CREATE INDEX IF NOT EXISTS swaps_token_ts ON swaps (token, ts)",
        """CREATE TABLE IF NOT EXISTS insider_pools (
            pool VARCHAR(64) PRIMARY KEY,
            token VARCHAR(64),
            is0 INTEGER
        )""",
        """CREATE TABLE IF NOT EXISTS wallet_stats (
            wallet VARCHAR(64) NOT NULL,
            range VARCHAR(8) NOT NULL,
            pnl_realized DOUBLE PRECISION,
            pnl_unrealized DOUBLE PRECISION,
            pnl_total DOUBLE PRECISION,
            pnl_pct DOUBLE PRECISION,
            winrate DOUBLE PRECISION,
            trades INTEGER,
            closed INTEGER,
            volume DOUBLE PRECISION,
            best_token VARCHAR(64),
            best_symbol VARCHAR(48),
            best_pnl DOUBLE PRECISION,
            last_trade BIGINT,
            bot_suspect INTEGER DEFAULT 0,
            PRIMARY KEY (wallet, range)
        )""",
        """CREATE TABLE IF NOT EXISTS v4_pools (
            id VARCHAR(70) PRIMARY KEY,
            token VARCHAR(64),
            is0 INTEGER
        )""",
        """CREATE TABLE IF NOT EXISTS token_symbols (
            token VARCHAR(64) PRIMARY KEY,
            symbol VARCHAR(48)
        )""",
    ]
    for s in stmts:
        await db.execute(text(s))
    # migracje kolumn (bezpieczne przy restarcie)
    for alter in [
        "ALTER TABLE wallet_stats ADD COLUMN IF NOT EXISTS open_positions INTEGER DEFAULT 0",
        "ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS currency0 VARCHAR(64)",
        "ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS currency1 VARCHAR(64)",
        "ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS fee INTEGER",
        "ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS tick_spacing INTEGER",
        "ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS hooks VARCHAR(64)",
        "ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS block BIGINT",
        "ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS usdc_dec INTEGER",
    ]:
        try:
            await db.execute(text(alter))
        except Exception:  # noqa
            pass


# ---------------- pool -> token resolution ----------------

async def _resolve_pool(pool: str) -> dict | None:
    key = pool.lower()
    if key in _pool_cache:
        return _pool_cache[key]
    row = await db.fetchone(text("SELECT token, is0 FROM insider_pools WHERE pool = :p").bindparams(p=key))
    if row:
        info = {"is0": bool(row["is0"]), "token": row["token"]} if row["token"] else None
        if info is None:
            q = await db.fetchone(text("SELECT token, quote, is0 FROM quote_pools WHERE pool = :p").bindparams(p=key))
            if q:
                info = {"is0": bool(q["is0"]), "token": q["token"], "quote": q["quote"]}
        _pool_cache[key] = info
        return info
    token, is0 = None, False
    try:
        t0 = "0x" + (await CHAIN.eth_call(pool, SEL_TOKEN0)).hex()[-40:]
        t1 = "0x" + (await CHAIN.eth_call(pool, SEL_TOKEN1)).hex()[-40:]
    except Exception:  # noqa
        # RPC padl (429/timeout): NIE utrwalamy — pula zostanie rozwiazana przy nastepnym swapie.
        # Wczesniej taki blad zapisywal pule na stale jako "nie-USDC" i gubil jej caly wolumen.
        return None
    if t0.lower() == USDC:
        token, is0 = t1.lower(), False
    elif t1.lower() == USDC:
        token, is0 = t0.lower(), True
    else:
        # not a USDC pool: maybe a stock-quoted pool we know from long.supply (amounts priced through the stock's USD)
        q = await db.fetchone(text("SELECT token, quote, is0 FROM quote_pools WHERE pool = :p").bindparams(p=key))
        if q:
            info = {"is0": bool(q["is0"]), "token": q["token"], "quote": q["quote"]}
            _pool_cache[key] = info
            return info
    await db.execute(text(
        "INSERT INTO insider_pools (pool, token, is0) VALUES (:p, :t, :i) ON CONFLICT (pool) DO NOTHING"
    ).bindparams(p=key, t=token, i=1 if is0 else 0))
    info = {"is0": is0, "token": token} if token else None
    _pool_cache[key] = info
    return info


# ---- stock-quoted pools (long.supply): quote token -> USD, refreshed by quote_pools_loop
_quote_usd: dict[str, float] = {}
LS_HOSTS = ["https://long.supply/api", "https://long-supply-keeper-production.up.railway.app"]  # public host, then their keeper (same JSON)


async def _ls_get(s, path: str) -> dict:
    last = None
    for h in LS_HOSTS:
        try:
            async with s.get(f"{h}{path}", headers={"User-Agent": "ArcTools/1.0"}, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status != 200:
                    last = Exception(f"{h}{path} {r.status}"); continue
                return await r.json(content_type=None)
        except Exception as e:  # noqa
            last = e
    raise last or Exception("long.supply unreachable")


async def quote_pools_loop():
    """Every 5 min: long.supply launches (pool, token, pairToken) + stock USD prices → quote_pools, so their V3 pools are
    indexed like USDC pools (amounts converted through the stock price). New pools are queued for backfill."""
    import aiohttp
    await db.execute(text("CREATE TABLE IF NOT EXISTS quote_pools (pool VARCHAR(64) PRIMARY KEY, token VARCHAR(64), quote VARCHAR(64), is0 INTEGER, ts BIGINT)"))
    await db.execute(text("ALTER TABLE quote_pools ADD COLUMN IF NOT EXISTS from_block BIGINT"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS pool_backfill (pool VARCHAR(64) PRIMARY KEY, done INTEGER DEFAULT 0, swaps INTEGER DEFAULT 0)"))
    await asyncio.sleep(20)
    while True:
        try:
            async with aiohttp.ClientSession() as s:
                pairs = (await _ls_get(s, "/pairs")).get("pairs") or []
                for p in pairs:
                    _quote_usd[p["arcStock"].lower()] = int(p["usdX18"]) / 1e18
                launches = []
                for off in range(0, 2000, 100):
                    j = await _ls_get(s, f"/launches?limit=100&offset={off}")
                    launches += j.get("launches") or []
                    for k, v in (j.get("usdByPairToken") or {}).items():
                        _quote_usd[k.lower()] = int(v) / 1e18
                    if off + 100 >= int(j.get("total") or 0):
                        break
            new = 0
            for l in launches:
                pool, tok, q = (l.get("pool") or "").lower(), (l.get("token") or "").lower(), (l.get("pairToken") or "").lower()
                if not (pool.startswith("0x") and tok.startswith("0x") and q.startswith("0x")):
                    continue
                fb = int(l.get("block") or 0)
                if await db.fetchone(text("SELECT 1 FROM quote_pools WHERE pool = :p").bindparams(p=pool)):
                    if fb:
                        await db.execute(text("UPDATE quote_pools SET from_block = :b WHERE pool = :p AND from_block IS NULL").bindparams(b=fb, p=pool))
                    continue
                is0 = 1 if int(tok, 16) < int(q, 16) else 0
                await db.execute(text("INSERT INTO quote_pools (pool, token, quote, is0, ts, from_block) VALUES (:p, :t, :q, :i, :ts, :b) ON CONFLICT (pool) DO NOTHING")
                                 .bindparams(p=pool, t=tok, q=q, i=is0, ts=int(time.time()), b=fb or None))
                new += 1
                _pool_cache.pop(pool, None)
                await db.execute(text("DELETE FROM insider_pools WHERE pool = :p AND token IS NULL").bindparams(p=pool))
                await db.execute(text("INSERT INTO pool_backfill (pool, done) VALUES (:p, 0) ON CONFLICT (pool) DO NOTHING").bindparams(p=pool))
                await db.execute(text("INSERT INTO token_symbols (token, symbol) VALUES (:t, :s) ON CONFLICT (token) DO NOTHING").bindparams(t=tok, s=str(l.get("symbol") or "")[:32]))
            log.info("quote pools: %d launches, %d new, %d quotes priced", len(launches), new, len(_quote_usd))
            # backfill the stock-quoted pools ourselves (from their launch block) — the hourly repair loop is too slow for this
            todo = await db.fetchall(text(
                "SELECT q.pool, q.from_block FROM quote_pools q JOIN pool_backfill b ON b.pool = q.pool WHERE b.done = 0 ORDER BY q.from_block DESC NULLS LAST LIMIT 60"))
            if todo:
                head_now = await CHAIN._bn()
                sem = asyncio.Semaphore(3)

                async def bf(pool, fb):
                    async with sem:
                        try:
                            _pool_cache.pop(pool, None)
                            if not await _resolve_pool(pool):
                                return
                            blocks = max(1000, head_now - int(fb) + 200) if fb else 400_000
                            n = await backfill_pool(pool, blocks)
                            await db.execute(text("UPDATE pool_backfill SET done = 1, swaps = :n WHERE pool = :p").bindparams(n=n, p=pool))
                        except Exception as e:  # noqa
                            log.warning("quote backfill %s: %s", pool[:10], e)
                log.info("quote pools: backfilling %d pools", len(todo))
                await asyncio.gather(*[bf(r["pool"], r["from_block"]) for r in todo])
        except Exception as e:  # noqa
            log.warning("quote pools loop: %s", e)
        await asyncio.sleep(300)


PRIORITY_POOLS = ["0xf89005ccf237a59eeee1521e74b15c7d8d022ab7"]   # ARCT/USDC — zawsze pierwszy

# ---- ArcPad v3: token moze byc kwotowany w innym tokenie (np. TOLLY) ----
ARCPAD_V3 = "0x2726aec64d8a9bc41b9940dda5d21c889458b348"
SEL_LAUNCH = "0x214013ca"
_pad_quote: dict[str, str | None] = {}       # token -> quote token addr (None = USDC)
_quote_usd: dict[str, tuple[float, float]] = {}   # quote -> (usd, ts)


def _pad_quote_usd(pad: str, token: str) -> float:
    """Synchroniczny odczyt z cache; brakujace pozycje dociaga _refresh_pad_quotes (asynchronicznie)."""
    if pad != ARCPAD_V3:
        return 1.0
    q = _pad_quote.get(token, "?")
    if q == "?":
        _pad_quote_missing.add(token)
        return 1.0                       # tymczasowo jak USDC; korekta po dociagnieciu (rzadkie)
    if q is None:
        return 1.0
    v = _quote_usd.get(q)
    return v[0] if v and v[0] > 0 else 0.0


_pad_quote_missing: set[str] = set()


async def _refresh_pad_quotes():
    """launch(token).quoteToken dla nowych tokenow v3 + cena quote z naszego indeksu (mediana 5 ostatnich)."""
    for token in list(_pad_quote_missing):
        try:
            raw = await CHAIN.eth_call(ARCPAD_V3, SEL_LAUNCH + token[2:].rjust(64, "0"))
            q = "0x" + raw.hex()[24:64]          # slowo 0 = quoteToken
            _pad_quote[token] = None if q.lower() in ("0x" + "0" * 40, USDC) else q.lower()
            _pad_quote_missing.discard(token)
        except Exception:  # noqa
            pass
    now = time.time()
    for q in {v for v in _pad_quote.values() if v}:
        if q in _quote_usd and now - _quote_usd[q][1] < 300:
            continue
        r = await db.fetchone(text(
            "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price1m) AS p FROM ("
            "SELECT price1m FROM swaps WHERE token = :t AND usdc >= 0.5 AND price1m > 0 ORDER BY ts DESC LIMIT 5) s"
        ).bindparams(t=q))
        _quote_usd[q] = ((float(r["p"]) / 1e6) if r and r["p"] else 0.0, now)

# ---- Uniswap V4 (singleton PoolManager): SHARC, poolstrade i inne pady handluja tutaj ----
V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
V4_SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
V4_INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
NATIVE = "0x0000000000000000000000000000000000000000"          # natywne USDC jako currency0
# V4 pools quoted in a token instead of USDC (Arguspad launches pair with ARGUS). Amounts are converted to USDC with
# the quote's own USDC price (from our index, refreshed by quote_price_loop) so these tokens get price / MC / trades.
QUOTE_TOKENS = {"0xece5ca8bf9220718e5727754026757512212cb3c": "ARGUS"}
_quote_px: dict[str, float] = {}      # quote token -> USDC per token


async def quote_price_loop():
    from sqlalchemy import text as _t
    while True:
        for q in QUOTE_TOKENS:
            try:
                r = await db.fetchone(_t("SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 AND usdc >= 1 ORDER BY ts DESC LIMIT 1").bindparams(t=q))
                if r:
                    _quote_px[q] = float(r["price1m"]) / 1e6
            except Exception:  # noqa
                pass
        await asyncio.sleep(30)
_v4_cache: dict[str, dict | None] = {}


def _topic_hex(t) -> str:
    h = t.hex() if hasattr(t, "hex") else str(t)
    return h if h.startswith("0x") else "0x" + h


async def _v4_register_init(lg):
    """Initialize(id, currency0, currency1, ...) -> mapowanie poolId -> token."""
    topics = [_topic_hex(t) for t in lg["topics"]]
    if len(topics) < 4:
        return
    pid = topics[1].lower()
    c0 = ("0x" + topics[2][-40:]).lower()
    c1 = ("0x" + topics[3][-40:]).lower()
    token, is0, quote = None, False, None
    if c0 in (NATIVE, USDC) and c1 in (NATIVE, USDC):
        return                                   # native USDC ↔ USDC facade pool: not a token, never index it
    if c0 in (NATIVE, USDC):
        token, is0 = c1, True
    elif c1 in (NATIVE, USDC):
        token, is0 = c0, False
    elif c0 in QUOTE_TOKENS:
        token, is0, quote = c1, True, c0
    elif c1 in QUOTE_TOKENS:
        token, is0, quote = c0, False, c1
    # data: fee uint24, tickSpacing int24, hooks address, sqrtPriceX96, tick  -> full PoolKey for routers/snipers
    body = (lg["data"].hex() if hasattr(lg["data"], "hex") else str(lg["data"])).replace("0x", "")
    fee = int(body[0:64], 16) if len(body) >= 64 else None
    ts = int.from_bytes(bytes.fromhex(body[64:128]), "big", signed=True) if len(body) >= 128 else None
    hooks = ("0x" + body[128:192][-40:]).lower() if len(body) >= 192 else None
    blk = lg.get("blockNumber")
    blk = int(blk, 16) if isinstance(blk, str) else (int(blk) if blk is not None else None)
    await db.execute(text(
        "INSERT INTO v4_pools (id, token, is0, currency0, currency1, fee, tick_spacing, hooks, block) "
        "VALUES (:i, :t, :z, :c0, :c1, :f, :ts, :h, :b) ON CONFLICT (id) DO UPDATE SET "
        "currency0 = EXCLUDED.currency0, currency1 = EXCLUDED.currency1, fee = EXCLUDED.fee, "
        "tick_spacing = EXCLUDED.tick_spacing, hooks = EXCLUDED.hooks, block = COALESCE(v4_pools.block, EXCLUDED.block)"
    ).bindparams(i=pid, t=token, z=1 if is0 else 0, c0=c0, c1=c1, f=fee, ts=ts, h=hooks, b=blk))
    usdc_dec = 6 if (c0 == USDC or c1 == USDC) else 18      # facade ERC-20 = 6 dec, native = 18
    await db.execute(text("UPDATE v4_pools SET usdc_dec = :d, quote = :q WHERE id = :i").bindparams(d=usdc_dec, q=quote, i=pid))
    _v4_cache[pid] = {"is0": is0, "token": token, "usdc_dec": usdc_dec, "quote": quote} if token else None


async def _v4_pool(pid: str) -> dict | None:
    pid = pid.lower()
    if pid in _v4_cache:
        return _v4_cache[pid]
    row = await db.fetchone(text("SELECT token, is0, usdc_dec, quote FROM v4_pools WHERE id = :i").bindparams(i=pid))
    info = ({"is0": bool(row["is0"]), "token": row["token"], "usdc_dec": int(row["usdc_dec"] or 18), "quote": row["quote"]}
            if row and row["token"] else None)
    if row:
        _v4_cache[pid] = info
    return info


def _decode_v4(lg, info: dict | None) -> dict | None:
    """V4 Swap: amount0/amount1 int128 z perspektywy swapujacego (ujemne = zaplacil)."""
    if not info:
        return None
    body = (lg["data"].hex() if hasattr(lg["data"], "hex") else str(lg["data"])).replace("0x", "")
    try:
        a0 = int.from_bytes(bytes.fromhex(body[0:64]), "big", signed=True)
        a1 = int.from_bytes(bytes.fromhex(body[64:128]), "big", signed=True)
    except Exception:  # noqa
        return None
    usdc_amt, tok_amt = (a0, a1) if info["is0"] else (a1, a0)
    scale = 10 ** int(info.get("usdc_dec") or 18)
    q = info.get("quote")
    if q:
        px = _quote_px.get(q)
        if not px:
            return None                      # quote price unknown yet — skip rather than write garbage
        scale = scale / px                   # quote units → USDC
    if usdc_amt < 0 and tok_amt > 0:      # zaplacil USDC, dostal token
        return {"side": "buy", "token": info["token"], "tokens": tok_amt / 1e18, "usdc": -usdc_amt / scale}
    if usdc_amt > 0 and tok_amt < 0:
        return {"side": "sell", "token": info["token"], "tokens": -tok_amt / 1e18, "usdc": usdc_amt / scale}
    return None


async def v4_quote_backfill():
    """Pools paired with a quote token (ARGUS) were stored with token=NULL: assign token/quote, then index their swaps."""
    await asyncio.sleep(40)                  # let quote_price_loop fill _quote_px first
    fixed = []
    for q in QUOTE_TOKENS:
        rows = await db.fetchall(text("SELECT id, currency0, currency1, block FROM v4_pools WHERE token IS NULL AND (currency0 = :q OR currency1 = :q)").bindparams(q=q))
        for r in rows:
            is0 = r["currency0"] == q
            token = r["currency1"] if is0 else r["currency0"]
            await db.execute(text("UPDATE v4_pools SET token = :t, is0 = :z, quote = :q, usdc_dec = 18 WHERE id = :i")
                             .bindparams(t=token, z=1 if is0 else 0, q=q, i=r["id"]))
            _v4_cache.pop(r["id"].lower(), None)
            fixed.append((r["id"], r["block"]))
    # resumable: every quote pool without a done-flag gets (re)scanned from its Initialize block
    fixed = []
    for r in await db.fetchall(text("SELECT id, block FROM v4_pools WHERE quote IS NOT NULL AND token IS NOT NULL")):
        if not await db.kv_get(f"v4q_done:{r['id']}"):
            fixed.append((r["id"], r["block"]))
    if not fixed:
        return
    log.info("v4 quote backfill: %s pools", len(fixed))
    pm = V4_POOL_MANAGER
    head = await CHAIN.block_number()
    ins = text(
        "INSERT INTO swaps (tx, log_index, block, ts, wallet, token, side, usdc, tokens, price1m, venue) "
        "VALUES (:tx, :log_index, :block, :ts, :wallet, :token, :side, :usdc, :tokens, :price1m, :venue) "
        "ON CONFLICT (tx, log_index) DO NOTHING")
    total = 0
    for pid, blk in fixed:
        frm = int(blk or (head - 300_000))
        ok = True
        for a in range(frm, head, 10_000):
            await _yield_to_live("v4 quote backfill")
            b = min(head, a + 9_999)
            try:
                logs = await CHAIN.get_logs({"address": pm, "topics": [V4_SWAP_TOPIC, pid], "fromBlock": a, "toBlock": b})
            except Exception as e:  # noqa
                log.warning("v4 quote scan %s %s: %s", pid[:10], a, str(e)[:80]); ok = False; await asyncio.sleep(1); continue
            decoded = []
            for lg in logs:
                dec = _decode_v4(lg, await _v4_pool(pid))
                if dec and dec["usdc"] > 0 and dec["tokens"] > 0:
                    decoded.append((lg, dec))
            if not decoded:
                continue
            senders, (t0, slope) = await asyncio.gather(_tx_senders(list({lg["transactionHash"] for lg, _ in decoded}), {lg["transactionHash"]: lg["blockNumber"] for lg, _ in decoded}), _window_clock(a, b))
            rows = []
            for lg, dec in decoded:
                txh = _topic_hex(lg["transactionHash"])
                rows.append({"block": lg["blockNumber"], "log_index": lg["logIndex"], "price1m": dec["usdc"] / dec["tokens"] * 1e6, "side": dec["side"],
                             "token": dec["token"], "tokens": dec["tokens"], "ts": int(t0 + (lg["blockNumber"] - a) * slope), "tx": txh,
                             "usdc": dec["usdc"], "venue": "v4", "wallet": senders.get(txh, "")})
            await db.execute_many(ins, rows)
            _prefetch_new_tokens(rows)
            total += len(rows)
            await asyncio.sleep(0.05)
        if ok:
            await db.kv_set(f"v4q_done:{pid}", "1")
    log.info("v4 quote backfill: +%s swaps", total)


async def v4_bootstrap():
    """Jednorazowo: tabela, mapowanie wszystkich puli V4 z 30 dni, backfill swapow V4 (filtr po adresie)."""
    await db.execute(text("CREATE TABLE IF NOT EXISTS v4_pools (id VARCHAR(70) PRIMARY KEY, token VARCHAR(64), is0 INTEGER)"))
    for col, typ in (("currency0", "VARCHAR(64)"), ("currency1", "VARCHAR(64)"), ("fee", "INTEGER"),
                     ("tick_spacing", "INTEGER"), ("hooks", "VARCHAR(64)"), ("block", "BIGINT"), ("usdc_dec", "INTEGER"), ("quote", "VARCHAR(64)")):
        await db.execute(text(f"ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS {col} {typ}"))
    _v4_cache.clear()
    asyncio.create_task(quote_price_loop(), name="quote-price")
    asyncio.create_task(v4_quote_backfill(), name="v4-quote-backfill")
    asyncio.create_task(v4_keys_backfill(), name="v4-keys-backfill")
    await warm_supply_cache()
    from .warm import warm_loop
    asyncio.create_task(warm_loop(), name="site-warm")
    from .referrals import init_tables as _ref_init
    await _ref_init()
    from .risk_score import init as _score_init
    await _score_init()
    from .kols import init as _kols_init
    await _kols_init()
    from .pads_registry import init as _pads_init
    await _pads_init()
    from .watchdog import watchdog_loop
    asyncio.create_task(watchdog_loop(), name="site-watchdog")
    from .orders import init as _orders_init
    await _orders_init()
    from .bubbles import start_warm as _bubbles_warm
    _bubbles_warm()
    asyncio.create_task(quote_pools_loop(), name="quote-pools")
    if await db.kv_get("v4_bootstrapped"):
        return
    head = await CHAIN._bn()
    frm = max(0, head - BACKFILL_BLOCKS)
    pm = Web3.to_checksum_address(V4_POOL_MANAGER)
    n_init = 0
    for a in range(frm, head, 10_000):
        try:
            for lg in await CHAIN.get_logs({"address": pm, "topics": [V4_INIT_TOPIC], "fromBlock": a + 1, "toBlock": min(head, a + 10_000)}):
                await _v4_register_init(lg)
                n_init += 1
        except Exception as e:  # noqa
            log.warning("v4 init scan %s: %s", a, str(e)[:60])
            await asyncio.sleep(0.5)
        await asyncio.sleep(0.05)
    log.info("v4 bootstrap: %s pools mapped", n_init)
    ins = text(
        "INSERT INTO swaps (tx, log_index, block, ts, wallet, token, side, usdc, tokens, price1m, venue) "
        "VALUES (:tx, :log_index, :block, :ts, :wallet, :token, :side, :usdc, :tokens, :price1m, :venue) "
        "ON CONFLICT (tx, log_index) DO NOTHING")
    total = 0
    for a in range(frm, head, 10_000):
        b = min(head, a + 10_000)
        try:
            logs = await CHAIN.get_logs({"address": pm, "topics": [V4_SWAP_TOPIC], "fromBlock": a + 1, "toBlock": b})
        except Exception as e:  # noqa
            log.warning("v4 swap scan %s: %s", a, str(e)[:60])
            await asyncio.sleep(0.5)
            continue
        decoded = []
        for lg in logs:
            dec = _decode_v4(lg, await _v4_pool(_topic_hex(lg["topics"][1])))
            if dec and dec["usdc"] > 0 and dec["tokens"] > 0:
                decoded.append((lg, dec))
        if not decoded:
            continue
        senders, (t0, slope) = await asyncio.gather(
            _tx_senders(list({lg["transactionHash"] for lg, _ in decoded}), {lg["transactionHash"]: lg["blockNumber"] for lg, _ in decoded}), _window_clock(a + 1, b))
        rows = []
        for lg, dec in decoded:
            txh = _topic_hex(lg["transactionHash"])
            rows.append({"block": lg["blockNumber"], "log_index": lg["logIndex"], "price1m": dec["usdc"] / dec["tokens"] * 1e6,
                         "side": dec["side"], "token": dec["token"], "tokens": dec["tokens"],
                         "ts": int(t0 + (lg["blockNumber"] - (a + 1)) * slope), "tx": txh, "usdc": dec["usdc"],
                         "venue": "v4", "wallet": senders.get(txh, "")})
        await db.execute_many(ins, rows)
        _prefetch_new_tokens(rows)
        total += len(rows)
        await asyncio.sleep(0.05)
    await db.kv_set("v4_bootstrapped", "1")
    log.info("v4 bootstrap: +%s swaps indexed", total)


async def v4_keys_backfill():
    """Pools registered before PoolKey columns existed: re-read Initialize logs (topic + pool id) in 10k windows."""
    await asyncio.sleep(60)
    try:
        if await db.kv_get("v4_keys_backfilled"):
            return
        head = await CHAIN._bn()
        pm = Web3.to_checksum_address(V4_POOL_MANAGER)
        n = 0
        for a in range(max(0, head - BACKFILL_BLOCKS), head, 10_000):
            try:
                logs = await CHAIN.get_logs({"address": pm, "topics": [V4_INIT_TOPIC], "fromBlock": a, "toBlock": min(head, a + 9_999)})
            except Exception as e:  # noqa
                log.warning("v4 keys backfill %s: %s", a, e)
                await asyncio.sleep(2)
                continue
            for lg in logs:
                await _v4_register_init(lg)
                n += 1
            await asyncio.sleep(0.2)
        await db.kv_set("v4_keys_backfilled", "1")
        log.info("v4 keys backfill done: %s pools", n)
        if not await db.kv_get("v4_facade_fixed"):
            # historical V4 swaps on facade-USDC pools were scaled by 1e18 instead of 1e6 -> 1e12x too small
            r = await db.execute(text(
                "UPDATE swaps SET usdc = usdc * 1e12, price1m = price1m * 1e12 WHERE venue = 'v4' AND usdc < 0.0001 "
                "AND token IN (SELECT token FROM v4_pools WHERE usdc_dec = 6)"))
            await db.kv_set("v4_facade_fixed", "1")
            log.info("v4 facade swaps rescaled")
    except Exception as e:  # noqa
        log.warning("v4 keys backfill: %s", e)


async def api_v4pool(request: web.Request) -> web.Response:
    """PoolKey(s) for a token on Uniswap V4 (USDC-paired) — used by the sniper to route buys."""
    token = _tok(request)
    if not token:
        return web.json_response({"error": "bad token"}, status=400, headers=API_CORS)
    rows = await db.fetchall(text(
        "SELECT id, currency0, currency1, fee, tick_spacing, hooks, is0, block, usdc_dec FROM v4_pools "
        "WHERE token = :t AND fee IS NOT NULL ORDER BY block DESC NULLS LAST").bindparams(t=token))
    pools = []
    for r in rows:
        d = dict(r)
        sw = await db.fetchone(text("SELECT COUNT(*) AS n, MAX(ts) AS last FROM swaps WHERE token = :t AND venue = 'v4'").bindparams(t=token))
        d["swaps"] = int(sw["n"] or 0) if sw else 0
        pools.append(d)
    return web.json_response({"token": token, "pools": pools}, headers=API_CORS)


async def api_v4launches(request: web.Request) -> web.Response:
    """Latest USDC-paired Uniswap V4 pools (any launchpad) with symbol + basic stats — feeds the site's V4 tab."""
    limit = min(100, int(request.query.get("limit", "50")))
    rows = await db.fetchall(text(
        "SELECT p.id, p.token, p.hooks, p.fee, p.block, s.symbol FROM v4_pools p LEFT JOIN token_symbols s ON s.token = p.token "
        "WHERE p.token IS NOT NULL AND p.fee IS NOT NULL ORDER BY p.block DESC NULLS LAST LIMIT :l").bindparams(l=limit))
    out = []
    now = int(time.time())
    head = None
    try:
        head = int(await db.kv_get("insider_cursor") or 0) or None
    except Exception:  # noqa
        pass
    for r in rows:
        d = dict(r)
        st = await db.fetchone(text(
            "SELECT COUNT(*) AS n, SUM(CASE WHEN ts > :d THEN usdc ELSE 0 END) AS vol24, MAX(ts) AS last, MIN(ts) AS first, "
            "(SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 ORDER BY ts DESC LIMIT 1) AS price1m "
            "FROM swaps WHERE token = :t").bindparams(t=d["token"], d=now - 86400))
        first = int(st["first"] or 0) if st else 0
        # creation time: first indexed swap, else block distance from the live cursor (~0.63 s/block on Arc)
        created = first or (int(now - (head - int(d["block"])) * 0.63) if (head and d.get("block")) else None)
        d.update({"swaps": int(st["n"] or 0), "vol24": float(st["vol24"] or 0), "last_ts": int(st["last"] or 0),
                  "price1m": float(st["price1m"]) if st and st["price1m"] else None, "created_ts": created})
        out.append(d)
    # symbols + supply for rows that lack them (relay calls, cached in token_symbols / memory)
    async def _fill(d):
        if not d.get("symbol"):
            try:
                d["symbol"] = await _symbol(d["token"]) or None
            except Exception:  # noqa
                pass
        d["supply"] = await _total_supply(d["token"])
    await asyncio.gather(*[_fill(d) for d in out])
    return web.json_response({"pools": out}, headers=API_CORS)


_supply_cache: dict[str, tuple[float, float]] = {}
_supply_sem = asyncio.Semaphore(6)


async def _total_supply(token: str) -> float | None:
    c = _supply_cache.get(token)
    if c and c[0] is not None and time.time() - c[1] < 6 * 3600:
        return c[0]
    if c and c[0] is None and time.time() - c[1] < 120:
        return None
    async with _supply_sem:
        v = await _total_supply_fetch(token)
    if v:
        try:
            await db.execute(text("INSERT INTO token_supply (token, supply, ts) VALUES (:t, :s, :ts) "
                                  "ON CONFLICT (token) DO UPDATE SET supply = EXCLUDED.supply, ts = EXCLUDED.ts")
                             .bindparams(t=token, s=float(v), ts=int(time.time())))
        except Exception:  # noqa
            pass
    return v


_supply_pending: set[str] = set()


def total_supply_nowait(token: str) -> float | None:
    """Cached supply (memory, warmed from token_supply at boot) or None; a miss schedules a background fetch
    so list endpoints never block on 100+ relay calls after a restart."""
    c = _supply_cache.get(token)
    if c and c[0] is not None:
        return c[0]
    if token not in _supply_pending:
        _supply_pending.add(token)

        async def _bg():
            try:
                await _total_supply(token)
            finally:
                _supply_pending.discard(token)
        asyncio.create_task(_bg())
    return None


async def warm_supply_cache():
    try:
        await db.execute(text("CREATE TABLE IF NOT EXISTS token_supply (token VARCHAR(64) PRIMARY KEY, supply DOUBLE PRECISION, ts BIGINT)"))
        rows = await db.fetchall(text("SELECT token, supply, ts FROM token_supply"))
        for r in rows:
            if r["supply"]:
                _supply_cache[r["token"]] = (float(r["supply"]), float(r["ts"] or time.time()))
        log.info("supply cache warmed: %d tokens", len(rows))
    except Exception as e:  # noqa
        log.warning("warm_supply_cache: %s", e)


SUPPLY_RPCS = [RELAY_RPC, "https://sharc.fun/rpc", "https://rpc.arc-scan.org"]


async def _total_supply_fetch(token: str) -> float | None:
    """totalSupply + decimals in one batch call; relay → sharc → arc-scan until one answers."""
    body = [{"id": 1, "jsonrpc": "2.0", "method": "eth_call", "params": [{"data": "0x18160ddd", "to": token}, "latest"]},
            {"id": 2, "jsonrpc": "2.0", "method": "eth_call", "params": [{"data": "0x313ce567", "to": token}, "latest"]}]
    for url in SUPPLY_RPCS:
        try:
            async with _aiohttp.ClientSession() as s:
                async with s.post(url, json=body, headers={"X-Priority": "high", "X-Relay-Key": os.getenv("RELAY_KEY", "")}, timeout=_aiohttp.ClientTimeout(total=6)) as r:
                    j = await r.json()
            if not isinstance(j, list):
                continue
            res = {x.get("id"): x.get("result") for x in j if isinstance(x, dict)}
            raw = res.get(1)
            if not raw or raw == "0x":
                continue
            dec_raw = res.get(2)
            dec = int(dec_raw, 16) if dec_raw and dec_raw != "0x" and int(dec_raw, 16) <= 36 else 18
            sup = int(raw, 16) / 10 ** dec
            if sup <= 0:
                continue
            _supply_cache[token] = (sup, time.time())
            return sup
        except Exception:  # noqa - next RPC
            continue
    _supply_cache[token] = (None, time.time())
    return None


async def repair_supply_once(limit: int = 40) -> tuple[int, int]:
    """Tokens that traded in the last 24 h but have no supply (→ no market cap anywhere on the site): fetch it.
    Returns (missing_before, fixed)."""
    now = int(time.time())
    rows = await db.fetchall(text("""
        SELECT s.token, SUM(s.usdc) AS vol FROM swaps s
        LEFT JOIN token_supply ts ON ts.token = s.token
        WHERE s.ts > :since AND (ts.supply IS NULL OR ts.supply <= 0)
        GROUP BY s.token ORDER BY vol DESC LIMIT :lim
    """).bindparams(since=now - 86400, lim=limit))
    fixed = 0
    for r in rows:
        tok = r["token"]
        c = _supply_cache.get(tok)
        if c and c[0]:
            continue
        _supply_cache.pop(tok, None)          # bypass the 120 s negative cache: this is the repair path
        v = await _total_supply(tok)
        if v:
            fixed += 1
    if rows:
        log.info("supply repair: %d missing, %d fixed", len(rows), fixed)
    return len(rows), fixed


async def supply_repair_loop():
    await asyncio.sleep(60)
    while True:
        try:
            await repair_supply_once()
        except Exception as e:  # noqa
            log.warning("supply repair: %s", e)
        await asyncio.sleep(120)


async def repair_pools_once() -> list[str]:
    """Ponownie rozwiazuje pule zapisane jako NULL (ofiary 429), 6 rownolegle. Zwraca pule USDC."""
    rows = await db.fetchall(text("SELECT pool FROM insider_pools WHERE token IS NULL"))
    pools = [p for p in PRIORITY_POOLS if any(r["pool"] == p for r in rows)] + \
            [r["pool"] for r in rows if r["pool"] not in PRIORITY_POOLS]
    fixed: list[str] = []
    sem = asyncio.Semaphore(6)

    async def one(pool):
        async with sem:
            try:
                t0 = "0x" + (await CHAIN.eth_call(pool, SEL_TOKEN0)).hex()[-40:]
                t1 = "0x" + (await CHAIN.eth_call(pool, SEL_TOKEN1)).hex()[-40:]
            except Exception:  # noqa
                return
            token, is0 = None, False
            if t0.lower() == USDC:
                token, is0 = t1.lower(), False
            elif t1.lower() == USDC:
                token, is0 = t0.lower(), True
            if token:
                await db.execute(text("UPDATE insider_pools SET token = :t, is0 = :i WHERE pool = :p")
                                 .bindparams(t=token, i=1 if is0 else 0, p=pool))
                _pool_cache[pool] = {"is0": is0, "token": token}
                fixed.append(pool)

    await asyncio.gather(*[one(p) for p in pools])
    log.info("insider repair: %s NULL pools checked, %s were USDC pools", len(rows), len(fixed))
    return fixed


_site_pool_age: dict[str, int] = {}   # pool -> created_at epoch (bounds the backfill window)


async def _learn_pools_from_site(limit: int = 400) -> int:
    """Site token list → pools we have never resolved. Returns how many were newly registered."""
    import aiohttp as _ah
    async with _ah.ClientSession() as s_:
        async with s_.get("https://arctools.fun/api/tokens?full=1", timeout=_ah.ClientTimeout(total=90),
                          headers={"User-Agent": "ArcTools-buybot/1.0"}) as r:
            j = await r.json()
    toks = j.get("tokens") if isinstance(j, dict) else j
    known = {r_["pool"] for r_ in await db.fetchall(text("SELECT pool FROM insider_pools"))}
    knownq = {r_["pool"] for r_ in await db.fetchall(text("SELECT pool FROM quote_pools"))}
    n = 0
    for t in toks or []:
        pool = (t.get("pool") or "").lower()
        if not pool or not pool.startswith("0x") or len(pool) != 42 or pool in known or pool in knownq:
            continue
        if t.get("stock") or t.get("quote"):
            continue   # stock-quoted pools come through quote_pools (long.supply / Ellipse), handled elsewhere
        ca = t.get("createdAt")
        if ca:
            try:
                from datetime import datetime, timezone
                _site_pool_age[pool] = int(datetime.fromisoformat(str(ca).replace("Z", "+00:00")).timestamp())
            except Exception:  # noqa
                pass
        info = await _resolve_pool(pool)
        if info:
            n += 1
        if n >= limit:
            break
    if n:
        log.info("learn pools: %d new USDC pools from the site list", n)
    return n


async def api_index_pool(req: web.Request):
    """GET /api/index-pool?pool=0x… — resolve one pool and backfill its swaps now (token page found a pool we never indexed)."""
    pool = (req.query.get("pool") or "").lower()
    if not (pool.startswith("0x") and len(pool) == 42):
        return web.json_response({"error": "pool"}, status=400, headers={"Access-Control-Allow-Origin": "*"})
    row = await db.fetchone(text("SELECT 1 FROM swaps s JOIN insider_pools p ON p.token = s.token WHERE p.pool = :p LIMIT 1").bindparams(p=pool))
    if row:
        return web.json_response({"ok": True, "indexed": True}, headers={"Access-Control-Allow-Origin": "*"})
    if pool in _index_inflight:
        return web.json_response({"ok": True, "queued": True}, headers={"Access-Control-Allow-Origin": "*"})
    _index_inflight.add(pool)

    async def _go():
        try:
            _pool_cache.pop(pool, None)
            await db.execute(text("DELETE FROM insider_pools WHERE pool = :p AND token IS NULL").bindparams(p=pool))
            info = await _resolve_pool(pool)
            if not info:
                return
            since = req.query.get("since")
            blocks = BACKFILL_BLOCKS
            try:
                if since:
                    age_s = max(0, int(time.time()) - int(since))
                    blocks = max(2000, int(age_s / 0.63) + 500)
            except Exception:  # noqa
                pass
            n = await backfill_pool(pool, min(blocks, BACKFILL_BLOCKS))
            await db.execute(text("INSERT INTO pool_backfill (pool, done, swaps) VALUES (:p, 1, :n) "
                                  "ON CONFLICT (pool) DO UPDATE SET done = 1, swaps = :n").bindparams(p=pool, n=n))
        except Exception as e:  # noqa
            log.warning("index-pool %s: %s", pool[:10], e)
        finally:
            _index_inflight.discard(pool)
    asyncio.create_task(_go())
    return web.json_response({"ok": True, "queued": True}, headers={"Access-Control-Allow-Origin": "*"})


_index_inflight: set[str] = set()


async def backfill_pool(pool: str, blocks: int = BACKFILL_BLOCKS) -> int:
    """Historia swapow JEDNEJ puli (filtr po adresie) — odzyskanie wolumenu pominietej puli."""
    head = await CHAIN._bn()
    frm = max(0, head - min(blocks, 300_000))   # public RPCs answer -32600 "Invalid request" for older ranges — don't burn calls
    ins = text(
        "INSERT INTO swaps (tx, log_index, block, ts, wallet, token, side, usdc, tokens, price1m, venue) "
        "VALUES (:tx, :log_index, :block, :ts, :wallet, :token, :side, :usdc, :tokens, :price1m, :venue) "
        "ON CONFLICT (tx, log_index) DO NOTHING")
    total = 0
    for a in range(frm, head, 10_000):          # arc-scan: max 10k blokow na getLogs
        await _yield_to_live("backfill_pool")
        b = min(head, a + 10_000)
        info = _pool_cache.get(pool)
        try:
            logs = []
            for topic in (V3_SWAP_TOPIC, V2_SWAP_TOPIC):
                logs += await CHAIN.get_logs({"address": Web3.to_checksum_address(pool), "topics": [topic], "fromBlock": a + 1, "toBlock": b})
        except Exception as e:  # noqa
            log.warning("backfill_pool %s %s-%s: %s", pool[:10], a, b, str(e)[:60])
            await asyncio.sleep(0.5)
            continue
        decoded = []
        for lg in logs:
            topic = lg["topics"][0].hex()
            topic = topic if topic.startswith("0x") else "0x" + topic
            dec = _decode(topic, lg, info)
            if dec and dec["usdc"] > 0 and dec["tokens"] > 0:
                decoded.append((topic, lg, dec))
        if not decoded:
            continue
        senders, (t0, slope) = await asyncio.gather(
            _tx_senders(list({lg["transactionHash"] for _, lg, _ in decoded}), {lg["transactionHash"]: lg["blockNumber"] for _, lg, _ in decoded}), _window_clock(a + 1, b))
        rows = []
        for topic, lg, dec in decoded:
            txh = lg["transactionHash"].hex()
            txh = txh if txh.startswith("0x") else "0x" + txh
            rows.append({
                "block": lg["blockNumber"], "log_index": lg["logIndex"],
                "price1m": dec["usdc"] / dec["tokens"] * 1e6, "side": dec["side"], "token": dec["token"],
                "tokens": dec["tokens"], "ts": int(t0 + (lg["blockNumber"] - (a + 1)) * slope), "tx": txh,
                "usdc": dec["usdc"], "venue": "v3" if topic == V3_SWAP_TOPIC else "v2", "wallet": senders.get(txh, ""),
            })
        await db.execute_many(ins, rows)
        _prefetch_new_tokens(rows)
        total += len(rows)
        await asyncio.sleep(0.1)
    log.info("backfill_pool %s: +%s swaps", pool[:10], total)
    return total


async def repair_loop():
    """Trwala kolejka: pule USDC bez ani jednego swapu w indeksie -> backfill po adresie.
    Odporna na restart (tabela pool_backfill), 3 pule rownolegle, ARCT jako pierwszy."""
    await asyncio.sleep(60)
    await db.execute(text("CREATE TABLE IF NOT EXISTS pool_backfill (pool VARCHAR(64) PRIMARY KEY, done INTEGER DEFAULT 0, swaps INTEGER DEFAULT 0)"))
    try:
        await v4_bootstrap()
    except Exception as e:  # noqa
        log.warning("v4 bootstrap: %s", e)
    # pule priorytetowe: rozwiaz i dociagnij NATYCHMIAST, nie czekajac na pelny skan
    for p in PRIORITY_POOLS:
        try:
            _pool_cache.pop(p, None)
            await db.execute(text("DELETE FROM insider_pools WHERE pool = :p AND token IS NULL").bindparams(p=p))
            info = await _resolve_pool(p)
            if info:
                n = await backfill_pool(p)
                await db.execute(text("INSERT INTO pool_backfill (pool, done, swaps) VALUES (:p, 1, :n) "
                                      "ON CONFLICT (pool) DO UPDATE SET done = 1, swaps = :n").bindparams(p=p, n=n))
        except Exception as e:  # noqa
            log.warning("priority pool %s: %s", p[:10], e)
    while True:
        try:
            await repair_pools_once()
            # pools the site knows from launchpad APIs / factory registry (Lift, eve.fun, Ellipse, ArcPad …) but that never
            # produced an indexed swap: resolve them so the query below queues their backfill
            try:
                await _learn_pools_from_site()
            except Exception as e:  # noqa
                log.warning("learn pools: %s", e)
            # kazda pula USDC, ktorej zaden swap nie trafil do indeksu = kandydat (ofiara 429 albo swieza)
            await db.execute(text("""
                INSERT INTO pool_backfill (pool, done)
                SELECT p.pool, 0 FROM insider_pools p
                WHERE p.token IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM swaps s WHERE s.token = p.token LIMIT 1)
                ON CONFLICT (pool) DO NOTHING"""))
            rows = await db.fetchall(text("""
                SELECT b.pool, COALESCE(p.token, q.token) AS token FROM pool_backfill b
                LEFT JOIN insider_pools p ON p.pool = b.pool LEFT JOIN quote_pools q ON q.pool = b.pool
                WHERE b.done = 0 AND COALESCE(p.token, q.token) IS NOT NULL
                ORDER BY CASE WHEN p.token = :arct THEN 0 ELSE 1 END, b.pool""").bindparams(
                arct="0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52"))
            if rows:
                log.info("insider repair: %s pools queued for backfill", len(rows))
            sem = asyncio.Semaphore(3)

            async def one(pool, token):
                async with sem:
                    if pool not in _pool_cache:
                        await _resolve_pool(pool)
                    # stock-quoted pools: history starts at the launch block — never scan 30 days for a 2-day-old pool
                    qb = await db.fetchone(text("SELECT from_block FROM quote_pools WHERE pool = :p").bindparams(p=pool))
                    blocks = BACKFILL_BLOCKS
                    if qb and qb["from_block"]:
                        head_now = await CHAIN._bn()
                        blocks = max(1000, head_now - int(qb["from_block"]) + 200)
                    elif pool in _site_pool_age:
                        # launchpad pools learned from the site list: history starts at the launch (≈0.63 s / block on Arc)
                        blocks = min(BACKFILL_BLOCKS, max(2000, int((time.time() - _site_pool_age[pool]) / 0.63) + 500))
                    n = await backfill_pool(pool, blocks)
                    await db.execute(text("UPDATE pool_backfill SET done = 1, swaps = :n WHERE pool = :p")
                                     .bindparams(n=n, p=pool))

            await asyncio.gather(*[one(r["pool"], r["token"]) for r in rows])
        except Exception as e:  # noqa
            log.warning("insider repair: %s", e)
        await asyncio.sleep(3600)


def _decode(topic: str, lg, pool_info: dict | None) -> dict | None:
    """-> {token, side, usdc, tokens} lub None."""
    data = lg["data"]
    body = (data.hex() if hasattr(data, "hex") else str(data)).replace("0x", "")
    try:
        if topic == ARCPAD_TRADE_TOPIC:
            topics = [t.hex() if hasattr(t, "hex") else str(t) for t in lg["topics"]]
            topics = [t if t.startswith("0x") else "0x" + t for t in topics]
            token = "0x" + topics[1][-40:]
            is_buy = int(body[0:64], 16) == 1
            usdc = int(body[64:128], 16) if is_buy else int(body[128:192], 16)
            toks = int(body[256:320], 16) if is_buy else int(body[192:256], 16)
            if usdc <= 0 or toks <= 0:
                return None
            # ArcPad v3: kwota jest w QUOTE tokenie (np. TOLLY) — przeliczamy na USD po cenie quote
            q = _pad_quote_usd(lg["address"].lower(), token.lower())
            return {"side": "buy" if is_buy else "sell", "token": token.lower(),
                    "tokens": toks / 1e18, "usdc": usdc / 1e18 * q}
        if not pool_info:
            return None
        token = pool_info["token"]
        tok_is0 = pool_info["is0"]
        if topic == V3_SWAP_TOPIC:
            a0 = int.from_bytes(bytes.fromhex(body[0:64]), "big", signed=True)
            a1 = int.from_bytes(bytes.fromhex(body[64:128]), "big", signed=True)
            tok_amt, usdc_amt = (a0, a1) if tok_is0 else (a1, a0)
            q = pool_info.get("quote")
            if q:   # stock-quoted pool: 18-dec stock amounts → USD through the reference price
                px = _quote_usd.get(q)
                if not px:
                    return None
                usd = abs(usdc_amt) / 1e18 * px
                if usdc_amt > 0 and tok_amt < 0:
                    return {"side": "buy", "token": token, "tokens": -tok_amt / 1e18, "usdc": usd}
                if usdc_amt < 0 and tok_amt > 0:
                    return {"side": "sell", "token": token, "tokens": tok_amt / 1e18, "usdc": usd}
                return None
            if usdc_amt > 0 and tok_amt < 0:
                return {"side": "buy", "token": token, "tokens": -tok_amt / 1e18, "usdc": usdc_amt / 1e6}
            if usdc_amt < 0 and tok_amt > 0:
                return {"side": "sell", "token": token, "tokens": tok_amt / 1e18, "usdc": -usdc_amt / 1e6}
            return None
        # V2: amount0In amount1In amount0Out amount1Out
        a0i, a1i = int(body[0:64], 16), int(body[64:128], 16)
        a0o, a1o = int(body[128:192], 16), int(body[192:256], 16)
        usdc_in = a1i if tok_is0 else a0i
        usdc_out = a1o if tok_is0 else a0o
        tok_in = a0i if tok_is0 else a1i
        tok_out = a0o if tok_is0 else a1o
        if usdc_in > 0 and tok_out > 0:
            return {"side": "buy", "token": token, "tokens": tok_out / 1e18, "usdc": usdc_in / 1e6}
        if tok_in > 0 and usdc_out > 0:
            return {"side": "sell", "token": token, "tokens": tok_in / 1e18, "usdc": usdc_out / 1e6}
        return None
    except Exception:  # noqa
        return None


# ---------------- ingest loop (backfill -> live tail) ----------------

def _hx(h) -> str:
    key = h.hex() if hasattr(h, "hex") else str(h)
    return key if key.startswith("0x") else "0x" + key


async def _tx_senders(hashes: list, blocks: dict | None = None) -> dict[str, str]:
    """tx.from for unique transactions. With `blocks` (hash -> block number) we fetch whole blocks with full txs
    (one call per block instead of one per tx — a 2k-block window with 230 swaps went from ~80 s to a few seconds)."""
    out: dict[str, str] = {}
    want = {_hx(h) for h in hashes}
    sem = asyncio.Semaphore(32)
    if blocks:
        by_block: dict[int, set[str]] = {}
        for h, b in blocks.items():
            k = _hx(h)
            if k in want:
                by_block.setdefault(int(b), set()).add(k)

        async def one_block(b: int, keys: set[str]):
            async with sem:
                try:
                    blk = await CHAIN.w3.eth.get_block(b, full_transactions=True)
                    for tx in blk["transactions"]:
                        k = _hx(tx["hash"])
                        if k in keys:
                            out[k] = (tx["from"] or "").lower()
                except Exception:  # noqa
                    pass
        await asyncio.gather(*[one_block(b, ks) for b, ks in by_block.items()])
    missing = [k for k in want if k not in out]

    async def one(h):
        async with sem:
            try:
                t = await CHAIN.get_tx(h)
                out[h] = (t["from"] or "").lower()
            except Exception:  # noqa
                out[h] = ""
    if missing:
        await asyncio.gather(*[one(h) for h in missing])
    return out


async def _window_clock(frm: int, to: int) -> tuple[int, float]:
    """Realny timestamp bloku `frm` + sekundy/blok w oknie (2 zapytania)."""
    try:
        b0 = await CHAIN.call_any("get_block", frm)
        t0 = int(b0["timestamp"])
        if to > frm:
            b1 = await CHAIN.call_any("get_block", to)
            slope = max(0.05, (int(b1["timestamp"]) - t0) / (to - frm))
        else:
            slope = 0.5
        return t0, slope
    except Exception:  # noqa
        return int(time.time()), 0.5


async def _scan_window(frm: int, to: int, senders: bool = True) -> list[dict] | None:
    """Skan jednego okna blokow -> wiersze swapow (None = blad RPC, powtorzyc)."""
    async def fetch(topic):
        try:
            return topic, await CHAIN.get_logs({"topics": [topic], "fromBlock": frm, "toBlock": to})
        except Exception as e:  # noqa
            log.warning("insider get_logs %s %s-%s: %s", topic[:10], frm, to, str(e)[:70])
            return topic, None

    results = await asyncio.gather(*[fetch(t) for t in (V3_SWAP_TOPIC, V2_SWAP_TOPIC, ARCPAD_TRADE_TOPIC, V4_SWAP_TOPIC, V4_INIT_TOPIC)])
    if any(logs is None for _, logs in results):
        return None

    # nowe pule V4 rejestrujemy PRZED dekodowaniem ich swapow z tego samego okna
    for topic, logs in results:
        if topic == V4_INIT_TOPIC:
            for lg in logs:
                if lg["address"].lower() == V4_POOL_MANAGER:
                    await _v4_register_init(lg)
    pools = {lg["address"].lower() for topic, logs in results
             if topic in (V3_SWAP_TOPIC, V2_SWAP_TOPIC) for lg in logs}
    await asyncio.gather(*[_resolve_pool(p) for p in pools])
    # a pool whose token0/token1 read failed (RPC 429/503) is not in the cache at all (a genuine non-USDC pool IS cached
    # as None) → this window must be retried, otherwise the first swaps of a brand-new pool vanish for good
    unresolved = [p for p in pools if p not in _pool_cache]
    if unresolved:
        if len(unresolved) <= 3:
            await asyncio.gather(*[_resolve_pool(p) for p in unresolved])
            unresolved = [p for p in unresolved if p not in _pool_cache]
        if unresolved:
            log.warning("insider window %s-%s: %d pools unresolved (RPC) → retry", frm, to, len(unresolved))
            return None
    # ArcPad v3: poznaj quote token kazdego tokena z tego okna zanim zdekodujemy kwoty
    for topic, logs in results:
        if topic == ARCPAD_TRADE_TOPIC:
            for lg in logs:
                if lg["address"].lower() == ARCPAD_V3:
                    _pad_quote_usd(ARCPAD_V3, ("0x" + _topic_hex(lg["topics"][1])[-40:]).lower())
    if _pad_quote_missing or _pad_quote:
        await _refresh_pad_quotes()
    decoded = []
    for topic, logs in results:
        if topic == V4_INIT_TOPIC:
            continue
        for lg in logs:
            if topic == V4_SWAP_TOPIC:
                if lg["address"].lower() != V4_POOL_MANAGER:
                    continue
                dec = _decode_v4(lg, await _v4_pool(_topic_hex(lg["topics"][1])))
            else:
                info = None if topic == ARCPAD_TRADE_TOPIC else _pool_cache.get(lg["address"].lower())
                dec = _decode(topic, lg, info)
            if dec and dec["usdc"] > 0 and dec["tokens"] > 0:
                decoded.append((topic, lg, dec))
    if not decoded:
        return []

    if senders:
        senders, clock = await asyncio.gather(
            _tx_senders(list({lg["transactionHash"] for _, lg, _ in decoded}), {lg["transactionHash"]: lg["blockNumber"] for _, lg, _ in decoded}),
            _window_clock(frm, to))
    else:
        senders, clock = {}, await _window_clock(frm, to)      # wallets filled later by sender_fill_loop (catch-up mode)
    t0, slope = clock
    rows = []
    for topic, lg, dec in decoded:
        txh = lg["transactionHash"].hex()
        txh = txh if txh.startswith("0x") else "0x" + txh
        rows.append({
            "block": lg["blockNumber"], "log_index": lg["logIndex"],
            "price1m": dec["usdc"] / dec["tokens"] * 1e6,
            "side": dec["side"], "token": dec["token"], "tokens": dec["tokens"],
            "ts": int(t0 + (lg["blockNumber"] - frm) * slope), "tx": txh, "usdc": dec["usdc"],
            "venue": "pad" if topic == ARCPAD_TRADE_TOPIC else ("v3" if topic == V3_SWAP_TOPIC else ("v4" if topic == V4_SWAP_TOPIC else "v2")),
            "wallet": senders.get(txh, ""),
        })
    return rows


async def gap_fill_loop():
    """Scans ranges the live ingest skipped (kv insider_gaps), oldest first, adaptive window, senders deferred.
    Lowest priority: pauses while the live ingest is more than 3k blocks behind."""
    await asyncio.sleep(90)
    ins = text(
        "INSERT INTO swaps (tx, log_index, block, ts, wallet, token, side, usdc, tokens, price1m, venue) "
        "VALUES (:tx, :log_index, :block, :ts, :wallet, :token, :side, :usdc, :tokens, :price1m, :venue) "
        "ON CONFLICT (tx, log_index) DO NOTHING")
    win = 2_000
    while True:
        try:
            gaps = json.loads(await db.kv_get("insider_gaps") or "[]")
            gaps = [g for g in gaps if g[1] >= g[0]]
            if not gaps:
                await asyncio.sleep(60); continue
            if _lag["blocks"] > 3_000:
                await asyncio.sleep(20); continue
            frm, to_all = gaps[0]
            to = min(to_all, frm + win - 1)
            t0 = time.time()
            try:
                res = await asyncio.wait_for(_scan_window(frm, to, senders=False), timeout=240)
            except asyncio.TimeoutError:
                res = None
            if res is None:
                win = max(250, win // 2); await asyncio.sleep(3); continue
            await db.execute_many_ingest(ins, res)
            _prefetch_new_tokens(res)
            if time.time() - t0 < 40:
                win = min(5_000, int(win * 1.5))
            gaps[0][0] = to + 1
            gaps = [g for g in gaps if g[1] >= g[0]]
            await db.kv_set("insider_gaps", json.dumps(gaps))
            _lag["gap"] = sum(g[1] - g[0] + 1 for g in gaps)
            log.info("gap fill %s-%s: +%s swaps (win %s, %s blocks left)", frm, to, len(res), win, _lag["gap"])
            await asyncio.sleep(0.5)
        except Exception as e:  # noqa
            log.warning("gap fill: %s", e); await asyncio.sleep(10)


async def sender_fill_loop():
    """Catch-up mode writes swaps with wallet='' (senders deferred). Fill them in the background, newest first,
    one getBlock per block (full transactions) — low priority, yields when the live ingest is far behind."""
    await asyncio.sleep(60)
    while True:
        try:
            rows = await db.fetchall(text("SELECT tx, block FROM swaps WHERE wallet = '' ORDER BY block DESC LIMIT 400"))
            if not rows:
                await asyncio.sleep(30); continue
            if _lag["blocks"] > 1_500:
                await asyncio.sleep(20); continue           # live ingest first
            by_block: dict[int, list[str]] = {}
            for r in rows:
                by_block.setdefault(int(r["block"]), []).append(r["tx"].lower())
            sem = asyncio.Semaphore(4); done = 0

            async def one(b: int, txs: list[str]):
                nonlocal done
                async with sem:
                    try:
                        blk = await CHAIN.w3.eth.get_block(b, full_transactions=True)
                    except Exception:  # noqa
                        return
                    found = {(_hx(t["hash"])).lower(): (t["from"] or "").lower() for t in blk["transactions"]}
                    rows_ = [{"w": found.get(h) or "0x", "h": h} for h in txs]     # '0x' = tx not in block (reorg) → never retried
                    await db.execute_many(text("UPDATE swaps SET wallet = :w WHERE tx = :h AND wallet = ''"), rows_)
                    done += sum(1 for r_ in rows_ if r_["w"] != "0x")
            await asyncio.gather(*[one(b, t) for b, t in by_block.items()])
            log.info("sender fill: %s wallets from %s blocks (%s rows pending)", done, len(by_block), len(rows))
        except Exception as e:  # noqa
            log.warning("sender fill: %s", e)
            await asyncio.sleep(10)


def _prefetch_new_tokens(rows: list[dict]):
    try:
        _prefetch_new_tokens_impl(rows)
    except Exception as e:  # noqa - never let a helper stall the cursor
        log.warning("prefetch: %s", e)


def _prefetch_new_tokens_impl(rows: list[dict]):
    """First swap of a token → fetch supply + symbol NOW (own node, ms) so the Terminal shows MC and a name on the
    first render instead of dashes that wait for the next repair pass."""
    toks = {r["token"] for r in rows if r.get("token")}
    def _has(t):
        c = _supply_cache.get(t)
        return c is not None and ((isinstance(c, tuple) and c[0] is not None) or (not isinstance(c, tuple) and c))
    fresh = [t for t in toks if not _has(t)]
    try:
        from . import stream
        stream.publish(rows)
    except Exception:  # noqa
        pass
    for t in fresh[:60]:
        if t not in _supply_pending:
            _supply_pending.add(t)

            async def _bg(tok=t):
                try:
                    await _total_supply(tok)
                    await _symbol(tok)
                except Exception:  # noqa
                    pass
                finally:
                    _supply_pending.discard(tok)
            asyncio.create_task(_bg())


async def ingest_loop():
    await init_tables()
    head = await CHAIN._bn()
    cur = await db.kv_get("insider_cursor")
    cursor = int(cur) if cur else max(0, head - BACKFILL_BLOCKS)
    log.info("insider ingest start @ %s (head %s, backlog %s)", cursor, head, head - cursor)
    ins = text(
        "INSERT INTO swaps (tx, log_index, block, ts, wallet, token, side, usdc, tokens, price1m, venue) "
        "VALUES (:tx, :log_index, :block, :ts, :wallet, :token, :side, :usdc, :tokens, :price1m, :venue) "
        "ON CONFLICT (tx, log_index) DO NOTHING")
    _last_progress = time.time()
    while True:
        try:
            _lag.update(phase="head", since=time.time())
            head = await asyncio.wait_for(CHAIN._bn(), timeout=30)
            _lag["blocks"] = max(0, head - cursor)
            if head - cursor > 20_000:
                # far behind (outage): serve LIVE data first — jump to near-head and hand the gap to gap_fill_loop
                gaps = json.loads(await db.kv_get("insider_gaps") or "[]")
                gaps.append([cursor + 1, head - 2_000])
                await db.kv_set("insider_gaps", json.dumps(gaps))
                log.warning("insider ingest: %s blocks behind → jump to %s, gap %s-%s queued for background fill", head - cursor, head - 2_000, cursor + 1, head - 2_000)
                cursor = head - 2_000
                await db.kv_set("insider_cursor", str(cursor))
                _lag["blocks"] = head - cursor
            if time.time() - _last_progress > 900:
                log.warning("insider ingest: no progress for %ss (cursor %s, head %s) — continuing", int(time.time() - _last_progress), cursor, head)
                _last_progress = time.time()
            if cursor >= head:
                await db.kv_set("insider_synced", "1")
                await asyncio.sleep(CFG.poll_interval)
                continue
            backfilling = head - cursor > LIVE_WINDOW * 2

            if backfilling:
                # adaptive window: a post-outage burst can hold thousands of swaps in 5k blocks → the scan would not finish
                # inside the timeout and restart forever. Halve on timeout, grow back when a window is quick.
                win = int(_lag.get("win") or BACKFILL_WINDOW)
                spans = []
                c = cursor
                for _ in range(PARALLEL_WINDOWS):
                    if c >= head:
                        break
                    frm, to = c + 1, min(head, c + win)
                    spans.append((frm, to))
                    c = to
                _lag.update(phase="scan", since=time.time(), window=f"{spans[0][0]}-{spans[-1][1]}", win=win)
                t_scan = time.time()
                try:
                    defer = (head - cursor) > 3_000
                    scans = await asyncio.wait_for(asyncio.gather(*[_scan_window(f, t, senders=not defer) for f, t in spans]), timeout=240)
                except asyncio.TimeoutError:
                    _lag["win"] = max(250, win // 2)
                    log.warning("insider backfill window %s-%s timed out → window %s", spans[0][0], spans[-1][1], _lag["win"])
                    continue
                if any(r is None for r in scans):
                    # RPC refused (e.g. "query exceeds max results 20000" in a post-outage burst) or transient failure:
                    # shrink the window after 2 consecutive misses so a dense range gets through in smaller bites
                    _lag["miss"] = int(_lag.get("miss") or 0) + 1
                    if _lag["miss"] >= 2:
                        _lag["win"] = max(250, win // 2); _lag["miss"] = 0
                        log.warning("insider backfill window %s-%s failed twice → window %s", spans[0][0], spans[-1][1], _lag["win"])
                    await asyncio.sleep(2)
                    continue
                _lag["miss"] = 0
                if time.time() - t_scan < 60 and win < BACKFILL_WINDOW:
                    _lag["win"] = min(BACKFILL_WINDOW, int(win * 1.5))
                _lag.update(phase="write", since=time.time())
                rows, advanced = [], cursor
                for (frm, to), res in zip(spans, scans):
                    if res is None:
                        break                     # dalsze okna powtorzymy w nastepnej iteracji
                    rows.extend(res)
                    advanced = to
                await db.execute_many_ingest(ins, rows)
                _prefetch_new_tokens(rows)
                if advanced > cursor:
                    cursor = advanced; _last_progress = time.time()
                    await db.kv_set("insider_cursor", str(cursor))
                    log.info("insider backfill -> %s: +%s swaps (%s okien, do head %s blokow)",
                             cursor, len(rows), len(spans), head - cursor)
                else:
                    await asyncio.sleep(3)
                await asyncio.sleep(0.1)
            else:
                # live window is adaptive too: with ~20 swaps/block the chain now exceeds the 20 000-log cap in a
                # 2 000-block window → the scan returned None forever and the cursor froze ~2 300 blocks behind
                lwin = int(_lag.get("lwin") or LIVE_WINDOW)
                frm, to = cursor + 1, min(head, cursor + lwin)
                _lag.update(phase="scan", since=time.time(), window=f"{frm}-{to}", lwin=lwin)
                t_scan = time.time()
                try:
                    res = await asyncio.wait_for(_scan_window(frm, to, senders=(head - cursor) < 1_500), timeout=120)
                except asyncio.TimeoutError:
                    res = None
                if res is None:
                    _lag["lmiss"] = int(_lag.get("lmiss") or 0) + 1
                    if _lag["lmiss"] >= 2:
                        _lag["lwin"] = max(100, lwin // 2); _lag["lmiss"] = 0
                        log.warning("insider live window %s-%s failed twice → window %s", frm, to, _lag["lwin"])
                    await asyncio.sleep(2)
                    continue
                _lag["lmiss"] = 0
                if time.time() - t_scan < 20 and lwin < LIVE_WINDOW:
                    _lag["lwin"] = min(LIVE_WINDOW, int(lwin * 1.5))
                await db.execute_many_ingest(ins, res)
                _prefetch_new_tokens(res)
                cursor = to; _last_progress = time.time()
                await db.kv_set("insider_cursor", str(cursor))
                # behind head → go straight on; at head → normal poll cadence
                await asyncio.sleep(CFG.poll_interval if head - cursor < 50 else 0.2)
        except Exception as e:  # noqa
            log.warning("insider ingest [%s %s]: %r", _lag.get("phase"), _lag.get("window"), e)
            _lag.update(phase="error:" + type(e).__name__, since=time.time())
            await asyncio.sleep(5)


# ---------------- wallet stats (avg-cost PnL) ----------------

RANGES = {"7d": 7 * 86400, "30d": 30 * 86400, "all": 10 * 365 * 86400}


async def _compute_range(rng: str, since: int):
    rows = await db.fetchall(text("""
        SELECT wallet, token,
               SUM(CASE WHEN side='buy' THEN usdc ELSE 0 END) AS buy_usd,
               SUM(CASE WHEN side='buy' THEN tokens ELSE 0 END) AS buy_tok,
               SUM(CASE WHEN side='sell' THEN usdc ELSE 0 END) AS sell_usd,
               SUM(CASE WHEN side='sell' THEN tokens ELSE 0 END) AS sell_tok,
               COUNT(*) AS n, MAX(ts) AS last_ts
        FROM swaps WHERE ts > :since AND wallet != '' GROUP BY wallet, token
    """).bindparams(since=since))
    # Cena referencyjna = MEDIANA z 5 ostatnich swapow o sensownej wielkosci.
    # Bez tego jeden pylkowy trade (kilka wei) ustawia absurdalna cene i generuje
    # fikcyjne miliony niezrealizowanego zysku.
    prices = await db.fetchall(text("""
        WITH recent AS (
            SELECT token, price1m, ROW_NUMBER() OVER (PARTITION BY token ORDER BY ts DESC) AS rn
            FROM swaps WHERE usdc >= :dust AND price1m > 0
        )
        SELECT token, percentile_cont(0.5) WITHIN GROUP (ORDER BY price1m) AS price1m
        FROM recent WHERE rn <= 5 GROUP BY token
    """).bindparams(dust=PRICE_MIN_USD))
    price_map = {p["token"]: float(p["price1m"] or 0) for p in prices}

    wallets: dict[str, dict] = {}
    for r in rows:
        w = r["wallet"]
        if w in EXCLUDED:
            continue
        buy_usd, buy_tok = float(r["buy_usd"] or 0), float(r["buy_tok"] or 0)
        sell_usd, sell_tok = float(r["sell_usd"] or 0), float(r["sell_tok"] or 0)
        # Bez zakupu w oknie nie ma bazy kosztowej (token kupiony wczesniej) ->
        # taka sprzedaz liczylaby sie jako 100% zysku. Pomijamy pozycje.
        if buy_tok <= 0:
            continue
        s = wallets.setdefault(w, {"best": (None, 0.0), "closed": 0, "last": 0, "open": 0,
                                   "pnl_r": 0.0, "pnl_u": 0.0, "spent": 0.0,
                                   "trades": 0, "vol": 0.0, "wins": 0})
        avg_cost = buy_usd / buy_tok
        sold = min(sell_tok, buy_tok)
        # przychod proporcjonalnie do czesci pokrytej baza kosztowa
        proceeds = sell_usd * (sold / sell_tok) if sell_tok > 0 else 0.0
        realized = proceeds - sold * avg_cost
        remaining = max(0.0, buy_tok - sell_tok)
        cost_open = remaining * avg_cost
        # Sufit na papierowy zysk: pozycja otwarta warta max UNREAL_CAP x koszt.
        # Chroni ranking przed manipulowana/martwa cena w niepłynnym tokenie.
        value_open = min(remaining / 1e6 * price_map.get(r["token"], 0), cost_open * UNREAL_CAP)
        unrealized = value_open - cost_open
        s["pnl_r"] += realized
        s["pnl_u"] += unrealized
        s["spent"] += buy_usd
        s["vol"] += buy_usd + sell_usd
        s["trades"] += int(r["n"])
        s["last"] = max(s["last"], int(r["last_ts"] or 0))
        if sell_tok > 0:
            s["closed"] += 1
            if realized > 0:
                s["wins"] += 1
        if remaining > 0:
            s["open"] += 1
        tot = realized + unrealized
        if tot > s["best"][1]:
            s["best"] = (r["token"], tot)

    days = max(1, (RANGES[rng] if rng != "all" else int(time.time()) - since) / 86400)
    out = []
    for w, s in wallets.items():
        if s["closed"] < MIN_CLOSED or s["vol"] < MIN_VOLUME:
            continue
        pnl = s["pnl_r"] + s["pnl_u"]
        out.append({
            "best_pnl": s["best"][1], "best_token": s["best"][0] or "",
            "bot": 1 if s["trades"] / days > BOT_TRADES_PER_DAY else 0,
            "closed": s["closed"], "last": s["last"], "open": s["open"],
            "pnl": pnl, "pnl_pct": (pnl / s["spent"] * 100) if s["spent"] > 0 else 0,
            "pnl_r": s["pnl_r"], "pnl_u": s["pnl_u"],
            "trades": s["trades"], "vol": s["vol"], "wallet": w,
            "winrate": (s["wins"] / s["closed"] * 100) if s["closed"] else 0,
        })
    out.sort(key=lambda x: -x["pnl"])
    out = [o for o in out if not o["bot"]][:200]

    # symbole best tokenow (rownolegle, z cache)
    toks = list({o["best_token"] for o in out[:80] if o["best_token"]})
    got = await asyncio.gather(*[_symbol(t) for t in toks], return_exceptions=True)
    syms = {t: (s if isinstance(s, str) else "?") for t, s in zip(toks, got)}

    await db.execute(text("DELETE FROM wallet_stats WHERE range = :r").bindparams(r=rng))
    ins = text("""
        INSERT INTO wallet_stats (wallet, range, pnl_realized, pnl_unrealized, pnl_total,
            pnl_pct, winrate, trades, closed, volume, best_token, best_symbol, best_pnl,
            last_trade, bot_suspect, open_positions)
        VALUES (:w, :r, :pr, :pu, :pt, :pp, :wr, :tr, :cl, :vo, :bt, :bs, :bp, :lt, :bo, :op)""")
    await db.execute_many(ins, [{
        "bo": o["bot"], "bp": o["best_pnl"], "bs": syms.get(o["best_token"], ""),
        "bt": o["best_token"], "cl": o["closed"], "lt": o["last"], "op": o["open"],
        "pp": o["pnl_pct"], "pr": o["pnl_r"], "pt": o["pnl"], "pu": o["pnl_u"],
        "r": rng, "tr": o["trades"], "vo": o["vol"], "w": o["wallet"], "wr": o["winrate"],
    } for o in out])
    log.info("insider stats %s: %s wallets ranked (z %s kandydatow)", rng, len(out), len(wallets))


async def stats_loop():
    await asyncio.sleep(45)
    while True:
        try:
            now = int(time.time())
            for rng, span in RANGES.items():
                await _compute_range(rng, now - span if rng != "all" else 0)
        except Exception as e:  # noqa
            log.warning("insider stats: %s", e)
        await asyncio.sleep(120)


# ---------------- HTTP API ----------------

API_CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type"}


async def api_board(request: web.Request) -> web.Response:
    rng = request.query.get("range", "30d")
    if rng not in RANGES:
        rng = "30d"
    rows = await db.fetchall(text(
        "SELECT * FROM wallet_stats WHERE range = :r ORDER BY pnl_total DESC LIMIT 100"
    ).bindparams(r=rng))
    return web.json_response({"range": rng, "rows": [dict(r) for r in rows]}, headers=API_CORS)


_wstats_cache: dict[str, tuple[float, list[dict]]] = {}


async def wallet_stats_live(w: str) -> list[dict]:
    """Avg-cost PnL for ONE wallet over 7d / 30d / all — same maths as the leaderboard, but for any address
    (the leaderboard table only keeps the ranked top-200). Cached 3 min."""
    hit = _wstats_cache.get(w)
    if hit and time.time() - hit[0] < 180:
        return hit[1]
    now = int(time.time())
    rows = await db.fetchall(text("""
        SELECT token, ts, side, usdc, tokens FROM swaps WHERE wallet = :w AND ts > :since ORDER BY ts
    """).bindparams(w=w, since=now - RANGES["all"]))
    if not rows:
        _wstats_cache[w] = (time.time(), [])
        return []
    toks = list({r["token"] for r in rows})
    prices = await db.fetchall(text("""
        WITH recent AS (
            SELECT token, price1m, ROW_NUMBER() OVER (PARTITION BY token ORDER BY ts DESC) AS rn
            FROM swaps WHERE token = ANY(:toks) AND usdc >= :dust AND price1m > 0
        )
        SELECT token, percentile_cont(0.5) WITHIN GROUP (ORDER BY price1m) AS price1m
        FROM recent WHERE rn <= 5 GROUP BY token
    """).bindparams(toks=toks, dust=PRICE_MIN_USD))
    price_map = {p["token"]: float(p["price1m"] or 0) for p in prices}
    out = []
    for rng, span in RANGES.items():
        since = now - span
        agg: dict[str, dict] = {}
        for r in rows:
            if int(r["ts"]) <= since:
                continue
            a = agg.setdefault(r["token"], {"buy_usd": 0.0, "buy_tok": 0.0, "sell_usd": 0.0, "sell_tok": 0.0, "n": 0, "last": 0})
            if r["side"] == "buy":
                a["buy_usd"] += float(r["usdc"] or 0); a["buy_tok"] += float(r["tokens"] or 0)
            else:
                a["sell_usd"] += float(r["usdc"] or 0); a["sell_tok"] += float(r["tokens"] or 0)
            a["n"] += 1; a["last"] = max(a["last"], int(r["ts"]))
        st = {"best": (None, 0.0), "closed": 0, "last": 0, "open": 0, "pnl_r": 0.0, "pnl_u": 0.0, "spent": 0.0, "trades": 0, "vol": 0.0, "wins": 0}
        for tok, a in agg.items():
            st["trades"] += a["n"]; st["vol"] += a["buy_usd"] + a["sell_usd"]; st["last"] = max(st["last"], a["last"])
            if a["buy_tok"] <= 0:
                continue
            avg_cost = a["buy_usd"] / a["buy_tok"]
            sold = min(a["sell_tok"], a["buy_tok"])
            proceeds = a["sell_usd"] * (sold / a["sell_tok"]) if a["sell_tok"] > 0 else 0.0
            realized = proceeds - sold * avg_cost
            remaining = max(0.0, a["buy_tok"] - a["sell_tok"])
            cost_open = remaining * avg_cost
            value_open = min(remaining / 1e6 * price_map.get(tok, 0), cost_open * UNREAL_CAP)
            unrealized = value_open - cost_open
            st["pnl_r"] += realized; st["pnl_u"] += unrealized; st["spent"] += a["buy_usd"]
            if a["sell_tok"] > 0:
                st["closed"] += 1
                if realized > 0:
                    st["wins"] += 1
            if remaining > 0:
                st["open"] += 1
            if realized + unrealized > st["best"][1]:
                st["best"] = (tok, realized + unrealized)
        if st["trades"] == 0:
            continue
        best_sym = ""
        if st["best"][0]:
            try:
                best_sym = await _symbol(st["best"][0])
            except Exception:  # noqa
                best_sym = ""
        pnl = st["pnl_r"] + st["pnl_u"]
        out.append({"wallet": w, "range": rng, "pnl_realized": st["pnl_r"], "pnl_unrealized": st["pnl_u"], "pnl_total": pnl,
                    "pnl_pct": (pnl / st["spent"] * 100) if st["spent"] > 0 else 0, "winrate": (st["wins"] / st["closed"] * 100) if st["closed"] else 0,
                    "trades": st["trades"], "closed": st["closed"], "volume": st["vol"], "best_token": st["best"][0] or "", "best_symbol": best_sym,
                    "best_pnl": st["best"][1], "last_trade": st["last"], "bot_suspect": 0, "open_positions": st["open"], "live": 1})
    _wstats_cache[w] = (time.time(), out)
    return out


async def api_wallet(request: web.Request) -> web.Response:
    w = request.match_info["wallet"].lower()
    if not (w.startswith("0x") and len(w) == 42):
        return web.json_response({"error": "bad wallet"}, status=400, headers=API_CORS)
    stats = await db.fetchall(text("SELECT * FROM wallet_stats WHERE wallet = :w").bindparams(w=w))
    if not stats:
        try:
            stats = await asyncio.wait_for(wallet_stats_live(w), timeout=8)
        except Exception as e:  # noqa
            log.debug("wallet_stats_live %s: %s", w, e)
            stats = []
    trades = await db.fetchall(text(
        "SELECT tx, ts, token, side, usdc, tokens, price1m, venue FROM swaps "
        "WHERE wallet = :w ORDER BY ts DESC LIMIT 25").bindparams(w=w))
    return web.json_response({
        "stats": [dict(s) for s in stats],
        "trades": [dict(t) for t in trades],
        "wallet": w,
    }, headers=API_CORS)


async def api_health(_):
    """Railway healthcheck + self-heal probe. 200 = process alive and serving; DB state is reported, not fatal
    (a slow Postgres under ingest load must not make Railway/self-heal restart a healthy process)."""
    out = {"ok": True, "lag": _lag.get("blocks"), "phase": _lag.get("phase"), "db": "ok"}
    try:
        t = time.time()
        cur = await asyncio.wait_for(db.kv_get("insider_cursor"), 6)
        out["cursor"] = cur; out["db_ms"] = round((time.time() - t) * 1000)
    except Exception as e:  # noqa
        out["db"] = f"slow/err: {type(e).__name__} {str(e)[:60]}"
    return web.json_response(out, headers=API_CORS)


# ---------------- token page API: OHLC / trades / stats ----------------

TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}


def _tok(request: web.Request) -> str | None:
    t = (request.query.get("token") or "").lower()
    return t if t.startswith("0x") and len(t) == 42 else None


async def api_ohlc(request: web.Request) -> web.Response:
    """Swiece z wlasnego indeksu swapow (caly Arc). price1m = USDC za 1M tokenow."""
    token = _tok(request)
    if not token:
        return web.json_response({"error": "bad token"}, status=400, headers=API_CORS)
    tf = request.query.get("tf", "5m")
    step = TF_SECONDS.get(tf, 300)
    limit = min(1500, max(50, int(request.query.get("limit", "600"))))
    rows = await db.fetchall(text("""
        WITH raw AS (
            SELECT (ts / :step) * :step AS bucket, ts, log_index, price1m, usdc, side
            FROM swaps WHERE token = :t AND usdc >= :dust AND price1m > 0
        ),
        med AS (SELECT bucket, percentile_cont(0.5) WITHIN GROUP (ORDER BY price1m) AS m, COUNT(*) AS cnt FROM raw GROUP BY bucket),
        -- outlier guard: a multi-hop leg or a sandwiched dust trade can print 10-60x off the real price inside one candle
        -- and turns the chart into a wick forest; keep prints within 0.4x .. 2.5x of the candle's median (and every
        -- print when the candle has < 3 trades so thin tokens still get their bars)
        b AS (
            SELECT r.* FROM raw r JOIN med ON med.bucket = r.bucket
            WHERE r.price1m BETWEEN med.m * 0.4 AND med.m * 2.5 OR med.cnt < 3
        ),
        agg AS (
            SELECT bucket,
                   (array_agg(price1m ORDER BY ts, log_index))[1]  AS o,
                   MAX(price1m) AS h, MIN(price1m) AS l,
                   (array_agg(price1m ORDER BY ts DESC, log_index DESC))[1] AS c,
                   SUM(usdc) AS v,
                   SUM(CASE WHEN side='buy' THEN usdc ELSE 0 END) AS vb,
                   COUNT(*) AS n
            FROM b GROUP BY bucket
        )
        SELECT * FROM agg ORDER BY bucket DESC LIMIT :lim
    """).bindparams(step=step, t=token, dust=0.1, lim=limit))
    rows.reverse()
    # wypelnij luki: swieca bez transakcji = plaska na poprzednim close (jak na screenerach)
    out = []
    prev_c = None
    for r in rows:
        o = float(r["o"]) if prev_c is None else prev_c   # open = poprzedni close (ciaglosc)
        c = float(r["c"])
        out.append({"t": int(r["bucket"]), "o": o, "h": max(float(r["h"]), o), "l": min(float(r["l"]), o),
                    "c": c, "v": float(r["v"] or 0), "vb": float(r["vb"] or 0), "n": int(r["n"])})
        prev_c = c
    return web.json_response({"token": token, "tf": tf, "candles": out}, headers=API_CORS)


# ---------------- TradingView UDF datafeed (Advanced Charts / charting_library) ----------------
# Symbol = token address, optional ":mcap" suffix (values × supply/1e6 instead of price per token).
# Resolutions map onto our swap-index candles; history is served from the same aggregation as /api/ohlc.

UDF_RES = {"1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "1D": "1d", "D": "1d"}
UDF_CORS = {**API_CORS, "Cache-Control": "public, max-age=5"}


async def udf_config(request: web.Request) -> web.Response:
    return web.json_response({
        "supported_resolutions": ["1", "5", "15", "60", "240", "1D"],
        "supports_group_request": False, "supports_marks": False, "supports_search": True,
        "supports_time": True, "supports_timescale_marks": False,
        "exchanges": [{"value": "Arc", "name": "Arc", "desc": "Arc mainnet — every launchpad + Uniswap V3/V4"}],
        "symbols_types": [{"name": "crypto", "value": "crypto"}],
    }, headers=UDF_CORS)


async def udf_time(request: web.Request) -> web.Response:
    return web.Response(text=str(int(time.time())), headers=UDF_CORS)


def _udf_split(sym: str) -> tuple[str, bool]:
    sym = (sym or "").strip()
    mcap = sym.lower().endswith(":mcap")
    if mcap:
        sym = sym[:-5]
    if "/" in sym:
        sym = sym.split("/")[0]
    return sym.lower(), mcap


async def udf_symbols(request: web.Request) -> web.Response:
    tok, mcap = _udf_split(request.query.get("symbol", ""))
    if not (tok.startswith("0x") and len(tok) == 42):
        return web.json_response({"s": "error", "errmsg": "unknown symbol"}, headers=UDF_CORS)
    try:
        sym = await _symbol(tok)
    except Exception:  # noqa
        sym = tok[:6]
    name = f"{sym}/USDC" + (" · MCAP" if mcap else "")
    # price scale: USD per token is tiny for memecoins → 10 significant digits via pricescale
    return web.json_response({
        "name": name, "ticker": request.query.get("symbol", tok), "description": f"{sym} on Arc" + (" (market cap)" if mcap else ""),
        "type": "crypto", "session": "24x7", "timezone": "Etc/UTC", "exchange": "Arc", "listed_exchange": "Arc",
        "minmov": 1, "pricescale": 100 if mcap else 10 ** 10, "has_intraday": True, "has_daily": True, "has_weekly_and_monthly": False,
        "supported_resolutions": ["1", "5", "15", "60", "240", "1D"], "volume_precision": 2, "data_status": "streaming",
        "currency_code": "USD", "format": "price",
    }, headers=UDF_CORS)


async def udf_search(request: web.Request) -> web.Response:
    q = (request.query.get("query") or "").strip().lower()
    limit = min(50, int(request.query.get("limit", "30") or 30))
    if not q:
        return web.json_response([], headers=UDF_CORS)
    if q.startswith("0x") and len(q) == 42:
        rows = [{"token": q, "symbol": await _symbol(q)}]
    else:
        rows = await db.fetchall(text("SELECT token, symbol FROM token_symbols WHERE LOWER(symbol) LIKE :q LIMIT :l").bindparams(q=f"%{q}%", l=limit))
    return web.json_response([{"symbol": r["token"], "full_name": f"{r['symbol']}/USDC", "description": f"{r['symbol']} on Arc", "exchange": "Arc", "ticker": r["token"], "type": "crypto"} for r in rows], headers=UDF_CORS)


async def udf_history(request: web.Request) -> web.Response:
    tok, mcap = _udf_split(request.query.get("symbol", ""))
    if not (tok.startswith("0x") and len(tok) == 42):
        return web.json_response({"s": "error", "errmsg": "unknown symbol"}, headers=UDF_CORS)
    tf = UDF_RES.get(request.query.get("resolution", "5"), "5m")
    step = TF_SECONDS.get(tf, 300)
    try:
        frm = int(float(request.query.get("from", "0"))); to = int(float(request.query.get("to", str(int(time.time())))))
    except ValueError:
        return web.json_response({"s": "error", "errmsg": "bad range"}, headers=UDF_CORS)
    countback = int(request.query.get("countback", "0") or 0)
    rows = await db.fetchall(text("""
        WITH b AS (
            SELECT (ts / :step) * :step AS bucket, ts, log_index, price1m, usdc
            FROM swaps WHERE token = :t AND usdc >= :dust AND price1m > 0 AND ts < :to
        ),
        agg AS (
            SELECT bucket,
                   (array_agg(price1m ORDER BY ts, log_index))[1]  AS o,
                   MAX(price1m) AS h, MIN(price1m) AS l,
                   (array_agg(price1m ORDER BY ts DESC, log_index DESC))[1] AS c,
                   SUM(usdc) AS v
            FROM b GROUP BY bucket
        )
        SELECT * FROM agg ORDER BY bucket DESC LIMIT :lim
    """).bindparams(step=step, t=tok, dust=0.1, to=to, lim=max(countback, 2000)))
    rows.reverse()
    scale = 1e-6
    if mcap:
        try:
            sup = await db.fetchone(text("SELECT supply FROM token_supply WHERE token = :t").bindparams(t=tok))
            if sup and sup["supply"]:
                scale = float(sup["supply"]) / 1e6
        except Exception:  # noqa
            pass
    t_, o_, h_, l_, c_, v_ = [], [], [], [], [], []
    prev_c = None
    for r in rows:
        c = float(r["c"]); o = float(r["o"]) if prev_c is None else prev_c
        b = int(r["bucket"])
        if b >= frm or (countback and len(t_) < countback):
            t_.append(b); o_.append(o * scale); h_.append(max(float(r["h"]), o) * scale); l_.append(min(float(r["l"]), o) * scale); c_.append(c * scale); v_.append(float(r["v"] or 0))
        prev_c = c
    if not t_:
        nb = rows[-1]["bucket"] if rows else None
        return web.json_response({"s": "no_data", **({"nextTime": int(nb)} if nb else {})}, headers=UDF_CORS)
    return web.json_response({"s": "ok", "t": t_, "o": o_, "h": h_, "l": l_, "c": c_, "v": v_}, headers=UDF_CORS)


async def api_trades(request: web.Request) -> web.Response:
    token = _tok(request)
    if not token:
        return web.json_response({"error": "bad token"}, status=400, headers=API_CORS)
    limit = min(200, max(10, int(request.query.get("limit", "60"))))
    rows = await db.fetchall(text("""
        SELECT s.tx, s.ts, s.wallet, s.side, s.usdc, s.tokens, s.price1m, s.venue, s.block,
               w.rank AS insider_rank, w.pnl_total AS insider_pnl
        FROM swaps s
        LEFT JOIN (
            SELECT wallet, pnl_total, ROW_NUMBER() OVER (ORDER BY pnl_total DESC) AS rank
            FROM wallet_stats WHERE range = '30d'
        ) w ON w.wallet = s.wallet
        WHERE s.token = :t ORDER BY s.ts DESC, s.log_index DESC LIMIT :lim
    """).bindparams(t=token, lim=limit))
    return web.json_response({"token": token, "trades": [dict(r) for r in rows]}, headers=API_CORS)


async def api_token_stats(request: web.Request) -> web.Response:
    token = _tok(request)
    if not token:
        return web.json_response({"error": "bad token"}, status=400, headers=API_CORS)
    now = int(time.time())
    row = await db.fetchone(text("""
        SELECT
          SUM(CASE WHEN ts > :d1 THEN usdc ELSE 0 END) AS vol24,
          SUM(CASE WHEN ts > :d1 AND side='buy' THEN 1 ELSE 0 END) AS buys24,
          SUM(CASE WHEN ts > :d1 AND side='sell' THEN 1 ELSE 0 END) AS sells24,
          COUNT(DISTINCT CASE WHEN ts > :d1 THEN wallet END) AS traders24,
          COUNT(*) AS txns_all, SUM(usdc) AS vol_all,
          MIN(ts) AS first_ts
        FROM swaps WHERE token = :t
    """).bindparams(t=token, d1=now - 86400))

    async def price_at(cutoff: int):
        r = await db.fetchone(text(
            "SELECT price1m FROM swaps WHERE token = :t AND ts <= :c AND usdc >= 0.5 AND price1m > 0 "
            "ORDER BY ts DESC, log_index DESC LIMIT 1").bindparams(t=token, c=cutoff))
        return float(r["price1m"]) if r else None

    last, p5, p1h, p6h, p24 = await asyncio.gather(
        price_at(now), price_at(now - 300), price_at(now - 3600), price_at(now - 21600), price_at(now - 86400))

    def chg(p):
        return ((last - p) / p * 100) if (last and p and p > 0) else None

    return web.json_response({
        "token": token,
        "price1m": last,
        "change": {"5m": chg(p5), "1h": chg(p1h), "6h": chg(p6h), "24h": chg(p24)},
        "vol24": float(row["vol24"] or 0), "buys24": int(row["buys24"] or 0),
        "sells24": int(row["sells24"] or 0), "traders24": int(row["traders24"] or 0),
        "txns_all": int(row["txns_all"] or 0), "vol_all": float(row["vol_all"] or 0),
        "first_ts": int(row["first_ts"] or 0),
    }, headers=API_CORS)


async def start_api():
    import os
    app = web.Application()
    from .botmetrics import api_heartbeat, api_ui_beacon
    app.router.add_post("/api/bot-heartbeat", api_heartbeat)
    app.router.add_post("/api/ui-beacon", api_ui_beacon)
    app.router.add_options("/api/ui-beacon", lambda r: web.Response(headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST"}))
    from .alpha import api_alpha
    app.router.add_get("/api/alpha", api_alpha)
    async def api_tasks(request):
        out = []
        for t in asyncio.all_tasks():
            n = t.get_name()
            if n.startswith("Task-"):
                continue
            st = "done" if t.done() else "running"
            exc = None
            if t.done() and not t.cancelled():
                try: exc = repr(t.exception())[:200]
                except Exception: pass  # noqa
            out.append({"name": n, "state": st, "exc": exc})
        return web.json_response({"tasks": sorted(out, key=lambda x: x["name"]), "ingest_lag": _lag["blocks"], "ingest": {**_lag, "for_s": int(time.time() - float(_lag.get("since") or time.time()))}}, headers={"Access-Control-Allow-Origin": "*"})
    app.router.add_get("/api/tasks", api_tasks)
    from .rpc_monitor import api_rpc_health
    app.router.add_get("/api/rpc-health", api_rpc_health)
    from . import orders as _orders
    _orders.register(app)
    from . import bubbles as _bubbles
    _bubbles.register(app)
    from .chain_status import api_status as _chain_status
    app.router.add_get("/api/chain-status", _chain_status)
    app.router.add_get("/api/insiders", api_board)
    app.router.add_get("/api/insider/{wallet}", api_wallet)
    app.router.add_get("/api/ohlc", api_ohlc)
    app.router.add_get("/udf/config", udf_config); app.router.add_get("/udf/time", udf_time); app.router.add_get("/udf/symbols", udf_symbols)
    app.router.add_get("/udf/search", udf_search); app.router.add_get("/udf/history", udf_history)
    app.router.add_get("/api/trades", api_trades)
    app.router.add_get("/api/token-stats", api_token_stats)
    app.router.add_get("/api/v4pool", api_v4pool)
    app.router.add_get("/api/index-pool", api_index_pool)
    app.router.add_get("/api/v4launches", api_v4launches)
    from .watchlist import api_whales, api_movers, api_insider_activity, api_wallet_watch_count, api_positions
    app.router.add_get("/api/positions", api_positions)
    from .watchlist import api_wallet_trades
    app.router.add_get("/api/wallet-trades", api_wallet_trades)
    from .watchlist import api_trending
    app.router.add_get("/api/trending", api_trending)
    from .watchlist import api_stats
    app.router.add_get("/api/stats", api_stats)
    app.router.add_get("/api/whales", api_whales)
    app.router.add_get("/api/movers", api_movers)
    app.router.add_get("/api/insider-activity", api_insider_activity)
    app.router.add_get("/api/watchers", api_wallet_watch_count)
    from .balances import api_rich, api_balance_moves
    from .rules import api_rule_types, api_fresh, api_clusters
    app.router.add_get("/api/rich", api_rich)
    app.router.add_get("/api/balance-moves", api_balance_moves)
    app.router.add_get("/api/rule-types", api_rule_types)
    app.router.add_get("/api/fresh", api_fresh)
    app.router.add_get("/api/clusters", api_clusters)
    from .rules import api_smart_flow
    app.router.add_get("/api/smart-flow", api_smart_flow)
    from .bridge_watch import api_bridge
    app.router.add_get("/api/bridge", api_bridge)
    app.router.add_get("/health", api_health)
    from . import social as _social
    _social.register(app)
    from . import liquidity as _liq
    _liq.register(app)
    from . import stream as _stream
    _stream.register(app)
    from . import logos as _logos
    _logos.register(app)
    _liq.register_risk(app)
    from . import referrals as _ref
    _ref.register(app)
    from . import kols as _kols
    _kols.register(app)
    from . import token_intel as _ti
    _ti.register(app)
    from . import pads_registry as _pads
    _pads.register(app)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", int(os.getenv("PORT", "8080")))
    await site.start()
    log.info("insider API on :%s", os.getenv("PORT", "8080"))
