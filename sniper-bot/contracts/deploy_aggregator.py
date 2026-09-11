"""Deploy ArcAggregator + mainnet smoke test: split buy (V3 ARCT leg + V4 SHARC is a different token, so test
   per token): 1) buy ARCT via V3 leg, 2) buy SHARC via V4 native leg, 3) quoteV4 SHARC, 4) sell both back with fee."""
import json
import os
import sys
import time

import solcx
from eth_abi import encode, decode
from eth_utils import function_signature_to_4byte_selector as sel
from web3 import Web3

RPC = "https://rpc.arc-scan.org"
PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
SR02 = "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
ARCT = "0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52"
SHARC = "0xbd88cf25a230f971adbf31efa30ed0d1bd3338be"
ZERO = "0x0000000000000000000000000000000000000000"
LEG = "(uint8,address,uint24,(address,address,uint24,int24,address),uint256)"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 90, "headers": {"User-Agent": "Mozilla/5.0"}}))
acct = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])
ME = acct.address
cs = Web3.to_checksum_address


def send(tx, gas):
    tx.update({"gas": gas, "gasPrice": w3.eth.gas_price, "nonce": w3.eth.get_transaction_count(ME), "chainId": 5042})
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).rawTransaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    print(f"  tx {h.hex()[:14]} status {r.status} gas {r.gasUsed}")
    assert r.status == 1, "reverted"
    return r


def bal(tok):
    return int.from_bytes(w3.eth.call({"to": cs(tok), "data": sel("balanceOf(address)") + encode(["address"], [ME])}), "big")


ZERO_KEY = (ZERO, ZERO, 0, 0, ZERO)

if __name__ == "__main__":
    print("deployer", ME, "balance", w3.eth.get_balance(ME) / 1e18)
    if len(sys.argv) > 1 and sys.argv[1].startswith("0x"):
        agg = cs(sys.argv[1])
    else:
        solcx.set_solc_version("0.8.24")
        out = solcx.compile_source(open("ArcAggregator.sol").read(), output_values=["abi", "bin"], optimize=True, optimize_runs=500, via_ir=True)
        c = out["<stdin>:ArcAggregator"]
        print("bytecode", len(c["bin"]) // 2, "bytes")
        data = bytes.fromhex(c["bin"]) + encode(["address", "address", "address"], [cs(PM), cs(SR02), TREASURY])
        r = send({"to": None, "data": data, "value": 0}, 2_400_000)
        agg = r.contractAddress
        json.dump({"aggregator": agg, "abi": c["abi"], "deployedAt": int(time.time())}, open("ArcAggregator.deploy.json", "w"), indent=1)
    print("ArcAggregator:", agg)
    BUY = sel(f"buy(address,{LEG}[],uint256,address,uint16)")
    SELL = sel(f"sell(address,{LEG}[],uint256,address,uint16)")
    T = ["address", f"{LEG}[]", "uint256", "address", "uint16"]

    # 1) V3 leg: 0.05 USDC -> ARCT (fee tier 10000), 1% fee
    amt = int(0.05e18)
    legs = [(1, ZERO, 10000, ZERO_KEY, amt)]
    data = BUY + encode(T, [cs(ARCT), legs, 0, ME, 100])
    g = w3.eth.estimate_gas({"from": ME, "to": agg, "data": data, "value": amt + amt // 100})
    b0 = bal(ARCT); send({"to": agg, "data": data, "value": amt + amt // 100}, g + 80_000)
    got_arct = bal(ARCT) - b0
    print("  V3 buy ARCT:", got_arct / 1e18)

    # 2) V4 native leg: SHARC pool (fee 2500, ts 25, no hook)
    key = (ZERO, cs(SHARC), 2500, 25, ZERO)
    q = w3.eth.call({"to": agg, "data": sel("quoteV4((address,address,uint24,int24,address),address,bool,uint256)") + encode(["(address,address,uint24,int24,address)", "address", "bool", "uint256"], [key, cs(SHARC), True, amt])})
    print("  quoteV4 SHARC for 0.05 USDC:", int.from_bytes(q, "big") / 1e18)
    legs = [(2, ZERO, 0, key, amt)]
    data = BUY + encode(T, [cs(SHARC), legs, 0, ME, 100])
    g = w3.eth.estimate_gas({"from": ME, "to": agg, "data": data, "value": amt + amt // 100})
    b0 = bal(SHARC); send({"to": agg, "data": data, "value": amt + amt // 100}, g + 80_000)
    got_sharc = bal(SHARC) - b0
    print("  V4 buy SHARC:", got_sharc / 1e18)

    # 3) sells with fee -> native back
    for tok, got, legs in ((ARCT, got_arct, [(1, ZERO, 10000, ZERO_KEY, got_arct)]), (SHARC, got_sharc, [(2, ZERO, 0, key, got_sharc)])):
        if got <= 0:
            continue
        send({"to": cs(tok), "data": sel("approve(address,uint256)") + encode(["address", "uint256"], [agg, 2 ** 256 - 1]), "value": 0}, 100_000)
        data = SELL + encode(T, [cs(tok), legs, 0, ME, 100])
        g = w3.eth.estimate_gas({"from": ME, "to": agg, "data": data})
        u0 = w3.eth.get_balance(ME); send({"to": agg, "data": data, "value": 0}, g + 80_000)
        print(f"  sold {tok[:8]}: native delta {(w3.eth.get_balance(ME) - u0) / 1e18:.6f} (incl gas)")
    print("balance", w3.eth.get_balance(ME) / 1e18)
