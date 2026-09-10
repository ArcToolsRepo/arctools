"""Adaptery launchpadow ARC mainnet. Sell tax ignorujemy - kupujemy za wszelka cene.

Mechanika USDC na ARC:
  - gas / msg.value: natywne USDC, skala 1e18
  - ERC-20 facade 0x3600...0000 (6 decimals) - widok na natywne saldo;
    pooly Uniswap V3 paruja z facade, wiec swapy ida przez approve+transferFrom (1e6)

router_kind:
  univ3  - SwapRouter02 exactInputSingle, tokenIn = facade (approve, bez value)
  v2     - router V2-style, natywne value (swapExactETHForTokens...)
  curve  - payable buy(...) na kontrakcie curve (adres z eventu lub factory)
"""
import logging
import time
from eth_abi import encode as abi_encode
from eth_utils import function_signature_to_4byte_selector, to_checksum_address
from .config import CFG, load_pads
from .chain import CHAIN

log = logging.getLogger("pads")

DEADLINE = lambda: int(time.time()) + 120
USDC_FACADE_DECIMALS = 6


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
    for fee in (10000, 3000, 500):
        try:
            data = _sel("quoteExactInputSingle((address,address,uint256,uint24,uint160))") + abi_encode(
                ["(address,address,uint256,uint24,uint160)"],
                [(to_checksum_address(token), to_checksum_address(CFG.wrapped_usdc),
                  int(amount_tokens), fee, 0)])
            res = await CHAIN.call_any(
                lambda w3, d=data: w3.eth.call({"to": to_checksum_address(CFG.univ3_quoter), "data": d}))
            out = int.from_bytes(res[:32], "big")
            if out > 0:
                return out / 10 ** USDC_FACADE_DECIMALS
        except Exception:  # noqa - brak poola na tym fee -> kolejny tier
            continue
    # token z naszego launchpada (brak poola V3): quoteSell na curve
    v = await _arcpad_quote("d98b2f5c", token, amount_tokens)
    return v / 1e18 if v is not None else None


async def quote_usdc_to_token(token: str, amount_usdc: float) -> int | None:
    """Estimated tokens out for `amount_usdc` via QuoterV2 (fee tier fallback)."""
    if not (CFG.univ3_quoter and CHAIN) or amount_usdc <= 0:
        return None
    for fee in (10000, 3000, 500):
        try:
            data = _sel("quoteExactInputSingle((address,address,uint256,uint24,uint160))") + abi_encode(
                ["(address,address,uint256,uint24,uint160)"],
                [(to_checksum_address(CFG.wrapped_usdc), to_checksum_address(token),
                  usdc_units(amount_usdc), fee, 0)])
            res = await CHAIN.call_any(
                lambda w3, d=data: w3.eth.call({"to": to_checksum_address(CFG.univ3_quoter), "data": d}))
            out = int.from_bytes(res[:32], "big")
            if out > 0:
                return out
        except Exception:  # noqa
            continue
    # ArcPad curve fallback: quoteBuy (kwoty natywne 1e18)
    return await _arcpad_quote("0d7a94f6", token, usdc_native(amount_usdc))


async def token_overview(token: str) -> dict:
    """Symbol/decimals + spot price info for the CA panel."""
    out = {"symbol": "?", "decimals": 18, "price_1m": None}
    if not CHAIN:
        return out
    ca = to_checksum_address(token)
    try:
        out["symbol"] = await CHAIN.call_any(
            lambda w3: CHAIN.erc20(ca, w3).functions.symbol().call())
    except Exception:  # noqa
        pass
    try:
        out["decimals"] = int(await CHAIN.call_any(
            lambda w3: CHAIN.erc20(ca, w3).functions.decimals().call()))
    except Exception:  # noqa
        pass
    out["price_1m"] = await quote_token_usdc(token, 10 ** out["decimals"] * 1_000_000)
    return out
