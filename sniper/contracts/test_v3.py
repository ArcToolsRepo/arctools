"""Mainnet smoke tests for ArcPad v3 with tiny amounts (minTarget = 0.3)."""
import json
import os
import time

from web3 import Web3

RPC = "https://rpc.arc-scan.org"
KEY = os.environ["DEPLOYER_KEY"]
D = json.load(open("arcpad_deploy_v3.json"))
PAD, VAULT = D["launchpad"], D["vault"]
USDC = "0x3600000000000000000000000000000000000000"
TOLLY = Web3.to_checksum_address("0xbc43ce8dec648ea298c4275559b81d6261c90b67")
FEE_ROUTER = "0xA4E79c06eeC23c4caAa63aA37aCC6Fb7f0370a12"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
ERC = [
    {"name": "approve", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
]
FR_ABI = [{"name": "buy", "type": "function", "stateMutability": "nonpayable",
           "inputs": [{"type": "address"}, {"type": "uint24"}, {"type": "uint256"}, {"type": "uint256"}, {"type": "uint256"}], "outputs": [{"type": "uint256"}]}]

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 40}))
acct = w3.eth.account.from_key(KEY)
pad = w3.eth.contract(address=PAD, abi=D["abi"])
usdc = w3.eth.contract(address=USDC, abi=ERC)
tolly = w3.eth.contract(address=TOLLY, abi=ERC)
gp = int(w3.eth.gas_price * 1.2)
print("balance:", w3.eth.get_balance(acct.address) / 1e18, "USDC")


def send(fn, gas, value=0):
    fn.call({"from": acct.address, "value": value})
    tx = fn.build_transaction({"from": acct.address, "value": value, "chainId": 5042, "gasPrice": gp, "gas": gas,
                               "nonce": w3.eth.get_transaction_count(acct.address)})
    tx.pop("maxFeePerGas", None); tx.pop("maxPriorityFeePerGas", None)
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).rawTransaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    assert r["status"] == 1, f"FAILED {h.hex()}"
    return r


def created_token(r):
    ev = pad.events.TokenCreated().process_receipt(r)
    return ev[0]["args"]["token"]


def params(name, sym, quote, mode, target, rewards_bps=0, reward_token=None, mkt_bps=0):
    return (name, sym, mkt_bps, rewards_bps, 0, acct.address if mkt_bps else "0x0000000000000000000000000000000000000000",
            "", "", "", reward_token or "0x0000000000000000000000000000000000000000", quote, mode, target)


ZERO = "0x0000000000000000000000000000000000000000"
sep = lambda t: print("\n=== " + t)

# ---------------- A: USDC curve, target 0.3 -> graduation on 2nd buy
sep("A) USDC curve, target 0.3 USDC")
A = Web3.to_checksum_address("0xd94A27473a5A3834262c085AC5d8c6029c309897"); print("token (reused):", A)
tok = w3.eth.contract(address=A, abi=D.get("token_abi", ERC) if "token_abi" in D else ERC)
print("(first buy done earlier) my tokens:", tok.functions.balanceOf(acct.address).call() / 1e18, "| graduated:", pad.functions.launch(A).call()[5])
r = send(pad.functions.buy(A, 0), 6_500_000, value=int(0.2e18))
L = pad.functions.launch(A).call()
print("buy 0.20 -> graduated:", L[5], "| pool:", L[6], "| lpId:", L[7], "| gas", r["gasUsed"])
if L[5]:
    pool = L[6]
    print("  pool USDC (facade 6d):", usdc.functions.balanceOf(pool).call() / 1e6, "| pool tokens:", tok.functions.balanceOf(pool).call() / 1e18)
    print("  burned leftover:", tok.functions.balanceOf("0x000000000000000000000000000000000000dEaD").call() / 1e18)
    print("  pad token bal (should be 0):", tok.functions.balanceOf(PAD).call())
    ev = pad.events.Graduated().process_receipt(r)
    print("  Graduated event:", dict(ev[0]["args"]) if ev else "-")
    try:
        send(pad.functions.buy(A, 0), 300_000, value=int(0.01e18)); print("  BUG: buy after graduation succeeded")
    except Exception as e:
        print("  buy after graduation correctly rejected:", str(e)[:60])

