import time
from sqlalchemy import (Column, Integer, BigInteger, String, Float, Text,
                        MetaData, Table, select, insert, update, delete)
from sqlalchemy.ext.asyncio import create_async_engine
from .config import CFG

_url = CFG.database_url
if _url.startswith("postgres://"):
    _url = _url.replace("postgres://", "postgresql+asyncpg://", 1)
elif _url.startswith("postgresql://"):
    _url = _url.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(_url, pool_pre_ping=True)
meta = MetaData()

users = Table("users", meta,
    Column("tg_id", BigInteger, primary_key=True),
    Column("active_wallet", Integer, default=0),
    Column("buy_usdc", Float, default=CFG.default_buy_usdc),
    Column("slippage", Integer, default=CFG.default_slippage),
    Column("gas_mode", String(16), default="turbo"),
    Column("created_at", BigInteger),
)

wallets = Table("wallets", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("address", String(64)),
    Column("enc_pk", Text),
    Column("label", String(64), default=""),
)

snipes = Table("snipes", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("token", String(64)),          # CA albo "" gdy snipe na 'pierwszy token z pada'
    Column("pad", String(32), default="auto"),
    Column("amount_usdc", Float),
    Column("slippage", Integer),
    Column("gas_mode", String(16)),
    Column("wallet_ids", String(256)),    # csv id portfeli (multi-wallet)
    Column("mode", String(16), default="instant"),  # instant|event|migration
    Column("status", String(16), default="armed"),  # armed|done|failed|cancelled
    Column("result", Text, default=""),
    Column("created_at", BigInteger),
)

positions = Table("positions", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("wallet", String(64)),
    Column("token", String(64)),
    Column("symbol", String(32), default="?"),
    Column("pad", String(32), default=""),
    Column("curve", Text, default=""),   # bonding-curve contract, or JSON PoolKey / {"fee": N} for V4 / V3 routes
    Column("amount_tokens", Float, default=0),
    Column("cost_usdc", Float, default=0),
    Column("realized_usdc", Float, default=0),
    Column("tp_mult", Float, default=0),   # 0 = brak TP
    Column("status", String(16), default="open"),
    Column("created_at", BigInteger),
)

trades = Table("trades", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("token", String(64)),
    Column("side", String(4)),
    Column("usdc", Float),
    Column("tokens", Float),
    Column("tx", String(80)),
    Column("ts", BigInteger),
)

alerts = Table("alerts", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("kind", String(16)),     # grad|deployer|whale|price
    Column("target", String(64)),   # token / deployer addr
    Column("param", Float, default=0),
    Column("last_fired", BigInteger, default=0),
)

copytargets = Table("copytargets", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tg_id", BigInteger, index=True),
    Column("wallet", String(64)),
    Column("amount_usdc", Float, default=0),  # 0 = proporcjonalnie? -> flat sizing usera
    Column("enabled", Integer, default=1),
)

kv = Table("kv", meta,
    Column("k", String(64), primary_key=True),
    Column("v", Text),
)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(meta.create_all)
        # migrations for existing databases (idempotent)
        from sqlalchemy import text as _t
        for stmt in (
            "ALTER TABLE positions ALTER COLUMN curve TYPE TEXT",       # V4 PoolKey JSON is ~300 chars; was VARCHAR(64)
        ):
            try:
                await conn.execute(_t(stmt))
            except Exception:  # noqa - sqlite / already applied
                pass


async def fetchone(q):
    async with engine.connect() as c:
        r = (await c.execute(q)).mappings().first()
        return dict(r) if r else None


async def fetchall(q):
    async with engine.connect() as c:
        return [dict(r) for r in (await c.execute(q)).mappings().all()]


async def execute(q):
    async with engine.begin() as c:
        return await c.execute(q)


async def get_user(tg_id: int) -> dict:
    u = await fetchone(select(users).where(users.c.tg_id == tg_id))
    if not u:
        await execute(insert(users).values(tg_id=tg_id, created_at=int(time.time())))
        u = await fetchone(select(users).where(users.c.tg_id == tg_id))
    return u


async def set_user(tg_id: int, **kw):
    await execute(update(users).where(users.c.tg_id == tg_id).values(**kw))


async def kv_get(k: str, default=""):
    r = await fetchone(select(kv).where(kv.c.k == k))
    return r["v"] if r else default


async def kv_set(k: str, v: str):
    if await fetchone(select(kv).where(kv.c.k == k)) is None:
        await execute(insert(kv).values(k=k, v=v))
    else:
        await execute(update(kv).where(kv.c.k == k).values(v=v))
