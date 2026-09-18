"""Mainnet E2E for ArcClaim: e2e wallet creates a 1 USDC link, the bridge-owner wallet claims it with the link key,
treasury receives 2 %. Also creates a 0.1 USDC link with a 1 h TTL that is left open for the refund path."""
import json, os, time
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_abi import encode

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "..", "contracts", "ArcClaim.deploy.json")))
w3 = Web3(Web3.HTTPProvider("http://178.156.197.90:8545", request_kwargs={"timeout": 120}))
c = w3.eth.contract(address=d["claim"], abi=d["abi"])
sender = Account.from_key(open(os.path.join(HERE, "..", ".e2e_wallet")).read().split()[0].strip())
claimer = Account.from_key(open(os.path.join(HERE, "..", ".bridge_owner_key")).read().split()[0].strip())
TREASURY = d["treasury"]
E = 10**18


def send(acct, fn, value=0):
    tx = fn.build_transaction({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address), "gasPrice": w3.eth.gas_price, "chainId": 5042, "value": value})
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.3)
    s = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(getattr(s, "rawTransaction", None) or s.raw_transaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    assert r.status == 1, f"reverted {h.hex()}"
    return r


print("sender", sender.address, w3.eth.get_balance(sender.address) / 1e18, "| claimer", claimer.address, w3.eth.get_balance(claimer.address) / 1e18)
link_key = Account.create()
r = send(sender, c.functions.create(link_key.address, 3600), value=E)
ev = c.events.Created().process_receipt(r)[0]["args"]
print("created id", ev["id"], "amount", ev["amount"] / 1e18, "expiry", ev["expiry"], "tx", r.transactionHash.hex(), "gas", r.gasUsed)

inner = Web3.keccak(encode(["string", "uint256", "address", "uint256", "address"], ["ArcClaim", 5042, d["claim"], ev["id"], claimer.address]))
assert c.functions.claimDigest(ev["id"], claimer.address).call() == Web3.keccak(b"\x19Ethereum Signed Message:\n32" + inner)
sig = Account.sign_message(encode_defunct(primitive=inner), link_key.key).signature
t0, c0 = w3.eth.get_balance(TREASURY), w3.eth.get_balance(claimer.address)
r = send(claimer, c.functions.claim(ev["id"], claimer.address, sig))
ev2 = c.events.Claimed().process_receipt(r)[0]["args"]
gas_cost = r.gasUsed * w3.eth.gas_price
print("claimed: paid", ev2["paid"] / 1e18, "fee", ev2["fee"] / 1e18, "tx", r.transactionHash.hex(), "gas", r.gasUsed)
print("treasury delta", (w3.eth.get_balance(TREASURY) - t0) / 1e18, "| claimer delta (+paid -gas)", (w3.eth.get_balance(claimer.address) - c0) / 1e18)
assert ev2["fee"] == E * 200 // 10000 and ev2["paid"] == E - ev2["fee"]

# open link for the refund path (checked later by the buybot's refund sweeper)
k2 = Account.create()
r = send(sender, c.functions.create(k2.address, 3600), value=E // 10)
ev3 = c.events.Created().process_receipt(r)[0]["args"]
print("open refund-test link id", ev3["id"], "expiry", ev3["expiry"], "key", k2.key.hex())
json.dump({"refund_test_id": int(ev3["id"]), "expiry": int(ev3["expiry"])}, open("/tmp/arcclaim_refund_test.json", "w"))
print("E2E OK")
