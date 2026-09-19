"""Run the injected ArcSim probe against real tokens and print the verdict for each.

Usage: python3 scripts/test_arcsim.py [token ...]   (defaults to a spread of live Arc tokens)
"""
import json
import pathlib
import subprocess
import sys
import urllib.request

from eth_abi import decode, encode
from eth_utils import keccak

NODE = "http://178.156.197.90:8545"
SITE = "https://arctools.fun"
AGG = "0x43CdbF8edb8fE41ddE4ba519F49499D1ED78E74A"
PROBE = "0x00000000000000000000000000000000000f00d1"
ZERO = "0x" + "0" * 40
RUNTIME = "0x" + json.loads((pathlib.Path(__file__).resolve().parents[1] / "contracts" / "ArcSim.build.json").read_text())["runtime"]
SPEND = 10**18  # 1 USDC round trip

LEG_T = "(uint8,address,uint24,(address,address,uint24,int24,address),uint256)"
SIG = f"probe(address,address,{LEG_T}[],{LEG_T}[],uint256)"
STAGES = {0: "buy reverted", 1: "buy returned 0 tokens", 2: "CANNOT SELL (honeypot)", 3: "sell returned 0 USDC", 4: "tradable"}


def rpc(method, params):
    req = urllib.request.Request(NODE, data=json.dumps({"id": 1, "jsonrpc": "2.0", "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json"})
    j = json.load(urllib.request.urlopen(req, timeout=60))
    return {"__error": j["error"]} if "error" in j else j["result"]


def route(token, side, amount):
    out = subprocess.run(["curl", "-s", "-m", "45", f"{SITE}/api/swaproute?token={token}&side={side}&amount={amount}"],
                         capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {}


def legs_of(r):
    return [(
        int(l["venue"]), l.get("target") or ZERO, int(l.get("fee") or 0),
        ((l.get("key") or {}).get("currency0") or ZERO, (l.get("key") or {}).get("currency1") or ZERO,
         int(((l.get("key") or {}).get("fee")) or 0), int(((l.get("key") or {}).get("tick_spacing")) or 0),
         (l.get("key") or {}).get("hooks") or ZERO),
        int(l["amount"]),
    ) for l in (r.get("legs") or [])]


def probe(token):
    buy = route(token, "buy", SPEND)
    if not buy.get("legs"):
        return {"ok": False, "verdict": "no route", "detail": buy.get("error") or "no venue"}
    expect_tokens = int(buy.get("out") or 0)
    sell = route(token, "sell", expect_tokens) if expect_tokens else {}
    sell_legs = legs_of(sell) or [(l[0], l[1], l[2], l[3], expect_tokens) for l in legs_of(buy)]

    data = "0x" + keccak(text=SIG).hex()[:8] + encode(
        ["address", "address", f"{LEG_T}[]", f"{LEG_T}[]", "uint256"],
        [AGG, token, legs_of(buy), sell_legs, SPEND],
    ).hex()
    res = rpc("eth_call", [{"data": data, "from": PROBE, "to": PROBE, "value": hex(SPEND)}, "latest",
                           {PROBE: {"balance": hex(10 * 10**18), "code": RUNTIME}}])
    if isinstance(res, dict):
        return {"ok": False, "verdict": "probe error", "detail": str(res["__error"])[:110]}
    stage, bought, returned, sellable = decode(["uint8", "uint256", "uint256", "uint256"], bytes.fromhex(res[2:]))
    keep = returned / SPEND if returned else 0.0
    return {"bought": bought, "keep": keep, "ok": stage == 4, "returned": returned, "stage": stage,
            "verdict": STAGES.get(stage, "?")}


def main(tokens):
    print(f"{'token':<44} {'verdict':<24} round trip")
    for t in tokens:
        r = probe(t.lower())
        rt = f"{r['keep'] * 100:.1f}% back" if r.get("keep") else (r.get("detail") or "")
        print(f"{t:<44} {r['verdict']:<24} {rt}")


if __name__ == "__main__":
    args = sys.argv[1:] or [
        "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52",   # ARCT, known good
        "0x8c4252c87081c88c6ad57d6dd97e1cafebf842b7",   # WETH copy, active
        "0x2993e1e98bde9db95681389ead12731e31dfa509",   # VIRTUAL
        "0x5fef82d87e34db1d2d838685b589dedc1f5fcf1a",   # CHECK
    ]
    main(args)
