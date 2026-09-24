"""Deploy ArcPerps (production), add the 10 launch markets, seed the fund from the treasury wallet, fund the operator with gas."""
import json, os, urllib.request
from web3 import Web3
RPC = "http://178.156.197.90:8545"; TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"; U = 10 ** 18
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120}))
A = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"]); S = w3.eth.account.from_key(os.environ["SEED_KEY"])
OPERATOR = Web3.to_checksum_address(os.environ["OPERATOR_ADDR"]); SEED_USDC = int(float(os.environ.get("SEED_USDC", "800")) * U)
BUILD = json.load(open(os.path.join(os.path.dirname(__file__), "ArcPerps.build.json")))
def send(acct, tx_or_fn, value=0):
    tx = tx_or_fn.build_transaction({"from": acct.address, "value": value}) if hasattr(tx_or_fn, "build_transaction") else dict(tx_or_fn)
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"): tx.pop(k, None)
    tx.update({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address), "gasPrice": int(w3.eth.gas_price * 1.2), "chainId": 5042}); tx["gas"] = int(tx.get("gas", 60000) * 1.5) + 50_000
    raw = "0x" + acct.sign_transaction(tx).raw_transaction.hex(); h = None
    for url in ("https://arctools.fun/api/rpc", "https://rpc.arc-scan.org", RPC):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": [raw]}).encode(), headers={"content-type": "application/json", "User-Agent": "Mozilla/5.0"}), timeout=30).read())
            if "result" in r: h = r["result"]; break
        except Exception: pass
    assert h, "broadcast failed"; rc = w3.eth.wait_for_transaction_receipt(h, timeout=120); assert rc.status == 1, f"reverted {h}"; return rc
# name, token, kind, levLive, levOff, corridorBps, oiCap USDC
MARKETS = [
    ("NVDA-USDC", "0x6505506540dc99f7366316b10e9cf1a584cbd42a", 1, 3, 2, 700, 50_000), ("TSLA-USDC", "0x4d1efa7f5629f89fbdd7950b5ef73403a350ad59", 1, 3, 2, 700, 50_000),
    ("CRCL-USDC", "0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b", 1, 3, 2, 700, 50_000), ("GME-USDC", "0x41b386e03928c70d635606c210717c19dcfc984d", 1, 3, 2, 700, 25_000), ("HIMS-USDC", "0x3b26421eb41f42119b021eadfbe3ff687ff7ebd8", 1, 3, 2, 700, 25_000),
    ("ARGUS-USDC", "0xece5ca8bf9220718e5727754026757512212cb3c", 0, 3, 3, 0, 400_000), ("TOLLY-USDC", "0xbc43ce8dec648ea298c4275559b81d6261c90b67", 0, 3, 3, 0, 43_000),
    ("ARCOON-USDC", "0x4621a0baa0b5d97aae77704cf2a84dabe78a4fed", 0, 2, 2, 0, 22_000), ("WONK-USDC", "0x548df4bf91624d8cec46d606211eb13f7492e27e", 0, 2, 2, 0, 17_000), ("ARCT-USDC", "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52", 0, 2, 2, 0, 13_000),
]
C = w3.eth.contract(abi=BUILD["abi"], bytecode=BUILD["bytecode"])
rc = send(A, C.constructor(OPERATOR, TREASURY)); addr = rc.contractAddress; c = w3.eth.contract(address=addr, abi=BUILD["abi"]); print("ArcPerps", addr)
for name, tok, kind, ll, lo, cor, cap in MARKETS: send(A, c.functions.addMarket(name, kind, ll, lo, cor, cap * U)); print("  market", name)
send(A, {"to": OPERATOR, "value": 5 * U, "gas": 30000}); print("operator funded 5 USDC")
send(S, c.functions.lpDeposit(), value=SEED_USDC); print("fund seeded", SEED_USDC / U, "USDC from", S.address, "fund =", c.functions.fund().call() / U)
json.dump({"address": addr, "operator": OPERATOR, "treasury": TREASURY, "block": rc.blockNumber, "markets": [{"id": i, "name": m[0], "token": m[1], "kind": m[2], "levLive": m[3], "levOff": m[4], "corridorBps": m[5], "oiCap": m[6]} for i, m in enumerate(MARKETS)]}, open(os.path.join(os.path.dirname(__file__), "ArcPerps.deploy.json"), "w"), indent=1)
print("saved ArcPerps.deploy.json")
