"""ArcPredict mainnet test: deploys a throwaway instance (60 s rounds) and plays real rounds with two wallets.
Usage: DEPLOYER_KEY=0x.. E2E_KEY=0x.. python test_predict.py"""
import json, os, time
from web3 import Web3

RPC = os.environ.get("ARC_RPC", "http://178.156.197.90:8545")
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120}))
A = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"])   # admin + operator for the test
B = w3.eth.account.from_key(os.environ["E2E_KEY"])
BUILD = json.load(open(os.path.join(os.path.dirname(__file__), "ArcPredict.build.json")))
INTERVAL, BUFFER = 60, 30
U = 10 ** 18

def send(acct, fn, extra=None):
    tx = fn.build_transaction({"from": acct.address, **(extra or {})}) if hasattr(fn, "build_transaction") else fn
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"): tx.pop(k, None)
    tx.update({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address), "gasPrice": w3.eth.gas_price, "chainId": 5042})
    tx["gas"] = int(tx.get("gas", 100_000) * 1.5) + 50_000
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
    rc = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    assert rc.status == 1, f"tx reverted {h.hex()} gas {rc.gasUsed}/{tx['gas']}"
    return rc

def expect_revert(acct, fn, label, value=0):
    try:
        fn.build_transaction({"from": acct.address, "value": value})
        print(f"  FAIL {label}: did not revert")
    except Exception as e:
        print(f"  ok   {label}: reverted ({str(e)[:60]})")

def wait_until(ts, label):
    d = ts - time.time() + 4
    if d > 0: print(f"  … waiting {int(d)} s for {label}"); time.sleep(d)

print("admin/operator", A.address, round(w3.eth.get_balance(A.address) / U, 4), "| bettor", B.address, round(w3.eth.get_balance(B.address) / U, 4))
C = w3.eth.contract(abi=BUILD["abi"], bytecode=BUILD["bytecode"])
rc = send(A, C.constructor("TEST/USD", A.address, A.address, TREASURY, INTERVAL, BUFFER, U // 100, 5 * U, 300))
addr = rc.contractAddress; print("deployed", addr, "gas", rc.gasUsed)
P = w3.eth.contract(address=addr, abi=BUILD["abi"])
t0 = w3.eth.get_balance(TREASURY)

# genesis
send(A, P.functions.genesisStart()); r1 = P.functions.rounds(1).call(); print("round 1 open, lock at", r1[2])
# bets on round 1: A down 0.05, B up 0.10
send(A, P.functions.betDown(1), {"value": U // 20}); send(B, P.functions.betUp(1), {"value": U // 10})
print("  bets placed: A down 0.05, B up 0.10")
expect_revert(B, P.functions.betDown(1), "second bet same wallet", U // 20)
expect_revert(B, P.functions.betUp(2), "bet on a round that is not open", U // 20)
wait_until(r1[2], "lock of round 1")
send(A, P.functions.genesisLock(100_00000000)); print("round 1 locked @100; round 2 open")
expect_revert(B, P.functions.betUp(1), "bet after lock", U // 20)
# round 2 bets: only B (up) → losing side empty → refund path
send(B, P.functions.betUp(2), {"value": U // 10}); print("  round 2: B up 0.10 (nobody down)")
r1 = P.functions.rounds(1).call(); wait_until(r1[3], "close of round 1")
# close 1 @110 (UP wins), lock 2 @110, open 3
send(A, P.functions.executeRound(110_00000000))
r1 = P.functions.rounds(1).call(); print("round 1 resolved: winner", r1[12], "rewardAmount", r1[9] / U, "fee", r1[10] / U, "| treasury +", (w3.eth.get_balance(TREASURY) - t0) / U)
assert r1[12] == 1 and abs(r1[10] - int(0.15 * U * 0.03)) < 10, "fee/winner wrong"
cl = P.functions.claimable(B.address, [1]).call()[0]; print("  B claimable round 1:", cl / U, "(expect 0.1455)"); assert abs(cl - int(0.15 * U * 0.97)) < 10
cl_a = P.functions.claimable(A.address, [1]).call()[0]; assert cl_a == 0, "loser should get 0"
b0 = w3.eth.get_balance(B.address); rc = send(B, P.functions.claim([1])); print("  B claimed, delta", (w3.eth.get_balance(B.address) - b0) / U, "(minus gas)")
expect_revert(B, P.functions.claim([1]), "double claim")
# round 3: tie test — both bet, close == lock
send(A, P.functions.betUp(3), {"value": U // 20}); send(B, P.functions.betDown(3), {"value": U // 20}); print("  round 3: A up 0.05, B down 0.05 (tie test)")
r2 = P.functions.rounds(2).call(); wait_until(r2[3], "close of round 2")
send(A, P.functions.executeRound(120_00000000))   # closes 2 (@120, only up bets → refund), locks 3 @120
r2 = P.functions.rounds(2).call(); print("round 2 resolved: winner", r2[12], "rewardBase", r2[8] / U, "rewardAmount", r2[9] / U, "fee", r2[10] / U)
assert r2[10] == 0 and P.functions.claimable(B.address, [2]).call()[0] == U // 10, "one-sided round must refund in full"
r3 = P.functions.rounds(3).call(); wait_until(r3[3], "close of round 3")
send(A, P.functions.executeRound(120_00000000))   # closes 3 @120 == lock → tie
r3 = P.functions.rounds(3).call(); print("round 3 resolved: winner", r3[12], "(0 = tie → refunds)"); assert r3[12] == 0 and r3[10] == 0
print("  claimable A/B round 3:", P.functions.claimable(A.address, [3]).call()[0] / U, P.functions.claimable(B.address, [3]).call()[0] / U)
# overdue test: round 4 is locked now; nobody executes → after close+buffer anyone can cancel and bettors are refunded
send(B, P.functions.betUp(5), {"value": U // 20}); print("  round 5: B up 0.05 (will be left to expire)")
r4 = P.functions.rounds(4).call(); wait_until(r4[3] + BUFFER, "round 4 close + buffer (operator silent)")
expect_revert(A, P.functions.executeRound(130_00000000), "executeRound after buffer must not resolve with a late price")
# cancelRound(4) by anyone; round 5's lock is also overdue by now
send(B, P.functions.cancelRound(4)); print("round 4 cancelled by a bettor")
wait_until(P.functions.rounds(5).call()[2] + BUFFER, "round 5 lock + buffer")
print("  B claimable [2,3,5] before cancel of 5:", [x / U for x in P.functions.claimable(B.address, [2, 3, 5]).call()])
b0 = w3.eth.get_balance(B.address); send(B, P.functions.claim([2, 3, 5])); print("  B claimed refunds 2+3+5, delta", (w3.eth.get_balance(B.address) - b0) / U, "(expect ~0.20 minus gas)")
# admin restart reopens betting
send(A, P.functions.restart()); print("restart → current epoch", P.functions.currentEpoch().call(), "status", P.functions.rounds(P.functions.currentEpoch().call()).call()[11])
# no admin drain
expect_revert(B, P.functions.setPaused(True), "non-admin pause")
print("contract balance left", w3.eth.get_balance(addr) / U, "(A's unclaimed refunds/tie)")
print("A claimable [3]:", P.functions.claimable(A.address, [3]).call()[0] / U)
send(A, P.functions.claim([3])); print("A claimed tie refund; contract balance", w3.eth.get_balance(addr) / U)
print("treasury total +", (w3.eth.get_balance(TREASURY) - t0) / U, "USDC (expect 0.0045)")
json.dump({"test_instance": addr}, open("ArcPredict.test.json", "w"))
print("ALL OK")
