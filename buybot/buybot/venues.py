"""Venue discovery + swap decoding for a token: canonical Uniswap V3
(RadarDex / ArcPad / Tolly / DYOR V3 positions), DYORSwap V2 pairs and
WarpDex pairs. All pools quote against native USDC (facade, 6 dec)."""
import logging
from eth_abi import encode as abi_encode
from eth_utils import function_signature_to_4byte_selector as sel, to_checksum_address
from .config import CFG
from .chain import CHAIN

log = logging.getLogger("venues")

V3_SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
V2_SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"

# nasz launchpad (arctools.fun/launchpad): event Trade(token idx, trader idx, buy, usdcIn, usdcOut, tokensIn, tokensOut)
ARCPAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE"
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


async def discover_venues(token: str) -> list[dict]:
    """Returns [{address, kind: v3|v2, venue}] pools that exist for token/USDC."""
    token = to_checksum_address(token)
    out = []
    # canonical Uniswap V3, common fee tiers
    for fee in (10000, 3000, 500):
        try:
            data = GET_POOL + _pad(token) + _pad(CFG.usdc) + hex(fee)[2:].rjust(64, "0")
            res = await CHAIN.eth_call(CFG.univ3_factory, data)
            pool = _addr(res.hex())
            if int(pool, 16) != 0:
                out.append({"address": pool, "kind": "v3", "venue": "UniswapV3"})
        except Exception:  # noqa
            pass
    # V2-style factories (DYORSwap, WarpDex)
    for factory, venue in ((CFG.dyor_v2_factory, "DYORSwap"), (CFG.warp_dex_factory, "WarpDex")):
        try:
            data = GET_PAIR + _pad(token) + _pad(CFG.usdc)
            res = await CHAIN.eth_call(factory, data)
            pair = _addr(res.hex())
            if int(pair, 16) != 0:
                out.append({"address": pair, "kind": "v2", "venue": venue})
        except Exception:  # noqa
            pass
    # ArcPad (nasz launchpad): trading na kontrakcie launchpada
    try:
        res = await CHAIN.eth_call(ARCPAD, CURVE_SEL + _pad(token))
        body = res.hex().replace("0x", "")
        if len(body) >= 128 and int(body[64:128], 16) > 0:  # tokenReserve > 0
            out.append({"address": ARCPAD, "kind": "arcpad", "venue": "ArcToolsPad"})
    except Exception:  # noqa
        pass
    return out


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
        return v / 1e18 if v > 0 else None
    except Exception:  # noqa
        return None


async def token_symbol(token: str) -> str:
    try:
        from .chain import ERC20_ABI
        w3 = CHAIN.w3
        c = w3.eth.contract(address=to_checksum_address(token), abi=ERC20_ABI)
        return await c.functions.symbol().call()
    except Exception:  # noqa
        return "?"


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
