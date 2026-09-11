import os
"""Compile + deploy ArcPad (vault + launchpad) on Arc mainnet, then smoke-test."""
import json
import sys
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
print("deployer:", acct.address, "balance:", w3.eth.get_balance(acct.address) / 1e18)

solcx.set_solc_version("0.8.24")
src = open("ArcPad.sol").read()
out = solcx.compile_source(src, output_values=["abi", "bin"], optimize=True, optimize_runs=200, via_ir=True)
vault_c = out["<stdin>:ArcRewardsVault"]
pad_c = out["<stdin>:ArcPadLaunchpad"]
token_c = out["<stdin>:ArcPadToken"]

gp = int(w3.eth.gas_price * 1.3)
nonce = w3.eth.get_transaction_count(acct.address)


def send(tx):
    global nonce
    tx.pop("maxFeePerGas", None)
    tx.pop("maxPriorityFeePerGas", None)
    tx.update({"chainId": CHAIN, "gasPrice": gp, "nonce": nonce, "from": acct.address})
    if "gas" not in tx:
        tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.25)
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.rawTransaction)
    nonce += 1
    r = w3.eth.wait_for_transaction_receipt(h, timeout=60)
    assert r["status"] == 1, f"tx failed {h.hex()}"
    return r


# 1. vault
Vault = w3.eth.contract(abi=vault_c["abi"], bytecode=vault_c["bin"])
r = send(Vault.constructor(ARCT).build_transaction())
vault_addr = r["contractAddress"]
print("vault:", vault_addr, "gas:", r["gasUsed"])

# 2. launchpad
Pad = w3.eth.contract(abi=pad_c["abi"], bytecode=pad_c["bin"])
r = send(Pad.constructor(vault_addr, TREASURY).build_transaction())
pad_addr = r["contractAddress"]
print("launchpad:", pad_addr, "gas:", r["gasUsed"])

# 3. wire
vault = w3.eth.contract(address=vault_addr, abi=vault_c["abi"])
r = send(vault.functions.setLaunchpad(pad_addr).build_transaction())
print("setLaunchpad ok")

# 4. smoke test: create + buy + sell
pad = w3.eth.contract(address=pad_addr, abi=pad_c["abi"])
r = send(pad.functions.createToken(
    "ArcPad Test", "APTEST", 100, 200, 100, acct.address,
    "https://arctools.fun", "", "").build_transaction())
tok = pad.functions.tokens(0).call()
print("test token:", tok, "gas:", r["gasUsed"])

q = pad.functions.quoteBuy(tok, int(0.05e18)).call()
r = send(pad.functions.buy(tok, int(q * 0.98)).build_transaction({"value": int(0.05e18)}))
print("buy ok, gas:", r["gasUsed"])
tc = w3.eth.contract(address=tok, abi=token_c["abi"])
bal = tc.functions.balanceOf(acct.address).call()
print("token balance:", bal / 1e18)

qs = pad.functions.quoteSell(tok, bal // 2).call()
r = send(pad.functions.sell(tok, bal // 2, int(qs * 0.98)).build_transaction())
print("sell ok, gas:", r["gasUsed"])

page = pad.functions.tokenPage(tok).call()
print("tokenPage curve:", page[1])
print("vault pendingUsdc:", vault.functions.pendingUsdc().call() / 1e18)
print("FINAL balance:", w3.eth.get_balance(acct.address) / 1e18)

json.dump({"vault": vault_addr, "launchpad": pad_addr,
           "abi_pad": pad_c["abi"], "abi_vault": vault_c["abi"], "abi_token": token_c["abi"]},
          open("arcpad_deploy.json", "w"))
print("saved arcpad_deploy.json")
