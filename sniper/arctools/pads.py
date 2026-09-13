"""Adaptery launchpadow ARC mainnet. Sell tax ignorujemy - kupujemy za wszelka cene.

Mechanika USDC na ARC:
  - gas / msg.value: natywne USDC, skala 1e18
  - ERC-20 facade 0x3600...0000 (6 decimals) - widok na natywne saldo;
    pooly Uniswap V3 paruja z facade, wiec swapy ida przez approve+transferFrom (1e6)

router_kind:
  univ3  - SwapRouter02 exactInputSingle, tokenIn = facade (approve, bez value)
  v2     - router V2-style, natywne value (swapExactETHForTokens...)
  curve  - payable buy(...) na kontrakcie curve (adres z eventu lub factory)
  univ4  - Uniswap V4 przez nasz ArcV4Router.swapExactIn(PoolKey, zeroForOne, amountIn, minOut, to, feeBps=0):
           natywne USDC (0x0) jako msg.value albo fasada 0x3600 przez approve+transferFrom (6 dec).
           PoolKey z eventu Initialize (przy launchu) albo z API Arc Insider (/api/v4pool), fallback: skan logow.
"""
import asyncio
import logging
import time
from eth_abi import encode as abi_encode
from eth_utils import function_signature_to_4byte_selector, to_checksum_address
from .config import CFG, load_pads
from .chain import CHAIN

log = logging.getLogger("pads")

DEADLINE = lambda: int(time.time()) + 120
USDC_FACADE_DECIMALS = 6

# ---- Uniswap V4 on Arc ----
UNIVERSAL_ROUTER = "0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1"   # canonical UR (facade path broken for us — unused)
ARC_V4_ROUTER = "0x05a0158EF87E8E7bFE4E0242e11dda75f83954e1"     # our ownerless router, tested mainnet 2026-09-11
PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3"
V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
V4_INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
NATIVE = "0x0000000000000000000000000000000000000000"
INSIDER_API = "https://bot-production-4200.up.railway.app"
CMD_V4_SWAP = 0x10
ACT_SWAP_EXACT_IN_SINGLE, ACT_SETTLE_ALL, ACT_TAKE_ALL = 0x06, 0x0c, 0x0f
_v4_keys: dict[str, dict] = {}


def poolkey_from_init_log(lg, token: str) -> dict | None:
    """PoolKey z eventu Initialize(id, currency0 idx, currency1 idx, fee, tickSpacing, hooks, sqrtPrice, tick)."""
    topics = [t.hex() if hasattr(t, "hex") else str(t) for t in lg["topics"]]
    topics = [t if t.startswith("0x") else "0x" + t for t in topics]
    if len(topics) < 4 or topics[0].lower() != V4_INIT_TOPIC:
        return None
    c0, c1 = ("0x" + topics[2][-40:]).lower(), ("0x" + topics[3][-40:]).lower()
    if token.lower() not in (c0, c1):
        return None
    data = lg["data"]
    data = (data.hex() if hasattr(data, "hex") else str(data)).replace("0x", "")
    return {"id": topics[1].lower(), "currency0": c0, "currency1": c1, "fee": int(data[0:64], 16),
            "tick_spacing": int.from_bytes(bytes.fromhex(data[64:128]), "big", signed=True),
            "hooks": "0x" + data[128:192][-40:]}


