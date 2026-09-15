import os
"""Async multi-RPC reader (Infura primary, arc-scan fallback)."""
import logging
from web3 import AsyncWeb3, AsyncHTTPProvider
from .config import CFG

log = logging.getLogger("chain")

ERC20_ABI = [
    {"name": "symbol", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "decimals", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
]


class Chain:
    def __init__(self, urls: list[str]):
        self.w3s = [AsyncWeb3(AsyncHTTPProvider(u, request_kwargs={"timeout": 10, "headers": {"X-Priority": "high", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "User-Agent": "arcbuybot/1.0"}})) for u in urls]
        self._i = 0

    @property
    def w3(self) -> AsyncWeb3:
        w = self.w3s[self._i % len(self.w3s)]
        self._i += 1
        return w

    async def call_any(self, fn_name: str, *args):
        last = None
        for w3 in self.w3s:
            try:
                return await getattr(w3.eth, fn_name)(*args)
            except Exception as e:  # noqa
                last = e
        raise last

    async def block_number(self) -> int:
        return await self.call_any("block_number") if False else await self._bn()

    async def _bn(self) -> int:
        last = None
        for w3 in self.w3s:
            try:
                return await w3.eth.block_number
            except Exception as e:  # noqa
                last = e
        raise last

    async def get_logs(self, params: dict):
        last = None
        for w3 in self.w3s:
            try:
                return await w3.eth.get_logs(params)
            except Exception as e:  # noqa
                last = e
        raise last

    async def eth_call(self, to: str, data: str) -> bytes:
        last = None
        for w3 in self.w3s:
            try:
                return await w3.eth.call({"to": AsyncWeb3.to_checksum_address(to), "data": data})
            except Exception as e:  # noqa
                last = e
        raise last

    async def get_tx(self, h):
        last = None
        for w3 in self.w3s:
            try:
                return await w3.eth.get_transaction(h)
            except Exception as e:  # noqa
                last = e
        raise last


CHAIN = Chain(CFG.rpc_urls)
