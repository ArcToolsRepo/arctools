"""Deploy ArcClaim (USDC payment links, 2 % fee to treasury) on Arc mainnet.
Usage: DEPLOYER_KEY=... python deploy_claim.py"""
import json
import os
import time

from web3 import Web3

RPC = os.environ.get("ARC_RPC", "http://178.156.197.90:8545")
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120}))
acct = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])
ME = acct.address
b = json.load(open(os.path.join(os.path.dirname(__file__), "ArcClaim.build.json")))
print("deployer", ME, "balance", w3.eth.get_balance(ME) / 1e18, "chain", w3.eth.chain_id)
assert w3.eth.chain_id == 5042

C = w3.eth.contract(abi=b["abi"], bytecode=b["bytecode"])
tx = C.constructor(Web3.to_checksum_address(TREASURY)).build_transaction({
    "from": ME, "nonce": w3.eth.get_transaction_count(ME), "gasPrice": w3.eth.gas_price, "chainId": 5042})
tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.2)
signed = acct.sign_transaction(tx)
h = w3.eth.send_raw_transaction(getattr(signed, "rawTransaction", None) or signed.raw_transaction)
r = w3.eth.wait_for_transaction_receipt(h, timeout=240)
assert r.status == 1, "deploy reverted"
addr = r.contractAddress
c = w3.eth.contract(address=addr, abi=b["abi"])
print("ArcClaim", addr, "block", r.blockNumber, "gas", r.gasUsed, "tx", h.hex())
print("  treasury", c.functions.treasury().call(), "FEE_BPS", c.functions.FEE_BPS().call(), "nextId", c.functions.nextId().call())
json.dump({"claim": addr, "treasury": TREASURY, "block": r.blockNumber, "tx": h.hex(), "deployedAt": int(time.time()), "abi": b["abi"]},
          open(os.path.join(os.path.dirname(__file__), "ArcClaim.deploy.json"), "w"), indent=1)
