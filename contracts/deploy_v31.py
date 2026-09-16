"""Deploy ArcRewardsVault (v3 instance) + ArcPadLaunchpadV3, wire them, set a tiny minTarget for mainnet smoke tests."""
import json
import os

import solcx
from web3 import Web3

RPC = "https://rpc.arc-scan.org"
CHAIN = 5042
KEY = os.environ["DEPLOYER_KEY"]
ARCT = "0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52"
TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D"

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 40}))
acct = w3.eth.account.from_key(KEY)
print("deployer:", acct.address, "balance:", w3.eth.get_balance(acct.address) / 1e18)

solcx.set_solc_version("0.8.24")
src = open("ArcPadV3.sol").read().replace("0x39654a85A4C05127f5fd6ed22caEc077A0fB1377", "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377")
open("ArcPadV3.sol", "w").write(src)
v3 = solcx.compile_source(src, output_values=["abi", "bin"], optimize=True, optimize_runs=200, via_ir=True)["<stdin>:ArcPadLaunchpadV3"]
print("v3 bytecode:", len(v3["bin"]) // 2, "bytes")
vault_c = solcx.compile_source(open("ArcRewardsVaultV3.sol").read(), output_values=["abi", "bin"], optimize=True, optimize_runs=200, via_ir=True)["<stdin>:ArcRewardsVault"]

gp = int(w3.eth.gas_price * 1.15)


def send_raw(tx, gas):
    tx.update({"chainId": CHAIN, "gasPrice": gp, "gas": gas, "nonce": w3.eth.get_transaction_count(acct.address), "from": acct.address})
    tx.pop("maxFeePerGas", None); tx.pop("maxPriorityFeePerGas", None)
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).rawTransaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    assert r["status"] == 1, f"failed {h.hex()}"
    return r


def send(fn, gas):
    fn.call({"from": acct.address})
    return send_raw(fn.build_transaction({"from": acct.address}), gas)


Vault = w3.eth.contract(abi=vault_c["abi"], bytecode=vault_c["bin"])
r = send_raw(Vault.constructor(ARCT).build_transaction({"from": acct.address}), 1_700_000)
VAULT = r["contractAddress"]; print("vault v3:", VAULT, "gas", r["gasUsed"])

Pad = w3.eth.contract(abi=v3["abi"], bytecode=v3["bin"])
r = send_raw(Pad.constructor(VAULT, TREASURY).build_transaction({"from": acct.address}), 6_500_000)
PAD = r["contractAddress"]; print("launchpad v3:", PAD, "gas", r["gasUsed"])

vault = w3.eth.contract(address=VAULT, abi=vault_c["abi"])
pad = w3.eth.contract(address=PAD, abi=v3["abi"])
send(vault.functions.setLaunchpad(PAD), 100_000); print("vault.launchpad set")
print("minTarget:", pad.functions.minTarget().call()/1e18, "| instantFee:", pad.functions.instantFee().call()/1e18, "USDC")

json.dump({"launchpad": PAD, "vault": VAULT, "abi": v3["abi"], "vault_abi": vault_c["abi"]}, open("arcpad_deploy_v31.json", "w"), indent=1)
print("balance after:", w3.eth.get_balance(acct.address) / 1e18)
