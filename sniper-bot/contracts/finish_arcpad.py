import os
"""Finish ArcPad deployment: wire vault->launchpad, smoke test, save ABIs."""
import json
import time

import solcx
from web3 import Web3

RPC = "https://rpc.arc-scan.org"
CHAIN = 5042
KEY = os.environ["DEPLOYER_KEY"]
VAULT = "0x416aCd6c51361b107b597B847325d9f57668303C"
PAD = "0x5b15eD6795f22B3d748530BFd8D9674771cE3215"

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
acct = w3.eth.account.from_key(KEY)
print("balance:", w3.eth.get_balance(acct.address) / 1e18)

solcx.set_solc_version("0.8.24")
out = solcx.compile_source(open("ArcPad.sol").read(), output_values=["abi", "bin"],
                           optimize=True, optimize_runs=200, via_ir=True)
vault_c = out["<stdin>:ArcRewardsVault"]
pad_c = out["<stdin>:ArcPadLaunchpad"]
token_c = out["<stdin>:ArcPadToken"]

gp = int(w3.eth.gas_price * 1.3)


def send(fn, gas, value=0):
    for attempt in range(4):
        try:
            tx2 = fn.build_transaction({
                "chainId": CHAIN, "gasPrice": gp, "gas": gas, "value": value,
                "nonce": w3.eth.get_transaction_count(acct.address),
                "from": acct.address})
            tx2.pop("maxFeePerGas", None)
            tx2.pop("maxPriorityFeePerGas", None)
            signed = acct.sign_transaction(tx2)
            h = w3.eth.send_raw_transaction(signed.rawTransaction)
            r = w3.eth.wait_for_transaction_receipt(h, timeout=90)
            if r["status"] == 1:
                return r
            print("status 0, retry", attempt)
        except Exception as e:
            print("retry", attempt, str(e)[:120])
        time.sleep(3)
    raise SystemExit("tx failed")


vault = w3.eth.contract(address=VAULT, abi=vault_c["abi"])
pad = w3.eth.contract(address=PAD, abi=pad_c["abi"])

if vault.functions.launchpad().call() == "0x0000000000000000000000000000000000000000":
    send(vault.functions.setLaunchpad(PAD), 100_000)
    print("setLaunchpad ok ->", vault.functions.launchpad().call())
else:
    print("launchpad already set:", vault.functions.launchpad().call())

# smoke test
if pad.functions.tokenCount().call() == 0:
    send(pad.functions.createToken(
        "ArcPad Test", "APTEST", 100, 200, 100, acct.address,
        "https://arctools.fun", "", ""), 3_000_000)
tok = pad.functions.tokens(0).call()
print("test token:", tok)

q = pad.functions.quoteBuy(tok, int(0.05e18)).call()
print("quoteBuy 0.05 USDC ->", q / 1e18, "tokens")
send(pad.functions.buy(tok, int(q * 0.98)), 800_000, value=int(0.05e18))
tc = w3.eth.contract(address=tok, abi=token_c["abi"])
bal = tc.functions.balanceOf(acct.address).call()
print("buy ok, balance:", bal / 1e18)

qs = pad.functions.quoteSell(tok, bal // 2).call()
send(pad.functions.sell(tok, bal // 2, int(qs * 0.98)), 800_000)
print("sell ok, got quote:", qs / 1e18)

page = pad.functions.tokenPage(tok).call()
print("curve:", page[1])
print("vault pendingUsdc:", vault.functions.pendingUsdc().call() / 1e18)
print("claimable project rewards:", pad.functions.claimable(tok, acct.address).call() / 1e18)
print("FINAL balance:", w3.eth.get_balance(acct.address) / 1e18)

json.dump({"vault": VAULT, "launchpad": PAD, "abi_pad": pad_c["abi"],
           "abi_vault": vault_c["abi"], "abi_token": token_c["abi"]},
          open("arcpad_deploy.json", "w"))
print("saved")
