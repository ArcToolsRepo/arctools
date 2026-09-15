"""Bubble map — which holders of a token are connected to each other.

Edges (each carries a reason so the UI can explain the link):
  transfer  : one holder sent the TOKEN to another (from the token's transfer log)
  funding   : both holders received their FIRST native USDC from the same wallet (same funder = same operator)
  funded_by : holder A directly funded holder B (A → B native transfer among A's first txs)
  bundle    : both bought inside the launch window (first 2 s of trading) — classic bundle
  insider   : both are in the same insider-cluster buy window from our swap index (≥2 top wallets in 15 min)
Clusters = connected components over those edges; the big number users care about is "the largest cluster holds X %".

Data: arc-scan API (holders, token transfers, per-address tx history) + our swaps index. Result cached 10 min.
"""
import asyncio
import logging
import time
from collections import defaultdict

import aiohttp
from sqlalchemy import text

from . import db

log = logging.getLogger("bubbles")

API = "https://api.arc-scan.org/v1"
HDR = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsBot/1.0)"}
CACHE_S = 600
MAX_HOLDERS = 100
MAX_TRANSFER_PAGES = 8          # 800 most recent transfers
FUNDING_CONC = 6
SKIP = {"0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"}
KNOWN = {  # our own / well-known contracts, labelled instead of clustered
    "0x43cdbf8edb8fe41dde4ba519f49499d1ed78e74a": "ArcAggregator", "0x2726aec64d8a9bc41b9940dda5d21c889458b348": "ArcToolsPad",
    "0x48ada931c2c220b074c39449b7e70860a3b4c277": "ARCT stakers vault", "0x1abe31ba5d3c496635efd35cb0b7f7d86ba30af2": "ArcOrders",
    "0x8366a39cc670b4001a1121b8f6a443a643e40951": "Uniswap V4 PoolManager", "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77": "Uniswap SwapRouter",
}

_cache: dict[str, tuple[float, dict]] = {}
_sem = asyncio.Semaphore(FUNDING_CONC)


async def _get(s: aiohttp.ClientSession, path: str, **params):
    async with s.get(f"{API}/{path}", params=params or None, headers=HDR, timeout=aiohttp.ClientTimeout(total=20)) as r:
        if r.status != 200:
            return None
        return await r.json(content_type=None)


class DSU:
    def __init__(self):
        self.p: dict[str, str] = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]; x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


async def _holders(s, token):
    """arc-scan holders, merged with holders derived from our own swap index (net bought − sold per wallet).
    arc-scan's holder index is partial for many tokens (COOL: 2 of 1,836), our index misses plain transfers — the union
    is the best picture we can give without walking every Transfer log."""
    j = await _get(s, f"tokens/{token}/holders", limit=MAX_HOLDERS)
    out: dict[str, dict] = {}
    for x in (j or {}).get("items") or []:
        a = ((x.get("address") or {}).get("address") or "").lower()
        if not a or a in SKIP:
            continue
        out[a] = {"address": a, "share": float(x.get("share") or 0), "balance": float((x.get("balance") or {}).get("formatted") or 0), "src": "scan"}
    try:
        from .insider import total_supply_nowait
        supply = total_supply_nowait(token)
        rows = await db.fetchall(text(
            "SELECT wallet, SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) net FROM swaps WHERE token = :t GROUP BY wallet "
            "HAVING SUM(CASE WHEN side='buy' THEN tokens ELSE -tokens END) > 0 ORDER BY net DESC LIMIT :n").bindparams(t=token, n=MAX_HOLDERS))
        for r in rows:
            a = (r["wallet"] or "").lower(); net = float(r["net"] or 0)
            if not a or a in SKIP or a in out:
                continue
            out[a] = {"address": a, "share": (net / supply) if supply else 0.0, "balance": net, "src": "index"}
    except Exception as e:  # noqa
        log.debug("index holders: %s", e)
    lst = sorted(out.values(), key=lambda h: -h["balance"])[:MAX_HOLDERS]
    return lst


async def _transfers(s, token):
    items, cursor = [], None
    for _ in range(MAX_TRANSFER_PAGES):
        j = await _get(s, f"tokens/{token}/transfers", limit=100, **({"cursor": cursor} if cursor else {}))
        if not j:
            break
        items += j.get("items") or []
        pg = j.get("page") or {}
        cursor = pg.get("next")
        if not pg.get("has_more") or not cursor:
            break
    return items


