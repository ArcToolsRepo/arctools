"""Database maintenance: keep the 5 GB volume from filling up.

Why this exists: `swaps` grew to 2.5 GB / 4 M rows (38 days) on a 5 GB volume. Postgres then had no room for the
temp files a whole-table sort needs, so heavy endpoints started answering 500 (DiskFullError) and the Terminal lost
its numbers. Raw swaps older than the retention window are not read by any window the site offers (≤ 24 h); the only
thing that needs the full history is the per-token lifetime summary, so that is snapshotted into `token_life` first.

Admin endpoints (?key=INGEST_KEY):
  /api/db-maint?action=life                       — rebuild token_life from the full swaps history
  /api/db-maint?action=prune&days=21[&table=]     — delete rows older than N days, in batches, reporting progress
  /api/db-maint?action=vacuum&table=&full=1       — return the freed pages to the filesystem
  /api/db-maint?action=plan                       — sizes + what each step would free
"""
import logging
import os
import time

from sqlalchemy import text

from . import db

log = logging.getLogger("dbmaint")
PRUNABLE = {
    # table: (timestamp column, why it is safe to drop old rows)
    "swaps": ("ts", "lifetime stats live in token_life; every UI window is <= 24 h"),
    "kol_following": ("ts", "social graph, rebuilt by the KOL loop"),
    "balance_hist": ("ts", "history chart, only recent points are drawn"),
    "insider_alerted": ("ts", "dedupe log for alerts already sent"),
    "buys": ("ts", "alert dedupe log"),
}


async def ensure_tables():
    await db.execute(text("""CREATE TABLE IF NOT EXISTS token_life (
        token VARCHAR(64) PRIMARY KEY, first_ts BIGINT, last_ts BIGINT, txs_all BIGINT, vol_all DOUBLE PRECISION,
        ath DOUBLE PRECISION, first_price DOUBLE PRECISION, updated BIGINT)"""))


async def build_life() -> dict:
    """One aggregate over the whole swaps table into token_life (a few MB). Run before pruning, and nightly after."""
    await ensure_tables()
    t0 = time.time()
    rows = await db.fetchall_heavy(text("""
        SELECT token, MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*) AS txs_all, SUM(usdc) AS vol_all,
               MAX(CASE WHEN usdc >= 0.5 THEN price1m END) AS ath
        FROM swaps WHERE usdc >= 0.2 GROUP BY token"""))
    firsts = {}
    for r in await db.fetchall_heavy(text("""SELECT DISTINCT ON (token) token, price1m FROM swaps
            WHERE price1m > 0 AND usdc >= 1 ORDER BY token, ts ASC, log_index ASC""")):
        firsts[r["token"]] = float(r["price1m"])
    now = int(time.time())
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        vals = ", ".join(f"(:t{j}, :f{j}, :l{j}, :x{j}, :v{j}, :a{j}, :p{j}, :n)" for j in range(len(chunk)))
        par = {"n": now}
        for j, r in enumerate(chunk):
            par[f"t{j}"], par[f"f{j}"], par[f"l{j}"] = r["token"], r["first_ts"], r["last_ts"]
            par[f"x{j}"], par[f"v{j}"], par[f"a{j}"] = r["txs_all"], r["vol_all"], r["ath"]
            par[f"p{j}"] = firsts.get(r["token"])
        await db.execute(text(f"""INSERT INTO token_life (token, first_ts, last_ts, txs_all, vol_all, ath, first_price, updated)
            VALUES {vals} ON CONFLICT (token) DO UPDATE SET
              first_ts = LEAST(token_life.first_ts, EXCLUDED.first_ts),
              last_ts = GREATEST(token_life.last_ts, EXCLUDED.last_ts),
              txs_all = GREATEST(token_life.txs_all, EXCLUDED.txs_all),
              vol_all = GREATEST(token_life.vol_all, EXCLUDED.vol_all),
              ath = GREATEST(COALESCE(token_life.ath, 0), COALESCE(EXCLUDED.ath, 0)),
              first_price = COALESCE(token_life.first_price, EXCLUDED.first_price),
              updated = EXCLUDED.updated""").bindparams(**par))
    return {"tokens": len(rows), "seconds": round(time.time() - t0, 1)}


