"""Venue-agnostic market data for the panels (Maestro-style header).

Price / changes / volume come from the Arc Insider swap index (every venue: V3, V4, curves) — not from the V3
quoter, so a V4 or bonding-curve position gets a real value. Liquidity from the same index; supply via one hedged
RPC call cached 10 min. Everything under a hard time budget and a 20 s memo, so panels never wait on a slow RPC.
"""
import asyncio
import logging
import os
import time

import aiohttp
from eth_utils import to_checksum_address

log = logging.getLogger("market")
API = os.getenv("INSIDER_API", "https://bot-production-4200.up.railway.app").rstrip("/")

_memo: dict[str, tuple[float, dict]] = {}
_supply: dict[str, tuple[float, float]] = {}
_meta: dict[str, tuple[str, int]] = {}      # token -> (symbol, decimals), permanent


async def _get(session: aiohttp.ClientSession, path: str, **params):
    try:
        async with session.get(f"{API}{path}", params=params, timeout=aiohttp.ClientTimeout(total=5),
                               headers={"User-Agent": "arcsniper/1.0"}) as r:
            if r.status == 200:
                return await r.json()
    except Exception as e:  # noqa
        log.debug("%s: %s", path, e)
    return None


async def _supply_of(token: str) -> float | None:
    t = token.lower()
    hit = _supply.get(t)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    try:
        from .chain import CHAIN
        sym, dec = await meta(token)
        raw = await asyncio.wait_for(CHAIN.call_any(lambda w3: w3.eth.call(
            {"to": to_checksum_address(token), "data": "0x18160ddd"})), timeout=4)
        s = int.from_bytes(raw[:32], "big") / 10 ** dec
        _supply[t] = (time.time(), s)
        return s
    except Exception:  # noqa
        return hit[1] if hit else None


async def meta(token: str) -> tuple[str, int]:
    """(symbol, decimals) — cached forever once known."""
    t = token.lower()
    if t in _meta:
        return _meta[t]
    try:
        from .chain import CHAIN
        ca = to_checksum_address(token)
        sym, dec = await asyncio.wait_for(asyncio.gather(
            CHAIN.call_any(lambda w3: CHAIN.erc20(ca, w3).functions.symbol().call()),
            CHAIN.call_any(lambda w3: CHAIN.erc20(ca, w3).functions.decimals().call()),
            return_exceptions=True), timeout=5)
        sym = sym if isinstance(sym, str) and sym else ca[:6] + "…" + ca[-4:]
        dec = dec if isinstance(dec, int) else 18
        if isinstance(sym, str) and not sym.startswith("0x"):
            _meta[t] = (sym, dec)
        return sym, dec
    except Exception:  # noqa
        return token[:6] + "…" + token[-4:], 18


async def snapshot(token: str, budget: float = 6.0) -> dict:
    """{symbol, decimals, price (USD per token), price1m, mcap, liq, change{5m,1h,6h,24h}, vol24, buys24, sells24,
    traders24, age_s, fresh: bool}. Missing pieces are None — the card renders '—' for them."""
    t = token.lower()
    hit = _memo.get(t)
    if hit and time.time() - hit[0] < 20:
        return hit[1]
    out = {"symbol": None, "decimals": 18, "price": None, "price1m": None, "mcap": None, "liq": None,
           "change": {}, "vol24": None, "buys24": None, "sells24": None, "traders24": None, "age_s": None, "fresh": False}
    try:
        async with aiohttp.ClientSession() as s:
            stats, liq, (sym, dec), supply = await asyncio.wait_for(asyncio.gather(
                _get(s, "/api/token-stats", token=t), _get(s, "/api/liq", tokens=t), meta(token), _supply_of(token),
                return_exceptions=True), timeout=budget)
    except Exception:  # noqa
        stats, liq, sym, dec, supply = None, None, None, 18, None
    if isinstance(sym, tuple):
        sym, dec = sym
    out["symbol"], out["decimals"] = (sym if isinstance(sym, str) else None), (dec if isinstance(dec, int) else 18)
    if isinstance(stats, dict) and stats.get("price1m") is not None:
        out["price1m"] = float(stats["price1m"])
        out["price"] = out["price1m"] / 1_000_000
        out["change"] = stats.get("change") or {}
        out["vol24"], out["buys24"], out["sells24"], out["traders24"] = stats.get("vol24"), stats.get("buys24"), stats.get("sells24"), stats.get("traders24")
        if stats.get("first_ts"):
            out["age_s"] = int(time.time() - int(stats["first_ts"]))
        out["fresh"] = True
    if isinstance(liq, dict):
        v = (liq.get("liq") or {}).get(t)
        out["liq"] = float(v) if v is not None else None
    if out["price"] is not None and isinstance(supply, (int, float)) and supply:
        out["mcap"] = out["price"] * supply
    if out["price"] is None:
        # last resort: V3 quoter / ArcPad curve (fast path with its own budget)
        try:
            from .pads import quote_token_usdc
            q = await asyncio.wait_for(quote_token_usdc(token, 10 ** out["decimals"] * 1_000_000), timeout=4)
            if q:
                out["price1m"] = q; out["price"] = q / 1_000_000
                if isinstance(supply, (int, float)) and supply:
                    out["mcap"] = out["price"] * supply
        except Exception:  # noqa
            pass
    _memo[t] = (time.time(), out)
    return out


def invalidate(token: str):
    _memo.pop(token.lower(), None)