async def _addr_info(s, a):
    j = await _get(s, f"address/{a}")
    return (j or {}).get("type"), (j or {}).get("label") or (j or {}).get("tag")


async def _funding(s, a) -> tuple[str | None, list[str]]:
    """(first funder, wallets this address funded among its first 100 txs)."""
    async with _sem:
        j = await _get(s, f"address/{a}/txs", limit=100, order="asc")
    funder, funded = None, []
    for x in (j or {}).get("items") or []:
        v = float(((x.get("value") or {}).get("formatted")) or 0)
        f = ((x.get("from") or {}).get("address") or "").lower(); t = ((x.get("to") or {}).get("address") or "").lower()
        if v <= 0:
            continue
        if t == a and funder is None and f and f != a:
            funder = f
        elif f == a and t and t != a and not (x.get("created_contract")):
            funded.append(t)
    return funder, funded


async def build(token: str) -> dict:
    token = token.lower()
    hit = _cache.get(token)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    t0 = time.time()
    async with aiohttp.ClientSession() as s:
        holders = await _holders(s, token)
        if not holders:
            return {"token": token, "nodes": [], "edges": [], "clusters": [], "error": "no holders"}
        addrs = [h["address"] for h in holders]
        aset = set(addrs)
        # contract / pool detection: known pools from our index + arc-scan type
        pools = set()
        try:
            for r in await db.fetchall(text("SELECT pool FROM insider_pools WHERE token = :t").bindparams(t=token)):
                pools.add(r["pool"].lower())
        except Exception:  # noqa
            pass
        infos = await asyncio.gather(*[_addr_info(s, a) for a in addrs], return_exceptions=True)
        kind = {}
        for a, inf in zip(addrs, infos):
            typ, label = inf if isinstance(inf, tuple) else (None, None)
            kind[a] = ("pool" if a in pools else "contract" if typ == "contract" else "eoa", KNOWN.get(a) or label)
        eoas = [a for a in addrs if kind[a][0] == "eoa"]

        transfers, fund = await asyncio.gather(_transfers(s, token), asyncio.gather(*[_funding(s, a) for a in eoas], return_exceptions=True))

    # ---- edges
    edges: dict[tuple[str, str], set[str]] = defaultdict(set)
    def link(a, b, why):
        if a == b or a not in aset or b not in aset:
            return
        if kind[a][0] != "eoa" or kind[b][0] != "eoa":
            return
        edges[tuple(sorted((a, b)))].add(why)

    for x in transfers:
        f = ((x.get("from") or {}).get("address") or "").lower(); t = ((x.get("to") or {}).get("address") or "").lower()
        link(f, t, "transfer")
    funder_of: dict[str, str] = {}
    for a, fr in zip(eoas, fund):
        if not isinstance(fr, tuple):
            continue
        funder, funded = fr
        if funder:
            funder_of[a] = funder
            if funder in aset:
                link(funder, a, "funded_by")
        for b in funded:
            if b in aset:
                link(a, b, "funded_by")
    by_funder: dict[str, list[str]] = defaultdict(list)
    for a, f in funder_of.items():
        by_funder[f].append(a)
    for f, group in by_funder.items():
        if len(group) >= 2 and f not in KNOWN and kind.get(f, ("eoa",))[0] == "eoa":
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    link(group[i], group[j], "funding")
    # bundle + insider windows from our index
    try:
        rows = await db.fetchall(text("SELECT wallet, MIN(ts) t0 FROM swaps WHERE token = :t AND side='buy' GROUP BY wallet").bindparams(t=token))
        if rows:
            first = min(int(r["t0"]) for r in rows)
            bundle = [r["wallet"].lower() for r in rows if int(r["t0"]) <= first + 2 and r["wallet"].lower() in aset]
            for i in range(len(bundle)):
                for j in range(i + 1, len(bundle)):
                    link(bundle[i], bundle[j], "bundle")
        ins = await db.fetchall(text(
            "SELECT s.wallet, s.ts FROM swaps s JOIN (SELECT wallet FROM wallet_stats WHERE range='30d' ORDER BY pnl_total DESC LIMIT 200) w ON w.wallet = s.wallet "
            "WHERE s.token = :t AND s.side='buy' AND s.usdc >= 25 ORDER BY s.ts").bindparams(t=token))
        ws = [(int(r["ts"]), r["wallet"].lower()) for r in ins if r["wallet"].lower() in aset]
        for i in range(len(ws)):
            for j in range(i + 1, len(ws)):
                if ws[j][0] - ws[i][0] > 900:
                    break
                link(ws[i][1], ws[j][1], "insider")
    except Exception as e:  # noqa
        log.debug("bubbles index edges: %s", e)

    # ---- clusters
    dsu = DSU()
    for (a, b) in edges:
        dsu.union(a, b)
    share = {h["address"]: h["share"] for h in holders}
    comp: dict[str, list[str]] = defaultdict(list)
    for a in eoas:
        comp[dsu.find(a)].append(a)
    clusters = []
    for root, members in comp.items():
        if len(members) < 2:
            continue
        reasons = defaultdict(int)
        for (a, b), why in edges.items():
            if a in members and b in members:
                for w in why:
                    reasons[w] += 1
        clusters.append({"id": root, "wallets": sorted(members, key=lambda a: -share.get(a, 0)), "share": round(sum(share.get(a, 0) for a in members) * 100, 2),
                         "reasons": dict(reasons)})
    clusters.sort(key=lambda c: -c["share"])
    cid = {}
    for i, c in enumerate(clusters):
        for a in c["wallets"]:
            cid[a] = i
    # labels (dev / insider / KOL) from the risk engine
    labels = {}
    try:
        from .risk_score import wallet_labels
        labels = await wallet_labels(addrs, token)
    except Exception:  # noqa
        pass
    nodes = []
    for h in holders:
        a = h["address"]; k, lab = kind[a]
        nodes.append({"address": a, "share": round(h["share"] * 100, 3), "balance": h["balance"], "kind": k, "label": lab, "src": h.get("src"),
                      "cluster": cid.get(a), "funder": funder_of.get(a), "tags": [x.get("text") or x.get("kind") for x in (labels.get(a) or []) if isinstance(x, dict)][:3]})
    out = {"token": token, "holders": len(holders), "eoa": len(eoas), "nodes": nodes,
           "edges": [{"a": a, "b": b, "why": sorted(w)} for (a, b), w in edges.items()],
           "clusters": clusters, "largest_cluster_pct": clusters[0]["share"] if clusters else 0.0,
           "clustered_pct": round(sum(c["share"] for c in clusters), 2), "took_ms": int((time.time() - t0) * 1000), "ts": int(time.time())}
    _cache[token] = (time.time(), out)
    return out


