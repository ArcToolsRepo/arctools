"""Arc Insider — smart-money tracker.

Chain-wide swap ingest (every USDC pool on Arc, all venues), resumable
backfill, average-cost PnL stats per wallet, and a small HTTP API that the
arctools.fun /insiders page reads.
"""
import asyncio
import json
import logging
import time

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
BACKFILL_WINDOW = 10_000
PARALLEL_WINDOWS = 4                  # okna backfillu skanowane jednocześnie
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


async def _symbol(token: str) -> str:
    """Symbol tokena: dynamic string albo bytes32, z cache w pamieci i w bazie."""
    key = token.lower()
    if key in _sym_cache:
        return _sym_cache[key]
    row = await db.fetchone(text("SELECT symbol FROM token_symbols WHERE token = :t").bindparams(t=key))
    if row and row["symbol"]:
        _sym_cache[key] = row["symbol"]
        return row["symbol"]
    sym = ""
    for attempt in range(3):
        try:
            # wlasny relay (stabilny) — arc-scan w trakcie backfillu zwraca 429
            async with _aiohttp.ClientSession() as s:
                async with s.post(RELAY_RPC, json={
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
    await db.execute(text(
        "INSERT INTO insider_pools (pool, token, is0) VALUES (:p, :t, :i) ON CONFLICT (pool) DO NOTHING"
    ).bindparams(p=key, t=token, i=1 if is0 else 0))
    info = {"is0": is0, "token": token} if token else None
    _pool_cache[key] = info
    return info


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
    token, is0 = None, False
    if c0 in (NATIVE, USDC):
        token, is0 = c1, True
    elif c1 in (NATIVE, USDC):
        token, is0 = c0, False
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
    await db.execute(text("UPDATE v4_pools SET usdc_dec = :d WHERE id = :i").bindparams(d=usdc_dec, i=pid))
    _v4_cache[pid] = {"is0": is0, "token": token, "usdc_dec": usdc_dec} if token else None


async def _v4_pool(pid: str) -> dict | None:
    pid = pid.lower()
    if pid in _v4_cache:
        return _v4_cache[pid]
    row = await db.fetchone(text("SELECT token, is0, usdc_dec FROM v4_pools WHERE id = :i").bindparams(i=pid))
    info = ({"is0": bool(row["is0"]), "token": row["token"], "usdc_dec": int(row["usdc_dec"] or 18)}
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
    if usdc_amt < 0 and tok_amt > 0:      # zaplacil USDC, dostal token
        return {"side": "buy", "token": info["token"], "tokens": tok_amt / 1e18, "usdc": -usdc_amt / scale}
    if usdc_amt > 0 and tok_amt < 0:
        return {"side": "sell", "token": info["token"], "tokens": -tok_amt / 1e18, "usdc": usdc_amt / scale}
    return None


async def v4_bootstrap():
    """Jednorazowo: tabela, mapowanie wszystkich puli V4 z 30 dni, backfill swapow V4 (filtr po adresie)."""
    await db.execute(text("CREATE TABLE IF NOT EXISTS v4_pools (id VARCHAR(70) PRIMARY KEY, token VARCHAR(64), is0 INTEGER)"))
    for col, typ in (("currency0", "VARCHAR(64)"), ("currency1", "VARCHAR(64)"), ("fee", "INTEGER"),
                     ("tick_spacing", "INTEGER"), ("hooks", "VARCHAR(64)"), ("block", "BIGINT"), ("usdc_dec", "INTEGER")):
        await db.execute(text(f"ALTER TABLE v4_pools ADD COLUMN IF NOT EXISTS {col} {typ}"))
    _v4_cache.clear()
    asyncio.create_task(v4_keys_backfill(), name="v4-keys-backfill")
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
            _tx_senders(list({lg["transactionHash"] for lg, _ in decoded})), _window_clock(a + 1, b))
        rows = []
        for lg, dec in decoded:
            txh = _topic_hex(lg["transactionHash"])
            rows.append({"block": lg["blockNumber"], "log_index": lg["logIndex"], "price1m": dec["usdc"] / dec["tokens"] * 1e6,
                         "side": dec["side"], "token": dec["token"], "tokens": dec["tokens"],
                         "ts": int(t0 + (lg["blockNumber"] - (a + 1)) * slope), "tx": txh, "usdc": dec["usdc"],
                         "venue": "v4", "wallet": senders.get(txh, "")})
        await db.execute_many(ins, rows)
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
        return await _total_supply_fetch(token)


async def _total_supply_fetch(token: str) -> float | None:
    try:
        async with _aiohttp.ClientSession() as s:
            async with s.post(RELAY_RPC, json={"id": 1, "jsonrpc": "2.0", "method": "eth_call",
                                              "params": [{"data": "0x18160ddd", "to": token}, "latest"]},
                              timeout=_aiohttp.ClientTimeout(total=8)) as r:
                res = (await r.json()).get("result")
        sup = int(res, 16) / 1e18 if res and res != "0x" else None
        _supply_cache[token] = (sup, time.time())
        return sup
    except Exception:  # noqa
        return None


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


async def backfill_pool(pool: str, blocks: int = BACKFILL_BLOCKS) -> int:
    """Historia swapow JEDNEJ puli (filtr po adresie) — odzyskanie wolumenu pominietej puli."""
    head = await CHAIN._bn()
    frm = max(0, head - blocks)
    ins = text(
        "INSERT INTO swaps (tx, log_index, block, ts, wallet, token, side, usdc, tokens, price1m, venue) "
        "VALUES (:tx, :log_index, :block, :ts, :wallet, :token, :side, :usdc, :tokens, :price1m, :venue) "
        "ON CONFLICT (tx, log_index) DO NOTHING")
    total = 0
    for a in range(frm, head, 10_000):          # arc-scan: max 10k blokow na getLogs
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
            _tx_senders(list({lg["transactionHash"] for _, lg, _ in decoded})), _window_clock(a + 1, b))
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
            # kazda pula USDC, ktorej zaden swap nie trafil do indeksu = kandydat (ofiara 429 albo swieza)
            await db.execute(text("""
                INSERT INTO pool_backfill (pool, done)
                SELECT p.pool, 0 FROM insider_pools p
                WHERE p.token IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM swaps s WHERE s.token = p.token LIMIT 1)
                ON CONFLICT (pool) DO NOTHING"""))
            rows = await db.fetchall(text("""
                SELECT b.pool, p.token FROM pool_backfill b JOIN insider_pools p ON p.pool = b.pool
                WHERE b.done = 0
                ORDER BY CASE WHEN p.token = :arct THEN 0 ELSE 1 END, b.pool""").bindparams(
                arct="0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52"))
            if rows:
                log.info("insider repair: %s pools queued for backfill", len(rows))
            sem = asyncio.Semaphore(3)

            async def one(pool, token):
                async with sem:
                    if pool not in _pool_cache:
                        await _resolve_pool(pool)
                    n = await backfill_pool(pool)
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

async def _tx_senders(hashes: list) -> dict[str, str]:
    """Rownolegle pobranie tx.from dla unikalnych transakcji."""
    out: dict[str, str] = {}
    sem = asyncio.Semaphore(12)

    async def one(h):
        key = h.hex() if hasattr(h, "hex") else str(h)
        key = key if key.startswith("0x") else "0x" + key
        async with sem:
            try:
                t = await CHAIN.get_tx(h)
                out[key] = (t["from"] or "").lower()
            except Exception:  # noqa
                out[key] = ""

    await asyncio.gather(*[one(h) for h in hashes])
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


async def _scan_window(frm: int, to: int) -> list[dict] | None:
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

    senders, clock = await asyncio.gather(
        _tx_senders(list({lg["transactionHash"] for _, lg, _ in decoded})),
        _window_clock(frm, to))
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
    while True:
        try:
            head = await CHAIN._bn()
            if cursor >= head:
                await db.kv_set("insider_synced", "1")
                await asyncio.sleep(CFG.poll_interval)
                continue
            backfilling = head - cursor > LIVE_WINDOW * 2

            if backfilling:
                # kilka okien naraz — kursor idzie tylko po spojnym prefiksie sukcesow
                spans = []
                c = cursor
                for _ in range(PARALLEL_WINDOWS):
                    if c >= head:
                        break
                    frm, to = c + 1, min(head, c + BACKFILL_WINDOW)
                    spans.append((frm, to))
                    c = to
                scans = await asyncio.gather(*[_scan_window(f, t) for f, t in spans])
                rows, advanced = [], cursor
                for (frm, to), res in zip(spans, scans):
                    if res is None:
                        break                     # dalsze okna powtorzymy w nastepnej iteracji
                    rows.extend(res)
                    advanced = to
                await db.execute_many(ins, rows)
                if advanced > cursor:
                    cursor = advanced
                    await db.kv_set("insider_cursor", str(cursor))
                    log.info("insider backfill -> %s: +%s swaps (%s okien, do head %s blokow)",
                             cursor, len(rows), len(spans), head - cursor)
                else:
                    await asyncio.sleep(3)
                await asyncio.sleep(0.1)
            else:
                frm, to = cursor + 1, min(head, cursor + LIVE_WINDOW)
                res = await _scan_window(frm, to)
                if res is None:
                    await asyncio.sleep(3)
                    continue
                await db.execute_many(ins, res)
                cursor = to
                await db.kv_set("insider_cursor", str(cursor))
                await asyncio.sleep(CFG.poll_interval)
        except Exception as e:  # noqa
            log.warning("insider ingest: %s", e)
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


async def api_wallet(request: web.Request) -> web.Response:
    w = request.match_info["wallet"].lower()
    if not (w.startswith("0x") and len(w) == 42):
        return web.json_response({"error": "bad wallet"}, status=400, headers=API_CORS)
    stats = await db.fetchall(text("SELECT * FROM wallet_stats WHERE wallet = :w").bindparams(w=w))
    trades = await db.fetchall(text(
        "SELECT tx, ts, token, side, usdc, tokens, price1m, venue FROM swaps "
        "WHERE wallet = :w ORDER BY ts DESC LIMIT 25").bindparams(w=w))
    return web.json_response({
        "stats": [dict(s) for s in stats],
        "trades": [dict(t) for t in trades],
        "wallet": w,
    }, headers=API_CORS)


async def api_health(_):
    n = await db.fetchone(text("SELECT COUNT(*) AS n FROM swaps"))
    p = await db.fetchone(text("SELECT COUNT(*) AS all_, COUNT(token) AS usdc FROM insider_pools"))
    cur = await db.kv_get("insider_cursor")
    return web.json_response({"ok": True, "swaps": n["n"], "pools": p["all_"], "usdc_pools": p["usdc"],
                              "null_pools": p["all_"] - p["usdc"], "cursor": cur}, headers=API_CORS)


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
        WITH b AS (
            SELECT (ts / :step) * :step AS bucket, ts, log_index, price1m, usdc, side
            FROM swaps WHERE token = :t AND usdc >= :dust AND price1m > 0
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
    app.router.add_get("/api/insiders", api_board)
    app.router.add_get("/api/insider/{wallet}", api_wallet)
    app.router.add_get("/api/ohlc", api_ohlc)
    app.router.add_get("/api/trades", api_trades)
    app.router.add_get("/api/token-stats", api_token_stats)
    app.router.add_get("/api/v4pool", api_v4pool)
    app.router.add_get("/api/v4launches", api_v4launches)
    from .watchlist import api_whales, api_movers, api_insider_activity, api_wallet_watch_count, api_positions
    app.router.add_get("/api/positions", api_positions)
    from .watchlist import api_wallet_trades
    app.router.add_get("/api/wallet-trades", api_wallet_trades)
    from .watchlist import api_trending
    app.router.add_get("/api/trending", api_trending)
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
    from .bridge_watch import api_bridge
    app.router.add_get("/api/bridge", api_bridge)
    app.router.add_get("/health", api_health)
    from . import social as _social
    _social.register(app)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", int(os.getenv("PORT", "8080")))
    await site.start()
    log.info("insider API on :%s", os.getenv("PORT", "8080"))