# ---------------- B: TOLLY-quoted curve, rewards 1% in TOLLY
sep("B) TOLLY quote, rewards 1% in TOLLY")
if tolly.functions.balanceOf(acct.address).call() < int(0.6e18):
    fr = w3.eth.contract(address=FEE_ROUTER, abi=FR_ABI)
    send(usdc.functions.approve(FEE_ROUTER, 2**256 - 1), 80_000)
    send(fr.functions.buy(TOLLY, 10000, 150_000, 0, int(time.time()) + 600), 500_000)
bal_t = tolly.functions.balanceOf(acct.address).call(); print("my TOLLY:", bal_t / 1e18)
r = send(pad.functions.createToken(params("Baby Tolly", "BTOLLY", TOLLY, 0, int(0.3e18), rewards_bps=100)), 2_800_000)
B = created_token(r); print("token:", B, "| quote:", pad.functions.launch(B).call()[0], "tier", pad.functions.launch(B).call()[1])
send(tolly.functions.approve(PAD, 2**256 - 1), 80_000)
r = send(pad.functions.buyToken(B, int(0.2e18), 0), 900_000)
btok = w3.eth.contract(address=B, abi=ERC)
print("buyToken 0.2 TOLLY -> BTOLLY:", btok.functions.balanceOf(acct.address).call() / 1e18, "| feePot[TOLLY]:", pad.functions.feePot(TOLLY).call() / 1e18,
      "| rewardsPending:", pad.functions.rewardsPending(B).call() / 1e18, "| rewardsAcc>0:", pad.functions.rewardsAcc(B).call() > 0)
# second buyer? use same wallet: claimable rewards (holder of BTOLLY) after another buy
r = send(pad.functions.buyToken(B, int(0.05e18), 0), 900_000)
print("claimable TOLLY rewards for me:", pad.functions.claimable(B, acct.address).call() / 1e18)
t0 = tolly.functions.balanceOf(acct.address).call()
send(pad.functions.claimRewards(B), 200_000)
print("claimed -> TOLLY delta:", (tolly.functions.balanceOf(acct.address).call() - t0) / 1e18)
# fee flush TOLLY -> USDC -> vault/treasury
v0 = w3.eth.get_balance(VAULT); tr0 = w3.eth.get_balance(TREASURY)
r = send(pad.functions.flushFees(TOLLY), 400_000)
print("flushFees -> vault +", (w3.eth.get_balance(VAULT) - v0) / 1e18, "USDC | treasury +", (w3.eth.get_balance(TREASURY) - tr0) / 1e18, "USDC")
# graduate B
r = send(pad.functions.buyToken(B, int(0.12e18), 0), 6_500_000)
L = pad.functions.launch(B).call(); print("graduated:", L[5], "| pool:", L[6])
if L[5]:
    print("  pool TOLLY:", tolly.functions.balanceOf(L[6]).call() / 1e18, "| pool BTOLLY:", btok.functions.balanceOf(L[6]).call() / 1e18)

# ---------------- C: instant launch, 0.3 USDC seed
sep("C) instant Uniswap launch, seed 0.3 USDC")
r = send(pad.functions.createToken(params("Instant Test", "INST", ZERO, 1, int(0.3e18))), 7_500_000, value=int(0.3e18))
C = created_token(r); L = pad.functions.launch(C).call()
ctok = w3.eth.contract(address=C, abi=ERC)
print("token:", C, "| graduated:", L[5], "| pool:", L[6], "| gas", r["gasUsed"])
print("  pool USDC:", usdc.functions.balanceOf(L[6]).call() / 1e6, "| pool INST:", ctok.functions.balanceOf(L[6]).call() / 1e18, "| vault drop:", ctok.functions.balanceOf(VAULT).call() / 1e18)

print("\nbalance after:", w3.eth.get_balance(acct.address) / 1e18, "USDC")
json.dump({"A": A, "B": B, "C": C}, open("v3_test_tokens.json", "w"))