async def prune(table: str, days: int, batches: int, batch_rows: int = 100_000) -> dict:
    col, _ = PRUNABLE[table]
    cut = int(time.time()) - days * 86400
    deleted = 0
    for _ in range(batches):
        async with db.engine.begin() as c:
            r = await c.execute(text(f"DELETE FROM {table} WHERE ctid IN "
                                     f"(SELECT ctid FROM {table} WHERE {col} < :c LIMIT :n)").bindparams(c=cut, n=batch_rows))
        n = r.rowcount or 0
        deleted += n
        if n < batch_rows:
            break
    left = await db.fetchone(text(f"SELECT COUNT(*) AS n FROM {table} WHERE {col} < :c").bindparams(c=cut))
    return {"table": table, "older_than_days": days, "deleted": deleted, "still_older": int(left["n"])}


async def vacuum(table: str, full: bool) -> dict:
    sql = f"VACUUM ({'FULL, ' if full else ''}ANALYZE) {table}"   # VACUUM FULL (ANALYZE) is a syntax error
    t0 = time.time()
    async with db.engine.connect() as c:
        c2 = await c.execution_options(isolation_level="AUTOCOMMIT")
        await c2.exec_driver_sql(sql)
    return {"ran": sql, "seconds": round(time.time() - t0, 1)}


async def sizes() -> list[dict]:
    rows = await db.fetchall(text("SELECT relname AS t, pg_total_relation_size(relid) AS bytes, n_live_tup AS live "
                                  "FROM pg_stat_user_tables ORDER BY 2 DESC LIMIT 20"))
    return [{"t": r["t"], "mb": round(int(r["bytes"]) / 1e6, 1), "rows": int(r["live"] or 0)} for r in rows]


