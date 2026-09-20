import asyncio
import os
"""Async multi-RPC reader.

Every read walks the configured endpoints in order and returns the first answer. That is fine while they are
all healthy — and a trap when one of them HANGS instead of refusing: the Warsaw backup stopped refusing
connections and started swallowing them, so every call paid its full 10 s timeout before falling through to
the node that works. Two block timestamps per scan window turned into 68 s of the 69 s scan, and the index
fell 210 blocks behind the chain.

So an endpoint that fails is now benched for a cooldown, healthy endpoints are tried first, and every attempt
has its own deadline, shorter than the transport timeout.
"""
import logging
import time

from web3 import AsyncWeb3, AsyncHTTPProvider
from .config import CFG

log = logging.getLogger("chain")

ATTEMPT_TIMEOUT = 6.0      # one endpoint's deadline; the transport timeout (10 s) is the backstop
BENCH_S = 120.0            # how long a failing endpoint stays out of the rotation

ERC20_ABI = [
    {"name": "symbol", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "decimals", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
]


class Chain:
    def __init__(self, urls: list[str]):
        self.urls = list(urls)
        self.w3s = [AsyncWeb3(AsyncHTTPProvider(u, request_kwargs={"timeout": 10, "headers": {"Content-Type": "application/json", "X-Priority": "high", "X-Relay-Key": os.getenv("RELAY_KEY", ""), "User-Agent": "arcbuybot/1.0"}})) for u in urls]
        self._i = 0
        self._benched: dict[int, float] = {}      # index -> when it may be tried again

    @property
    def w3(self) -> AsyncWeb3:
        w = self.w3s[self._i % len(self.w3s)]
        self._i += 1
        return w

    # ---------------- endpoint health ----------------

    def _order(self) -> list[int]:
        """Healthy endpoints first, benched ones last (never dropped: they are the fallback of last resort)."""
        now = time.time()
        live = [i for i in range(len(self.w3s)) if self._benched.get(i, 0.0) <= now]
        dead = [i for i in range(len(self.w3s)) if self._benched.get(i, 0.0) > now]
        return live + dead

    def _bench(self, i: int, err: Exception) -> None:
        if self._benched.get(i, 0.0) <= time.time():
            log.warning("rpc %s benched for %.0fs: %s", self.urls[i][:40], BENCH_S, str(err)[:90])
        self._benched[i] = time.time() + BENCH_S

    def _revive(self, i: int) -> None:
        if self._benched.pop(i, None):
            log.info("rpc %s answering again", self.urls[i][:40])

    async def _try(self, make):
        """Run `make(w3)` against the endpoints in health order, with a deadline on each."""
        last: Exception | None = None
        for i in self._order():
            try:
                out = await asyncio.wait_for(make(self.w3s[i]), timeout=ATTEMPT_TIMEOUT)
                self._revive(i)
                return out
            except asyncio.TimeoutError as e:        # a hang is worse than a refusal: bench it
                self._bench(i, e)
                last = e
            except Exception as e:  # noqa
                # a pruned range or a revert is the node answering, not the node being broken
                msg = str(e).lower()
                if not any(k in msg for k in ("prun", "revert", "not found", "exceed", "range", "limit")):
                    self._bench(i, e)
                last = e
        raise last if last else RuntimeError("no rpc endpoint configured")

    # ---------------- reads ----------------

    async def call_any(self, fn_name: str, *args):
        return await self._try(lambda w3: getattr(w3.eth, fn_name)(*args))

    async def block_number(self) -> int:
        return await self._bn()

    async def _bn(self) -> int:
        async def go(w3):
            return await w3.eth.block_number
        return await self._try(go)

    async def get_logs(self, params: dict):
        return await self._try(lambda w3: w3.eth.get_logs(params))

    async def eth_call(self, to: str, data: str) -> bytes:
        return await self._try(lambda w3: w3.eth.call({"to": AsyncWeb3.to_checksum_address(to), "data": data}))

    async def get_tx(self, h):
        return await self._try(lambda w3: w3.eth.get_transaction(h))

    def health(self) -> list[dict]:
        """For /api/rpc-health: which endpoints are currently benched and for how long."""
        now = time.time()
        return [{"url": u, "benched_for_s": round(max(0.0, self._benched.get(i, 0.0) - now), 1)}
                for i, u in enumerate(self.urls)]


CHAIN = Chain(CFG.rpc_urls)
