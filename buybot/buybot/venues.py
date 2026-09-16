"""Venue discovery + swap decoding for a token: canonical Uniswap V3
(RadarDex / ArcPad / Tolly / DYOR V3 positions), DYORSwap V2 pairs and
WarpDex pairs. All pools quote against native USDC (facade, 6 dec)."""
import asyncio
import logging
from eth_abi import encode as abi_encode
from eth_utils import function_signature_to_4byte_selector as sel, to_checksum_address
from .config import CFG
from . import db
from sqlalchemy import text
from .chain import CHAIN

log = logging.getLogger("venues")

V3_SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
V2_SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"

# nasz launchpad (arctools.fun/launchpad): event Trade(token idx, trader idx, buy, usdcIn, usdcOut, tokensIn, tokensOut)
ARCPAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE"
ARCPAD_V3 = "0x2726AeC64D8a9BC41B9940dDA5D21c889458B348"
ARCPAD_TRADE_TOPIC = "0x9adcf0ad0cda63c4d50f26a48925cf6405df27d422a39c456b5f03f661c82982"
CURVE_SEL = "0x06d8d7db"      # curve(address)
QUOTE_SELL_SEL = "0xd98b2f5c"  # quoteSell(address,uint256)

GET_POOL = "0x" + sel("getPool(address,address,uint24)").hex()
GET_PAIR = "0x" + sel("getPair(address,address)").hex()
QUOTE = "0x" + sel("quoteExactInputSingle((address,address,uint256,uint24,uint160))").hex()


def _pad(a: str) -> str:
    return a[2:].lower().rjust(64, "0")


def _addr(word: str) -> str:
    return to_checksum_address("0x" + word[-40:])


async def _v3_pool(token: str, fee: int) -> dict | None:
    data = GET_POOL + _pad(token) + _pad(CFG.usdc) + hex(fee)[2:].rjust(64, "0")
    res = await CHAIN.eth_call(CFG.univ3_factory, data)
    pool = _addr(res.hex())
    return {"address": pool, "kind": "v3", "venue": "UniswapV3"} if int(pool, 16) != 0 else None


async def _v2_pair(token: str, factory: str, venue: str) -> dict | None:
    res = await CHAIN.eth_call(factory, GET_PAIR + _pad(token) + _pad(CFG.usdc))
    pair = _addr(res.hex())
    return {"address": pair, "kind": "v2", "venue": venue} if int(pair, 16) != 0 else None


async def _arcpad(token: str) -> dict | None:
    res = await CHAIN.eth_call(ARCPAD, CURVE_SEL + _pad(token))
    body = res.hex().replace("0x", "") if res else ""
    if len(body) >= 128 and int(body[64:128], 16) > 0:  # tokenReserve > 0
        return {"address": ARCPAD, "kind": "arcpad", "venue": "ArcToolsPad"}
    res3 = await CHAIN.eth_call(ARCPAD_V3, CURVE_SEL + _pad(token))
    if res3 and int.from_bytes(res3[32:64], "big") > 0:
        return {"address": ARCPAD_V3, "kind": "arcpad", "venue": "ArcToolsPad"}
    return None


async def _db_venues(token: str) -> list[dict]:
    """Fast path (ms): pools the Arc Insider index already knows for this token."""
    out = []
    t = token.lower()
    try:
        for r in await db.fetchall(text("SELECT pool FROM insider_pools WHERE token = :t").bindparams(t=t)):
            out.append({"address": to_checksum_address(r["pool"]), "kind": "v3", "venue": "UniswapV3"})
    except Exception:  # noqa
        pass
    try:
        rows = await db.fetchall(text(
            "SELECT id, is0, hooks, usdc_dec FROM v4_pools WHERE token = :t AND fee IS NOT NULL").bindparams(t=t))
        for r in rows:
            out.append({"address": V4_POOL_MANAGER, "kind": "v4", "venue": v4_venue_name(r["hooks"]),
                        "pool_id": r["id"], "is0": bool(r["is0"]), "usdc_dec": int(r["usdc_dec"] or 18)})
    except Exception:  # noqa
        pass
    return out