async def resolve_v4_key(token: str, blocks_back: int = 100_000) -> dict | None:
    """PoolKey tokena: cache -> Arc Insider API -> skan Initialize na PoolManagerze (10k okien)."""
    t = token.lower()
    if t in _v4_keys:
        return _v4_keys[t]
    import aiohttp
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.get(f"{INSIDER_API}/api/v4pool", params={"token": t},
                                timeout=aiohttp.ClientTimeout(total=6)) as r:
                j = await r.json()
        pools = [x for x in (j.get("pools") or []) if x.get("fee") is not None]
        if pools:
            best = sorted(pools, key=lambda x: -(x.get("swaps") or 0))[0]
            key = {"id": best["id"], "currency0": best["currency0"], "currency1": best["currency1"],
                   "fee": int(best["fee"]), "tick_spacing": int(best["tick_spacing"]), "hooks": best["hooks"]}
            _v4_keys[t] = key
            return key
    except Exception as e:  # noqa
        log.debug("v4pool api: %s", e)
    try:
        head = await CHAIN.w3.eth.block_number
        tok_topic = "0x" + t[2:].rjust(64, "0")
        for a in range(head, max(0, head - blocks_back), -9_999):
            for pos in (3, 2):  # token zwykle currency1 (USDC natywne 0x0 / fasada 0x3600 jest currency0)
                topics = [V4_INIT_TOPIC, None, None, None]
                topics[pos] = tok_topic
                logs = await CHAIN.get_logs(address=to_checksum_address(V4_POOL_MANAGER), topics=topics,
                                            from_block=max(0, a - 9_998), to_block=a)
                for lg in logs:
                    key = poolkey_from_init_log(lg, t)
                    if key:
                        _v4_keys[t] = key
                        return key
    except Exception as e:  # noqa
        log.warning("resolve_v4_key %s: %s", token, e)
    return None


def v4_usdc_currency(key: dict, token: str) -> str:
    """The USDC side of the pool: native 0x0 (18 dec, msg.value) or the ERC-20 facade 0x3600 (6 dec, Permit2)."""
    c0, c1 = key["currency0"].lower(), key["currency1"].lower()
    return c1 if c0 == token.lower() else c0


def v4_usdc_units(key: dict, token: str, amount_usdc: float) -> int:
    return usdc_native(amount_usdc) if v4_usdc_currency(key, token) == NATIVE else usdc_units(amount_usdc)


def _v4_swap_calldata(key: dict, token: str, recipient: str, amount_in: int, min_out: int, buy: bool,
                      fee_bps: int = 0) -> bytes:
    """ArcV4Router.swapExactIn — sniper passes fee_bps=0 (it charges its own 1%)."""
    c0, c1 = to_checksum_address(key["currency0"]), to_checksum_address(key["currency1"])
    token = to_checksum_address(token)
    zero_for_one = (c0 != token) if buy else (c0 == token)   # input currency == currency0 -> zeroForOne
    pool_key = (c0, c1, int(key["fee"]), int(key["tick_spacing"]), to_checksum_address(key["hooks"]))
    return _sel("swapExactIn((address,address,uint24,int24,address),bool,uint256,uint256,address,uint16)") + abi_encode(
        ["(address,address,uint24,int24,address)", "bool", "uint256", "uint256", "address", "uint16"],
        [pool_key, zero_for_one, amount_in, min_out, to_checksum_address(recipient), fee_bps])


async def permit2_allowance(owner: str, token: str, spender: str) -> int:
    """Permit2.allowance(owner, token, spender) -> (amount uint160, expiration uint48, nonce); 0 if expired."""
    try:
        data = _sel("allowance(address,address,address)") + abi_encode(
            ["address", "address", "address"], [to_checksum_address(owner), to_checksum_address(token), to_checksum_address(spender)])
        res = await CHAIN.call_any(lambda w3, d=data: w3.eth.call({"to": to_checksum_address(PERMIT2), "data": d}))
        amount = int.from_bytes(res[0:32], "big")
        exp = int.from_bytes(res[32:64], "big")
        return amount if exp > time.time() + 60 else 0
    except Exception:  # noqa
        return 0


def permit2_approve_calldata(token: str, spender: str, amount: int) -> bytes:
    return _sel("approve(address,address,uint160,uint48)") + abi_encode(
        ["address", "address", "uint160", "uint48"],
        [to_checksum_address(token), to_checksum_address(spender), min(amount, 2 ** 160 - 1), 2 ** 48 - 1])


