import os
"""E2E: ETH on Base -> ArcAggregator buy on Arc in one origin tx, via Relay (destination call).
Usage: python3 relay_e2e.py quote|send [token] [usdc_amount]
"""
import json, sys, time, urllib.request
from web3 import Web3

AGG = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"; ZERO = "0x" + "0" * 40; ARC_RPC = "http://178.156.197.90:8545"; BASE_RPC = "https://mainnet.base.org"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"; FEE_BPS = 150
KEY = os.environ["E2E_KEY"]
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36", "content-type": "application/json"}
def get(url): return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
def post(url, body):
    try: return json.loads(urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(), headers=UA), timeout=60).read())
    except urllib.error.HTTPError as e: return {"http": e.code, "body": e.read().decode()[:500]}
p32 = lambda a: a[2:].lower().rjust(64, "0"); pn = lambda n: format(int(n), "064x")

def buy_calldata(token, usdc_wei, to):
    r = get(f"https://arctools.fun/api/swaproute?token={token}&side=buy&amount={usdc_wei}")
    if not r.get("legs"): raise SystemExit(f"no route: {r}")
    legs = "".join(pn(l["venue"]) + p32(l["target"]) + pn(l["fee"]) + p32((l["key"] or {}).get("currency0", ZERO)) + p32((l["key"] or {}).get("currency1", ZERO)) + pn((l["key"] or {}).get("fee", 0))
                   + pn(int((l["key"] or {}).get("tick_spacing", 0)) % 2**256) + p32((l["key"] or {}).get("hooks", ZERO)) + pn(l["amount"]) for l in r["legs"])
    data = "0x9125f3db" + p32(token) + pn(0xa0) + pn(0) + p32(to) + pn(FEE_BPS) + pn(len(r["legs"])) + legs
    value = usdc_wei + usdc_wei * FEE_BPS // 10_000
    return data, value, r

def relay_quote(user, token, usdc_wei, gas=700_000):
    data, value, route = buy_calldata(token, usdc_wei, user)
    q = {"user": user, "recipient": user, "originChainId": 8453, "destinationChainId": 5042, "originCurrency": ZERO, "destinationCurrency": ZERO,
         "amount": str(value), "tradeType": "EXACT_OUTPUT", "txs": [{"to": AGG, "value": str(value), "data": data}], "txsGasLimit": gas, "refundTo": user}
    res = post("https://api.relay.link/quote", q)
    return res, route, value

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "quote"; token = (sys.argv[2] if len(sys.argv) > 2 else "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52").lower()
    usdc = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0; usdc_wei = int(usdc * 1e18)
    base = Web3(Web3.HTTPProvider(BASE_RPC)); arc = Web3(Web3.HTTPProvider(ARC_RPC)); acct = base.eth.account.from_key(KEY); U = acct.address
    res, route, value = relay_quote(U, token, usdc_wei, gas=int(sys.argv[4]) if len(sys.argv) > 4 else 700_000)
    if "details" not in res: print("quote failed", res); raise SystemExit(1)
    d = res["details"]; print(f"route: {[l['label'] for l in route['legs']]} expect {int(route['out'])/1e18:.1f} tokens for {usdc} USDC (+{FEE_BPS/100}% fee)")
    print(f"relay: pay {d['currencyIn']['amountFormatted']} ETH on Base -> {d['currencyOut']['amountFormatted']} USDC on Arc | ~{d.get('timeEstimate')} s | relay fees {[(k, v.get('amountUsd')) for k, v in res['fees'].items()]}")
    steps = res["steps"]; print("steps:", [(s["id"], [(i["data"]["to"], i["data"].get("value"), i["data"].get("chainId")) for i in s["items"]]) for s in steps])
    if mode != "send": raise SystemExit(0)
    ERC = arc.eth.contract(address=Web3.to_checksum_address(token), abi=[{"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [{"name": "", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]}])
    bal0 = ERC.functions.balanceOf(U).call(); tre0 = arc.eth.get_balance(TREASURY); eth0 = base.eth.get_balance(U)
    for s in steps:
        for it in s["items"]:
            tx = it["data"]; t = {"from": U, "to": Web3.to_checksum_address(tx["to"]), "data": tx["data"], "value": int(tx.get("value", "0")), "chainId": 8453, "nonce": base.eth.get_transaction_count(U)}
            if tx.get("maxFeePerGas"): t["maxFeePerGas"] = int(tx["maxFeePerGas"]); t["maxPriorityFeePerGas"] = int(tx.get("maxPriorityFeePerGas", 0))
            else: t["gasPrice"] = base.eth.gas_price
            t["gas"] = int(tx.get("gas") or base.eth.estimate_gas(t) * 1.3)
            h = base.eth.send_raw_transaction(acct.sign_transaction(t).raw_transaction); print("origin tx", h.hex()); rc = base.eth.wait_for_transaction_receipt(h, 180); assert rc.status == 1, rc
            t0 = time.time(); chk = it.get("check", {}); url = "https://api.relay.link" + chk.get("endpoint", f"/intents/status/v2?requestId={res['details'].get('requestId','')}") if chk else None
            while url:
                st = get(url); print(f"  +{time.time()-t0:4.1f}s status {st.get('status')} {st.get('details','')[:80] if isinstance(st.get('details'), str) else ''}")
                if st.get("status") in ("success", "failure", "refund"): print("  relay:", {k: st.get(k) for k in ("status", "txHashes", "destinationChainId", "details") if k in st}); break
                time.sleep(2)
                if time.time() - t0 > 240: print("  timeout waiting for fill"); break
    time.sleep(3); bal1 = ERC.functions.balanceOf(U).call(); tre1 = arc.eth.get_balance(TREASURY); eth1 = base.eth.get_balance(U)
    print(f"RESULT: tokens +{(bal1-bal0)/1e18:.2f} | treasury fee +{(tre1-tre0)/1e18:.6f} USDC | ETH spent {(eth0-eth1)/1e18:.6f}")
