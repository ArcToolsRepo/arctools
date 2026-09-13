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
        self.w3s = [AsyncWeb3(AsyncHTTPProvider(u, request_kwargs={"timeout": 6})) for u in rpc_urls]
        self.chain_id = chain_id
        self._i = 0
        self._down: dict[int, float] = {}  # idx -> unix ts do kiedy w kwarantannie
        self._gp_cache: tuple[int, float] | None = None  # (gas_price, ts)

    def _mark_down(self, idx: int, err: Exception):
        msg = str(err).lower()
        if any(s in msg for s in ("quota", "exceeded", "429", "too many", "rate limit", "-32600", "-32005")):
            self._down[idx] = time.time() + 600  # 10 min kwarantanny
            log.warning("RPC %s w kwarantannie 10min: %s", self.urls[idx].split("/")[2], err)

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

    async def call_any(self, fn):
        """Wykonaj fn(w3) na pierwszym zywym RPC; przy bledzie failover na kolejne."""
        last: Exception | None = None
        for idx in self._alive():
            try:
                return await fn(self.w3s[idx])
            except Exception as e:  # noqa
                last = e
                msg = str(e).lower()
                # deterministic on-chain outcome (revert / no pool / bad call): every RPC would answer the same —
                # failing over just multiplies the latency by the number of RPCs
                if any(k in msg for k in ("execution reverted", "revert", "contractlogicerror", "outoffunds", "invalid opcode", "out of gas")):
                    raise
                self._mark_down(idx, e)
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