def _sel(sig: str) -> bytes:
    return function_signature_to_4byte_selector(sig)


def usdc_native(amount: float) -> int:
    """natywne USDC (msg.value) - 1e18"""
    return int(amount * 1e18)


def usdc_units(amount: float) -> int:
    """USDC na facade ERC-20 - 1e6"""
    return int(amount * 10 ** USDC_FACADE_DECIMALS)


class Pad:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.name = cfg["name"]
        self.type = cfg.get("type", "instant_pool")
        self.factory = cfg.get("factory", "")
        self.event_topic = (cfg.get("event_topic") or "").lower()
        self.migration_topic = (cfg.get("migration_topic") or "").lower()
        self.token_arg_index = cfg.get("token_arg_index", 0)
        self.curve_arg_index = cfg.get("curve_arg_index")
        self.router_kind = cfg.get("router_kind", "curve" if self.type == "curve" else "univ3")

    # ---- parsowanie eventu launchu ----
    def parse_log(self, lg) -> dict | None:
        """zwraca {token, curve?} z eventu fabryki"""
        topics = [t.hex() if hasattr(t, "hex") else t for t in lg["topics"]]
        topics = [t if t.startswith("0x") else "0x" + t for t in topics]
        data = lg["data"]
        data = data.hex() if hasattr(data, "hex") else str(data)
        data = data[2:] if data.startswith("0x") else data

        def arg(idx: int) -> str | None:
            try:
                if idx + 1 < len(topics):  # indexed
                    return to_checksum_address("0x" + topics[idx + 1][-40:])
                off = (idx + 1 - len(topics)) * 64
                return to_checksum_address("0x" + data[off:off + 64][-40:])
            except Exception:  # noqa
                return None

        try:
            if self.token_arg_index == -1:  # UniV3 PoolCreated: token0/token1 indexed
                t0 = to_checksum_address("0x" + topics[1][-40:])
                t1 = to_checksum_address("0x" + topics[2][-40:])
                w = to_checksum_address(CFG.wrapped_usdc)
                if t0 == w:
                    return {"token": t1}
                if t1 == w:
                    return {"token": t0}
                return None  # pool bez USDC - pomijamy
            out = {"token": arg(self.token_arg_index)}
            if out["token"] is None:
                return None
            if self.curve_arg_index is not None:
                out["curve"] = arg(self.curve_arg_index)
            return out
        except Exception as e:  # noqa
            log.warning("parse_log %s: %s", self.name, e)
            return None

    # ---- calldata kupna: (to, data, value_wei, approve_spender|None) ----
    def buy_calldata(self, token: str, recipient: str, amount_usdc: float,
                     min_out: int = 0, curve: str | None = None):
        token = to_checksum_address(token)
        if self.router_kind == "univ3":
            router = to_checksum_address(self.cfg.get("router") or CFG.univ3_router)
            fee = int(self.cfg.get("fee_tier", 10000))
            amount_in = usdc_units(amount_usdc)
            params = abi_encode(
                ["(address,address,uint24,address,uint256,uint256,uint160)"],
                [(to_checksum_address(CFG.wrapped_usdc), token, fee,
                  to_checksum_address(recipient), amount_in, min_out, 0)])
            data = _sel("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))") + params
            return router, data, 0, router  # approve facade -> router
        if self.router_kind == "v3path":
            # curve = {"mid": stock, "fee1": USDC/stock tier, "fee2": stock/token tier}
            hop = curve if isinstance(curve, dict) and curve.get("mid") else None
            if not hop:
                raise RuntimeError("stock hop unresolved for " + token)
            router = to_checksum_address(CFG.univ3_router)
            path = (bytes.fromhex(CFG.wrapped_usdc[2:]) + int(hop["fee1"]).to_bytes(3, "big")
                    + bytes.fromhex(hop["mid"][2:]) + int(hop["fee2"]).to_bytes(3, "big") + bytes.fromhex(token[2:]))
            params = abi_encode(["(bytes,address,uint256,uint256)"],
                                [(path, to_checksum_address(recipient), usdc_units(amount_usdc), min_out)])
            data = _sel("exactInput((bytes,address,uint256,uint256))") + params
            return router, data, 0, router  # approve facade -> router
        if self.router_kind == "univ4":
            key = curve if isinstance(curve, dict) else None
            if not key:
                raise RuntimeError("V4 PoolKey unresolved for " + token)
            amount_in = v4_usdc_units(key, token, amount_usdc)
            data = _v4_swap_calldata(key, token, recipient, amount_in, min_out, buy=True)
            if v4_usdc_currency(key, token) == NATIVE:
                return to_checksum_address(ARC_V4_ROUTER), data, amount_in, None          # native USDC as msg.value
            return to_checksum_address(ARC_V4_ROUTER), data, 0, to_checksum_address(ARC_V4_ROUTER)  # approve facade -> router
        if self.router_kind == "v2":
            router = to_checksum_address(self.cfg["router"])
            path = [to_checksum_address(CFG.wrapped_usdc), token]
            params = abi_encode(["uint256", "address[]", "address", "uint256"],
                                [min_out, path, to_checksum_address(recipient), DEADLINE()])
            data = _sel("swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)") + params
            return router, data, usdc_native(amount_usdc), None
        # curve: payable buy na kontrakcie curve (z eventu) albo factory
        to = to_checksum_address(curve or self.cfg["factory"])
        sig = self.cfg.get("curve_buy_signature", "buy(uint256)")
        argtypes = [t.strip() for t in sig[sig.index("(") + 1:-1].split(",") if t.strip()]
        args = []
        for t in argtypes:
            if t == "address":
                args.append(token)
            elif t.startswith("uint"):
                args.append(min_out)
        data = _sel(sig) + (abi_encode(argtypes, args) if argtypes else b"")
        return to, data, usdc_native(amount_usdc), None

    # ---- calldata sprzedazy: (to, data, approve_spender) ----
    def sell_calldata(self, token: str, recipient: str, amount_tokens: int,
                      min_out: int = 0, curve: str | None = None):
        token = to_checksum_address(token)
        if self.router_kind == "univ3":
            router = to_checksum_address(self.cfg.get("router") or CFG.univ3_router)
            fee = int(self.cfg.get("fee_tier", 10000))
            params = abi_encode(
                ["(address,address,uint24,address,uint256,uint256,uint160)"],
                [(token, to_checksum_address(CFG.wrapped_usdc), fee,
                  to_checksum_address(recipient), amount_tokens, min_out, 0)])
            data = _sel("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))") + params
            return router, data, router
        if self.router_kind == "v3path":
            hop = curve if isinstance(curve, dict) and curve.get("mid") else None
            if not hop:
                raise RuntimeError("stock hop unresolved for " + token)
            router = to_checksum_address(CFG.univ3_router)
            path = (bytes.fromhex(token[2:]) + int(hop["fee2"]).to_bytes(3, "big")
                    + bytes.fromhex(hop["mid"][2:]) + int(hop["fee1"]).to_bytes(3, "big") + bytes.fromhex(CFG.wrapped_usdc[2:]))
            params = abi_encode(["(bytes,address,uint256,uint256)"],
                                [(path, to_checksum_address(recipient), amount_tokens, min_out)])
            data = _sel("exactInput((bytes,address,uint256,uint256))") + params
            return router, data, router
        if self.router_kind == "univ4":
            key = curve if isinstance(curve, dict) else None
            if not key:
                raise RuntimeError("V4 PoolKey unresolved for " + token)
            data = _v4_swap_calldata(key, token, recipient, amount_tokens, min_out, buy=False)
            return to_checksum_address(ARC_V4_ROUTER), data, to_checksum_address(ARC_V4_ROUTER)  # approve token -> router
        if self.router_kind == "v2":
            router = to_checksum_address(self.cfg["router"])
            path = [token, to_checksum_address(CFG.wrapped_usdc)]
            params = abi_encode(["uint256", "uint256", "address[]", "address", "uint256"],
                                [amount_tokens, min_out, path, to_checksum_address(recipient), DEADLINE()])
            data = _sel("swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)") + params
            return router, data, router
        to = to_checksum_address(curve or self.cfg["factory"])
        sig = self.cfg.get("curve_sell_signature", "sell(uint256,uint256)")
        argtypes = [t.strip() for t in sig[sig.index("(") + 1:-1].split(",") if t.strip()]
        args = []
        seen_uint = 0
        for t in argtypes:
            if t == "address":
                args.append(token)
            elif t.startswith("uint"):
                args.append(amount_tokens if seen_uint == 0 else min_out)
                seen_uint += 1
        data = _sel(sig) + (abi_encode(argtypes, args) if argtypes else b"")
        return to, data, to


