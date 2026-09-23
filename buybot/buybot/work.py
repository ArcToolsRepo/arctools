"""ArcWork — services marketplace with USDC escrow (contracts/ArcWork.sol). This module is the read layer + metadata store:

  GET  /api/work/gigs?category=&seller=&active=1     gigs from the chain (15 s cache) merged with their off-chain metadata
  GET  /api/work/gig?id=                             one gig + its seller's stats + reviews
  GET  /api/work/orders?wallet=0x…                   orders where the wallet is buyer or seller (chain, live)
  GET  /api/work/order?id=                           one order
  POST /api/work/meta   {gigId, title, description, samples[], contact, tags[], sig}   seller-signed (EIP-191) metadata
  GET  /api/work/stats                               volume, completed, disputes, sellers
  loop: watches OrderPaid / OrderDisputed / OrderDelivered events → Telegram to the admin (arbiter) and to sellers who set a tg handle

The chain is the source of truth for money and state; Postgres only holds text (titles, descriptions, reviews text) and the event log.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

import aiohttp
from aiohttp import web
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import text
from web3 import Web3

from . import db

log = logging.getLogger("work")
BOT_PUBLIC = "https://bot-production-4200.up.railway.app"
NODE_RPC = os.getenv("PRIMARY_RPC", "http://178.156.197.90:8545")
HERE = os.path.dirname(__file__)
DEPLOY = json.load(open(os.path.join(HERE, "..", "ArcWork.deploy.json"))) if os.path.exists(os.path.join(HERE, "..", "ArcWork.deploy.json")) else {}
ABI = json.load(open(os.path.join(HERE, "..", "ArcWork.abi.json"))) if os.path.exists(os.path.join(HERE, "..", "ArcWork.abi.json")) else []
ADDR = DEPLOY.get("address")
CATEGORIES = ["Logo & banner", "Website / landing", "Telegram / Discord setup", "KOL post / thread", "Contract review", "Other"]
STATUS = ["none", "paid", "delivered", "completed", "refunded", "disputed", "resolved"]
ADMIN_TG = os.getenv("ADMIN_TG_ID", "8351095206")
bot = None   # aiogram Bot, set by main

_w3 = Web3(Web3.HTTPProvider(NODE_RPC, request_kwargs={"timeout": 20}))
_c = _w3.eth.contract(address=Web3.to_checksum_address(ADDR), abi=ABI) if ADDR and ABI else None
_cache: dict = {"gigs": (0, []), "meta": (0, {})}
_state: dict = {"last_block": 0, "notified": 0, "last_error": None}

GIG_FIELDS = ("seller", "category", "price", "deliveryDays", "active", "uri", "sold", "disputed", "ratingSum", "ratingCount")
ORDER_FIELDS = ("gigId", "buyer", "seller", "amount", "paidAt", "deadline", "deliveredAt", "status", "buyerBps", "brief", "delivery", "stars")


async def init() -> None:
    await db.execute(text("""CREATE TABLE IF NOT EXISTS work_meta (gig_id BIGINT PRIMARY KEY, seller VARCHAR(50), title VARCHAR(120), description TEXT, samples JSONB, contact VARCHAR(120),
        tags JSONB, tg VARCHAR(64), updated BIGINT)"""))
    try: await db.execute(text("ALTER TABLE work_meta ADD COLUMN IF NOT EXISTS image TEXT"))
    except Exception: pass
    await db.execute(text("CREATE TABLE IF NOT EXISTS work_events (tx VARCHAR(80), log_index INT, block BIGINT, ts BIGINT, name VARCHAR(24), order_id BIGINT, gig_id BIGINT, actor VARCHAR(50), data JSONB, PRIMARY KEY (tx, log_index))"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS work_events_order ON work_events (order_id, block)"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS work_reviews (order_id BIGINT PRIMARY KEY, gig_id BIGINT, buyer VARCHAR(50), stars SMALLINT, text_ TEXT, ts BIGINT)"))
    await db.execute(text("CREATE TABLE IF NOT EXISTS work_cursor (k VARCHAR(8) PRIMARY KEY, block BIGINT)"))
    r = await db.fetchone(text("SELECT block FROM work_cursor WHERE k = 'evt'"))
    _state["last_block"] = int(r["block"]) if r else int(DEPLOY.get("block", 0))


# ───────────────────────── chain reads ─────────────────────────
def _gig(row, gid: int) -> dict:
    g = dict(zip(GIG_FIELDS, row)); g["id"] = gid; g["price"] = str(g["price"]); g["seller"] = g["seller"].lower()
    g["rating"] = round(g["ratingSum"] / g["ratingCount"], 2) if g["ratingCount"] else None
    g["categoryLabel"] = CATEGORIES[g["category"]] if g["category"] < len(CATEGORIES) else "Other"
    return g

def _order(row, oid: int) -> dict:
    o = dict(zip(ORDER_FIELDS, row)); o["id"] = oid; o["amount"] = str(o["amount"]); o["buyer"] = o["buyer"].lower(); o["seller"] = o["seller"].lower()
    o["statusLabel"] = STATUS[o["status"]] if o["status"] < len(STATUS) else "?"
    return o

async def all_gigs(force=False) -> list[dict]:
    ts, cached = _cache["gigs"]
    if not force and time.time() - ts < 15 and cached:
        return cached
    def read():
        n = _c.functions.gigsCount().call(); out = []
        for frm in range(0, n, 200):
            rows = _c.functions.getGigs(frm, min(200, n - frm)).call()
            out += [_gig(r, frm + i) for i, r in enumerate(rows)]
        return out
    gigs = await asyncio.get_event_loop().run_in_executor(None, read)
    _cache["gigs"] = (time.time(), gigs)
    return gigs

async def all_meta() -> dict[int, dict]:
    ts, cached = _cache["meta"]
    if time.time() - ts < 15 and cached:
        return cached
    rows = await db.fetchall(text("SELECT gig_id, seller, title, description, samples, contact, tags, tg, updated, (image IS NOT NULL AND image <> '') has_image FROM work_meta"))
    m = {int(r["gig_id"]): {"title": r["title"], "description": r["description"], "samples": r["samples"] or [], "contact": r["contact"], "tags": r["tags"] or [], "tg": r["tg"], "updated": int(r["updated"] or 0), "image": f"{BOT_PUBLIC}/api/work/img/{int(r['gig_id'])}.png?v={int(r['updated'] or 0)}" if r["has_image"] else None} for r in rows}
    _cache["meta"] = (time.time(), m)
    return m

async def orders_of(wallet: str) -> list[dict]:
    w = Web3.to_checksum_address(wallet)
    def read():
        ids = sorted(set(_c.functions.getOrdersOfBuyer(w).call()) | set(_c.functions.getOrdersOfSeller(w).call()))
        if not ids: return []
        rows = _c.functions.getOrders(ids).call()
        return [_order(r, i) for i, r in zip(ids, rows)]
    return await asyncio.get_event_loop().run_in_executor(None, read)

async def one_order(oid: int) -> dict:
    row = await asyncio.get_event_loop().run_in_executor(None, lambda: _c.functions.orders(oid).call())
    return _order(row, oid)


# ───────────────────────── HTTP ─────────────────────────
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type"}

async def api_gigs(req: web.Request) -> web.Response:
    if not _c: return web.json_response({"error": "ArcWork not configured"}, status=503, headers=CORS)
    gigs, meta = await all_gigs(), await all_meta()
    cat = req.query.get("category"); seller = (req.query.get("seller") or "").lower(); active = req.query.get("active", "1") == "1"
    out = []
    for g in gigs:
        if active and not g["active"]: continue
        if cat is not None and cat != "" and str(g["category"]) != cat: continue
        if seller and g["seller"] != seller: continue
        out.append({**g, "meta": meta.get(g["id"])})
    # sellers' aggregate stats for the cards
    sellers: dict[str, dict] = {}
    for g in gigs:
        s = sellers.setdefault(g["seller"], {"gigs": 0, "sold": 0, "disputed": 0, "ratingSum": 0, "ratingCount": 0})
        s["gigs"] += 1; s["sold"] += g["sold"]; s["disputed"] += g["disputed"]; s["ratingSum"] += g["ratingSum"]; s["ratingCount"] += g["ratingCount"]
    for s in sellers.values(): s["rating"] = round(s["ratingSum"] / s["ratingCount"], 2) if s["ratingCount"] else None
    return web.json_response({"contract": ADDR, "categories": CATEGORIES, "gigs": out, "sellers": sellers, "feeBps": DEPLOY.get("feeBps", 200), "tierFeeBps": DEPLOY.get("tierFeeBps", 100), "arctTier": DEPLOY.get("arctTier")}, headers={**CORS, "Cache-Control": "public, max-age=10"})

async def api_gig(req: web.Request) -> web.Response:
    gid = int(req.query.get("id", "-1")); gigs = await all_gigs(); meta = await all_meta()
    if gid < 0 or gid >= len(gigs): return web.json_response({"error": "no such gig"}, status=404, headers=CORS)
    reviews = await db.fetchall(text("SELECT order_id, buyer, stars, text_, ts FROM work_reviews WHERE gig_id = :g ORDER BY ts DESC LIMIT 50").bindparams(g=gid))
    return web.json_response({**gigs[gid], "meta": meta.get(gid), "reviews": [{"order": int(r["order_id"]), "buyer": r["buyer"], "stars": int(r["stars"]), "text": r["text_"], "ts": int(r["ts"])} for r in reviews]}, headers={**CORS, "Cache-Control": "public, max-age=10"})

async def api_orders(req: web.Request) -> web.Response:
    w = (req.query.get("wallet") or "").lower()
    if not re.fullmatch(r"0x[0-9a-f]{40}", w): return web.json_response({"error": "wallet"}, status=400, headers=CORS)
    orders = await orders_of(w); gigs = await all_gigs(); meta = await all_meta()
    for o in orders:
        g = gigs[o["gigId"]] if o["gigId"] < len(gigs) else None
        o["gig"] = {**g, "meta": meta.get(o["gigId"])} if g else None
        ev = await db.fetchall(text("SELECT name, ts, actor, data FROM work_events WHERE order_id = :o ORDER BY block, log_index").bindparams(o=o["id"]))
        o["events"] = [{"name": e["name"], "ts": int(e["ts"]), "actor": e["actor"], "data": e["data"]} for e in ev]
    return web.json_response({"wallet": w, "orders": orders, "acceptWindowH": DEPLOY.get("acceptWindowH", 72), "cancelGraceD": DEPLOY.get("cancelGraceD", 3)}, headers={**CORS, "Cache-Control": "no-store"})

async def api_order(req: web.Request) -> web.Response:
    oid = int(req.query.get("id", "-1"))
    try: o = await one_order(oid)
    except Exception: return web.json_response({"error": "no such order"}, status=404, headers=CORS)
    gigs = await all_gigs(); meta = await all_meta(); o["gig"] = {**gigs[o["gigId"]], "meta": meta.get(o["gigId"])} if o["gigId"] < len(gigs) else None
    ev = await db.fetchall(text("SELECT name, ts, actor, data FROM work_events WHERE order_id = :o ORDER BY block, log_index").bindparams(o=oid))
    o["events"] = [{"name": e["name"], "ts": int(e["ts"]), "actor": e["actor"], "data": e["data"]} for e in ev]
    return web.json_response(o, headers={**CORS, "Cache-Control": "no-store"})

async def api_meta_post(req: web.Request) -> web.Response:
    """seller signs `arcwork-meta:<gigId>:<sha of the JSON body without sig>` with the gig's seller key (EIP-191)"""
    try: j = await req.json()
    except Exception: return web.json_response({"ok": False, "reason": "bad json"}, status=400, headers=CORS)
    gid = int(j.get("gigId", -1)); gigs = await all_gigs(force=True)
    if gid < 0 or gid >= len(gigs): return web.json_response({"ok": False, "reason": "no such gig"}, status=404, headers=CORS)
    title = str(j.get("title", ""))[:120].strip(); desc = str(j.get("description", ""))[:3000].strip(); contact = str(j.get("contact", ""))[:120].strip()
    samples = [str(s)[:300] for s in (j.get("samples") or []) if isinstance(s, str) and s.startswith("https://")][:6]
    tags = [str(t)[:24] for t in (j.get("tags") or [])][:8]; tg = re.sub(r"[^A-Za-z0-9_]", "", str(j.get("tg", "")))[:64]
    if len(title) < 3 or len(desc) < 20: return web.json_response({"ok": False, "reason": "title ≥ 3 and description ≥ 20 chars"}, status=400, headers=CORS)
    image = str(j.get("image") or "")
    if image and (not re.match(r"^data:image/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$", image) or len(image) > 400_000): return web.json_response({"ok": False, "reason": "image must be a PNG/WebP/JPEG data URL under 300 KB"}, status=400, headers=CORS)
    payload = json.dumps({"gigId": gid, "title": title, "description": desc, "samples": samples, "contact": contact, "tags": tags, "tg": tg, "image": image}, separators=(",", ":"), sort_keys=True)
    msg = f"arcwork-meta:{gid}:{Web3.keccak(text=payload).hex()}"
    try: signer = Account.recover_message(encode_defunct(text=msg), signature=j.get("sig", "")).lower()
    except Exception: return web.json_response({"ok": False, "reason": "bad signature"}, status=400, headers=CORS)
    if signer != gigs[gid]["seller"]: return web.json_response({"ok": False, "reason": "signature is not the gig's seller", "expected_message": msg}, status=403, headers=CORS)
    await db.execute(text("""INSERT INTO work_meta (gig_id, seller, title, description, samples, contact, tags, tg, updated, image) VALUES (:g,:s,:t,:d,CAST(:sa AS JSONB),:c,CAST(:tg2 AS JSONB),:tg,:u,:img)
        ON CONFLICT (gig_id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, samples=EXCLUDED.samples, contact=EXCLUDED.contact, tags=EXCLUDED.tags, tg=EXCLUDED.tg, updated=EXCLUDED.updated,
        image = CASE WHEN EXCLUDED.image <> '' THEN EXCLUDED.image ELSE work_meta.image END""")
        .bindparams(g=gid, s=signer, t=title, d=desc, sa=json.dumps(samples), c=contact, tg2=json.dumps(tags), tg=tg, u=int(time.time()), img=image))
    _cache["meta"] = (0, {})
    return web.json_response({"ok": True, "gigId": gid}, headers=CORS)