async def api(req):
    from aiohttp import web
    if req.query.get("key") != os.getenv("INGEST_KEY", ""):
        return web.json_response({"error": "forbidden"}, status=403)
    action = req.query.get("action") or "plan"
    try:
        if action == "plan":
            db_mb = await db.fetchone(text("SELECT pg_database_size(current_database()) AS v"))
            sw = await db.fetchone(text("SELECT MIN(ts) mn, MAX(ts) mx, COUNT(*) n FROM swaps"))
            life = await db.fetchone(text("SELECT COUNT(*) AS n FROM token_life")) if await _has_life() else None
            return web.json_response({"db_mb": round(int(db_mb["v"]) / 1e6), "tables": await sizes(),
                                      "swaps": {"rows": int(sw["n"]), "days": round((int(sw["mx"]) - int(sw["mn"])) / 86400, 1)},
                                      "token_life_rows": int(life["n"]) if life else 0, "prunable": list(PRUNABLE)})
        if action == "guard":
            return web.json_response(await guard())
        if action == "life":
            return web.json_response(await build_life())
        if action == "prune":
            table = req.query.get("table", "swaps")
            if table not in PRUNABLE:
                return web.json_response({"error": f"not prunable: {table}"}, status=400)
            return web.json_response(await prune(table, max(3, min(180, int(req.query.get("days", "21")))),
                                                 max(1, min(60, int(req.query.get("batches", "10"))))))
        if action == "resupply":
            # supply now excludes 0xdead/0x0 balances: drop stored supplies for tokens that traded recently so the
            # repair loop (and the next trending frame) refetches them with the new rule. ?hours=24 (default)
            hours = int(req.query.get("hours") or 24)
            r = await db.execute(text("DELETE FROM token_supply WHERE token IN (SELECT DISTINCT token FROM swaps WHERE ts > :s)").bindparams(s=int(time.time()) - hours * 3600))
            from . import insider as _ins
            _ins._supply_cache.clear()
            n = getattr(r, "rowcount", None)
            return web.json_response({"ok": True, "cleared": n, "hours": hours})
        if action == "export-pools":
            # every token we know with every pool we have seen for it: V3 (insider_pools), V4 (v4_pools), plus the
            # pad/venue routing from social_tokens/token_symbols. One CSV; the owner slices it himself.
            rows = await db.fetchall(text("""
                SELECT p.token, COALESCE(s.symbol,'') AS symbol, 'v3' AS kind, p.pool AS pool, NULL AS hooks, NULL AS fee, p.is0
                FROM insider_pools p LEFT JOIN token_symbols s ON s.token = p.token
                UNION ALL
                SELECT v.token, COALESCE(s.symbol,''), 'v4', v.id, v.hooks, v.fee, v.is0
                FROM v4_pools v LEFT JOIN token_symbols s ON s.token = v.token
                UNION ALL
                SELECT t.token, COALESCE(t.symbol,''), 'nopool', NULL, NULL, NULL, NULL
                FROM token_symbols t WHERE t.token NOT IN (SELECT token FROM insider_pools) AND t.token NOT IN (SELECT token FROM v4_pools)
                ORDER BY 1, 3"""))
            import io, csv
            buf = io.StringIO(); w = csv.writer(buf); w.writerow(["token", "symbol", "kind", "pool", "hooks", "fee", "usdc_is0"])
            for r in rows: w.writerow([r["token"], r["symbol"], r["kind"], r["pool"] or "", r["hooks"] or "", r["fee"] if r["fee"] is not None else "", r["is0"] if r["is0"] is not None else ""])
            return web.Response(text=buf.getvalue(), content_type="text/csv", headers={"Content-Disposition": "attachment; filename=arc-tokens-pools.csv"})
        if action == "token-age":
            t = (req.query.get("token") or "").lower()
            r = await db.fetchone(text("SELECT MIN(ts) AS mn, MAX(ts) AS mx, COUNT(*) AS n, COUNT(*) FILTER (WHERE price1m > 0 AND usdc >= 0.5) AS priced, MIN(ts) FILTER (WHERE price1m > 0 AND usdc >= 0.5) AS mn_priced FROM swaps WHERE token = :t").bindparams(t=t))
            return web.json_response({k: (int(v) if v is not None else None) for k, v in dict(r).items()} | {"now": int(time.time())})
        if action == "buys-top":
            rows = await db.fetchall(text("SELECT token, symbol, usdc, ts, tx FROM buys WHERE ts > :t ORDER BY usdc DESC LIMIT 12").bindparams(t=int(time.time()) - 86400))
            return web.json_response({"rows": [dict(r) for r in rows]})
        if action == "fix-buys":
            # The V4 alert decoder had its sides swapped until today, so `buys.usdc` held TOKEN amounts for every
            # USDC-first pool (BARC: 3,593,502 "USDC" for a 210 USDC buy). The indexer decodes the same swaps
            # correctly, so it is the reference: for each buy in the window, take the indexer's usdc for the same
            # tx; a buy the indexer never saw is dropped. Then force the board to repost + re-pin.
            t0 = int(time.time()) - 86400
            fixed = await db.execute(text("""
                UPDATE buys b SET usdc = s.u
                  FROM (SELECT tx, SUM(usdc) AS u FROM swaps WHERE ts > :t AND side = 'buy' GROUP BY tx) s
                 WHERE b.tx = s.tx AND b.ts > :t AND (b.usdc > s.u * 3 OR b.usdc * 3 < s.u)
            """).bindparams(t=t0))
            gone = await db.execute(text("""
                DELETE FROM buys b WHERE b.ts > :t AND NOT EXISTS (SELECT 1 FROM swaps s WHERE s.tx = b.tx)
            """).bindparams(t=t0))
            await db.kv_set("trend_pin_ts", "0")
            top = await db.fetchall(text("SELECT symbol, usdc FROM buys WHERE ts > :t ORDER BY usdc DESC LIMIT 5").bindparams(t=t0))
            return web.json_response({"corrected": getattr(fixed, "rowcount", None), "deleted_unknown": getattr(gone, "rowcount", None),
                                      "top_now": [{"symbol": r["symbol"], "usdc": round(float(r["usdc"]), 2)} for r in top], "board": "repost forced"})
        if action == "wallets":
            # the numbers marketing keeps asking for: distinct wallets we saw trade, and how many the insider
            # index ranks — from the data, not from a guess
            now = int(time.time())
            r = await db.fetchone(text("""
                SELECT COUNT(DISTINCT wallet) FILTER (WHERE ts > :d1) AS w24,
                       COUNT(DISTINCT wallet) FILTER (WHERE ts > :d7) AS w7,
                       COUNT(*) FILTER (WHERE ts > :d1) AS s24,
                       COUNT(DISTINCT token) FILTER (WHERE ts > :d1) AS t24
                  FROM swaps
            """).bindparams(d1=now - 86400, d7=now - 7 * 86400))
            ins = await db.fetchone(text("SELECT COUNT(*) AS n FROM insider_scores")) if await _has_table("insider_scores") else {"n": None}
            return web.json_response({"wallets_24h": int(r["w24"] or 0), "wallets_7d": int(r["w7"] or 0),
                                      "swaps_24h": int(r["s24"] or 0), "tokens_traded_24h": int(r["t24"] or 0),
                                      "insiders_ranked": (int(ins["n"]) if ins and ins.get("n") is not None else None)})
        if action == "truncate":
            table = req.query.get("table", "")
            if table not in PRUNABLE and table not in ("wallet_balance", "kol_following"):
                return web.json_response({"error": "table not allowed"}, status=400)
            return web.json_response(await truncate_empty(table))
        if action == "vacuum":
            table = req.query.get("table", "swaps")
            if table not in PRUNABLE and table not in ("v4_pools", "social_tokens", "token_symbols", "risk_cache", "wallet_balance"):
                return web.json_response({"error": "table not allowed"}, status=400)
            return web.json_response(await vacuum(table, bool(req.query.get("full"))))
    except Exception as e:  # noqa
        return web.json_response({"error": repr(e)[:400]}, status=500)
    return web.json_response({"error": "unknown action"}, status=400)



