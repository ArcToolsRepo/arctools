"""Find every CCTP burn aimed at ArcBridgeFeeProxyV2 (destinationCaller) on Base / Arbitrum / Ethereum over the last N days,
check whether its nonce was consumed on Arc, and (with --fix) complete the missing ones via proxy.bridgeReceive."""
import json, os, sys, time, urllib.request
from web3 import Web3
from eth_utils import keccak

PROXY = "0x292ddaed9b959cbe4df5ac35c52da1977e29916e"; TM = Web3.to_checksum_address("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d")
TRANSMITTER = Web3.to_checksum_address("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64")   # MessageTransmitterV2, same on every chain
TOPIC = "0x" + keccak(text="DepositForBurn(address,uint256,address,bytes32,uint32,bytes32,bytes32,uint256,uint32,bytes)").hex()
SRC = {6: ("Base", "https://mainnet.base.org", 2.0, 4000), 3: ("Arbitrum", "https://arb1.arbitrum.io/rpc", 0.25, 20000), 0: ("Ethereum", "https://eth.merkle.io", 12.0, 800)}
DAYS = float(sys.argv[1]) if len(sys.argv) > 1 else 14; FIX = "--fix" in sys.argv
arc = Web3(Web3.HTTPProvider("http://178.156.197.90:8545")); tr = arc.eth.contract(address=TRANSMITTER, abi=[{"name": "usedNonces", "type": "function", "stateMutability": "view", "inputs": [{"name": "", "type": "bytes32"}], "outputs": [{"name": "", "type": "uint256"}]}])
UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
def iris(domain, tx):
    for attempt in range(3):
        try:
            j = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://iris-api.circle.com/v2/messages/{domain}?transactionHash={tx}", headers=UA), timeout=30).read())
            return (j.get("messages") or [None])[0]
        except urllib.error.HTTPError as e:
            if e.code == 404: return {"status": "not-found"}
            time.sleep(2)
        except Exception: time.sleep(2)
    return None
missing = []
for dom, (name, rpc, bt, span) in SRC.items():
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 60})); head = w3.eth.block_number; frm = head - int(DAYS * 86400 / bt); n = 0; ours = 0
    while frm <= head:
        to = min(head, frm + span)
        try: logs = w3.eth.get_logs({"address": TM, "topics": [TOPIC], "fromBlock": frm, "toBlock": to})
        except Exception as e: print(name, "getLogs", frm, str(e)[:60]); time.sleep(1); span = max(200, span // 2); continue
        for lg in logs:
            n += 1; d = lg["data"].hex(); w = [d[i:i + 64] for i in range(0, len(d), 64)]
            if len(w) < 7 or int(w[2], 16) != 26 or w[4][-40:] != PROXY[2:]: continue
            ours += 1; amount = int(w[0], 16) / 1e6; depositor = "0x" + lg["topics"][2].hex()[-40:]; tx = "0x" + lg["transactionHash"].hex().replace("0x", "")
            m = iris(dom, tx); time.sleep(0.4)
            status = m.get("status") if m else "no-iris"; nonce = m.get("eventNonce") if m else None
            used = bool(tr.functions.usedNonces(bytes.fromhex(nonce[2:])).call()) if nonce else None
            print(f"{name} blk {lg['blockNumber']} tx {tx[:12]}… {amount:.2f} USDC depositor {depositor[:10]}… iris={status} minted={used}")
            if status == "complete" and used is False: missing.append((dom, name, tx, amount, depositor, m))
        frm = to + 1
    print(f"== {name}: {n} burns scanned, {ours} ours")
print("MISSING:", [(x[1], x[2][:12], x[3], x[4][:10]) for x in missing])
if FIX and missing:
    acct = arc.eth.account.from_key(os.environ["DEPLOYER_KEY"])
    c = arc.eth.contract(address=Web3.to_checksum_address(PROXY), abi=[{"name": "bridgeReceive", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "message", "type": "bytes"}, {"name": "attestation", "type": "bytes"}], "outputs": []}])
    for dom, name, tx, amount, depositor, m in missing:
        t = c.functions.bridgeReceive(bytes.fromhex(m["message"][2:]), bytes.fromhex(m["attestation"][2:])).build_transaction({"from": acct.address, "nonce": arc.eth.get_transaction_count(acct.address)})
        for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"): t.pop(k, None)
        t["gasPrice"] = int(arc.eth.gas_price * 1.2); t["gas"] = int(arc.eth.estimate_gas(t) * 1.5) + 50000
        raw = "0x" + acct.sign_transaction(t).raw_transaction.hex()
        r = json.loads(urllib.request.urlopen(urllib.request.Request("https://arctools.fun/api/rpc", data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": [raw]}).encode(), headers={"content-type": "application/json", **UA}), timeout=30).read())
        h = r.get("result"); rc = arc.eth.wait_for_transaction_receipt(h, 120) if h else None
        print("FIXED", name, tx[:12], amount, "->", depositor, "arc", h, "status", rc.status if rc else r)