async def api_meta_message(req: web.Request) -> web.Response:
    """helper for clients: the exact message to sign for a metadata body (same canonicalisation as the POST)"""
    try: j = await req.json()
    except Exception: return web.json_response({"error": "bad json"}, status=400, headers=CORS)
    gid = int(j.get("gigId", -1)); payload = json.dumps({"gigId": gid, "title": str(j.get("title", ""))[:120].strip(), "description": str(j.get("description", ""))[:3000].strip(),
        "samples": [str(s)[:300] for s in (j.get("samples") or []) if isinstance(s, str) and s.startswith("https://")][:6], "contact": str(j.get("contact", ""))[:120].strip(),
        "tags": [str(t)[:24] for t in (j.get("tags") or [])][:8], "tg": re.sub(r"[^A-Za-z0-9_]", "", str(j.get("tg", "")))[:64], "image": str(j.get("image") or "")}, separators=(",", ":"), sort_keys=True)
    return web.json_response({"message": f"arcwork-meta:{gid}:{Web3.keccak(text=payload).hex()}"}, headers=CORS)

async def api_disputed(req: web.Request) -> web.Response:
    """orders currently in Disputed state (from the event log, verified on-chain) — the arbiter's inbox"""
    rows = await db.fetchall(text("SELECT DISTINCT order_id FROM work_events WHERE name = 'OrderDisputed' AND order_id NOT IN (SELECT order_id FROM work_events WHERE name = 'OrderResolved') ORDER BY order_id DESC LIMIT 200"))
    ids = [int(r["order_id"]) for r in rows]
    if not ids: return web.json_response({"orders": []}, headers={**CORS, "Cache-Control": "no-store"})
    orders = await asyncio.get_event_loop().run_in_executor(None, lambda: [_order(r, i) for i, r in zip(ids, _c.functions.getOrders(ids).call())])
    orders = [o for o in orders if o["status"] == 5]
    gigs = await all_gigs(); meta = await all_meta()
    for o in orders:
        o["gig"] = {**gigs[o["gigId"]], "meta": meta.get(o["gigId"])} if o["gigId"] < len(gigs) else None
        ev = await db.fetchall(text("SELECT name, ts, actor, data FROM work_events WHERE order_id = :o ORDER BY block, log_index").bindparams(o=o["id"]))
        o["events"] = [{"name": e["name"], "ts": int(e["ts"]), "actor": e["actor"], "data": e["data"]} for e in ev]
    return web.json_response({"orders": orders}, headers={**CORS, "Cache-Control": "no-store"})

