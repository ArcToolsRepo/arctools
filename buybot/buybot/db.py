import time
from sqlalchemy import (text, Column, Integer, BigInteger, String, Float, Text,
                        MetaData, Table, select, insert, update, delete)
from sqlalchemy.ext.asyncio import create_async_engine
from .config import CFG

_url = CFG.database_url
if _url.startswith("postgres://"):
    _url = _url.replace("postgres://", "postgresql+asyncpg://", 1)
elif _url.startswith("postgresql://"):
    _url = _url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Connections leaked by cancelled coroutines (asyncio.wait_for timeouts mid-query) sat "idle in transaction" and
# exhausted the pool → Postgres now kills such sessions after 60 s and caps any statement at 90 s; pre_ping replaces them.
engine = create_async_engine(_url, pool_pre_ping=True, pool_size=20, max_overflow=20, pool_timeout=20, pool_recycle=1800,
                             connect_args={"server_settings": {"idle_in_transaction_session_timeout": "60000", "statement_timeout": "90000"}})
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


# The swap ingest gets its own small pool: API bursts / background hunters can exhaust the shared pool (QueuePool
# timeout) and every such exception froze the cursor. Writes of the live index never queue behind anything else.
engine_ingest = create_async_engine(_url, pool_pre_ping=True, pool_size=4, max_overflow=4, pool_timeout=30, pool_recycle=1800,
                                    connect_args={"server_settings": {"idle_in_transaction_session_timeout": "120000", "statement_timeout": "180000"}})


async def execute_many_ingest(q, rows: list[dict]):
    if not rows:
        return
    async with engine_ingest.begin() as c:
        return await c.execute(q, rows)


async def execute_ingest(q):
    async with engine_ingest.begin() as c:
        return await c.execute(q)


async def kv_get(k: str, default=""):
    r = await fetchone(select(kv).where(kv.c.k == k))
    return r["v"] if r else default


async def kv_set(k: str, v: str):
    if await fetchone(select(kv).where(kv.c.k == k)) is None:
        await execute(insert(kv).values(k=k, v=v))
    else:
        await execute(update(kv).where(kv.c.k == k).values(v=v))


import asyncio as _asyncio
_heavy_sem = _asyncio.Semaphore(2)      # at most 3 whole-table aggregates at once — the rest wait instead of thrashing the disk


async def fetchall_heavy(q):
    """Window/aggregate queries over the whole swaps table: give the sort/hash 64 MB instead of the server default
    (4 MB on the Railway plan → sorts spilled to disk, 1-20 s). SET LOCAL lives only inside this transaction."""
    async with _heavy_sem:
        async with engine.begin() as c:
            await c.execute(text("SET LOCAL work_mem = '64MB'"))
            return [dict(r) for r in (await c.execute(q)).mappings().all()]