async def discover_venues(token: str, budget: float = 12.0) -> list[dict]:
    """Returns [{address, kind: v3|v2|v4|arcpad, venue}] markets for token/USDC.
    Index first (instant), then every RPC probe IN PARALLEL under one time budget —
    a slow RPC day must not turn /add into a minutes-long wait."""
    token = to_checksum_address(token)
    out = await _db_venues(token)
    probes = [_v3_pool(token, fee) for fee in (10000, 3000, 500)]
    probes += [_v2_pair(token, CFG.dyor_v2_factory, "DYORSwap"), _v2_pair(token, CFG.warp_dex_factory, "WarpDex"),
               _arcpad(token)]
    try:
        results = await asyncio.wait_for(asyncio.gather(*probes, return_exceptions=True), timeout=budget)
    except asyncio.TimeoutError:
        results = []
    seen = {(v["address"].lower(), v.get("pool_id")) for v in out}
    for r in results:
        if isinstance(r, dict) and (r["address"].lower(), r.get("pool_id")) not in seen:
            out.append(r); seen.add((r["address"].lower(), r.get("pool_id")))
    return out


V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
V4_SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
# known V4 hook addresses -> launchpad names (extend as pads appear)
V4_HOOKS = {
    "0xa368005ad249fbebcd5baa7396c9e3b3e44e6044": "Arguspad",
    "0xfea9dfe2a20e11f7c4d4b30c6c96a06e42e6e044": "Arguspad",          # Arguspad V4 (ARGUS-quoted pools)
    "0x465af15c85ac291d5cffb8d02d8c8e23102fe6e3": "act.fun",
    "0x20eead6db6b3d0a4491e9073119dd0ebff166acc": "UBI.fun",
    "0xc780c0f4aac690908854d351b8bfda2812daefdc": "UBI.fun",           # UBI.fun revenue-stream hook (launcher 0xe07f7ca6…)
    "0xbaba3f590b3661de78998d1576a73a4d726b2acc": "Sashimi",           # Sashimi graduation pools (launcher 0x3990608d…)
    "0xf73a3f56c533f7f1146fbc97806f07efa66ce0cc": "Klik",              # klik.finance Arc factory 0x7e5aeacf…
    "0xca55cdde6578f6f8113dd339520e13418abc2acc": "Lift",              # Lift V4 (launcher 0x1ca37b3c…), since block ~21.09M
    "0x7cd35b33d495396c4707056d23582df68d0a28cc": "Archemist",         # Archemist V4 (launcher 0xc6e91233…)
    "0xc0fda29b6683ef1aa5376d5d7054ff773f5a20cc": "Minara",            # minara.fun (launcher 0xb6c6f77e…)
    "0xb6a65950534f061618b4ae102fbcbb8541a8e0cc": "Minara",            # minaraFeeHook (API contracts?chainId=5042)
}


def v4_venue_name(hooks: str | None) -> str:
    return V4_HOOKS.get((hooks or "").lower(), "UniswapV4")


def decode_v4_swap(token_is_0: bool, lg, usdc_dec: int = 18) -> dict | None:
    """V4 Swap(id, sender, amount0, amount1, ...) — amounts from the swapper's view: negative = paid."""
    try:
        body = (lg["data"].hex() if hasattr(lg["data"], "hex") else str(lg["data"])).replace("0x", "")
        a0 = int.from_bytes(bytes.fromhex(body[0:64]), "big", signed=True)
        a1 = int.from_bytes(bytes.fromhex(body[64:128]), "big", signed=True)
        usdc_amt, tok_amt = (a1, a0) if token_is_0 else (a0, a1)
        if usdc_amt < 0 and tok_amt > 0:
            return {"usdc": -usdc_amt / (10 ** usdc_dec), "tokens": tok_amt / 1e18}
        return None
    except Exception:  # noqa
        return None