async def api_img(req: web.Request) -> web.Response:
    gid = int(req.match_info["gid"].removesuffix(".png"))
    r = await db.fetchone(text("SELECT image FROM work_meta WHERE gig_id = :g").bindparams(g=gid))
    m = re.match(r"^data:(image/[a-z]+);base64,(.+)$", (r["image"] if r else "") or "")
    if not m: raise web.HTTPNotFound()
    import base64
    return web.Response(body=base64.b64decode(m.group(2)), content_type=m.group(1), headers={"Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*"})

async def api_stats(req: web.Request) -> web.Response:
    gigs = await all_gigs()
    ev = await db.fetchone(text("SELECT COUNT(*) FILTER (WHERE name='OrderPaid') paid, COUNT(*) FILTER (WHERE name='OrderCompleted') done, COUNT(*) FILTER (WHERE name='OrderDisputed') disp, COUNT(*) FILTER (WHERE name='OrderResolved') res FROM work_events"))
    vol = await db.fetchone(text("SELECT COALESCE(SUM((data->>'amount')::NUMERIC),0) v FROM work_events WHERE name='OrderPaid'"))
    fees = await db.fetchone(text("SELECT COALESCE(SUM((data->>'fee')::NUMERIC),0) f FROM work_events WHERE name IN ('OrderCompleted','OrderResolved')"))
    return web.json_response({"contract": ADDR, "gigs": len(gigs), "active_gigs": sum(1 for g in gigs if g["active"]), "sellers": len({g["seller"] for g in gigs}),
        "orders_paid": int(ev["paid"]), "completed": int(ev["done"]), "disputed": int(ev["disp"]), "resolved": int(ev["res"]), "volume_usdc": float(vol["v"] or 0) / 1e18, "fees_usdc": float(fees["f"] or 0) / 1e18,
        "indexed_to": _state["last_block"]}, headers={**CORS, "Cache-Control": "public, max-age=30"})


