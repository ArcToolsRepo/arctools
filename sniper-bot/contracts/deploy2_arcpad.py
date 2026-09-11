import os
"""Deploy fixed ArcPad (vault + launchpad) with simulation-first sends."""
import json
import time

import solcx
from web3 import Web3

RPC = "https://rpc.arc-scan.org"
CHAIN = 5042
KEY = os.environ["DEPLOYER_KEY"]
ARCT = "0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
acct = w3.eth.account.from_key(KEY)
print("balance:", w3.eth.get_balance(acct.address) / 1e18)

solcx.set_solc_version("0.8.24")
out = solcx.compile_source(open("ArcPad.sol").read(), output_values=["abi", "bin"],
                           optimize=True, optimize_runs=200, via_ir=True)
vault_c = out["<stdin>:ArcRewardsVault"]
pad_c = out["<stdin>:ArcPadLaunchpad"]
token_c = out["<stdin>:ArcPadToken"]

gp = int(w3.eth.gas_price * 1.15)


def send(fn_or_tx, gas, value=0):
    if hasattr(fn_or_tx, "build_transaction"):
        # simulate first (with from!) so a revert never costs gas
        fn_or_tx.call({"from": acct.address, "value": value})
        tx = fn_or_tx.build_transaction({
            "chainId": CHAIN, "gasPrice": gp, "gas": gas, "value": value,
            "nonce": w3.eth.get_transaction_count(acct.address), "from": acct.address})
    else:
        tx = fn_or_tx
        tx.update({"chainId": CHAIN, "gasPrice": gp, "gas": gas, "value": value,
                   "nonce": w3.eth.get_transaction_count(acct.address), "from": acct.address})
    tx.pop("maxFeePerGas", None)
    tx.pop("maxPriorityFeePerGas", None)
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.rawTransaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=90)
    assert r["status"] == 1, f"tx failed {h.hex()}"
    return r


Vault = w3.eth.contract(abi=vault_c["abi"], bytecode=vault_c["bin"])
r = send(Vault.constructor(ARCT).build_transaction({"from": acct.address}), 1_600_000)
VAULT = r["contractAddress"]
print("vault:", VAULT)

Pad = w3.eth.contract(abi=pad_c["abi"], bytecode=pad_c["bin"])
r = send(Pad.constructor(VAULT, TREASURY).build_transaction({"from": acct.address}), 4_200_000)
PAD = r["contractAddress"]
print("launchpad:", PAD)

vault = w3.eth.contract(address=VAULT, abi=vault_c["abi"])
pad = w3.eth.contract(address=PAD, abi=pad_c["abi"])
time.sleep(2)
send(vault.functions.setLaunchpad(PAD), 100_000)
print("wired")

send(pad.functions.createToken("ArcPad Test", "APTEST", 100, 200, 100, acct.address,
                               "https://arctools.fun", "", ""), 3_200_000)
tok = pad.functions.tokens(0).call()
print("test token:", tok)

q = pad.functions.quoteBuy(tok, int(0.05e18)).call()
send(pad.functions.buy(tok, int(q * 0.98)), 900_000, value=int(0.05e18))
tc = w3.eth.contract(address=tok, abi=token_c["abi"])
bal = tc.functions.balanceOf(acct.address).call()
print("buy ok, tokens:", bal / 1e18)

qs = pad.functions.quoteSell(tok, bal // 2).call()
send(pad.functions.sell(tok, bal // 2, int(qs * 0.98)), 900_000)
print("sell ok:", qs / 1e18, "USDC")

print("curve:", pad.functions.tokenPage(tok).call()[1])
print("vault pendingUsdc:", vault.functions.pendingUsdc().call() / 1e18)
print("project rewards claimable:", pad.functions.claimable(tok, acct.address).call() / 1e18)
print("dead balance (burn):", tc.functions.balanceOf("0x000000000000000000000000000000000000dEaD").call() / 1e18)
print("FINAL:", w3.eth.get_balance(acct.address) / 1e18)

json.dump({"vault": VAULT, "launchpad": PAD, "abi_pad": pad_c["abi"],
           "abi_vault": vault_c["abi"], "abi_token": token_c["abi"]},
          open("arcpad_deploy.json", "w"))
print("saved")