async def api_bubbles(request):
    from aiohttp import web
    token = (request.query.get("token") or "").lower()
    if not token.startswith("0x") or len(token) != 42:
        return web.json_response({"error": "token"}, status=400, headers={"Access-Control-Allow-Origin": "*"})
    try:
        out = await asyncio.wait_for(build(token), timeout=60)
    except Exception as e:  # noqa
        log.warning("bubbles %s: %s", token, e)
        out = {"token": token, "nodes": [], "edges": [], "clusters": [], "error": str(e)[:120]}
    return web.json_response(out, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=120"})


def register(app):
    app.router.add_get("/api/bubbles", api_bubbles)


async def warm_loop():
    """Precompute the map for the top-30 Terminal tokens every 10 min so the tab opens instantly for what people look at."""
    await asyncio.sleep(90)
    while True:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get("https://arctools.fun/api/tokens", timeout=aiohttp.ClientTimeout(total=40)) as r:
                    toks = [x["token"].lower() for x in ((await r.json(content_type=None)).get("tokens") or [])[:30]]
            for t in toks:
                hit = _cache.get(t)
                if hit and time.time() - hit[0] < CACHE_S * 0.8:
                    continue
                try:
                    await asyncio.wait_for(build(t), timeout=90)
                except Exception as e:  # noqa
                    log.debug("bubbles warm %s: %s", t[:10], e)
                await asyncio.sleep(3)
        except Exception as e:  # noqa
            log.warning("bubbles warm loop: %s", e)
        await asyncio.sleep(600)


def start_warm():
    asyncio.create_task(warm_loop(), name="bubbles-warm")