PADS: list[Pad] = [Pad(p) for p in load_pads()]


def pad_by_name(name: str) -> Pad | None:
    for p in PADS:
        if p.name.lower() == name.lower():
            return p
    return None


def default_pad() -> Pad | None:
    return pad_by_name("UniswapV3") or (PADS[0] if PADS else None)


def v4_pad() -> Pad | None:
    return pad_by_name("UniswapV4") or next((p for p in PADS if p.router_kind == "univ4"), None)


async def auto_pad(token: str) -> tuple[Pad | None, dict | None]:
    """Venue for a manual buy of an arbitrary token: canonical V3 pool -> UniswapV3; else V4 pool -> univ4 pad
    with its PoolKey; else default. Returns (pad, curve_or_key)."""
    try:
        for fee in (10000, 3000, 500):
            data = _sel("getPool(address,address,uint24)") + abi_encode(
                ["address", "address", "uint24"], [to_checksum_address(token), to_checksum_address(CFG.wrapped_usdc), fee])
            res = await CHAIN.call_any(lambda w3, d=data: w3.eth.call({"to": to_checksum_address(CFG.univ3_factory), "data": d}))
            if int.from_bytes(res[-20:], "big") != 0:
                return default_pad(), None
    except Exception as e:  # noqa
        log.debug("auto_pad v3: %s", e)
    key = await resolve_v4_key(token)
    if key and v4_pad():
        return v4_pad(), key
    # long.supply launches: only market is a V3 pool quoted in a wrapped stock → hop USDC -> stock -> token
    hop = await resolve_stock_hop(token)
    if hop:
        pad = pad_by_name("long.supply") or next((p for p in PADS if p.router_kind == "v3path"), None)
        if pad:
            return pad, hop
    return default_pad(), None


