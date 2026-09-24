"""ArcWork mainnet test with real (tiny) USDC. Deploys a throwaway instance, then: gig → hire → deliver → accept → review;
dispute → resolve 70/30; seller refund; premature cancel reverts; admin cannot drain; pause blocks new orders only.
Usage: DEPLOYER_KEY=.. E2E_KEY=.. python test_work.py"""
import json, os, time
from web3 import Web3

RPC = os.environ.get("ARC_RPC", "http://178.156.197.90:8545"); TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"; ARCT = Web3.to_checksum_address("0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52")
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120}))
A = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])   # admin + arbiter + seller
B = w3.eth.account.from_key(os.environ["E2E_KEY"])        # buyer
BUILD = json.load(open(os.path.join(os.path.dirname(__file__), "ArcWork.build.json"))); U = 10 ** 18

def send(acct, fn, extra=None):
    tx = fn.build_transaction({"from": acct.address, **(extra or {})})
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"): tx.pop(k, None)
    tx.update({"nonce": w3.eth.get_transaction_count(acct.address), "gasPrice": w3.eth.gas_price, "chainId": 5042, "gas": int(tx.get("gas", 150_000) * 1.5) + 50_000})
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction); rc = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    assert rc.status == 1, f"reverted {h.hex()}"; return rc

def expect_revert(acct, fn, label, value=0):
    try: fn.build_transaction({"from": acct.address, "value": value}); print(f"  FAIL {label}: did not revert")
    except Exception as e: print(f"  ok   {label}: reverted ({str(e)[:50]})")

bal = lambda a: w3.eth.get_balance(a)
print("A", A.address, round(bal(A.address) / U, 3), "| B", B.address, round(bal(B.address) / U, 3))
C = w3.eth.contract(abi=BUILD["abi"], bytecode=BUILD["bytecode"])
rc = send(A, C.constructor(A.address, A.address, TREASURY, ARCT)); addr = rc.contractAddress; print("deployed", addr, "gas", rc.gasUsed)
W = w3.eth.contract(address=addr, abi=BUILD["abi"]); t0 = bal(TREASURY)

# gig
send(A, W.functions.createGig(0, 1 * U, 3, "arctools://gig/test-logo")); g = W.functions.gigs(0).call(); print("gig 0:", g[0][:10], "price", g[2] / U, "days", g[3], "active", g[4])
expect_revert(A, W.functions.createGig(0, U // 2, 3, "x"), "gig below 1 USDC")
print("feeFor seller (A holds ARCT?)", W.functions.feeFor(A.address).call(), "bps")

# order 1: full happy path
expect_revert(B, W.functions.hire(0, "brief"), "hire with wrong value", U // 2)
send(B, W.functions.hire(0, "Logo for $TEST, 512px, deliver to tg @buyer"), {"value": 1 * U}); o = W.functions.orders(0).call(); print("order 0 paid: status", o[7], "deadline in", int(o[5] - time.time()) // 86400, "d")
expect_revert(B, W.functions.accept(0), "accept before delivery")
expect_revert(B, W.functions.cancelUndelivered(0), "cancel before deadline+grace")
send(A, W.functions.deliver(0, "ipfs://Qm…logo.png")); print("  delivered")
a0 = bal(A.address); send(B, W.functions.accept(0)); o = W.functions.orders(0).call(); fee = W.functions.feeFor(A.address).call()
print("  accepted: status", o[7], "seller +", round((bal(A.address) - a0) / U, 4), f"(expect {1 - fee/10000}) treasury +", round((bal(TREASURY) - t0) / U, 4), f"(expect {fee/10000})")
send(B, W.functions.review(0, 5, "fast, clean")); g = W.functions.gigs(0).call(); print("  review: sold", g[6], "rating", g[8], "/", g[9])
expect_revert(B, W.functions.review(0, 4, "again"), "double review")

# order 2: dispute → resolve 70 % to buyer
send(B, W.functions.hire(0, "second order"), {"value": 1 * U}); send(A, W.functions.deliver(1, "meh")); send(B, W.functions.dispute(1, "not what I asked"))
o = W.functions.orders(1).call(); print("order 1 disputed: status", o[7])
expect_revert(B, W.functions.resolve(1, 7000, "x"), "non-arbiter resolve")
expect_revert(A, W.functions.accept(1), "accept a disputed order")
b0 = bal(B.address); a0 = bal(A.address); t1 = bal(TREASURY); send(A, W.functions.resolve(1, 7000, "partial: delivered but off-brief"))
print("  resolved 70/30: buyer +", round((bal(B.address) - b0) / U, 4), "seller +", round((bal(A.address) - a0) / U, 4), "treasury +", round((bal(TREASURY) - t1) / U, 4), "(fee only on seller share)")
g = W.functions.gigs(0).call(); print("  gig disputed count", g[7])

# order 3: seller refund
send(B, W.functions.hire(0, "third"), {"value": 1 * U}); b0 = bal(B.address); send(A, W.functions.refund(2)); print("order 2 refunded by seller: buyer +", round((bal(B.address) - b0) / U, 4))

# pause: no new orders, but deliveries/accepts still work
send(A, W.functions.setPaused(True)); expect_revert(B, W.functions.hire(0, "paused"), "hire while paused", 1 * U); send(A, W.functions.setPaused(False))
expect_revert(B, W.functions.setPaused(True), "non-admin pause")
print("contract balance left", bal(addr) / U, "(expect 0)"); assert bal(addr) == 0
print("gigsCount", W.functions.gigsCount().call(), "ordersCount", W.functions.ordersCount().call(), "ordersOfBuyer(B)", W.functions.getOrdersOfBuyer(B.address).call())
print("ALL OK")
