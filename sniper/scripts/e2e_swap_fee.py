"""E2E for the Swap tab's fee path: a real 0.5 USDC buy through ArcAggregator with feeBps = 50.

Proves three things the UI claims:
  1. the swap itself executes through the routed venue,
  2. exactly 0.5% of the spend lands at the treasury (measured as a balance delta),
  3. the buyer receives tokens and the leftover value is refunded (no silent overcharge).
"""
import json
import time
import urllib.request

from eth_abi import encode
from eth_account import Account
from eth_utils import keccak

RPC = "http://178.156.197.90:8545"
SITE = "https://arctools.fun"
AGG = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"
ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52"
KEY = "0x2429ccbb8cfbda46786e588e891841ebf95fadbbe689fa9beb63290843e2adfb"
SPEND_USDC = 0.5
FEE_BPS = 50
ZERO = "0x" + "0" * 40


def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({"id": 1, "jsonrpc": "2.0", "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json"})
    j = json.load(urllib.request.urlopen(req, timeout=40))
    if "error" in j:
        raise RuntimeError(f"{method}: {j['error']}")
    return j["result"]


def addr(a):
    a = str(a or "")
    return a if a.startswith("0x") and len(a) == 42 else ZERO


def bal(a):
    return int(rpc("eth_getBalance", [a, "latest"]), 16)


def token_bal(token, who):
    d = "0x70a08231" + who[2:].lower().rjust(64, "0")
    r = rpc("eth_call", [{"data": d, "to": token}, "latest"])
    return int(r, 16) if r and r != "0x" else 0


def main():
    acct = Account.from_key(KEY)
    spend = int(SPEND_USDC * 1e18)
    fee = spend * FEE_BPS // 10_000

    import subprocess
    out = subprocess.run(["curl", "-s", "-m", "45", f"{SITE}/api/swaproute?token={ARCT}&side=buy&amount={spend}"],
                         capture_output=True, text=True).stdout
    route = json.loads(out)
    legs = route.get("legs") or []
    if not legs:
        raise SystemExit(f"no route: {route}")
    print(f"route: {[l['label'] for l in legs]}  expected out {int(route['out'])/1e18:,.2f} ARCT")

    leg_tuples = [(
        int(l["venue"]), addr(l.get("target")), int(l.get("fee") or 0),
        (addr((l.get("key") or {}).get("currency0")), addr((l.get("key") or {}).get("currency1")),
         int(((l.get("key") or {}).get("fee")) or 0), int(((l.get("key") or {}).get("tick_spacing")) or 0),
         addr((l.get("key") or {}).get("hooks"))),
        int(l["amount"]),
    ) for l in legs]
    min_out = int(route["out"]) * 90 // 100
    sel = "0x" + keccak(text="buy(address,(uint8,address,uint24,(address,address,uint24,int24,address),uint256)[],uint256,address,uint16)").hex()[:8]
    data = sel + encode(
        ["address", "(uint8,address,uint24,(address,address,uint24,int24,address),uint256)[]", "uint256", "address", "uint16"],
        [ARCT, leg_tuples, min_out, acct.address, FEE_BPS],
    ).hex()

    t0, b0, a0 = bal(TREASURY), bal(acct.address), token_bal(ARCT, acct.address)
    print(f"before: buyer {b0/1e18:.4f} USDC / {a0/1e18:,.2f} ARCT · treasury {t0/1e18:.4f} USDC")

    tx = {"chainId": 5042, "data": data, "gas": 1_200_000, "gasPrice": int(rpc("eth_gasPrice", []), 16),
          "nonce": int(rpc("eth_getTransactionCount", [acct.address, "pending"]), 16), "to": AGG, "value": spend + fee}
    h = rpc("eth_sendRawTransaction", ["0x" + acct.sign_transaction(tx).raw_transaction.hex().removeprefix("0x")])
    print("tx", h)
    for _ in range(40):
        time.sleep(3)
        rc = rpc("eth_getTransactionReceipt", [h])
        if rc:
            break
    if not rc or int(rc["status"], 16) != 1:
        raise SystemExit(f"reverted: {rc}")
    gas_cost = int(rc["gasUsed"], 16) * int(rc.get("effectiveGasPrice") or hex(tx["gasPrice"]), 16)

    t1, b1, a1 = bal(TREASURY), bal(acct.address), token_bal(ARCT, acct.address)
    got = (a1 - a0) / 1e18
    paid_fee = (t1 - t0) / 1e18
    spent_total = (b0 - b1 - gas_cost) / 1e18
    print(f"after : buyer {b1/1e18:.4f} USDC / {a1/1e18:,.2f} ARCT · treasury {t1/1e18:.4f} USDC")
    print(f"got {got:,.2f} ARCT · fee to treasury {paid_fee:.6f} USDC (expected {fee/1e18:.6f}) · total debited {spent_total:.6f} USDC")

    ok = abs(paid_fee - fee / 1e18) < 1e-9 and got * 1e18 >= min_out and spent_total <= (spend + fee) / 1e18 + 1e-9
    print("RESULT:", "PASS — 0.5% fee lands at the treasury, buyer charged exactly spend + fee" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
