"""Deploy ArcAggregatorV2 (adds VENUE_V3PATH two-hop V3 leg) from the pre-compiled build and run a mainnet smoke test:
   1) V3PATH buy: 1 USDC -> CRCL -> LONG (long.supply pair), 1.5% fee to treasury
   2) V3PATH sell: all LONG bought -> CRCL -> USDC
   3) plain V3 leg still works (0.05 USDC -> ARCT)
Usage: DEPLOYER_KEY=... python deploy_aggregator_v2.py [existing_v2_address]"""
import json
import os
import sys
import time

from eth_abi import encode
from eth_utils import function_signature_to_4byte_selector as sel
from web3 import Web3

RPC = os.environ.get("ARC_RPC", "https://rpc.arc-scan.org")
PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
SR02 = "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
USDC = "0x3600000000000000000000000000000000000000"
CRCL = "0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b"
LONG = "0x2164bb17a2d38c1b5170e987b2c0416df1efc752"
ARCT = "0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52"
ZERO = "0x0000000000000000000000000000000000000000"
LEG = "(uint8,address,uint24,(address,address,uint24,int24,address),uint256)"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120, "headers": {"User-Agent": "Mozilla/5.0"}}))
acct = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])
ME = acct.address
cs = Web3.to_checksum_address


def send(tx, gas):
    tx.update({"gas": gas, "gasPrice": w3.eth.gas_price, "nonce": w3.eth.get_transaction_count(ME), "chainId": 5042})
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(getattr(signed, "rawTransaction", None) or signed.raw_transaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=240)
    print(f"  tx {h.hex()[:14]} status {r.status} gas {r.gasUsed}")
    assert r.status == 1, "reverted"
    return r


def bal(tok, who=None):
    return int.from_bytes(w3.eth.call({"to": cs(tok), "data": sel("balanceOf(address)") + encode(["address"], [who or ME])}), "big")


ZERO_KEY = (ZERO, ZERO, 0, 0, ZERO)

if __name__ == "__main__":
    print("deployer", ME, "balance", w3.eth.get_balance(ME) / 1e18)
    build = json.load(open("ArcAggregatorV2.build.json"))
    if len(sys.argv) > 1 and sys.argv[1].startswith("0x"):
        agg = cs(sys.argv[1])
    else:
        print("bytecode", len(build["bin"]) // 2, "bytes")
        data = bytes.fromhex(build["bin"]) + encode(["address", "address", "address"], [cs(PM), cs(SR02), TREASURY])
        r = send({"to": None, "data": data, "value": 0}, 2_600_000)
        agg = r.contractAddress
        json.dump({"aggregator": agg, "abi": build["abi"], "deployedAt": int(time.time()), "v3path": True}, open("ArcAggregatorV2.deploy.json", "w"), indent=1)
    print("ArcAggregatorV2:", agg)
    BUY = sel(f"buy(address,{LEG}[],uint256,address,uint16)")
    SELL = sel(f"sell(address,{LEG}[],uint256,address,uint16)")
    T = ["address", f"{LEG}[]", "uint256", "address", "uint16"]
    # key.fee carries the second hop tier; target = intermediate token
    path_key = (ZERO, ZERO, 10000, 0, ZERO)

    # 1) V3PATH buy 1 USDC -> CRCL(1%) -> LONG(1%)
    spend = 10**18
    fee = spend * 150 // 10_000
    tre0 = w3.eth.get_balance(TREASURY); l0 = bal(LONG)
    print("1) buy LONG via CRCL hop, 1 USDC")
    send({"to": agg, "value": spend + fee, "data": BUY + encode(T, [cs(LONG), [(5, cs(CRCL), 10000, path_key, spend)], 0, ME, 150])}, 600_000)
    got = bal(LONG) - l0
    print(f"   got {got / 1e18:.2f} LONG · treasury +{(w3.eth.get_balance(TREASURY) - tre0) / 1e18:.4f} USDC")
    assert got > 0

    # 2) V3PATH sell everything back
    print("2) sell LONG via CRCL hop")
    al = int.from_bytes(w3.eth.call({"to": cs(LONG), "data": sel("allowance(address,address)") + encode(["address", "address"], [ME, agg])}), "big")
    if al < got:
        send({"to": cs(LONG), "value": 0, "data": sel("approve(address,uint256)") + encode(["address", "uint256"], [agg, 2**256 - 1])}, 80_000)
    u0 = w3.eth.get_balance(ME)
    r = send({"to": agg, "value": 0, "data": SELL + encode(T, [cs(LONG), [(5, cs(CRCL), 10000, path_key, got)], 0, ME, 150])}, 600_000)
    print(f"   USDC back ≈ {(w3.eth.get_balance(ME) - u0 + r.gasUsed * r.effectiveGasPrice) / 1e18:.4f} (net of fee)")

    # 3) plain V3 leg still fine
    print("3) V3 single leg 0.05 USDC -> ARCT")
    a0 = bal(ARCT)
    send({"to": agg, "value": 5 * 10**16 + 5 * 10**16 * 150 // 10_000, "data": BUY + encode(T, [cs(ARCT), [(1, ZERO, 10000, ZERO_KEY, 5 * 10**16)], 0, ME, 150])}, 400_000)
    print(f"   got {(bal(ARCT) - a0) / 1e18:.4f} ARCT")
    print("OK — set ARC_AGGREGATOR / V3PATH_AGGREGATOR =", agg)
