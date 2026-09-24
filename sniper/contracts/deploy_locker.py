"""Deploy ArcLocker to Arc mainnet.
Usage: DEPLOYER_KEY=0x... python deploy_locker.py
Treasury = ArcTools treasury (fee receiver). Owner = deployer (can only change fee/treasury)."""
import json, os, time
from web3 import Web3

RPC = os.environ.get("ARC_RPC", "http://178.156.197.90:8545")
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120}))
acct = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])
print("deployer", acct.address, "balance", w3.from_wei(w3.eth.get_balance(acct.address), "ether"), "USDC")
B = json.load(open(os.path.join(os.path.dirname(__file__), "ArcLocker.build.json")))
C = w3.eth.contract(abi=B["abi"], bytecode=B["bin"])
tx = C.constructor(Web3.to_checksum_address(TREASURY)).build_transaction({
    "from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address), "chainId": 5042,
    "gasPrice": int(w3.eth.gas_price * 1.15)})
tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.3)
print("gas estimate", tx["gas"])
signed = acct.sign_transaction(tx)
h = w3.eth.send_raw_transaction(signed.raw_transaction)
print("tx", h.hex())
rc = w3.eth.wait_for_transaction_receipt(h, timeout=180)
print("status", rc.status, "gasUsed", rc.gasUsed, "ArcLocker at", rc.contractAddress)
json.dump({"address": rc.contractAddress, "tx": h.hex(), "block": rc.blockNumber, "deployer": acct.address, "treasury": TREASURY,
           "ts": int(time.time()), "abi": B["abi"]}, open(os.path.join(os.path.dirname(__file__), "ArcLocker.deploy.json"), "w"), indent=1)