# ───────────────────────── event loop (notifications + log) ─────────────────────────
async def _tg(chat_id, text_: str):
    if not bot: return
    try: await bot.send_message(chat_id, text_, disable_web_page_preview=True)
    except Exception as e: log.warning("work tg %s: %s", chat_id, e)

async def events_loop() -> None:
    await init()
    if not _c:
        log.warning("work: no deploy json — loop idle"); return
    while True:
        try:
            head = await asyncio.get_event_loop().run_in_executor(None, lambda: _w3.eth.block_number)
            frm = _state["last_block"] + 1; to = min(head - 1, frm + 20_000)
            if to >= frm:
                logs = await asyncio.get_event_loop().run_in_executor(None, lambda: _w3.eth.get_logs({"fromBlock": frm, "toBlock": to, "address": _c.address}))
                for lg in logs:
                    await _handle(lg)
                _state["last_block"] = to
                await db.execute(text("INSERT INTO work_cursor (k, block) VALUES ('evt', :b) ON CONFLICT (k) DO UPDATE SET block = EXCLUDED.block").bindparams(b=to))
        except Exception as e:  # noqa
            _state["last_error"] = str(e)[:200]
        await asyncio.sleep(3)

async def _handle(lg) -> None:
    ev = None
    for e in _c.events:
        try: ev = e().process_log(lg); break
        except Exception: continue
    if not ev: return
    name = ev["event"]; a = dict(ev["args"]); oid = a.get("id") if name.startswith("Order") or name == "Reviewed" else None; gid = a.get("gigId") if "gigId" in a else (a.get("id") if name.startswith("Gig") else None)
    actor = (a.get("buyer") or a.get("by") or a.get("seller") or "")
    data = {k: (str(v) if isinstance(v, int) and v > 2**53 else v) for k, v in a.items()}
    blk = await asyncio.get_event_loop().run_in_executor(None, lambda: _w3.eth.get_block(lg["blockNumber"]))
    await db.execute(text("INSERT INTO work_events (tx, log_index, block, ts, name, order_id, gig_id, actor, data) VALUES (:t,:i,:b,:s,:n,:o,:g,:a,CAST(:d AS JSONB)) ON CONFLICT DO NOTHING")
                     .bindparams(t=lg["transactionHash"].hex(), i=lg["logIndex"], b=lg["blockNumber"], s=int(blk["timestamp"]), n=name, o=oid, g=gid, a=str(actor).lower(), d=json.dumps(data)))
    if name == "Reviewed":
        o = await one_order(int(a["id"]))
        await db.execute(text("INSERT INTO work_reviews (order_id, gig_id, buyer, stars, text_, ts) VALUES (:o,:g,:b,:s,:x,:t) ON CONFLICT (order_id) DO NOTHING").bindparams(o=int(a["id"]), g=int(a["gigId"]), b=o["buyer"], s=int(a["stars"]), x=a.get("text", ""), t=int(blk["timestamp"])))
    _cache["gigs"] = (0, [])
    # notifications
    meta = await all_meta()
    if name == "OrderPaid":
        g = meta.get(int(a["gigId"]), {}); title = g.get("title") or f"gig #{a['gigId']}"
        txt = f"🛒 ArcWork: new order #{a['id']} — {title}\n{int(a['amount'])/1e18:.2f} USDC in escrow · buyer {a['buyer'][:10]}… · deadline {time.strftime('%d %b %H:%M', time.gmtime(int(a['deadline'])))} UTC\nhttps://arctools.fun/market/order/{a['id']}"
        await _tg(ADMIN_TG, txt)
        if g.get("tg"): await _tg(f"@{g['tg']}", txt)   # works only if the seller started the bot; failures are logged, not fatal
        _state["notified"] += 1
    elif name == "OrderDisputed":
        await _tg(ADMIN_TG, f"⚖️ ArcWork: order #{a['id']} DISPUTED by {a['by'][:10]}…\nReason: {a.get('reason','')[:300]}\nResolve: https://arctools.fun/market/order/{a['id']}")
    elif name == "OrderDelivered":
        await _tg(ADMIN_TG, f"📦 ArcWork: order #{a['id']} delivered — buyer has 72 h to accept.")

def register(app: web.Application) -> None:
    app.router.add_get("/api/work/gigs", api_gigs)
    app.router.add_get("/api/work/gig", api_gig)
    app.router.add_get("/api/work/orders", api_orders)
    app.router.add_get("/api/work/order", api_order)
    app.router.add_post("/api/work/meta", api_meta_post)
    app.router.add_post("/api/work/meta-message", api_meta_message)
    app.router.add_get("/api/work/stats", api_stats)
    app.router.add_get("/api/work/disputed", api_disputed)
    app.router.add_get("/api/work/img/{gid}", api_img)
    async def opts(req): return web.Response(status=204, headers=CORS)
    app.router.add_route("OPTIONS", "/api/work/meta", opts); app.router.add_route("OPTIONS", "/api/work/meta-message", opts)
