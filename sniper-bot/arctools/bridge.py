"""CCTP v2: USDC z ETH/Base/Arbitrum -> natywne USDC na ARC.

Flow: approve USDC -> depositForBurn (TokenMessengerV2) na source chain
      -> attestation z Iris API -> receiveMessage (MessageTransmitterV2) na ARC.
Adresy TokenMessengerV2/MessageTransmitterV2 sa identyczne na wspieranych EVM.
"""
import asyncio
import logging
import aiohttp
from eth_abi import encode as abi_encode
from eth_utils import function_signature_to_4byte_selector as sel, to_checksum_address
from web3 import AsyncWeb3, AsyncHTTPProvider
from .config import CFG
from .chain import CHAIN, ERC20_ABI

log = logging.getLogger("bridge")

TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"   # source EVM chains
ARC_MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275"  # Arc mainnet (docs.arc.io)
ARC_CCTP_DOMAIN_DEFAULT = 26

SOURCES = {
    "eth":  {"rpc_env": "eth_rpc",  "domain": 0, "usdc": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "label": "Ethereum"},
    "base": {"rpc_env": "base_rpc", "domain": 6, "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "label": "Base"},
    "arb":  {"rpc_env": "arb_rpc",  "domain": 3, "usdc": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "label": "Arbitrum"},
}


def _w3(src: dict) -> AsyncWeb3 | None:
    url = getattr(CFG, src["rpc_env"], "")
    return AsyncWeb3(AsyncHTTPProvider(url)) if url else None


def _addr32(a: str) -> bytes:
    return bytes(12) + bytes.fromhex(a[2:])


async def bridge_to_arc(acct, source: str, amount_usdc: float, status_cb=None) -> dict:
    """Burns USDC on the source chain and mints on Arc to the same address."""
    arc_domain = int(CFG.arc_cctp_domain or ARC_CCTP_DOMAIN_DEFAULT)
    src = SOURCES.get(source)
    w3 = _w3(src) if src else None
    if not w3:
        return {"ok": False, "err": f"brak RPC dla {source}"}
    amount = int(amount_usdc * 1e6)
    usdc = w3.eth.contract(address=to_checksum_address(src["usdc"]), abi=ERC20_ABI)
    cid = await w3.eth.chain_id
    nonce = await w3.eth.get_transaction_count(acct.address)
    gp = int(await w3.eth.gas_price * 1.3)

    async def send(to, data, value=0):
        nonlocal nonce
        tx = {"chainId": cid, "from": acct.address, "to": to_checksum_address(to),
              "data": data, "value": value, "nonce": nonce, "gasPrice": gp}
        tx["gas"] = int(await w3.eth.estimate_gas(tx) * 1.3)
        nonce += 1
        signed = acct.sign_transaction(tx)
        h = (await w3.eth.send_raw_transaction(signed.raw_transaction)).hex()
        await w3.eth.wait_for_transaction_receipt(h, timeout=180)
        return h

    try:
        allowance = await usdc.functions.allowance(acct.address, TOKEN_MESSENGER_V2).call()
        if allowance < amount:
            if status_cb:
                await status_cb("1/4 approve USDC…")
            await send(src["usdc"], usdc.encode_abi("approve", [to_checksum_address(TOKEN_MESSENGER_V2), 2**256 - 1]))
        if status_cb:
            await status_cb("2/4 depositForBurn…")
        # depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)
        data = sel("depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)") + abi_encode(
            ["uint256", "uint32", "bytes32", "address", "bytes32", "uint256", "uint32"],
            [amount, arc_domain, _addr32(acct.address),
             to_checksum_address(src["usdc"]), bytes(32), 0, 1000])  # maxFee=0, standard transfer
        burn_tx = await send(TOKEN_MESSENGER_V2, data)
        if status_cb:
            await status_cb(f"3/4 waiting for Circle attestation... (tx {burn_tx[:14]}...)")
        message, attestation = await _wait_attestation(src["domain"], burn_tx)
        if status_cb:
            await status_cb("4/4 minting on Arc...")
        # receiveMessage on Arc
        rdata = sel("receiveMessage(bytes,bytes)") + abi_encode(["bytes", "bytes"], [message, attestation])
        tx = await CHAIN.build_tx(acct, ARC_MESSAGE_TRANSMITTER_V2, rdata, gas_mode="fast")
        h = await CHAIN.send(acct, tx)
        await CHAIN.wait_receipt(h, timeout=60)
        # bridge service fee (native USDC on Arc)
        try:
            fee = amount_usdc * CFG.bridge_fee_bps / 10_000
            if fee > 0 and CFG.fee_wallet:
                ftx = await CHAIN.build_tx(acct, CFG.fee_wallet, b"",
                                           value_wei=int(fee * 1e18),
                                           gas_mode="normal", gas_limit=30_000)
                await CHAIN.send(acct, ftx)
        except Exception as e:  # noqa
            log.warning("bridge fee transfer failed: %s", e)
        return {"ok": True, "burn_tx": burn_tx, "mint_tx": h}
    except Exception as e:  # noqa
        log.exception("bridge")
        return {"ok": False, "err": str(e)[:300]}


async def _wait_attestation(domain: int, tx_hash: str, timeout: int = 600):
    url = f"{CFG.iris_api}/v2/messages/{domain}?transactionHash={tx_hash if tx_hash.startswith('0x') else '0x' + tx_hash}"
    async with aiohttp.ClientSession() as s:
        for _ in range(timeout // 3):
            async with s.get(url) as r:
                if r.status == 200:
                    j = await r.json()
                    msgs = j.get("messages") or []
                    if msgs and msgs[0].get("status") == "complete":
                        m = msgs[0]
                        return (bytes.fromhex(m["message"][2:]),
                                bytes.fromhex(m["attestation"][2:]))
            await asyncio.sleep(3)
    raise TimeoutError("attestation timeout")
