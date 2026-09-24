"""ArcPerps mainnet test: throwaway instance, real USDC in the low single digits.
Usage: DEPLOYER_KEY=0x.. E2E_KEY=0x.. python test_perps.py"""
import json, os, time
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

RPC = os.environ.get("ARC_RPC", "http://178.156.197.90:8545"); TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 120}))
A = w3.eth.account.from_key(os.environ["DEPLOYER_KEY"]); B = w3.eth.account.from_key(os.environ["E2E_KEY"])
BUILD = json.load(open(os.path.join(os.path.dirname(__file__), "ArcPerps.build.json"))); U = 10 ** 18; P = 10 ** 8
fails = []

def send(acct, fn, value=0):
    tx = fn.build_transaction({"from": acct.address, "value": value})
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"): tx.pop(k, None)
    tx.update({"nonce": w3.eth.get_transaction_count(acct.address), "gasPrice": int(w3.eth.gas_price * 1.2), "chainId": 5042}); tx["gas"] = int(tx["gas"] * 1.5) + 50_000
    raw = "0x" + acct.sign_transaction(tx).raw_transaction.hex(); h = None
    for url in ("https://arctools.fun/api/rpc", "https://rpc.arc-scan.org", RPC):
        try:
            import urllib.request; r = json.loads(urllib.request.urlopen(urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": [raw]}).encode(), headers={"content-type": "application/json", "User-Agent": "Mozilla/5.0"}), timeout=30).read())
            if "result" in r: h = r["result"]; break
        except Exception: pass
    assert h, "broadcast failed"; rc = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    assert rc.status == 1, f"tx reverted {h}"; return rc
def expect_revert(acct, fn, label, value=0, contains=None):
    try: fn.build_transaction({"from": acct.address, "value": value}); print(f"  FAIL {label}: did not revert"); fails.append(label)
    except Exception as e:
        ok = contains is None or contains in str(e); print(f"  {'ok  ' if ok else 'FAIL'} {label}: {str(e)[:70]}")
        if not ok: fails.append(label)
def check(cond, label, extra=""):
    print(f"  {'ok  ' if cond else 'FAIL'} {label} {extra}"); 
    if not cond: fails.append(label)

def sig(c, market, price, live, ts):
    from eth_abi import encode; h = Web3.keccak(encode(["uint256", "address", "uint256", "uint128", "bool", "uint64"], [5042, c.address, market, price, live, ts]))
    return Account.sign_message(encode_defunct(primitive=h), private_key=A.key).signature
def post(c, acct, market, price, live=True, ts=None):
    ts = ts or int(time.time()); return send(acct, c.functions.postPrice(market, price, live, ts, sig(c, market, price, live, ts)))
def pos(c, i): p = c.functions.positions(i).call(); return {"owner": p[0], "market": p[1], "isLong": p[2], "margin": p[3], "notional": p[4], "entry": p[5]}

print("== deploy"); C = w3.eth.contract(abi=BUILD["abi"], bytecode=BUILD["bytecode"])
rc = send(A, C.constructor(A.address, TREASURY)); c = w3.eth.contract(address=rc.contractAddress, abi=BUILD["abi"]); print("  ArcPerps test instance", c.address)
send(A, c.functions.addMarket("ARGUS-USDC", 0, 3, 3, 0, 200 * U)); send(A, c.functions.addMarket("NVDA-USDC", 1, 3, 2, 700, 200 * U))
check(c.functions.marketCount().call() == 2, "two markets")

print("== oracle"); ts = int(time.time()); px0 = int(0.0184 * P)
expect_revert(A, c.functions.postPrice(0, px0, True, ts, sig(c, 0, px0 + 1, True, ts)), "bad signature rejected", contains="sig")
expect_revert(A, c.functions.postPrice(0, px0, True, ts - 400, sig(c, 0, px0, True, ts - 400)), "stale price rejected", contains="stale")
post(c, B, 0, px0)   # anyone can relay a valid signature
check(c.functions.markets(0).call()[7] == px0, "price posted by relayer")

print("== P2P: no fund → no unmatched interest")
expect_revert(B, c.functions.open(0, True, 3, 0, False, 0, b""), "long without counterparty", value=int(1.1 * U), contains="no counterparty")
print("== LP seeds the fund"); send(A, c.functions.lpDeposit(), value=20 * U); check(c.functions.fund().call() == 20 * U, "fund 20 USDC")
expect_revert(A, c.functions.lpWithdraw(1), "LP withdraw before 24h", contains="locked")

print("== open long (E2E, 2 USDC × 3x)"); tre0 = w3.eth.get_balance(TREASURY); fund0 = c.functions.fund().call()
val = 2 * U + 6 * U * 10 // 10_000; send(B, c.functions.open(0, True, 3, 0, False, 0, b""), value=val)
p0 = pos(c, 0); check(p0["margin"] == 2 * U and p0["notional"] == 6 * U and p0["entry"] == px0, "position 0 fields", str({k: (v / U if k in ('margin', 'notional') else v) for k, v in p0.items() if k != 'owner'}))
fee = 6 * U * 10 // 10_000; check(w3.eth.get_balance(TREASURY) - tre0 == fee * 3000 // 10_000, "30 % of open fee to treasury"); check(c.functions.fund().call() - fund0 == fee - fee * 3000 // 10_000, "70 % of open fee to fund")
expect_revert(A, c.functions.open(0, True, 4, 0, False, 0, b""), "leverage 4x rejected", value=int(1.1 * U), contains="leverage")
expect_revert(A, c.functions.open(0, True, 3, 0, False, 0, b""), "long beyond unmatched cap (10 USDC) rejected", value=int(4 * 1.003 * U), contains="no counterparty")

print("== open short (deployer, 2 USDC × 3x) → matched book"); send(A, c.functions.open(0, False, 3, 0, False, 0, b""), value=val)
m = c.functions.markets(0).call(); check(m[11] == 6 * U and m[12] == 6 * U, "longOI = shortOI = 6")

print("== price +5 % → close long with profit"); px1 = int(px0 * 1.05); post(c, A, 0, px1)
eq = c.functions.equityOf(0).call(); check(abs(eq[1] - 6 * U * 5 // 100) < 10 ** 12, "pnl ≈ +0.30 USDC", f"pnl={eq[1]/U:.4f}")
b0 = w3.eth.get_balance(B.address); rc = send(B, c.functions.close(0, 0, False, 0, b"")); gas = rc.gasUsed * rc.effectiveGasPrice
got = w3.eth.get_balance(B.address) - b0 + gas; exp = 2 * U + eq[1] - 6 * U * 10 // 10_000
check(abs(got - exp) < 10 ** 13, "payout = margin + pnl − 0.1 % fee", f"got {got/U:.6f} exp {exp/U:.6f}")
check(pos(c, 0)["owner"] == "0x0000000000000000000000000000000000000000", "position 0 closed")

print("== liquidation: E2E long 1 USDC × 3x, price −29 %"); send(B, c.functions.open(0, True, 3, 0, False, 0, b""), value=U + 3 * U * 10 // 10_000)
lp = c.functions.liquidationPrice(2).call(); check(abs(lp / P - px1 / P * (1 - 0.85 / 3)) / (px1 / P) < 0.001, "liquidation price ≈ entry × (1 − 0.85/3)", f"{lp/P:.6f}")
expect_revert(A, c.functions.liquidate(2, 0, False, 0, b""), "healthy position cannot be liquidated", contains="healthy")
px2 = int(px1 * 0.71); post(c, A, 0, px2); a0 = w3.eth.get_balance(A.address); rc = send(A, c.functions.liquidate(2, 0, False, 0, b""))
gasA = rc.gasUsed * rc.effectiveGasPrice; reward = w3.eth.get_balance(A.address) - a0 + gasA
check(reward >= 0 and reward <= 3 * U * 50 // 10_000, "liquidator reward ≤ 0.5 % of notional", f"{reward/U:.6f}"); check(c.functions.badDebt().call() == 0, "no bad debt")

print("== stock market: corridor + leverage schedule"); pn = int(224.55 * P); post(c, A, 1, pn, True)
check(c.functions.maxLeverage(1).call() == 3, "live feed → 3x")
post(c, A, 1, int(260 * P), False); m1 = c.functions.markets(1).call()
check(m1[7] == pn * 10_700 // 10_000, "off-feed price clamped to +7 % corridor", f"{m1[7]/P:.2f}"); check(c.functions.maxLeverage(1).call() == 2, "no feed → 2x")
expect_revert(B, c.functions.open(1, True, 3, 0, False, 0, b""), "3x rejected on weekend price", value=int(1.003 * U), contains="leverage")
send(B, c.functions.open(1, False, 2, 0, False, 0, b""), value=U + 2 * U * 10 // 10_000); check(pos(c, 3)["notional"] == 2 * U, "2x short on NVDA opened")

print("== funding accrues with skew (short-only book on NVDA)"); time.sleep(20); post(c, A, 1, int(230 * P), True)
m1 = c.functions.markets(1).call(); check(m1[14] > 0 and m1[13] <= 0, "shorts pay funding when only shorts are open", f"idxShort={m1[14]} idxLong={m1[13]}")
send(B, c.functions.close(3, 0, False, 0, b""))

print("== solvency"); bal = w3.eth.get_balance(c.address); margins = sum(pos(c, i)["margin"] for i in range(c.functions.positionCount().call()) if pos(c, i)["owner"] != "0x0000000000000000000000000000000000000000")
check(bal >= c.functions.fund().call() + margins, "contract balance ≥ fund + open margins", f"bal {bal/U:.4f} fund {c.functions.fund().call()/U:.4f} margins {margins/U:.4f}")
send(A, c.functions.close(1, 0, False, 0, b""))   # deployer's short from step 1 (in profit after the drop)
print("\nRESULT:", "ALL OK" if not fails else f"FAILS: {fails}")
json.dump({"address": c.address, "test": True}, open(os.path.join(os.path.dirname(__file__), "ArcPerps.test.deploy.json"), "w"))
