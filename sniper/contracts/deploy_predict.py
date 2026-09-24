"""Deploy ArcPredict markets to Arc mainnet.
Usage: DEPLOYER_KEY=0x.. OPERATOR=0x.. python deploy_predict.py
Admin = deployer (config, pause, roles). Operator = the ArcTools bot key (posts prices). Treasury = fee wallet."""
import json, os, time
from web3 import Web3

RPC = os.environ.get("ARC_RPC", "http://178.156.197.90:8545")
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
U = 10 ** 18
MARKETS = [  # market, interval s, buffer s, minBet, maxBet, fee bps
    ("BTC/USD", 120, 45, U, 500 * U, 300),
    ("ETH/USD", 120, 45, U, 500 * U, 300),
    ("SOL/USD", 120, 45, U, 500 * U, 300),
]
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120}))
acct = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"]); OPERATOR = Web3.to_checksum_address(os.environ["OPERATOR"])
B = json.load(open(os.path.join(os.path.dirname(__file__), "ArcPredict.build.json")))
print("deployer/admin", acct.address, round(w3.eth.get_balance(acct.address) / U, 4), "USDC | operator", OPERATOR)
out = {"admin": acct.address, "operator": OPERATOR, "treasury": TREASURY, "compiler": B["compiler"], "markets": {}}
for m, iv, buf, mn, mx, fee in MARKETS:
    C = w3.eth.contract(abi=B["abi"], bytecode=B["bytecode"])
    tx = C.constructor(m, acct.address, OPERATOR, TREASURY, iv, buf, mn, mx, fee).build_transaction({"from": acct.address})
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"): tx.pop(k, None)
    tx.update({"nonce": w3.eth.get_transaction_count(acct.address), "gasPrice": w3.eth.gas_price, "chainId": 5042, "gas": 3_200_000})
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction); rc = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    assert rc.status == 1, f"deploy {m} reverted"
    out["markets"][m] = {"address": rc.contractAddress, "interval": iv, "buffer": buf, "minBet": str(mn), "maxBet": str(mx), "feeBps": fee, "tx": h.hex(), "block": rc.blockNumber}
    print(f"  {m:8} → {rc.contractAddress} (gas {rc.gasUsed}, block {rc.blockNumber})")
out["deployed_at"] = int(time.time())
json.dump(out, open(os.path.join(os.path.dirname(__file__), "ArcPredict.deploy.json"), "w"), indent=2)
print("saved ArcPredict.deploy.json")
