"""Deploy ArcOrders (limit / TP / SL executor) on Arc mainnet.
Usage: DEPLOYER_KEY=... KEEPER=0x... python deploy_orders.py
Keeper = the buybot's executor wallet (may equal the deployer/treasury on day one)."""
import json
import os
import time

from web3 import Web3

RPC = os.environ.get("ARC_RPC", "https://rpc.arc-scan.org")
AGG = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120, "headers": {"User-Agent": "Mozilla/5.0"}}))
acct = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])
ME = acct.address
KEEPER = Web3.to_checksum_address(os.environ.get("KEEPER", ME))
b = json.load(open(os.path.join(os.path.dirname(__file__), "ArcOrders.build.json")))
print("deployer", ME, "balance", w3.eth.get_balance(ME) / 1e18, "keeper", KEEPER)

C = w3.eth.contract(abi=b["abi"], bytecode=b["bytecode"])
tx = C.constructor(Web3.to_checksum_address(AGG), KEEPER).build_transaction({
    "from": ME, "nonce": w3.eth.get_transaction_count(ME), "gasPrice": w3.eth.gas_price, "chainId": 5042})
tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.2)
signed = acct.sign_transaction(tx)
h = w3.eth.send_raw_transaction(getattr(signed, "rawTransaction", None) or signed.raw_transaction)
r = w3.eth.wait_for_transaction_receipt(h, timeout=240)
assert r.status == 1, "deploy reverted"
addr = r.contractAddress
c = w3.eth.contract(address=addr, abi=b["abi"])
print("ArcOrders", addr, "block", r.blockNumber, "gas", r.gasUsed)
print("  feeBps", c.functions.feeBps().call(), "keeper ok", c.functions.keepers(KEEPER).call(), "aggregator", c.functions.aggregator().call())
print("  DOMAIN_SEPARATOR", c.functions.DOMAIN_SEPARATOR().call().hex())
json.dump({"orders": addr, "keeper": KEEPER, "aggregator": AGG, "block": r.blockNumber, "deployedAt": int(time.time()), "abi": b["abi"]},
          open(os.path.join(os.path.dirname(__file__), "ArcOrders.deploy.json"), "w"), indent=1)