async def truncate_empty(table: str) -> dict:
    """Give the disk back for a table whose live rows are already gone.

    VACUUM FULL rewrites the table, so it needs room for a second copy — exactly what a full volume cannot
    give (it answered DiskFullError). TRUNCATE drops the file instead and needs no headroom at all, so it is
    the only move left once the disk is full. Guarded: it refuses to run if the table still holds live rows.
    """
    live = await db.fetchone(text("""
        SELECT COALESCE(n_live_tup, 0) AS n FROM pg_stat_user_tables WHERE relname = :t
    """).bindparams(t=table))
    n = int((live or {}).get("n") or 0)
    if n > 0:
        real = await db.fetchone(text(f"SELECT COUNT(*) AS n FROM {table}"))   # noqa: S608 - name is allow-listed
        n = int(real["n"])
    if n > 0:
        return {"table": table, "refused": "table still holds rows", "rows": n}
    before = await db.fetchone(text("SELECT pg_total_relation_size(:t) AS v").bindparams(t=table))
    await db.execute(text(f"TRUNCATE TABLE {table}"))                          # noqa: S608 - name is allow-listed
    after = await db.fetchone(text("SELECT pg_total_relation_size(:t) AS v").bindparams(t=table))
    return {"table": table, "freed_mb": round((int(before["v"]) - int(after["v"])) / 1e6, 1)}

async def _has_table(name: str) -> bool:
    try:
        r = await db.fetchone(text("SELECT 1 FROM information_schema.tables WHERE table_name = :t").bindparams(t=name))
        return bool(r)
    except Exception:  # noqa
        return False


async def _has_life() -> bool:
    try:
        await db.fetchone(text("SELECT 1 FROM token_life LIMIT 1"))
        return True
    except Exception:  # noqa
        return False


def register(app):
    app.router.add_get("/api/db-maint", api)


VOLUME_MB = int(os.getenv("PG_VOLUME_MB", "5000"))


async def guard() -> dict:
    """Disk guard: when the volume is nearly full, drop the oldest raw swaps (lifetime stats already live in
    token_life) so heavy queries keep their temp space instead of failing with DiskFullError."""
    r = await db.fetchone(text("SELECT pg_database_size(current_database()) AS v"))
    used_mb = int(r["v"]) / 1e6
    pct = used_mb / max(1, VOLUME_MB) * 100
    out = {"db_mb": round(used_mb), "volume_mb": VOLUME_MB, "pct": round(pct, 1)}
    if pct < 78:
        return out
    await build_life()                       # never prune history that has not been summarised yet
    for days in (30, 21, 14, 10, 7):
        out[f"prune_{days}d"] = await prune("swaps", days, batches=20)
        r = await db.fetchone(text("SELECT pg_database_size(current_database()) AS v"))
        if int(r["v"]) / 1e6 / max(1, VOLUME_MB) * 100 < 70:
            break
    out["after_mb"] = round(int((await db.fetchone(text("SELECT pg_database_size(current_database()) AS v")))["v"]) / 1e6)
    return out


async def guard_loop():
    import asyncio
    await asyncio.sleep(600)
    while True:
        try:
            r = await guard()
            if r.get("after_mb"):
                log.warning("db guard pruned: %s", r)
        except Exception as e:  # noqa
            log.warning("db guard: %s", str(e)[:160])
        await asyncio.sleep(1800)


async def life_loop():
    """Lifetime stats are the only thing that needs history older than the retention window: refresh them every 6 h
    (and always before a prune) so pruning raw swaps never changes what the Terminal shows as ALL VOL / ALL TXS / ATH."""
    import asyncio
    await asyncio.sleep(300)
    while True:
        try:
            r = await build_life()
            log.info("token_life: %s tokens in %ss", r["tokens"], r["seconds"])
        except Exception as e:  # noqa
            log.warning("token_life: %s", str(e)[:160])
        await asyncio.sleep(6 * 3600)
