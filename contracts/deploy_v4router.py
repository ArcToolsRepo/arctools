"""Deploy ArcV4Router on Arc mainnet and smoke-test: facade pool buy (Arguspad FROG) + native pool buy, 0.05 USDC each."""
import json
import os
import sys
import time

import solcx
from eth_abi import encode
from eth_utils import function_signature_to_4byte_selector as sel
from web3 import Web3

RPC = "https://rpc.arc-scan.org"
POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
FACADE = Web3.to_checksum_address("0x3600000000000000000000000000000000000000")

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 90, "headers": {"User-Agent": "Mozilla/5.0"}}))
acct = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])
ME = acct.address


def send(tx, gas):
    tx.update({"gas": gas, "gasPrice": w3.eth.gas_price, "nonce": w3.eth.get_transaction_count(ME), "chainId": 5042})
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).rawTransaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    print(f"  tx {h.hex()[:14]} status {r.status} gas {r.gasUsed}")
    return r


def pool_key(token, pos=3):
    head = w3.eth.block_number
    topic = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
    for i in range(20):
        topics = [topic, None, None, None]
        topics[pos] = "0x" + token[2:].lower().rjust(64, "0")
        logs = w3.eth.get_logs({"address": Web3.to_checksum_address(POOL_MANAGER), "topics": topics,
                                "fromBlock": head - 9999 * (i + 1), "toBlock": head - 9999 * i})
        if logs:
            lg = logs[0]
            d = lg["data"].hex() if hasattr(lg["data"], "hex") else lg["data"][2:]
            d = d.replace("0x", "")
            t = [x.hex() if hasattr(x, "hex") else x for x in lg["topics"]]
            return (Web3.to_checksum_address("0x" + t[2][-40:]), Web3.to_checksum_address("0x" + t[3][-40:]),
                    int(d[0:64], 16), int.from_bytes(bytes.fromhex(d[64:128]), "big", signed=True),
                    Web3.to_checksum_address("0x" + d[128:192][-40:]))
    return None


if __name__ == "__main__":
    print("deployer", ME, "balance", w3.eth.get_balance(ME) / 1e18)
    if len(sys.argv) > 1 and sys.argv[1].startswith("0x"):
        router = Web3.to_checksum_address(sys.argv[1])
        print("using existing router", router)
    else:
        solcx.set_solc_version("0.8.24")
        out = solcx.compile_source(open("ArcV4Router.sol").read(), output_values=["abi", "bin"],
                                   optimize=True, optimize_runs=500, via_ir=True)
        c = out["<stdin>:ArcV4Router"]
        print("bytecode", len(c["bin"]) // 2, "bytes")
        data = bytes.fromhex(c["bin"]) + encode(["address", "address"], [Web3.to_checksum_address(POOL_MANAGER), TREASURY])
        r = send({"to": None, "data": data, "value": 0}, 1_600_000)
        router = r.contractAddress
        json.dump({"router": router, "abi": c["abi"], "poolManager": POOL_MANAGER, "treasury": TREASURY,
                   "deployedAt": int(time.time())}, open("ArcV4Router.deploy.json", "w"), indent=1)
        print("ArcV4Router:", router)

    SIG = sel("swapExactIn((address,address,uint24,int24,address),bool,uint256,uint256,address,uint16)")
    TYPES = ["(address,address,uint24,int24,address)", "bool", "uint256", "uint256", "address", "uint16"]

    def bal(tok):
        return int.from_bytes(w3.eth.call({"to": Web3.to_checksum_address(tok), "data": sel("balanceOf(address)") + encode(["address"], [ME])}), "big")

    # --- facade pool: Arguspad FROG ---
    frog = "0x859586b1d4c5df3f029c84d82999c8d2e5242990"
    key = pool_key(frog)
    print("FROG key", key)
    if int.from_bytes(w3.eth.call({"to": FACADE, "data": sel("allowance(address,address)") + encode(["address", "address"], [ME, router])}), "big") < 10 ** 12:
        print("approve facade -> router")
        send({"to": FACADE, "data": sel("approve(address,uint256)") + encode(["address", "uint256"], [router, 2 ** 256 - 1]), "value": 0}, 100_000)
    zf1 = key[0] == FACADE
    data = SIG + encode(TYPES, [key, zf1, 50_000, 0, ME, 100])   # 0.05 USDC, 1% fee -> treasury
    g = w3.eth.estimate_gas({"from": ME, "to": router, "data": data})
    print("FROG buy estimate", g)
    b0 = bal(frog)
    send({"to": router, "data": data, "value": 0}, g + 60_000)
    print("  FROG received:", (bal(frog) - b0) / 1e18)

    # --- native pool ---
    nat = "0x3931daf72e7573a3200d4ee06342c015754486ea"
    key = pool_key(nat)
    print("native key", key)
    zf1 = key[0] == "0x0000000000000000000000000000000000000000"
    amt = int(0.05e18)
    data = SIG + encode(TYPES, [key, zf1, amt, 0, ME, 0])
    g = w3.eth.estimate_gas({"from": ME, "to": router, "data": data, "value": amt})
    print("native buy estimate", g)
    b0 = bal(nat)
    send({"to": router, "data": data, "value": amt}, g + 60_000)
    got = bal(nat) - b0
    print("  native token received:", got / 1e18)

    # --- sell back the native token (token -> native USDC), fee 100 on output ---
    if got > 0:
        print("approve token -> router")
        send({"to": Web3.to_checksum_address(nat), "data": sel("approve(address,uint256)") + encode(["address", "uint256"], [router, 2 ** 256 - 1]), "value": 0}, 100_000)
        data = SIG + encode(TYPES, [key, not zf1, got, 0, ME, 100])
        g = w3.eth.estimate_gas({"from": ME, "to": router, "data": data})
        u0 = w3.eth.get_balance(ME)
        send({"to": router, "data": data, "value": 0}, g + 60_000)
        print("  sold; native delta (incl gas):", (w3.eth.get_balance(ME) - u0) / 1e18)
    print("balance", w3.eth.get_balance(ME) / 1e18)
