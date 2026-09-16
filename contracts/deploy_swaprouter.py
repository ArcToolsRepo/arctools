"""Deploy ArcSwapFeeRouter + smoke test: buy 1 USDC of ARCT through it, then sell back."""
import json
import os
import time

import solcx
from web3 import Web3

RPC = "https://rpc.arc-scan.org"
CHAIN = 5042
KEY = os.environ["DEPLOYER_KEY"]
USDC = "0x3600000000000000000000000000000000000000"
SWAP_ROUTER02 = "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77"
FACTORY = "0xf0db7b58379503491d857dB50AC9ece64c653918"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
ARCT = "0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52"

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 40}))
acct = w3.eth.account.from_key(KEY)
print("deployer:", acct.address, "balance:", w3.eth.get_balance(acct.address) / 1e18, "USDC")

solcx.set_solc_version("0.8.24")
out = solcx.compile_source(open("ArcSwapFeeRouter.sol").read(), output_values=["abi", "bin"],
                           optimize=True, optimize_runs=500, via_ir=True)
c = out["<stdin>:ArcSwapFeeRouter"]
gp = int(w3.eth.gas_price * 1.1)
ERC20 = [
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}], "outputs": [{"type": "uint256"}]},
]
FACT_ABI = [{"name": "getPool", "type": "function", "stateMutability": "view",
             "inputs": [{"type": "address"}, {"type": "address"}, {"type": "uint24"}], "outputs": [{"type": "address"}]}]


def send(fn, gas):
    fn.call({"from": acct.address})
    tx = fn.build_transaction({"chainId": CHAIN, "gasPrice": gp, "gas": gas,
                               "nonce": w3.eth.get_transaction_count(acct.address), "from": acct.address})
    tx.pop("maxFeePerGas", None); tx.pop("maxPriorityFeePerGas", None)
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).rawTransaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    assert r["status"] == 1, f"tx failed {h.hex()}"
    return r


# ---- deploy
Router = w3.eth.contract(abi=c["abi"], bytecode=c["bin"])
tx = Router.constructor(USDC, SWAP_ROUTER02, TREASURY).build_transaction({
    "from": acct.address, "chainId": CHAIN, "gasPrice": gp, "gas": 1_500_000,
    "nonce": w3.eth.get_transaction_count(acct.address)})
tx.pop("maxFeePerGas", None); tx.pop("maxPriorityFeePerGas", None)
h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).rawTransaction)
r = w3.eth.wait_for_transaction_receipt(h, timeout=120)
assert r["status"] == 1
ADDR = r["contractAddress"]
print("ArcSwapFeeRouter:", ADDR, "gas:", r["gasUsed"])
json.dump({"address": ADDR, "abi": c["abi"]}, open("swaprouter_deploy.json", "w"), indent=1)

# ---- smoke test: find ARCT pool fee tier
fact = w3.eth.contract(address=FACTORY, abi=FACT_ABI)
tier = None
for f in (10000, 3000, 500, 100):
    p = fact.functions.getPool(USDC, ARCT, f).call()
    if int(p, 16) != 0:
        tier = f; print("ARCT pool tier:", f, p); break
assert tier

router = w3.eth.contract(address=ADDR, abi=c["abi"])
usdc = w3.eth.contract(address=USDC, abi=ERC20)
arct = w3.eth.contract(address=ARCT, abi=ERC20)
treas0 = usdc.functions.balanceOf(TREASURY).call()
arct0 = arct.functions.balanceOf(acct.address).call()

amt = 1_000_000  # 1 USDC (6 dec facade)
if usdc.functions.allowance(acct.address, ADDR).call() < amt:
    send(usdc.functions.approve(ADDR, 2**256 - 1), 80_000)
dl = int(time.time()) + 600
send(router.functions.buy(ARCT, tier, amt, 0, dl), 450_000)
arct1 = arct.functions.balanceOf(acct.address).call()
treas1 = usdc.functions.balanceOf(TREASURY).call()
got = arct1 - arct0
print(f"BUY ok: +{got/1e18:,.2f} ARCT | fee to treasury: {(treas1-treas0)/1e6:.4f} USDC (expect 0.0100)")
assert treas1 - treas0 == amt // 100

# sell half back
half = got // 2
send(arct.functions.approve(ADDR, 2**256 - 1), 80_000)
u0 = usdc.functions.balanceOf(acct.address).call()
send(router.functions.sell(ARCT, tier, half, 0, dl), 450_000)
u1 = usdc.functions.balanceOf(acct.address).call()
treas2 = usdc.functions.balanceOf(TREASURY).call()
print(f"SELL ok: +{(u1-u0)/1e6:.4f} USDC to user | fee to treasury: {(treas2-treas1)/1e6:.4f} USDC")
print("router holds USDC:", usdc.functions.balanceOf(ADDR).call(), "ARCT:", arct.functions.balanceOf(ADDR).call(), "(both must be 0)")