async def resolve_stock_hop(token: str) -> dict | None:
    """Ask the ArcTools route API whether the best route is a two-hop through a wrapped stock (venue 5)."""
    import aiohttp
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get("https://arctools.fun/api/swaproute", params={"token": token.lower(), "side": "buy", "amount": str(10**18)},
                             headers={"User-Agent": "ArcSniper/1.0"}, timeout=aiohttp.ClientTimeout(total=20)) as r:
                if r.status != 200:
                    return None
                j = await r.json()
        for leg in j.get("legs") or []:
            if int(leg.get("venue", 0)) == 5:
                return {"mid": leg["target"], "fee1": int(leg["fee"]), "fee2": int((leg.get("key") or {}).get("fee", 10000))}
    except Exception as e:  # noqa
        log.debug("stock hop %s: %s", token, e)
    return None


ARCPAD_LAUNCHPAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE"


async def _arcpad_quote(selector: str, token: str, amount: int) -> int | None:
    """Quote na naszym launchpadzie: quoteBuy 0x0d7a94f6 / quoteSell 0xd98b2f5c."""
    try:
        data = bytes.fromhex(selector) + abi_encode(["address", "uint256"],
                                                    [to_checksum_address(token), int(amount)])
        res = await CHAIN.call_any(
            lambda w3, d=data: w3.eth.call({"to": to_checksum_address(ARCPAD_LAUNCHPAD), "data": d}))
        out = int.from_bytes(res[:32], "big")
        return out if out > 0 else None
    except Exception:  # noqa
        return None


