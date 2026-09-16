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

engine = create_async_engine(_url, pool_pre_ping=True, pool_size=20, max_overflow=20, pool_timeout=20)
meta = MetaData()

tracks = Table("tracks", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("chat_id", BigInteger, index=True),
    Column("token", String(64), index=True),
    Column("symbol", String(48), default="?"),
    Column("venues", Text, default="[]"),     # json [{address,kind,venue}]
    Column("min_buy", Float, default=1.0),    # USDC
    Column("emoji", String(64), default="🟢"),
    Column("emoji_step", Float, default=10.0),  # USDC per emoji
    Column("media_type", String(16), default=""),   # photo|animation|video
    Column("media_id", Text, default=""),            # telegram file_id
    Column("website", Text, default=""),
    Column("twitter", Text, default=""),
    Column("telegram", Text, default=""),
    Column("show_mc", Integer, default=1),
    Column("show_buyer", Integer, default=1),
    Column("added_by", BigInteger, default=0),
    Column("created_at", BigInteger),
)

buys = Table("buys", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("token", String(64), index=True),
    Column("symbol", String(48), default="?"),
    Column("usdc", Float),
    Column("tx", String(80)),
    Column("ts", BigInteger, index=True),
)

boosts = Table("boosts", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("token", String(64), index=True),
    Column("symbol", String(48), default="?"),
    Column("until_ts", BigInteger),
    Column("paid_usdc", Float),
)

payments = Table("payments", meta,
    Column("tx", String(80), primary_key=True),
    Column("chat_id", BigInteger),
    Column("amount", Float),
    Column("ts", BigInteger),
)

kv = Table("kv", meta,
    Column("k", String(64), primary_key=True),
    Column("v", Text),
)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(meta.create_all)
    # additive migrations for pre-existing tables
    from sqlalchemy import text as _t
    adds = [
        "ALTER TABLE tracks ADD COLUMN emoji_step FLOAT DEFAULT 10",
        "ALTER TABLE tracks ADD COLUMN media_type VARCHAR(16) DEFAULT ''",
        "ALTER TABLE tracks ADD COLUMN media_id TEXT DEFAULT ''",
        "ALTER TABLE tracks ADD COLUMN website TEXT DEFAULT ''",
        "ALTER TABLE tracks ADD COLUMN twitter TEXT DEFAULT ''",
        "ALTER TABLE tracks ADD COLUMN telegram TEXT DEFAULT ''",
        "ALTER TABLE tracks ADD COLUMN show_mc INTEGER DEFAULT 1",
        "ALTER TABLE tracks ADD COLUMN show_buyer INTEGER DEFAULT 1",
    ]
    for stmt in adds:
        try:
            async with engine.begin() as conn:
                await conn.execute(_t(stmt))
        except Exception:  # noqa - column already exists
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


async def execute_many(q, rows: list[dict]):
    """Jedna transakcja na partie wierszy (executemany) — krytyczne dla ingestu."""
    if not rows:
        return
    async with engine.begin() as c:
        return await c.execute(q, rows)


async def kv_get(k: str, default=""):
    r = await fetchone(select(kv).where(kv.c.k == k))
    return r["v"] if r else default


async def kv_set(k: str, v: str):
    if await fetchone(select(kv).where(kv.c.k == k)) is None:
        await execute(insert(kv).values(k=k, v=v))
    else:
        await execute(update(kv).where(kv.c.k == k).values(v=v))