def decode_swap(kind: str, token: str, lg) -> dict | None:
    """Returns {usdc, tokens} for a BUY (USDC in -> token out), else None."""
    data = lg["data"]
    body = (data.hex() if hasattr(data, "hex") else str(data)).replace("0x", "")
    token_is_0 = int(token, 16) < int(CFG.usdc, 16)
    try:
        if kind == "arcpad":
            # Trade: topics[1]=token, topics[2]=trader; data: buy, usdcIn, usdcOut, tokensIn, tokensOut
            topics = [t.hex() if hasattr(t, "hex") else str(t) for t in lg["topics"]]
            topics = [t if t.startswith("0x") else "0x" + t for t in topics]
            if len(topics) < 2 or topics[1][-40:].lower() != token[2:].lower():
                return None  # trade innego tokena na tym samym kontrakcie launchpada
            is_buy = int(body[0:64], 16) == 1
            if not is_buy:
                return None
            usdc_in = int(body[64:128], 16)
            tok_out = int(body[256:320], 16)
            if usdc_in > 0 and tok_out > 0:
                return {"usdc": usdc_in / 1e18, "tokens": tok_out / 1e18}
            return None
        if kind == "v3":
            # amount0(int256) amount1(int256) sqrtPrice liquidity tick
            a0 = int.from_bytes(bytes.fromhex(body[0:64]), "big", signed=True)
            a1 = int.from_bytes(bytes.fromhex(body[64:128]), "big", signed=True)
            tok_amt, usdc_amt = (a0, a1) if token_is_0 else (a1, a0)
            if usdc_amt > 0 and tok_amt < 0:  # USDC into pool, token out => buy
                return {"usdc": usdc_amt / 1e6, "tokens": -tok_amt / 1e18}
            return None
        # v2: amount0In amount1In amount0Out amount1Out
        a0i = int(body[0:64], 16)
        a1i = int(body[64:128], 16)
        a0o = int(body[128:192], 16)
        a1o = int(body[192:256], 16)
        usdc_in = a1i if token_is_0 else a0i
        tok_out = a0o if token_is_0 else a1o
        if usdc_in > 0 and tok_out > 0:
            return {"usdc": usdc_in / 1e6, "tokens": tok_out / 1e18}
        return None
    except Exception:  # noqa
        return None


async def price_1m(token: str) -> float | None:
    """USDC value of 1M tokens via QuoterV2 (fee 10000), fallback: ArcPad curve."""
    try:
        params = abi_encode(
            ["(address,address,uint256,uint24,uint160)"],
            [(to_checksum_address(token), to_checksum_address(CFG.usdc),
              10 ** 18 * 1_000_000, 10000, 0)])
        res = await CHAIN.eth_call(CFG.univ3_quoter, QUOTE + params.hex())
        v = int.from_bytes(res[:32], "big")
        if v > 0:
            return v / 1e6
    except Exception:  # noqa
        pass
    try:  # token z naszego launchpada
        params = abi_encode(["address", "uint256"],
                            [to_checksum_address(token), 10 ** 18 * 1_000_000])
        res = await CHAIN.eth_call(ARCPAD, QUOTE_SELL_SEL + params.hex())
        v = int.from_bytes(res[:32], "big")
        if v > 0:
            return v / 1e18
    except Exception:  # noqa
        pass
    try:  # V4 / other venues: last indexed trade price (Arc Insider index)
        r = await db.fetchone(text(
            "SELECT price1m FROM swaps WHERE token = :t AND price1m > 0 AND usdc >= 0.5 ORDER BY ts DESC LIMIT 1"
        ).bindparams(t=token.lower()))
        return float(r["price1m"]) if r else None
    except Exception:  # noqa
        return None


SEL_SYMBOL = "0x95d89b41"
SEL_NAME = "0x06fdde03"


def _decode_str(raw: bytes) -> str:
    """ABI dynamic string OR bytes32 -> printable text."""
    s = ""
    if len(raw) >= 96:                      # offset + len + data
        ln = int.from_bytes(raw[32:64], "big")
        if 0 < ln <= 64:
            s = raw[64:64 + ln].decode("utf-8", "ignore")
    if not s and len(raw) >= 32:            # bytes32 symbol
        s = raw[:32].decode("utf-8", "ignore").replace("\x00", "")
    return "".join(ch for ch in s if ch.isprintable()).strip()[:24]


