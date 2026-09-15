import os
"""Multi-RPC: odczyty round-robin, broadcast race na wszystkie endpointy."""
import asyncio
import logging
import time
from web3 import AsyncWeb3, AsyncHTTPProvider
from web3.exceptions import Web3Exception
from .config import CFG

log = logging.getLogger("chain")

ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "decimals", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
    {"name": "symbol", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "s", "type": "address"}, {"name": "a", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
]


class Chain:
    def __init__(self, rpc_urls: list[str], chain_id: int):
        assert rpc_urls, "ARC_RPC_URLS puste"
        self.urls = list(rpc_urls)
        import os
        send_auth = os.getenv("RPC_SEND_AUTH", "")

        def _prov(u: str):
            # our relay: priority lane (skips its batch queue) + send-auth (unlocks broadcast through it)
            hdr = {"Content-Type": "application/json", "User-Agent": "arcsniper/1.0"}
            if "railway.app" in u or "arctools" in u:
                hdr["X-Priority"] = "high"
                if os.getenv("RELAY_KEY"):
                    hdr["X-Relay-Key"] = os.getenv("RELAY_KEY", "")
                if send_auth:
                    hdr["X-Send-Auth"] = send_auth
            return AsyncWeb3(AsyncHTTPProvider(u, request_kwargs={"timeout": 4, "headers": hdr}))
        self.w3s = [_prov(u) for u in rpc_urls]
        self.chain_id = chain_id
        self._i = 0
        self._down: dict[int, float] = {}  # idx -> unix ts do kiedy w kwarantannie
        self._gp_cache: tuple[int, float] | None = None  # (gas_price, ts)

    def _mark_down(self, idx: int, err: Exception):
        msg = str(err).lower()
        if any(s in msg for s in ("quota", "exceeded", "429", "too many", "rate limit", "-32600", "-32005")):
            # short quarantine: 20 s for our relay (it has its own failover), 90 s for third-party RPCs
            q = 20 if idx == 0 else 90
            self._down[idx] = time.time() + q
            log.warning("RPC %s w kwarantannie %ss: %s", self.urls[idx].split("/")[2], q, str(err)[:120])

    def _alive(self) -> list[int]:
        now = time.time()
        idx = [i for i in range(len(self.w3s)) if self._down.get(i, 0) <= now]
        return idx or list(range(len(self.w3s)))  # wszystkie padly -> probuj mimo to

    @property
    def w3(self) -> AsyncWeb3:
        alive = self._alive()
        w = self.w3s[alive[self._i % len(alive)]]
        self._i += 1
        return w

    _DETERMINISTIC = ("execution reverted", "revert", "contractlogicerror", "outoffunds", "invalid opcode", "out of gas")

    async def call_any(self, fn, hedge: float = 0.8):
        """Hedged read: start on the primary; if it has not answered within `hedge` seconds, fire the same call on
        every other live RPC in parallel and take the first success. A slow RPC costs 0.8 s, never a 6 s timeout
        times the number of endpoints. Deterministic on-chain errors (revert) are returned immediately."""
        alive = self._alive()
        tasks: list[asyncio.Task] = [asyncio.create_task(fn(self.w3s[alive[0]]))]
        idx_of = {tasks[0]: alive[0]}
        last: Exception | None = None
        try:
            done, _ = await asyncio.wait(tasks, timeout=hedge)
            if not done:
                for i in alive[1:]:
                    t = asyncio.create_task(fn(self.w3s[i])); tasks.append(t); idx_of[t] = i
            pending = set(tasks)
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for t in done:
                    try:
                        return t.result()
                    except Exception as e:  # noqa
                        last = e
                        msg = str(e).lower()
                        if any(k in msg for k in self._DETERMINISTIC):
                            raise
                        self._mark_down(idx_of[t], e)
                # primary failed fast and hedges were never started → start them now
                if not pending and len(tasks) == 1 and len(alive) > 1:
                    for i in alive[1:]:
                        t = asyncio.create_task(fn(self.w3s[i])); tasks.append(t); idx_of[t] = i
                    pending = set(tasks[1:])
        finally:
            for t in tasks:
                if not t.done():
                    t.cancel()
        raise last or RuntimeError("all RPC failed")

    def erc20(self, addr: str, w3: AsyncWeb3 | None = None):
        return (w3 or self.w3).eth.contract(address=AsyncWeb3.to_checksum_address(addr), abi=ERC20_ABI)

    async def gas_price(self, mode: str = "turbo") -> int:
        # cache 3s: przy snipe gas price nie zmienia sie miedzy blokami az tak,
        # a oszczedzamy pelny roundtrip RPC na kazdym tx
        now = time.time()
        if self._gp_cache and now - self._gp_cache[1] < 3.0:
            gp = self._gp_cache[0]
        else:
            gp = await self.call_any(lambda w3: w3.eth.gas_price)
            self._gp_cache = (gp, now)
        return int(gp * CFG.gas_mult.get(mode, 3.0))

    async def native_balance(self, addr: str) -> float:
        """Saldo USDC przez facade ERC-20 (6 dec) - widok na natywne saldo."""
        ca = AsyncWeb3.to_checksum_address(addr)
        try:
            return await self.call_any(
                lambda w3: self.erc20(CFG.wrapped_usdc, w3).functions.balanceOf(ca).call()
            ) / 1e6
        except Exception:  # noqa - fallback: natywne saldo 1e18
            return await self.call_any(lambda w3: w3.eth.get_balance(ca)) / 1e18

    async def build_tx(self, acct, to: str, data: bytes | str = b"", value_wei: int = 0,
                       gas_mode: str = "turbo", gas_limit: int | None = None,
                       nonce: int | None = None) -> dict:
        # nonce + gas price rownolegle: -1 roundtrip na kazdym tx
        if nonce is None:
            nonce, gp = await asyncio.gather(
                self.call_any(lambda w3: w3.eth.get_transaction_count(acct.address)),
                self.gas_price(gas_mode))
        else:
            gp = await self.gas_price(gas_mode)
        tx = {
            "chainId": self.chain_id,
            "from": acct.address,
            "to": AsyncWeb3.to_checksum_address(to),
            "value": value_wei,
            "data": data,
            "nonce": nonce,
            "gasPrice": gp,
        }
        if gas_limit:
            tx["gas"] = gas_limit
        else:
            try:
                est = await self.call_any(lambda w3: w3.eth.estimate_gas(tx))
                tx["gas"] = int(est * 1.3)
            except Exception:  # noqa
                tx["gas"] = 800_000  # kup za wszelka cene - nie blokujemy sie na estymacji
        return tx

    async def race_send(self, signed_raw: bytes) -> str:
        """Broadcast rownolegle na wszystkie RPC, zwraca hash pierwszego sukcesu."""
        async def _send(w3):
            return (await w3.eth.send_raw_transaction(signed_raw)).hex()

        tasks = [asyncio.create_task(_send(w)) for w in self.w3s]
        last_err = None
        for fut in asyncio.as_completed(tasks):
            try:
                h = await fut
                for t in tasks:
                    t.cancel()
                return h
            except Exception as e:  # noqa
                last_err = e
        raise last_err or RuntimeError("broadcast failed")

    async def send(self, acct, tx: dict) -> str:
        signed = acct.sign_transaction(tx)
        return await self.race_send(signed.raw_transaction)

    async def wait_receipt(self, tx_hash: str, timeout: float = 30):
        return await self.call_any(lambda w3: w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout))

    async def get_logs(self, address=None, topics=None, from_block=None, to_block=None):
        params = {}
        if address:
            params["address"] = address
        if topics:
            params["topics"] = topics
        params["fromBlock"] = from_block
        params["toBlock"] = to_block
        return await self.call_any(lambda w3: w3.eth.get_logs(params))


CHAIN = Chain(CFG.rpc_urls, CFG.chain_id) if CFG.rpc_urls else None
