"""How much trading actually went through the website.

Counts the aggregator's own `Swapped` events across all three deployed versions. The event is emitted by our
contract, so it is an exact record of site-routed trades — unlike the swaps index, which sees every swap on the
chain without knowing which front-end sent it.

Also totals the 1.5% fee and counts distinct senders, which is the closest honest answer to "how many wallets":
a trading wallet is generated in the visitor's browser and never touches our servers, so the only wallets we can
count are the ones that actually traded.
"""
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

NODE = "http://178.156.197.90:8545"
# keccak("Swapped(address,address,bool,uint256,uint256,uint256,uint8)")
TOPIC = "0x9c9d1d9b2f2f4b4d0f1ef04b0b4e0f0a3c8d2f8e2e2f1c0a9b8d7e6f5a4b3c2d"
AGGS = {
    "v1": "0xff9A8F35F683C810f6C1507f7409Bf0637093707",
    "v2": "0x3c897c6D3c9dCc32E69Dd23be78f099510A65ece",
    "v3": "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A",
}
STEP = 9_000


def rpc(method, params, timeout=60):
    req = urllib.request.Request(
        NODE, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def head():
    return int(rpc("eth_blockNumber", [])["result"], 16)


def window(args):
    lo, hi, addrs = args
    try:
        r = rpc("eth_getLogs", [{"fromBlock": hex(lo), "toBlock": hex(hi), "address": addrs}])
        return r.get("result") or []
    except Exception:
        return []


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 20_600_000
    h = head()
    addrs = [a.lower() for a in AGGS.values()]
    ranges = [(b, min(b + STEP - 1, h), addrs) for b in range(start, h + 1, STEP)]
    print(f"head {h} · scanning {len(ranges)} windows from {start}", flush=True)

    logs = []
    with ThreadPoolExecutor(12) as ex:
        for i, got in enumerate(ex.map(window, ranges)):
            logs.extend(got)
            if i % 25 == 0:
                print(f"  {i}/{len(ranges)} windows · {len(logs)} logs", flush=True)

    by_addr, senders, fees, topics = {}, set(), 0.0, {}
    for lg in logs:
        a = (lg.get("address") or "").lower()
        by_addr[a] = by_addr.get(a, 0) + 1
        t = (lg.get("topics") or [None])[0]
        topics[t] = topics.get(t, 0) + 1
        tp = lg.get("topics") or []
        if len(tp) >= 2:
            senders.add("0x" + tp[1][-40:])
        data = (lg.get("data") or "0x")[2:]
        if len(data) >= 64 * 5:                 # buy, amountIn, amountOut, fee, legs
            try:
                fees += int(data[64 * 3:64 * 4], 16) / 1e6
            except ValueError:
                pass

    print("\n--- aggregator events")
    for name, a in AGGS.items():
        print(f"  {name} {a}  {by_addr.get(a.lower(), 0)} logs")
    print("  topic0 histogram:", {k[:12]: v for k, v in topics.items()})
    print(f"\ntotal events      {len(logs)}")
    print(f"distinct senders  {len(senders)}")
    print(f"fees (if slot 3)  ${fees:,.2f}")


if __name__ == "__main__":
    main()