async def token_symbol(token: str, budget: float = 8.0) -> str:
    """Symbol: index first (instant), then RPC under a time budget, then a short address."""
    addr = to_checksum_address(token)
    try:
        r = await db.fetchone(text("SELECT symbol FROM token_symbols WHERE token = :t").bindparams(t=addr.lower()))
        if r and r["symbol"] and r["symbol"] not in ("?", ""):
            return r["symbol"]
    except Exception:  # noqa
        pass
    try:
        return await asyncio.wait_for(_token_symbol_rpc(addr), timeout=budget)
    except Exception:  # noqa
        return addr[:6] + "…" + addr[-4:]


async def _token_symbol_rpc(addr: str) -> str:
    for sel in (SEL_SYMBOL, SEL_NAME):
        for attempt in range(3):
            try:
                raw = await CHAIN.eth_call(addr, sel)
                s = _decode_str(bytes(raw)) if raw else ""
                if s:
                    return s
                break                        # kontrakt odpowiedzial pusto: probuj kolejny selektor
            except Exception:  # noqa - RPC 429/timeout: retry
                await asyncio.sleep(0.5 * (attempt + 1))
    return f"{addr[:6]}…{addr[-4:]}"


def symbol_missing(sym: str | None) -> bool:
    return not sym or sym.strip() in ("?", "")


# ---- project socials: screener API (RadarDex/Tolly/others) + ArcToolsPad on-chain meta ----
import time as _time

import aiohttp as _aiohttp

_socials = {"map": {}, "ts": 0.0}
ARCPAD_META_SEL = "0xe021deff"  # meta(address)


def _dec_meta_string(body: str, head_idx: int) -> str:
    """Decode a dynamic string from the meta() tuple return data."""
    try:
        off = int(body[head_idx * 64:(head_idx + 1) * 64], 16) * 2
        ln = int(body[off:off + 64], 16)
        raw = body[off + 64:off + 64 + ln * 2]
        return bytes.fromhex(raw).decode("utf-8", errors="ignore")
    except Exception:  # noqa
        return ""


async def token_socials(token: str) -> dict:
    """{website, twitter, telegram, icon} for a token, best-effort, cached 10 min."""
    now = _time.time()
    if now - _socials["ts"] > 600:
        _socials["ts"] = now
        try:
            async with _aiohttp.ClientSession(timeout=_aiohttp.ClientTimeout(total=12)) as s:
                async with s.get("https://api.radardex.pro/tokens") as r:
                    d = await r.json()
            m = {}
            for t in d.get("tokens", []) or []:
                if t.get("address") and (t.get("website") or t.get("twitter") or t.get("telegram") or t.get("icon")):
                    m[t["address"].lower()] = {
                        "icon": t.get("icon"),
                        "telegram": t.get("telegram"), "twitter": t.get("twitter"), "website": t.get("website"),
                    }
            _socials["map"] = m
        except Exception:  # noqa
            pass
    hit = _socials["map"].get(token.lower())
    if hit:
        return hit
    # ArcToolsPad token? socials live on-chain in meta(), logo on the site
    try:
        res = await CHAIN.eth_call(ARCPAD, ARCPAD_META_SEL + _pad(token))
        if not res or len(res) < 64 * 3 or int.from_bytes(res[0:32], "big") == 0:
            res = await CHAIN.eth_call(ARCPAD_V3, ARCPAD_META_SEL + _pad(token))
        body = res.hex().replace("0x", "")
        if len(body) >= 64 * 10 and body[24:64] == token[2:].lower().rjust(40, "0"):
            out = {
                "icon": f"https://arctools.fun/api/pad-logo/{token.lower()}",
                "telegram": _dec_meta_string(body, 8) or None,
                "twitter": _dec_meta_string(body, 7) or None,
                "website": _dec_meta_string(body, 6) or None,
            }
            _socials["map"][token.lower()] = out
            return out
    except Exception:  # noqa
        pass
    return {}