async def quote_token_usdc(token: str, amount_tokens: int) -> float | None:
    """Value of `amount_tokens` in USDC via QuoterV2 (facade, 6 dec).
    Failover przez wszystkie RPC + fallback fee tierow + fallback ArcPad curve."""
    if not (CFG.univ3_quoter and CHAIN) or amount_tokens <= 0:
        return None
    # all fee tiers + the ArcToolsPad curve quoted in PARALLEL (was sequential: 3 reverting tiers × RPC failover = seconds)
    async def tier(fee: int):
        data = _sel("quoteExactInputSingle((address,address,uint256,uint24,uint160))") + abi_encode(
            ["(address,address,uint256,uint24,uint160)"],
            [(to_checksum_address(token), to_checksum_address(CFG.wrapped_usdc), int(amount_tokens), fee, 0)])
        res = await CHAIN.call_any(lambda w3, d=data: w3.eth.call({"to": to_checksum_address(CFG.univ3_quoter), "data": d}))
        return int.from_bytes(res[:32], "big")
    results = await asyncio.gather(*[tier(f) for f in (10000, 3000, 500)], _arcpad_quote("d98b2f5c", token, amount_tokens), return_exceptions=True)
    best = max((r for r in results[:3] if isinstance(r, int) and r > 0), default=0)
    if best > 0:
        return best / 10 ** USDC_FACADE_DECIMALS
    v = results[3]
    return v / 1e18 if isinstance(v, int) and v > 0 else None


async def quote_usdc_to_token(token: str, amount_usdc: float) -> int | None:
    """Estimated tokens out for `amount_usdc` via QuoterV2 (fee tier fallback)."""
    if not (CFG.univ3_quoter and CHAIN) or amount_usdc <= 0:
        return None
    async def tier(fee: int):
        data = _sel("quoteExactInputSingle((address,address,uint256,uint24,uint160))") + abi_encode(
            ["(address,address,uint256,uint24,uint160)"],
            [(to_checksum_address(CFG.wrapped_usdc), to_checksum_address(token), usdc_units(amount_usdc), fee, 0)])
        res = await CHAIN.call_any(lambda w3, d=data: w3.eth.call({"to": to_checksum_address(CFG.univ3_quoter), "data": d}))
        return int.from_bytes(res[:32], "big")
    results = await asyncio.gather(*[tier(f) for f in (10000, 3000, 500)], _arcpad_quote("0d7a94f6", token, usdc_native(amount_usdc)), return_exceptions=True)
    best = max((r for r in results[:3] if isinstance(r, int) and r > 0), default=0)
    if best > 0:
        return best
    v = results[3]
    return v if isinstance(v, int) and v > 0 else None


async def token_overview(token: str) -> dict:
    """Symbol/decimals + spot price info for the CA panel."""
    out = {"symbol": "?", "decimals": 18, "price_1m": None}
    if not CHAIN:
        return out
    ca = to_checksum_address(token)
    sym, dec, px = await asyncio.gather(
        CHAIN.call_any(lambda w3: CHAIN.erc20(ca, w3).functions.symbol().call()),
        CHAIN.call_any(lambda w3: CHAIN.erc20(ca, w3).functions.decimals().call()),
        quote_token_usdc(token, 10 ** 18 * 1_000_000),
        return_exceptions=True)
    if isinstance(sym, str):
        out["symbol"] = sym
    if isinstance(dec, int):
        out["decimals"] = dec
    out["price_1m"] = px if isinstance(px, (int, float)) else None
    if isinstance(dec, int) and dec != 18:
        out["price_1m"] = await quote_token_usdc(token, 10 ** dec * 1_000_000)
    return out
