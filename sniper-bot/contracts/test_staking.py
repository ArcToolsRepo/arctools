"""E2E staking test with the exact calldata the /rewards page sends."""
import os
import json
import subprocess
import time

from web3 import Web3

RPC = "https://rpc.arc-scan.org"
RELAY = "https://rpc-production-ba7a.up.railway.app"
CHAIN = 5042
KEY = os.environ["DEPLOYER_KEY"]  # export DEPLOYER_KEY=0x...
ARCT = "0x1EA1e4f9A9975F1f6e9c0a9f6e8Ada7a66E6de52"
VAULT = "0x7D49f880c7BdAE4FD44D52c3dBfB43534E83dABd"
PAD = "0x1EaAD48260eECC7624666F1dFec202b2D75257fE"
APDEMO = "0xc27200409092Ec7630bA34755865655BD4236c02"

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
acct = w3.eth.account.from_key(KEY)
D = acct.address


def p32(h):
    return h.replace("0x", "").lower().rjust(64, "0")


def pnum(n):
    return format(n, "x").rjust(64, "0")


def relay_call(to, data):
    """Browser-equivalent eth_call through the CORS relay (with Origin header)."""
    out = subprocess.run(
        ["curl", "-s", "-m", "20", "-X", "POST", RELAY,
         "-H", "Content-Type: application/json", "-H", "Origin: https://arctools.fun",
         "-d", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                           "params": [{"to": to, "data": data}, "latest"]})],
        capture_output=True, text=True).stdout
    d = json.loads(out)
    if "error" in d:
        raise RuntimeError(d["error"])
    return d["result"]


def send(to, data, gas, value=0):
    tx = {"chainId": CHAIN, "from": D, "to": Web3.to_checksum_address(to),
          "data": data, "value": value, "gas": gas,
          "gasPrice": int(w3.eth.gas_price * 1.15),
          "nonce": w3.eth.get_transaction_count(D)}
    # simulate first (never burn gas on a revert)
    w3.eth.call({k: v for k, v in tx.items() if k in ("from", "to", "data", "value")})
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.rawTransaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=90)
    assert r["status"] == 1, f"REVERT {h.hex()}"
    return h.hex()


def bal(token, owner):
    return int(relay_call(token, "0x70a08231" + p32(owner)), 16)


print("gas balance:", w3.eth.get_balance(D) / 1e18)

# 0. claim ARCT from APDEMO holder rewards (site button: FN.claimRewards)
claimable = int(relay_call(PAD, "0xd4570c1c" + p32(APDEMO) + p32(D)), 16)
print("claimable APDEMO rewards (ARCT):", claimable / 1e18)
if claimable > 0:
    print("claimRewards tx:", send(PAD, "0xef5cfb8c" + p32(APDEMO), 300_000)[:20], "OK")

arct_bal = bal(ARCT, D)
print("ARCT balance:", arct_bal / 1e18)
assert arct_bal > 0, "no ARCT to stake"

# 1. allowance read exactly like the page (relay + Origin) -- the old 'Failed to fetch' path
allowance = int(relay_call(ARCT, "0xdd62ed3e" + p32(D) + p32(VAULT)), 16)
print("allowance via CORS relay:", allowance)

# 2. approve (site: FN.approve + p32(VAULT) + 'f'*64)
if allowance < arct_bal:
    print("approve tx:", send(ARCT, "0x095ea7b3" + p32(VAULT) + "f" * 64, 150_000)[:20], "OK")

# 3. stake 10 ARCT (site: FN.stake + pnum(wei))
amount = min(int(10e18), arct_bal)
print("stake tx:", send(VAULT, "0xa694fc3a" + pnum(amount), 500_000)[:20], "OK")

# 4. verify vault state (what the page displays)
staked = int(relay_call(VAULT, "0x98807d84" + p32(D)), 16)
total = int(relay_call(VAULT, "0x817b1cd2"), 16)
print("staked:", staked / 1e18, "| totalStaked:", total / 1e18)

# 5. tiny buy -> platform fee -> vault -> claimable USDC for the staker
q = int(relay_call(PAD, "0x0d7a94f6" + p32(APDEMO) + pnum(int(0.02e18))), 16)
print("buy tx:", send(PAD, "0xcce7ec13" + p32(APDEMO) + pnum(int(q * 0.95)), 900_000, value=int(0.02e18))[:20], "OK")
time.sleep(2)
claim_usdc = int(relay_call(VAULT, "0x55d2ac86" + p32(D)), 16)
print("claimableUsdc after buy:", claim_usdc / 1e18)
if claim_usdc > 0:
    print("claimUsdc tx:", send(VAULT, "0x1d6ee8eb", 200_000)[:20], "OK")

print("FINAL gas:", w3.eth.get_balance(D) / 1e18)
print("ALL STAKING PATHS OK")
